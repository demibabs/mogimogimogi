const { SlashCommandBuilder } = require("discord.js");
const LoungeApi = require("../../utils/loungeApi");
const DataManager = require("../../utils/dataManager");
const PlayerStats = require("../../utils/playerStats");
const database = require("../../utils/database");
const { getTable } = require("../../utils/loungeApi");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("add-table")
		.setDescription("Adds squad queue to server dataset")
		.addIntegerOption(option =>
			option.setName("table_id")
				.setDescription("Table ID to add")
				.setRequired(true)),

	async execute(interaction) {
		const tableId = interaction.options.getInteger("table_id");
		const serverId = interaction.guild.id;

		await interaction.deferReply();

		try {
			const table = await getTable(tableId);

			if (!table) {
				return await interaction.editReply({
					content: `Table #${tableId} not found. Please check the table ID and try again.`,
				});
			}

			await DataManager.addServerTable(interaction.guild.id, tableId);
			const data = await database.getServerData(serverId);

			const allPlayers = PlayerStats.getPlayersFromTable(table);
			let userCount = 0;

			// Iterate through users (data.users is an object with userId as keys)
			for (const userId in data.users) {
				const user = data.users[userId];
				// Iterate through players (allPlayers is an array)
				for (const player of allPlayers) {
					if (user.loungeName === player.playerName) {
						await DataManager.updateServerUser(serverId, userId, interaction.client);
						userCount++;
						// Found match, no need to check other players for this user
						break;
					}
				}
		    }

			if (userCount > 0) {
				await interaction.editReply(`Successfully updated ${userCount} user${userCount === 1 ? "" : "s"}.`);
			}
			else {
				await interaction.editReply("No users found in table.");
			}
		}
		catch (error) {
			console.error("Error fetching table data:", error);

			let errorMessage = "Sorry, there was an error fetching table data.";

			if (error.message.includes("404")) {
				errorMessage = `Table #${tableId} not found in the database.`;
			}
			else if (error.message.includes("ENOTFOUND") || error.message.includes("fetch")) {
				errorMessage = "Could not connect to the Mario Kart World Lounge API. Please try again later.";
			}

			await interaction.editReply({
				content: errorMessage,
			});
		}
	},
};