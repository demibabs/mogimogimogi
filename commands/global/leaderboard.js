const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const optimizedLeaderboard = require("../../utils/optimizedLeaderboard");
const embedEnhancer = require("../../utils/embedEnhancer");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("rank your server by stats.")
		.addStringOption(option =>
			option.setName("stat")
				.setDescription("the stat to rank by.")
				.setRequired(true)
				.addChoices(
					{ name : "mmr", value: "mMR" },
					{ name: "team win rate", value: "tWR" },
					{ name: "average score", value: "aS" },
					{ name: "highest score", value: "hS" },
					{ name: "events played", value: "eP" },
				))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("true = only mogis including other server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("true = squad only, false = solo only.")),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			const stat = interaction.options.getString("stat");
			const serverOnly = interaction.options.getBoolean("server-only") ?? false;
			const squads = interaction.options.getBoolean("squads");
			const serverId = interaction.guildId;

			// Generate leaderboard using optimized cache system
			const result = await this.generateLeaderboard(interaction, serverId, stat, serverOnly, squads, "all");

			if (!result) {
				return await interaction.editReply({
					content: "an error occurred while generating the leaderboard. please try again later.",
				});
			}

			// Create action row with three buttons (current one disabled)
			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setCustomId(`leaderboard_all_${stat}_${serverOnly}_${squads}`)
						.setLabel("all time")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId(`leaderboard_weekly_${stat}_${serverOnly}_${squads}`)
						.setLabel("past week")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(`leaderboard_season_${stat}_${serverOnly}_${squads}`)
						.setLabel("this season")
						.setStyle(ButtonStyle.Secondary),
				);

			await interaction.editReply({
				content: "",
				embeds: [result.embed],
				components: [row],
			});

		}
		catch (error) {
			console.error("error in leaderboard command:", error);
			await interaction.editReply({
				content: "an error occurred while generating the leaderboard. please try again later.",
			});
		}
	},

	// Handle button interactions
	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("leaderboard_")) return false;

		try {
			await interaction.deferUpdate();

			// Parse the custom ID to get parameters
			const parts = interaction.customId.split("_");
			const timeFilter = parts[1];
			const stat = parts[2];
			const serverOnly = parts[3] === "true";
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const serverId = interaction.guild.id;

			// Generate leaderboard using optimized system
			const result = await this.generateLeaderboard(interaction, serverId, stat, serverOnly, squads, timeFilter);

			if (result) {
				// Create action row with current button disabled
				const row = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`leaderboard_all_${stat}_${serverOnly}_${squads}`)
							.setLabel("all time")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "all"),
						new ButtonBuilder()
							.setCustomId(`leaderboard_weekly_${stat}_${serverOnly}_${squads}`)
							.setLabel("past week")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "weekly"),
						new ButtonBuilder()
							.setCustomId(`leaderboard_season_${stat}_${serverOnly}_${squads}`)
							.setLabel("this season")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "season"),
					);

				await interaction.editReply({ embeds: [result.embed], components: [row] });
			}

			return true;
		}
		catch (error) {
			console.error("Error in leaderboard button interaction:", error);
			return false;
		}
	},

	// Generate leaderboard using optimized cache system
	async generateLeaderboard(interaction, serverId, stat, serverOnly, squads, timeFilter = "all") {
		try {
			console.log(`Generating optimized leaderboard: ${stat}, ${timeFilter}, server-only: ${serverOnly}, squads: ${squads}`);

			// Get optimized leaderboard data from cache
			const leaderboardData = await optimizedLeaderboard.getLeaderboard(
				serverId,
				stat,
				timeFilter,
				serverOnly,
				squads,
			);

			if (!leaderboardData || leaderboardData.length === 0) {
				const embed = new EmbedBuilder()
					.setTitle("Leaderboard")
					.setDescription("no data available for the selected criteria.")
					.setColor("#FF6B6B");

				return { embed };
			}

			// Create embed
			const embed = new EmbedBuilder()
				.setColor("#00ff00")
				.setTimestamp();

			// Set title based on stat and time filter (simple lowercase style)
			const statNames = {
				"mMR": timeFilter === "weekly" ? "weekly mmr change" : timeFilter === "season" ? "season mmr change" : "mmr",
				"tWR": "team win rate",
				"aS": "average score",
				"hS": "highest score",
				"eP": "events played",
			};

			const timePrefix = timeFilter === "weekly" ? "weekly " : timeFilter === "season" ? "season " : "";
			const title = `${serverOnly ? "server " : ""}${squads ? "squad " : squads === false ? "soloq " : ""}${timePrefix}leaderboard - ${statNames[stat]}`;

			embed.setTitle(title);

			// Add simple footer
			let footerText = `showing top ${Math.min(leaderboardData.length, 10)} players`;
			if (timeFilter === "weekly") {
				footerText += " (past 7 days)";
			}
			else if (timeFilter === "season") {
				footerText += " (current season)";
			}
			embed.setFooter({ text: footerText });

			// Fetch Discord display names for all users in parallel
			const userFetches = leaderboardData.slice(0, 10).map(async (entry) => {
				try {
					const discordUser = await interaction.client.users.fetch(entry.userId);
					return {
						...entry,
						discordDisplayName: discordUser.displayName || discordUser.username,
					};
				}
				catch (error) {
					return entry;
				}
			});

			const entriesWithDiscordNames = await Promise.all(userFetches);

			// Format leaderboard entries (simple style, no emojis)
			let description = "";
			for (let i = 0; i < Math.min(entriesWithDiscordNames.length, 10); i++) {
				const entry = entriesWithDiscordNames[i];
				const rank = i + 1;

				// Use Discord display name first, then lounge name, then cached name
				const displayName = entry.discordDisplayName || entry.loungeUser?.name || entry.displayName;

				// Format player name with country flag
				const formattedName = embedEnhancer.formatPlayerNameWithFlag(
					displayName,
					entry.loungeUser?.countryCode,
				);

				// Format stat value
				let formattedValue;
				if (stat === "tWR") {
					formattedValue = `${(entry.statValue * 100).toFixed(1)}%`;
				}
				else if (stat === "aS") {
					formattedValue = entry.statValue.toFixed(1);
				}
				else if (stat === "mMR" && (timeFilter === "weekly" || timeFilter === "season")) {
					// Show + for MMR changes (only positive values are included)
					const change = Math.round(entry.statValue);
					formattedValue = `+${change}`;
				}
				else {
					formattedValue = Math.round(entry.statValue);
				}

				description += `${rank}. **${formattedName}**: ${formattedValue}\n`;
			}

			embed.setDescription(description);

			return { embed };
		}
		catch (error) {
			console.error("Error generating optimized leaderboard:", error);
			return null;
		}
	},
};