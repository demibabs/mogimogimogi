const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("add-user")
		.setDescription("Adds user to server dataset. Leave blank for yourself.")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("User to add")
				.setRequired(false)),

	async execute(interaction) {
		const discordUser = interaction.options.getUser("user") || interaction.user;
		const userId = discordUser.id;
		const serverId = interaction.guild.id;

		await interaction.deferReply();

		try {
			await DataManager.addServerUser(serverId, userId, interaction.client);
			await interaction.editReply("User successfully added.");
		}
		catch (error) {
			console.error("Error fetching player data:", error);

			let errorMessage = "Sorry, there was an error fetching player data.";

			if (error.message.includes("404")) {
				errorMessage = "Player not found in the database.";
			}
			else if (error.message.includes("ENOTFOUND") || error.message.includes("fetch")) {
				errorMessage = "Could not connect to the Mario Kart Lounge API. Please try again later.";
			}

			await interaction.editReply({
				content: errorMessage,
			});
		}

	},
};