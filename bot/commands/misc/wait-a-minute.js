const { SlashCommandBuilder } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("wait-a-minute")
		.setDescription("Waits for 60 seconds to test graceful shutdown."),
	async execute(interaction) {
		await interaction.reply("Starting 60 second timer...");

		for (let i = 1; i <= 12; i++) {
			await new Promise(resolve => setTimeout(resolve, 5000));
			// If the bot shuts down, this editReply should be blocked by the monkey-patch
			await interaction.editReply(`Timer: ${i * 5} / 60 seconds elapsed...`);
		}

		await interaction.editReply("Timer finished! Success.");
	},
};
