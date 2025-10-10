const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const DataManager = require("../../utils/dataManager");
const embedEnhancer = require("../../utils/embedEnhancer");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("stats")
		.setDescription("check your (or someone else's) stats.")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("yourself if left blank."))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("true = only mogis including other server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("true = squad only, false = solo only.")),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			const discordUser = interaction.options.getUser("user") || interaction.user;
			const serverOnly = interaction.options.getBoolean("server-only") ?? false;
			const squads = interaction.options.getBoolean("squads");
			const serverId = interaction.guildId;

			// Use generateStats for consistency with button interactions
			const result = await this.generateStats(interaction, discordUser, serverId, serverOnly, squads, "alltime");

			if (!result) {
				return await interaction.editReply({
					content: "an error occurred while generating stats. please try again later.",
				});
			}

			// Create action row with three buttons (current one disabled)
			const row = new ActionRowBuilder()
				.addComponents(
					// Current view is disabled
					new ButtonBuilder()
						.setCustomId(`stats_alltime_${discordUser.id}_${serverOnly}_${squads}`)
						.setLabel("all time")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId(`stats_weekly_${discordUser.id}_${serverOnly}_${squads}`)
						.setLabel("past week")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(`stats_season_${discordUser.id}_${serverOnly}_${squads}`)
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
			console.error("stats command error:", error);

			let errorMessage = "error: something went wrong while calculating stats.";

			if (error.message?.includes("404")) {
				errorMessage = "error: player data not found in mkw lounge.";
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				errorMessage = "error: couldn't connect to the mkw lounge api. please try again later.";
			}
			else if (error.message?.includes("Unknown interaction")) {
				console.error("interaction expired during stats calculation");
				return;
			}

			try {
				await interaction.editReply({ content: errorMessage });
			}
			catch (editError) {
				console.error("failed to edit reply with error message:", editError);
			}
		}
	},

	// Handle button interactions
	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("stats_")) return false;

		try {
			await interaction.deferUpdate();

			const parts = interaction.customId.split("_");
			// "weekly", "alltime", or "season"
			const timeFilter = parts[1];
			const userId = parts[2];
			const serverOnly = parts[3] === "true";
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const serverId = interaction.guild.id;
			const discordUser = await interaction.client.users.fetch(userId);

			// Generate stats based on time filter
			const result = await this.generateStats(interaction, discordUser, serverId, serverOnly, squads, timeFilter);

			if (result) {
				// Create action row with three buttons (current one disabled)
				const row = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`stats_alltime_${userId}_${serverOnly}_${squads}`)
							.setLabel("all time")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "alltime"),
						new ButtonBuilder()
							.setCustomId(`stats_weekly_${userId}_${serverOnly}_${squads}`)
							.setLabel("past week")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "weekly"),
						new ButtonBuilder()
							.setCustomId(`stats_season_${userId}_${serverOnly}_${squads}`)
							.setLabel("this season")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "season"),
					);

				await interaction.editReply({ embeds: [result.embed], components: [row] });
			}

			return true;
		}
		catch (error) {
			console.error("error in stats button interaction:", error);
			return false;
		}
	},

	// Generate stats data
	async generateStats(interaction, discordUser, serverId, serverOnly, squads, timeFilter = "alltime") {
		try {
			// Validate user exists in server data
			const serverData = await database.getServerData(serverId);
			const userData = serverData?.users?.[discordUser.id];

			if (!userData) {
				return null;
			}

			// Get user data from Lounge API
			const userId = discordUser.id;
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				return null;
			}

			await DataManager.updateServerUser(serverId, userId, interaction.client).catch(error => {
				console.warn(`failed to update user ${userId}:`, error);
			});

			let userTables = await LoungeApi.getAllPlayerTables(discordUser.id, serverId);

			if (!userTables || Object.keys(userTables).length === 0) {
				return null;
			}

			// Apply time filter using PlayerStats methods
			if (timeFilter === "weekly") {
				userTables = PlayerStats.filterTablesByWeek(userTables, true);
			}
			else if (timeFilter === "season") {
				userTables = PlayerStats.filterTablesBySeason(userTables, true);
			}

			// Filter by server-only if requested
			if (serverOnly) {
				const filteredEntries = [];
				for (const [tableId, table] of Object.entries(userTables)) {
					try {
						if (await PlayerStats.checkIfServerTable(userId, table, serverId)) {
							filteredEntries.push([tableId, table]);
						}
					}
					catch (error) {
						console.warn(`error checking server table ${tableId}:`, error);
					}
				}
				userTables = Object.fromEntries(filteredEntries);
			}

			// Filter by squad/solo if requested
			if (squads) {
				userTables = Object.fromEntries(
					Object.entries(userTables).filter(([tableId, table]) =>
						table.tier === "SQ"),
				);
			}
			if (squads === false) {
				userTables = Object.fromEntries(
					Object.entries(userTables).filter(([tableId, table]) =>
						table.tier !== "SQ"),
				);
			}

			// Check if any tables remain after filtering
			if (Object.keys(userTables).length === 0) {
				return null;
			}

			const eP = PlayerStats.getMatchesPlayed(userTables, loungeUser.name);
			const tWR = PlayerStats.getWinRate(userTables, loungeUser.name);
			const aSc = PlayerStats.getAverageScore(userTables, loungeUser.name);
			const bS = PlayerStats.getBestScore(userTables, loungeUser.name);
			const wS = PlayerStats.getWorstScore(userTables, loungeUser.name);
			const aSe = PlayerStats.getAverageSeed(userTables, loungeUser.name);
			const aP = PlayerStats.getAveragePlacement(userTables, loungeUser.name);
			const tH2H = await PlayerStats.getTotalH2H(userTables, loungeUser.name, serverId);

			const playerNameWithFlag = embedEnhancer.formatPlayerNameWithFlag(discordUser.displayName, loungeUser.countryCode);

			// Create time-aware title
			const timePrefix = timeFilter === "weekly" ? "weekly " : timeFilter === "season" ? "season " : "";

			const statsEmbed = new EmbedBuilder()
				.setColor("Purple")
				.setTitle(`${playerNameWithFlag}'s ${serverOnly ? "server " : ""}${
					squads ? "squad " : squads === false ? "soloQ " : ""}${timePrefix}stats`)
				.setTimestamp()
				.addFields(
					{ name: "events played:", value: String(eP) },
					{ name: "team win rate:", value: (tWR * 100).toFixed(2) + "%", inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
					{ name: "average score:", value: aSc.toFixed(2), inline: true },
					{ name: "best score:", value: String(bS.score), inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
					{ name: "worst score:", value: String(wS.score), inline: true },
					{ name: "average seed:", value: aSe.toFixed(2), inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
					{ name: "average placement:", value: aP.toFixed(2), inline: true },
					{ name: "head-to-head vs. server members:",
						value: `${
							tH2H.wins
						}-${
							tH2H.losses
						}${
							tH2H.ties ? "-" + tH2H.ties : ""
						}`,
					},
				);

			// Add player avatar as thumbnail
			const avatarUrl = embedEnhancer.getPlayerAvatarUrl(discordUser);
			if (avatarUrl) {
				statsEmbed.setThumbnail(avatarUrl);
			}

			// Add time-aware footer
			const eventCount = Object.keys(userTables).length;
			let footerText = `based on ${eventCount} event${eventCount !== 1 ? "s" : ""}`;
			if (timeFilter === "weekly") {
				footerText += " (past 7 days)";
			}
			else if (timeFilter === "season") {
				footerText += " (current season)";
			}
			statsEmbed.setFooter({ text: footerText });

			return { embed: statsEmbed };
		}
		catch (error) {
			console.error("error generating stats:", error);
			return null;
		}
	},
};