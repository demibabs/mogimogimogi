const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const DataManager = require("../../utils/dataManager");
const PlayerStats = require("../../utils/playerStats");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("head-to-head")
		.setDescription("Compare head-to-head stats of two users.")
		.addUserOption(option =>
			option.setName("user1")
			    .setDescription("The first user")
				.setRequired(true))
		.addUserOption(option =>
			option.setName("user2")
				.setDescription("The second user. Yourself if left blank"))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("True = squad only, false = solo only.")),
	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("Loading head-to-head data...");

			// Swap users if user2 isn't selected, since it'd be weird for yourself to be 2nd
			const discordUser1 = interaction.options.getUser("user2") ? interaction.options.getUser("user1") : interaction.user;
			const discordUser2 = interaction.options.getUser("user2") ? interaction.options.getUser("user2") : interaction.options.getUser("user1");
			const userId1 = discordUser1.id;
			const userId2 = discordUser2.id;
			const serverId = interaction.guild.id;
			const squads = interaction.options.getBoolean("squads");

			// Force cache users to ensure mentions display properly for everyone
			try {
				await interaction.client.users.fetch(userId1);
				await interaction.client.users.fetch(userId2);
			}
			catch (error) {
				console.warn("Failed to cache users:", error);
			}

			// Validate users exist in server data
			const serverData = await database.getServerData(serverId);
			const user1Data = serverData?.users?.[userId1];
			const user2Data = serverData?.users?.[userId2];

			if (!user1Data || !user2Data) {
				return await interaction.editReply({
					content: "ERROR: One of the users was not found in server data. Use `/setup` to add all server members with Lounge accounts.",
				});
			}

			// Update user data in background
			try {
				await DataManager.updateServerUser(serverId, userId1, interaction.client);
				await DataManager.updateServerUser(serverId, userId2, interaction.client);
			}
			catch (error) {
				console.warn("Failed to update user data:", error);
			}

			// Get lounge users
			const loungeUser1 = await LoungeApi.getPlayerByDiscordId(userId1);
			const loungeUser2 = await LoungeApi.getPlayerByDiscordId(userId2);

			if (!loungeUser1 || !loungeUser2) {
				return await interaction.editReply({
					content: "ERROR: One of the users was not found in Mario Kart World Lounge.",
				});
			}

			await interaction.editReply("Calculating head-to-head statistics...");

			// Get all tables for both users
			const user1Tables = await LoungeApi.getAllPlayerTables(userId1, serverId);
			const user2Tables = await LoungeApi.getAllPlayerTables(userId2, serverId);

			// Combine tables (prioritizing user1's data for duplicates)
			const allTables = { ...user2Tables, ...user1Tables };

			// Get H2H tables (tables where both players participated)
			let h2hTables = await PlayerStats.getH2HTables(userId1, userId2, serverId);

			if (!h2hTables || Object.keys(h2hTables).length === 0) {
				return await interaction.editReply({
					content: `No head-to-head matches found between ${discordUser1.displayName} and ${discordUser2.displayName}. :('`,
				});
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
				const squadType = squads ? "squad " : squads === false ? "soloQ " : "";
				return await interaction.editReply({
					content: `No ${squadType}head-to-head matches found between ${discordUser1.displayName} and ${discordUser2.displayName}. :('`,
				});
			}

			// Calculate statistics
			const h2hEventsPlayed = Object.keys(h2hTables).length;
			const h2hRecord = PlayerStats.getH2H(h2hTables, loungeUser1.name, loungeUser2.name);

			// Individual stats from H2H tables only
			const user1AvgScore = PlayerStats.getAverageScore(h2hTables, loungeUser1.name);
			const user2AvgScore = PlayerStats.getAverageScore(h2hTables, loungeUser2.name);
			const user1AvgPlacement = PlayerStats.getAveragePlacement(h2hTables, loungeUser1.name);
			const user2AvgPlacement = PlayerStats.getAveragePlacement(h2hTables, loungeUser2.name);

			// Get biggest differences (notables-style)
			const biggestWin1 = PlayerStats.getBiggestDifference(h2hTables, loungeUser1.name, loungeUser2.name);
			const biggestWin2 = PlayerStats.getBiggestDifference(h2hTables, loungeUser2.name, loungeUser1.name);

			// Create embed
			const h2hEmbed = new EmbedBuilder()
				.setColor("Blue")
				.setTitle(`${discordUser1.displayName} vs ${discordUser2.displayName} ${
					squads ? "Squad " : squads === false ? "SoloQ " : ""}Head-to-Head`);

			// Stats-style fields
			const fields = [
				{ name: "Events played:", value: String(h2hEventsPlayed) },
				{ name: "Head-to-head record:", value: `${h2hRecord.wins}-${h2hRecord.losses}${h2hRecord.ties ? `-${h2hRecord.ties}` : ""}` },
				{ name: `${discordUser1.displayName}'s avg score:`, value: user1AvgScore.toFixed(2), inline: true },
				{ name: "\u200B", value: "\u200B", inline: true },
				{ name: `${discordUser2.displayName}'s avg score:`, value: user2AvgScore.toFixed(2), inline: true },
				{ name: `${discordUser1.displayName}'s avg placement:`, value: user1AvgPlacement.toFixed(2), inline: true },
				{ name: "\u200B", value: "\u200B", inline: true },
				{ name: `${discordUser2.displayName}'s avg placement:`, value: user2AvgPlacement.toFixed(2), inline: true },
			];

			// Notables-style fields (if data exists)
			if (biggestWin1) {
				const table1 = h2hTables[biggestWin1.tableId];
				fields.push({
					name: `${discordUser1.displayName}'s biggest victory:`,
					value: `[In this ${table1.numPlayers}p ${table1.format}](https://lounge.mkcentral.com/mkworld/TableDetails/${biggestWin1.tableId}) ` +
						`${discordUser1.toString()} scored ${biggestWin1.player1Score} (rank ${biggestWin1.player1Rank}) ` +
						`while ${discordUser2.toString()} scored ${biggestWin1.player1Score - biggestWin1.scoreDifference} (rank ${biggestWin1.player2Rank}). `,
				});
			}

			if (biggestWin2) {
				const table2 = h2hTables[biggestWin2.tableId];
				fields.push({
					name: `${discordUser2.displayName}'s biggest victory:`,
					value: `[In this ${table2.numPlayers}p ${table2.format}](https://lounge.mkcentral.com/mkworld/TableDetails/${biggestWin2.tableId}) ` +
						`${discordUser2.toString()} scored ${biggestWin2.player1Score} (rank ${biggestWin2.player1Rank}) ` +
						`while ${discordUser1.toString()} scored ${biggestWin2.player1Score - biggestWin2.scoreDifference} (rank ${biggestWin2.player2Rank}). `,
				});
			}

			h2hEmbed.addFields(fields);

			await interaction.editReply({ content: "", embeds: [h2hEmbed] });
		}
		catch (error) {
			console.error("Head-to-head command error:", error);

			let errorMessage = "ERROR: An error occurred while calculating head-to-head statistics.";

			if (error.message?.includes("404")) {
				errorMessage = "ERROR: Player data not found in Mario Kart Lounge.";
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				errorMessage = "ERROR: Could not connect to Mario Kart Lounge API. Please try again later.";
			}
			else if (error.message?.includes("Unknown interaction")) {
				console.error("Interaction expired during head-to-head calculation");
				return;
			}

			try {
				await interaction.editReply({ content: errorMessage });
			}
			catch (editError) {
				console.error("Failed to edit reply with error message:", editError);
			}
		}
	},
};