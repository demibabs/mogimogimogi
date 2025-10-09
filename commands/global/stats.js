const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const ServerData = require("../../utils/serverData");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const DataManager = require("../../utils/dataManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("stats")
		.setDescription("Check your (or someone else's) stats vs. all other server members.")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("User to get the stats of. Leave blank for yourself"))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("True = only mogis including other server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("True = squad only, false = solo only.")),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("Fetching tables...");
			await interaction.channel.sendTyping();

			const discordUser = interaction.options.getUser("user") || interaction.user;
			const serverId = interaction.guild.id;

			// Validate user exists in server data
			const serverData = await ServerData.getServerData(serverId);
			const userData = serverData?.users?.[discordUser.id];

			if (!userData) {
				return await interaction.editReply({
					content: "ERROR: User not found in server data. Use `/setup` to add all server members.",
				});
			}

			// Get user data from Lounge API
			const userId = discordUser.id;
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				return await interaction.editReply({
					content: "ERROR: User not found in Mario Kart World Lounge. Please make sure they have a registered account.",
				});
			}

			const serverOnly = interaction.options.getBoolean("server-only");
			const squads = interaction.options.getBoolean("squads");

			await DataManager.updateServerUser(serverId, userId, interaction.client).catch(error => {
				console.warn(`Failed to update user ${userId}:`, error);
			});

			await interaction.editReply("Processing tables...");

			let userTables = await LoungeApi.getAllPlayerTables(discordUser.id, serverId);

			if (!userTables || Object.keys(userTables).length === 0) {
				return await interaction.editReply({
					content: "No table data found for this user. :('",
				});
			}

			// Filter by server-only if requested
			if (serverOnly) {
				await interaction.editReply("Filtering server-only matches...");
				const filteredEntries = [];
				for (const [tableId, table] of Object.entries(userTables)) {
					try {
						if (await PlayerStats.checkIfServerTable(userId, table, serverId)) {
							filteredEntries.push([tableId, table]);
						}
					}
					catch (error) {
						console.warn(`Error checking server table ${tableId}:`, error);
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
				const filterType = serverOnly ? "server-only " : "";
				const squadType = squads ? "squad " : squads === false ? "soloQ " : "";
				return await interaction.editReply({
					content: `No ${filterType}${squadType}matches found for this user. :('`,
				});
			}

			await interaction.editReply("Calculating stats...");
			await interaction.channel.sendTyping();

			const eP = PlayerStats.getMatchesPlayed(userTables, loungeUser.name);
			const tWR = PlayerStats.getWinRate(userTables, loungeUser.name);
			const aSc = PlayerStats.getAverageScore(userTables, loungeUser.name);
			const bS = PlayerStats.getBestScore(userTables, loungeUser.name);
			const wS = PlayerStats.getWorstScore(userTables, loungeUser.name);
			const aSe = PlayerStats.getAverageSeed(userTables, loungeUser.name);
			const aP = PlayerStats.getAveragePlacement(userTables, loungeUser.name);
			const tH2H = await PlayerStats.getTotalH2H(userTables, loungeUser.name, serverId);

			const statsEmbed = new EmbedBuilder()
				.setColor("Purple")
				.setTitle(`${discordUser.displayName}'s ${serverOnly ? "server " : ""}${
					squads ? "squad " : squads === false ? "soloQ " : ""}stats`)
				.addFields(
					{ name: "Events played:", value: String(eP) },
					{ name: "Team win rate:", value: (tWR * 100).toFixed(2) + "%", inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
					{ name: "Average score:", value: aSc.toFixed(2), inline: true },
					{ name: "Best score:", value: String(bS.score), inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
    			{ name: "Worst score:", value: String(wS.score), inline: true },
					{ name: "Average seed:", value: aSe.toFixed(2), inline: true },
					{ name: "\u200B", value: "\u200B", inline: true },
					{ name: "Average placement:", value: aP.toFixed(2), inline: true },
					{ name: "Head-to-head vs. server members:",
						value: `${
							tH2H.wins
						}-${
							tH2H.losses
						}${
							tH2H.ties ? "-" + tH2H.ties : ""
						}`,
					},
				);
			try {
				await interaction.editReply({ content: "", embeds: [statsEmbed] });
			}
			catch (error) {
				console.error("Failed to send stats embed:", error);
				await interaction.editReply({ content: "ERROR: Something went wrong while sending stats display." });
			}
		}
		catch (error) {
			console.error("Stats command error:", error);

			let errorMessage = "ERROR: An error occurred while calculating stats.";

			if (error.message?.includes("404")) {
				errorMessage = "ERROR: Player data not found in Mario Kart Lounge.";
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				errorMessage = "ERROR: Could not connect to Mario Kart Lounge API. Please try again later.";
			}
			else if (error.message?.includes("Unknown interaction")) {
				console.error("Interaction expired during stats calculation");
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