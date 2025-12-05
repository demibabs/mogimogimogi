const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("old-leaderboard")
		.setDescription("rank your server by stats.")
		.addStringOption(option =>
			option.setName("stat")
				.setDescription("the stat to rank by.")
				.setRequired(true)
				.addChoices(
					{ name : "mmr", value: "mmr" },
					{ name: "team win rate", value: "tWR" },
					{ name: "average score", value: "aS" },
					{ name: "highest score", value: "hS" },
					{ name: "events played", value: "eP" },
				))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("true = only mogis including at least 2 server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("true = squad only, false = solo only.")),

	async execute(interaction) {
		// Keep the slash command boilerplate but remove internal logic.
		// Show a placeholder message and the navigation buttons so interactions still work.
		await interaction.deferReply();

		const stat = interaction.options.getString("stat");
		const serverOnly = interaction.options.getBoolean("server-only") ?? false;
		const squads = interaction.options.getBoolean("squads");

		const placeholder = new EmbedBuilder()
			.setColor("Yellow")
			.setTitle("leaderboard")
			.setDescription("/leaderboard is temporarily disabled (it broke so i'm going to rewrite the code lol). check back soon.");

		const row = new ActionRowBuilder()
			.addComponents(
				new ButtonBuilder()
					.setCustomId(`leaderboard_all_${stat}_${serverOnly}_${squads}`)
					.setLabel("all time")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true),
				new ButtonBuilder()
					.setCustomId(`leaderboard_weekly_${stat}_${serverOnly}_${squads}`)
					.setLabel("past week")
					.setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId(`leaderboard_season_${stat}_${serverOnly}_${squads}`)
					.setLabel("this season")
					.setStyle(ButtonStyle.Secondary),
			);

		await interaction.editReply({ content: "", embeds: [placeholder], components: [row] });
	},

	// Handle button interactions
	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("leaderboard_")) return false;

		try {
			await interaction.deferUpdate();

			// Parse the custom ID to get parameters (kept for compatibility)
			const parts = interaction.customId.split("_");
			const timeFilter = parts[1];
			const stat = parts[2];
			const serverOnly = parts[3] === "true";
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const placeholder = new EmbedBuilder()
				.setColor("Yellow")
				.setTitle("leaderboard")
				.setDescription("this command is being rewritten. button interactions are stubbed.");

			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setCustomId(`leaderboard_all_${stat}_${serverOnly}_${squads}`)
						.setLabel("all time")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(timeFilter === "all"),
					new ButtonBuilder()
						.setCustomId(`leaderboard_weekly_${stat}_${serverOnly}_${squads}`)
						.setLabel("past week")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(timeFilter === "weekly"),
					new ButtonBuilder()
						.setCustomId(`leaderboard_season_${stat}_${serverOnly}_${squads}`)
						.setLabel("this season")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(timeFilter === "season"),
				);

			await interaction.editReply({ content: "", embeds: [placeholder], components: [row] });
			return true;
		}
		catch (error) {
			console.error("Error in leaderboard button interaction:", error);
			return false;
		}
	},
};
