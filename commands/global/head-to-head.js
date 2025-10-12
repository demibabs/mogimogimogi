const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const DataManager = require("../../utils/dataManager");
const PlayerStats = require("../../utils/playerStats");
const embedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("head-to-head")
		.setDescription("compare head-to-head stats of two users.")
		.addUserOption(option =>
			option.setName("user1")
			    .setDescription("the first user.")
				.setRequired(true))
		.addUserOption(option =>
			option.setName("user2")
				.setDescription("the second user. yourself if left blank."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("true = squad only, false = solo only.")),
	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("validating users...");

			// Swap users if user2 isn't selected, since it'd be weird for yourself to be 2nd
			const discordUser1 = interaction.options.getUser("user2") ? interaction.options.getUser("user1") : interaction.user;
			const discordUser2 = interaction.options.getUser("user2") ? interaction.options.getUser("user2") : interaction.options.getUser("user1");
			const squads = interaction.options.getBoolean("squads");
			const serverId = interaction.guildId;

			// Use generateHeadToHead for consistency with button interactions
			const result = await this.generateHeadToHead(interaction, discordUser1, discordUser2, serverId, squads, "alltime");

			   if (!result.success) {
				   const embed = new EmbedBuilder()
					   .setColor("Red")
					   .setDescription(result.message || "unable to load head-to-head data.");
				   return await interaction.editReply({ content: "", embeds: [embed] });
			   }

			// Create action row with three buttons (current one disabled)
			const row = new ActionRowBuilder()
				.addComponents(
					// Current view is disabled
					new ButtonBuilder()
						.setCustomId(`h2h_alltime_${discordUser1.id}_${discordUser2.id}_${squads}`)
						.setLabel("all time")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId(`h2h_weekly_${discordUser1.id}_${discordUser2.id}_${squads}`)
						.setLabel("past week")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(`h2h_season_${discordUser1.id}_${discordUser2.id}_${squads}`)
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
			console.error("head-to-head command error:", error);

			let errorMessage = "an error occurred while calculating head-to-head statistics D:";

			if (error.message?.includes("404")) {
				errorMessage = "player data not found in mkw lounge.";
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				errorMessage = "couldn't connect to the lounge api. please try again later.";
			}
			else if (error.message?.includes("Unknown interaction")) {
				console.error("interaction expired during head-to-head calculation.");
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
		if (!interaction.customId.startsWith("h2h_")) return false;

		try {
			await interaction.deferUpdate();

			const parts = interaction.customId.split("_");
			// "weekly", "alltime", or "season"
			const timeFilter = parts[1];
			const userId1 = parts[2];
			const userId2 = parts[3];
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const serverId = interaction.guild.id;
			const discordUser1 = await interaction.client.users.fetch(userId1);
			const discordUser2 = await interaction.client.users.fetch(userId2);

			// Generate head-to-head based on time filter
			const result = await this.generateHeadToHead(interaction, discordUser1, discordUser2, serverId, squads, timeFilter);

			if (result && result.success) {
				// Create action row with three buttons (current one disabled)
				const row = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`h2h_alltime_${userId1}_${userId2}_${squads}`)
							.setLabel("all time")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "alltime"),
						new ButtonBuilder()
							.setCustomId(`h2h_weekly_${userId1}_${userId2}_${squads}`)
							.setLabel("past week")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "weekly"),
						new ButtonBuilder()
							.setCustomId(`h2h_season_${userId1}_${userId2}_${squads}`)
							.setLabel("this season")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "season"),
					);

				await interaction.editReply({ content: "", embeds: [result.embed], components: [row] });
			}
			   else {
				   // Handle error case for button interactions
				   const embed = new EmbedBuilder()
					   .setTitle(`${discordUser1.displayName || "user 1"} vs ${discordUser2.displayName || "user 2"}`)
					   .setColor("Red")
					   .setDescription(result.message || "unable to load head-to-head data.");
				   await interaction.editReply({ content: "", embeds: [embed] });
			   }

			return true;
		}
		catch (error) {
			console.error("error in head-to-head button interaction:", error);
			return false;
		}
	},

	// Generate head-to-head data
	async generateHeadToHead(interaction, discordUser1, discordUser2, serverId, squads, timeFilter = "alltime") {
		try {
			const userId1 = discordUser1.id;
			const userId2 = discordUser2.id;

			// Validate both users exist and add them if they have lounge accounts
			const user1Validation = await AutoUserManager.validateUserForCommand(userId1, serverId, interaction.client);
			const user2Validation = await AutoUserManager.validateUserForCommand(userId2, serverId, interaction.client);

	       if (!user1Validation.success) {
		       if (user1Validation.needsSetup) {
			       return { success: false, message: "this server hasn't been set up yet. run `/setup` first." };
		       }
		       return { success: false, message: `player 1: ${user1Validation.message}` };
	       }

	       if (!user2Validation.success) {
		       if (user2Validation.needsSetup) {
			       return { success: false, message: "this server hasn't been set up yet. run `/setup` first." };
		       }
		       return { success: false, message: `player 2: ${user2Validation.message}` };
	       }

			// Update user data in background
			try {
				await DataManager.updateServerUser(serverId, userId1, interaction.client);
				await DataManager.updateServerUser(serverId, userId2, interaction.client);
			}
			catch (error) {
				console.warn("failed to update user data:", error);
			}

			// Get lounge users
			const loungeUser1 = await LoungeApi.getPlayerByDiscordId(userId1);
			const loungeUser2 = await LoungeApi.getPlayerByDiscordId(userId2);

			if (!loungeUser1 || !loungeUser2) {
				return null;
			}

			// Get H2H tables (tables where both players participated)
			await interaction.editReply("fetching tables...");
			let h2hTables = await PlayerStats.getH2HTables(userId1, userId2, serverId);

			if (!h2hTables || Object.keys(h2hTables).length === 0) {
				return { success: false, message: "no shared events found between these players." };
			}

			// Apply time filter using PlayerStats methods
			await interaction.editReply("filtering events...");
			if (timeFilter === "weekly") {
				h2hTables = PlayerStats.filterTablesByWeek(h2hTables, true);
			}
			else if (timeFilter === "season") {
				h2hTables = PlayerStats.filterTablesBySeason(h2hTables, true);
			}

			// Filter by squad/solo if requested
			if (squads) {
				h2hTables = Object.fromEntries(
					Object.entries(h2hTables).filter(([tableId, table]) =>
						table.tier === "SQ"),
				);
			}
			if (squads === false) {
				h2hTables = Object.fromEntries(
					Object.entries(h2hTables).filter(([tableId, table]) =>
						table.tier !== "SQ"),
				);
			}

			// Check if any tables remain after filtering
			if (Object.keys(h2hTables).length === 0) {
				return { success: false, message: "no shared events found matching the specified filters." };
			}

			// Calculate statistics
			await interaction.editReply("calculating stats...");
			const h2hEventsPlayed = Object.keys(h2hTables).length;
			const h2hRecord = PlayerStats.getH2H(h2hTables, userId1, userId2);

			// Individual stats from H2H tables only
			const user1AvgScore = PlayerStats.getAverageScore(h2hTables, userId1);
			const user2AvgScore = PlayerStats.getAverageScore(h2hTables, userId2);
			const user1AvgPlacement = PlayerStats.getAveragePlacement(h2hTables, userId1);
			const user2AvgPlacement = PlayerStats.getAveragePlacement(h2hTables, userId2);

			// Get biggest differences (notables-style)
			const biggestWin1 = PlayerStats.getBiggestDifference(h2hTables, userId1, userId2);
			const biggestWin2 = PlayerStats.getBiggestDifference(h2hTables, userId2, userId1);

			// Format player names with flags
			const player1NameWithFlag = embedEnhancer.formatPlayerNameWithFlag(discordUser1.displayName, loungeUser1.countryCode);
			const player2NameWithFlag = embedEnhancer.formatPlayerNameWithFlag(discordUser2.displayName, loungeUser2.countryCode);

			// Create time-aware title
			const timePrefix = timeFilter === "weekly" ? "weekly " : timeFilter === "season" ? "season " : "";

			// Create embed
			const h2hEmbed = new EmbedBuilder()
				.setColor("Blue")
				.setTitle(`${player1NameWithFlag} vs ${player2NameWithFlag} ${
					squads ? "squad " : squads === false ? "soloq " : ""}${timePrefix}head-to-head`)
				.setTimestamp();

			// Stats-style fields
			const fields = [
				{ name: "events played:", value: String(h2hEventsPlayed) },
				{ name: "head-to-head record:", value: `${h2hRecord.wins}-${h2hRecord.losses}${h2hRecord.ties ? `-${h2hRecord.ties}` : ""}` },
				{ name: `${player1NameWithFlag}'s avg score:`, value: user1AvgScore.toFixed(2), inline: true },
				{ name: "\u200B", value: "\u200B", inline: true },
				{ name: `${player2NameWithFlag}'s avg score:`, value: user2AvgScore.toFixed(2), inline: true },
				{ name: `${player1NameWithFlag}'s avg placement:`, value: user1AvgPlacement.toFixed(2), inline: true },
				{ name: "\u200B", value: "\u200B", inline: true },
				{ name: `${player2NameWithFlag}'s avg placement:`, value: user2AvgPlacement.toFixed(2), inline: true },
			];

			// Notables-style fields (if data exists)
			if (biggestWin1) {
				const table1 = h2hTables[biggestWin1.tableId];
				fields.push({
					name: `${player1NameWithFlag}'s biggest victory:`,
					value: `[in this ${table1.numPlayers}p ${table1.format}](https://lounge.mkcentral.com/mkworld/TableDetails/${biggestWin1.tableId}) ` +
						`${discordUser1.displayName} scored ${biggestWin1.player1Score} (rank ${biggestWin1.player1Rank}) ` +
						`while ${discordUser2.displayName} scored ${biggestWin1.player1Score - biggestWin1.scoreDifference} (rank ${biggestWin1.player2Rank}). `,
				});
			}

			if (biggestWin2) {
				const table2 = h2hTables[biggestWin2.tableId];
				fields.push({
					name: `${player2NameWithFlag}'s biggest victory:`,
					value: `[in this ${table2.numPlayers}p ${table2.format}](https://lounge.mkcentral.com/mkworld/TableDetails/${biggestWin2.tableId}) ` +
						`${discordUser2.displayName} scored ${biggestWin2.player1Score} (rank ${biggestWin2.player1Rank}) ` +
						`while ${discordUser1.displayName} scored ${biggestWin2.player1Score - biggestWin2.scoreDifference} (rank ${biggestWin2.player2Rank}). `,
				});
			}

			h2hEmbed.addFields(fields);

			// Add player avatar (prefer first player's avatar, fallback to second player's)
			const avatarUrl = embedEnhancer.getPlayerAvatarUrl(discordUser1) || embedEnhancer.getPlayerAvatarUrl(discordUser2);
			if (avatarUrl) {
				h2hEmbed.setThumbnail(avatarUrl);
			}

			// Add time-aware footer
			const tableCount = Object.keys(h2hTables).length;
			let footerText = `head-to-head across ${tableCount} shared event${tableCount !== 1 ? "s" : ""}`;
			if (timeFilter === "weekly") {
				footerText += " (past 7 days)";
			}
			else if (timeFilter === "season") {
				footerText += " (current season)";
			}
			h2hEmbed.setFooter({ text: footerText });

			return { success: true, embed: h2hEmbed };
		}
		catch (error) {
			console.error("error generating head-to-head:", error);
			return { success: false, message: "an error occurred while generating head-to-head stats. please try again later." };
		}
	},
};