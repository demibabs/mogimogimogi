const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const DataManager = require("../../utils/dataManager");
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

			// Use generateLeaderboard for consistency with button interactions
			const result = await this.generateLeaderboard(interaction, serverId, stat, serverOnly, squads, "alltime");

			if (!result) {
				return await interaction.editReply({
					content: "an error occurred while generating the leaderboard. please try again later.",
				});
			}

			// Create action row with three buttons (current one disabled)
			const row = new ActionRowBuilder()
				.addComponents(
					// Current view is disabled
					new ButtonBuilder()
						.setCustomId(`leaderboard_alltime_${stat}_${serverOnly}_${squads}`)
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
			// "weekly", "alltime", or "season"
			const timeFilter = parts[1];
			const stat = parts[2];
			const serverOnly = parts[3] === "true";
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const serverId = interaction.guild.id;

			// Generate leaderboard based on time filter
			const result = await this.generateLeaderboard(interaction, serverId, stat, serverOnly, squads, timeFilter);

			if (result) {
				// Create action row with three buttons (current one disabled)
				const row = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`leaderboard_alltime_${stat}_${serverOnly}_${squads}`)
							.setLabel("all time")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "alltime"),
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

	// Generate leaderboard data
	async generateLeaderboard(interaction, serverId, stat, serverOnly, squads, timeFilter = "alltime") {
		try {
			// Get server data
			const serverData = await database.getServerData(serverId);
			if (!serverData || !serverData.users) {
				return null;
			}

			const playerStats = [];

			// Process each user in the server
			for (const [userId, userData] of Object.entries(serverData.users)) {
				try {
					let statValue = null;
					let loungeUser = null;

					if (stat === "mMR") {
						if (timeFilter === "weekly") {
							// Get weekly MMR change
							statValue = await LoungeApi.getWeeklyMMRChange(userId);
						}
						else if (timeFilter === "season") {
							// Get season MMR change
							statValue = await LoungeApi.getSeasonMMRChange(userId);
						}
						else {
							// Get current MMR from API
							statValue = await LoungeApi.getCurrentMMR(userId);
						}
					}
					else {
						// For other stats, get lounge user data first
						loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

						if (loungeUser) {
							// Get tables and apply time filter
							let userTables = await LoungeApi.getAllPlayerTables(userId, serverId);

							if (timeFilter === "weekly") {
								userTables = PlayerStats.filterTablesByWeek(userTables, true);
							}
							else if (timeFilter === "season") {
								userTables = PlayerStats.filterTablesBySeason(userTables, true);
							}

							// Apply server-only and squad filters
							if (serverOnly !== false || squads !== null) {
								const filteredTables = {};
								for (const [tableId, table] of Object.entries(userTables)) {
									let includeTable = true;

									// Server-only filter
									if (serverOnly) {
										const isServerTable = await PlayerStats.checkIfServerTable(userId, table, serverId);
										if (!isServerTable) {
											includeTable = false;
										}
									}

									// Squad filter
									if (includeTable && squads !== null) {
										if (squads && table.tier !== "SQ") {
											includeTable = false;
										}
										else if (!squads && table.tier === "SQ") {
											includeTable = false;
										}
									}

									if (includeTable) {
										filteredTables[tableId] = table;
									}
								}
								userTables = filteredTables;
							}

							// Calculate the stat
							switch (stat) {
							case "tWR": {
								const winRate = PlayerStats.getWinRate(userTables, loungeUser.name);
								statValue = winRate;
								break;
							}
							case "aS": {
								const avgScore = PlayerStats.getAverageScore(userTables, loungeUser.name);
								statValue = avgScore;
								break;
							}
							case "hS": {
								const bestScoreResult = PlayerStats.getBestScore(userTables, loungeUser.name);
								statValue = bestScoreResult ? bestScoreResult.score : null;
								break;
							}
							case "eP": {
								const eventsPlayed = PlayerStats.getMatchesPlayed(userTables, loungeUser.name);
								statValue = eventsPlayed;
								break;
							}
							}
						}
					}

					if (statValue !== null && statValue !== undefined && statValue !== -1) {
						// Try to get Discord user for proper display
						let displayName = userData.loungePlayerName || `User ${userId}`;
						let discordUser = null;
						let loungeUserForDisplay = null;

						try {
							discordUser = await interaction.client.users.fetch(userId);
							displayName = discordUser.displayName || discordUser.username || displayName;
						}
						catch (error) {
							// Use lounge name if Discord user fetch fails
						}

						// Get lounge user data for country flag
						if (stat !== "mMR" && loungeUser) {
							loungeUserForDisplay = loungeUser;
						}
						else if (stat === "mMR") {
							try {
								loungeUserForDisplay = await LoungeApi.getPlayerByDiscordId(userId);
							}
							catch (error) {
								console.warn(`failed to get lounge user for ${userId}:`, error);
							}
						}

						// Format name with country flag
						const formattedName = embedEnhancer.formatPlayerNameWithFlag(displayName, loungeUserForDisplay?.countryCode);

						playerStats.push({
							userId,
							displayName: formattedName,
							statValue,
							discordUser,
						});
					}
				}
				catch (error) {
					console.warn(`Error processing user ${userId}:`, error);
				}
			}

			// Sort by stat value (descending for most stats, but MMR change can be negative)
			if (stat === "mMR" && timeFilter === "weekly") {
				// For weekly MMR change, sort by absolute change, but keep the sign
				playerStats.sort((a, b) => Math.abs(b.statValue) - Math.abs(a.statValue));
			}
			else {
				playerStats.sort((a, b) => b.statValue - a.statValue);
			}

			// Get top 10
			const top10 = playerStats.slice(0, 10);

			if (top10.length === 0) {
				const embed = new EmbedBuilder()
					.setTitle("no data found")
					.setDescription("no players found with the specified filters.")
					.setColor("#ff0000")
					.setTimestamp();

				// Cycle through time filters: alltime -> weekly -> season -> alltime
				let nextFilter, buttonLabel;
				if (timeFilter === "alltime") {
					nextFilter = "weekly";
					buttonLabel = "past week";
				}
				else if (timeFilter === "weekly") {
					nextFilter = "season";
					buttonLabel = "this season";
				}
				else {
					nextFilter = "alltime";
					buttonLabel = "all time";
				}

				const buttonId = `leaderboard_${nextFilter}_${stat}_${serverOnly}_${squads}`;

				return { embed, buttonLabel, buttonId };
			}

			// Create embed
			const statNames = {
				"mMR": timeFilter === "weekly" ? "weekly mmr change" : timeFilter === "season" ? "season mmr change" : "mmr",
				"tWR": "team win rate",
				"aS": "average Score",
				"hS": "highest Score",
				"eP": "events played",
			};

			const timePrefix = timeFilter === "weekly" ? "weekly " : timeFilter === "season" ? "season " : "";

			const embed = new EmbedBuilder()
				.setTitle(`${serverOnly ? "server " : ""}${squads ? "squad " : squads === false ? "soloq " : ""}${timePrefix}leaderboard - ${statNames[stat]}`)
				.setColor("#00ff00")
				.setTimestamp();

			// Build description
			let description = "";
			for (let i = 0; i < top10.length; i++) {
				const player = top10[i];
				const rank = i + 1;

				let formattedValue;
				if (stat === "tWR") {
					formattedValue = `${(player.statValue * 100).toFixed(1)}%`;
				}
				else if (stat === "aS") {
					formattedValue = player.statValue.toFixed(1);
				}
				else if (stat === "mMR" && (timeFilter === "weekly" || timeFilter === "season")) {
					// Show + or - for MMR changes
					const change = Math.round(player.statValue);
					formattedValue = change > 0 ? `+${change}` : `${change}`;
				}
				else {
					formattedValue = Math.round(player.statValue);
				}

				description += `${rank}. **${player.displayName}** - ${formattedValue}\n`;
			}

			embed.setDescription(description);

			// Set footer with appropriate time context
			let footerText = `showing top ${top10.length} players`;
			if (timeFilter === "weekly") {
				footerText += " (past 7 days)";
			}
			else if (timeFilter === "season") {
				footerText += " (current season)";
			}
			embed.setFooter({ text: footerText });

			// Add top player's avatar as thumbnail
			if (top10.length > 0 && top10[0].discordUser) {
				const avatarUrl = embedEnhancer.getPlayerAvatarUrl(top10[0].discordUser);
				if (avatarUrl) {
					embed.setThumbnail(avatarUrl);
				}
			}

			return { embed };
		}
		catch (error) {
			console.error("Error generating leaderboard:", error);
			return null;
		}
	},

	// Helper function to filter tables by week (moved from inline)
	filterTablesByWeek(tables, weeklyOnly = false) {
		if (!weeklyOnly) return tables;

		const oneWeekAgo = new Date();
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.createdOn) {
				const tableDate = new Date(table.createdOn);
				if (tableDate >= oneWeekAgo) {
					filtered[tableId] = table;
				}
			}
		}
		return filtered;
	},

	// Helper function to filter tables by current season
	filterTablesBySeason(tables, seasonOnly = false) {
		if (!seasonOnly) return tables;

		// Get current season from LoungeApi (DEFAULT_SEASON = 1)
		const currentSeason = 1;

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.season === currentSeason) {
				filtered[tableId] = table;
			}
		}
		return filtered;
	},
};