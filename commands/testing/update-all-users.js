const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("update-all-users")
		.setDescription("Updates all users with existing table data."),

	async execute(interaction) {
		const serverData = await database.getServerData(interaction.guild.id);

		await interaction.deferReply();

		try {
			for (const id in serverData.users) {
				await DataManager.updateServerUser(interaction.guild.id, id, interaction.client);
			}
			await interaction.editReply("Updated users.");
		}
		catch (error) {
			console.error("Something went wrong:", error);
			await interaction.editReply("Something went wrong.");
		}
	},
};