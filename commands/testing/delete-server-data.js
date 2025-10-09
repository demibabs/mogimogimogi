const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("delete-server-data")
		.setDescription("Self explanatory."),

	async execute(interaction) {
		try	{
			await DataManager.deleteServerData(interaction.guild.id);
			await interaction.reply("Data deleted.");
		}
		catch (error) {
			console.error("Something went wrong", error);
			await interaction.reply("Something went wrong.");
		}
	},
};