const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("add-two-users")
		.setDescription("Adds two users to server dataset. Leave user2 blank to add yourself and user1.")
		.addUserOption(option =>
			option.setName("user1")
				.setDescription("First user")
				.setRequired(true))
		.addUserOption(option =>
			option.setName("user2")
				.setDescription("Second user")
				.setRequired(false)),

	async execute(interaction) {
		const user1 = interaction.options.getUser("user1");
		const user2 = interaction.options.getUser("user2") || interaction.user;
		const serverId = interaction.guild.id;

		if (!user1) {
			return await interaction.reply({
				content: "Please provide at least 1 Discord user to search for.",
				ephemeral: true,
			});
		}

		await interaction.deferReply();

		try {
			await DataManager.addServerUser(serverId, user1.id, interaction.client);
			await DataManager.addServerUser(serverId, user2.id, interaction.client);
			await interaction.editReply("Users successfully added.");
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