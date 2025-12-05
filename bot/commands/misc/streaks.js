const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("streaks")
		.setDescription("shows who's been on a hot streak of mogis."),

	async execute(interaction) {
		// Keep only the command skeleton; internal logic removed.
		await interaction.deferReply();

		const embed = new EmbedBuilder()
			.setColor("Yellow")
			.setTitle("streaks")
			.setDescription("this command is being rewritten. check back soon.");

		const row = new ActionRowBuilder()
			.addComponents(
				new ButtonBuilder()
					.setCustomId("streaks_current")
					.setLabel("current")
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId("streaks_alltime")
					.setLabel("all time")
					.setStyle(ButtonStyle.Secondary),
			);

		await interaction.editReply({ content: "", embeds: [embed], components: [row] });
	},

	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("streaks_")) return false;

		try {
			await interaction.deferUpdate();

			const type = interaction.customId === "streaks_current" ? "current" : "alltime";
			const embed = new EmbedBuilder()
				.setColor("Yellow")
				.setTitle(`streaks - ${type}`)
				.setDescription("button interactions are stubbed while this command is being rewritten.");

			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setCustomId("streaks_current")
						.setLabel("current")
						.setStyle(type === "current" ? ButtonStyle.Primary : ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId("streaks_alltime")
						.setLabel("all time")
						.setStyle(type === "alltime" ? ButtonStyle.Primary : ButtonStyle.Secondary),
				);

			await interaction.editReply({ content: "", embeds: [embed], components: [row] });
			return true;
		}
		catch (error) {
			console.error("error handling streaks button:", error);
			return false;
		}
	},
};