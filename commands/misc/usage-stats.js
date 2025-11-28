const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");
const { GLOBAL_COMMAND_NAMES } = require("../../utils/globalCommands");

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function formatCount(value) {
	const safeValue = Number.isFinite(value) ? value : 0;
	return NUMBER_FORMATTER.format(safeValue);
}

function buildUsageLines(usageEntries) {
	if (!usageEntries.length) {
		return "No tracked usage yet.";
	}

	return usageEntries.map(([commandName, counts], index) => {
		const label = commandName.replace(/-/g, " ");
		const rank = index + 1;
		return `**${rank}. ${label}**\nslash: ${formatCount(counts.slash)} | buttons: ${formatCount(counts.button)}`;
	}).join("\n\n");
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("usage-stats")
		.setDescription("Show slash vs button usage for global commands."),

	async execute(interaction) {
		if (!database.useDatabase) {
			await interaction.reply({
				content: "Command usage tracking requires a configured database (DATABASE_URL).",
				ephemeral: true,
			});
			return;
		}

		await interaction.deferReply();

		const statsMap = new Map(GLOBAL_COMMAND_NAMES.map(name => [name, { slash: 0, button: 0, updatedAt: null }]));
		try {
			const rows = await database.getCommandUsageStats(GLOBAL_COMMAND_NAMES.length);
			for (const row of rows) {
				const key = row?.command_name;
				if (!statsMap.has(key)) {
					continue;
				}
				statsMap.set(key, {
					slash: Number(row.slash_count) || 0,
					button: Number(row.button_count) || 0,
					updatedAt: row.updated_at ? new Date(row.updated_at) : null,
				});
			}
		}
		catch (error) {
			console.error("Failed to load command usage stats:", error);
			await interaction.editReply("Unable to load usage stats right now.");
			return;
		}

		const orderedEntries = Array.from(statsMap.entries()).sort((a, b) => {
			if (b[1].slash !== a[1].slash) {
				return b[1].slash - a[1].slash;
			}
			if (b[1].button !== a[1].button) {
				return b[1].button - a[1].button;
			}
			return a[0].localeCompare(b[0]);
		});

		const totals = orderedEntries.reduce((acc, [, counts]) => {
			acc.slash += counts.slash;
			acc.button += counts.button;
			return acc;
		}, { slash: 0, button: 0 });

		const embed = new EmbedBuilder()
			.setTitle("Global Command Usage")
			.setColor(0x5865f2)
			.setDescription(buildUsageLines(orderedEntries))
			.addFields({ name: "Totals", value: `slash: ${formatCount(totals.slash)} | buttons: ${formatCount(totals.button)}` })
			.setFooter({ text: "Ranked by slash command usage" })
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	},
};
