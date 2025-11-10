const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { migrateData } = require("../../scripts/migrateLocalData");

function createInteractionLogger(logBuffer) {
	const push = (level, parts) => {
		const message = parts.map(part => {
			if (part instanceof Error) {
				return part.stack || part.message;
			}
			if (typeof part === "object") {
				try {
					return JSON.stringify(part);
				}
				catch (_) {
					return String(part);
				}
			}
			return String(part);
		}).join(" ");
		logBuffer.push(`[${level}] ${message}`);
	};

	return {
		log: (...args) => push("info", args),
		warn: (...args) => push("warn", args),
		error: (...args) => push("error", args),
	};
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("migrate")
		.setDescription("normalize local data and sync to the configured database")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.setDMPermission(false),

	async execute(interaction) {
		const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
		if (!hasPermission) {
			await interaction.reply({
				content: "you need administrator permissions to run this command.",
			});
			return;
		}

		await interaction.deferReply();
		await interaction.editReply("starting migration...");

		const logBuffer = [];
		const logger = createInteractionLogger(logBuffer);

		try {
			const summary = await migrateData({ logger });
			const summaryLines = [
				"migration complete!",
				`mode: ${summary.mode}`,
				`users migrated: ${summary.usersMigrated}`,
				`tables migrated: ${summary.tablesMigrated}`,
				`user-table links migrated: ${summary.linkGroupsMigrated}`,
			];

			const recentLogs = logBuffer.slice(-10).join("\n");
			const logSection = recentLogs ? `\nrecent logs:\n${recentLogs}` : "";

			await interaction.editReply(`${summaryLines.join("\n")}${logSection}`.slice(0, 1900));
		}
		catch (error) {
			logger.error("migration failed", error);
			const recentLogs = logBuffer.slice(-10).join("\n");
			const content = `migration failed: ${error.message || error}\n${recentLogs ? `\nrecent logs:\n${recentLogs}` : ""}`;
			await interaction.editReply(content.slice(0, 1900));
		}
	},
};
