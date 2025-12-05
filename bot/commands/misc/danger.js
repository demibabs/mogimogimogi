const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	PermissionFlagsBits,
} = require("discord.js");
const database = require("../../utils/database");

const CUSTOM_ID_PREFIX = "danger";

function makeRow({ userId, disabled = false } = {}) {
	const confirmId = `${CUSTOM_ID_PREFIX}:confirm:${userId}`;
	const cancelId = `${CUSTOM_ID_PREFIX}:cancel:${userId}`;
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(confirmId)
			.setLabel("YES, WIPE EVERYTHING")
			.setStyle(ButtonStyle.Danger)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(cancelId)
			.setLabel("Cancel")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled),
	);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("danger")
		.setDescription("DANGER: Wipes the entire database after confirmation (admin only)."),

	async execute(interaction) {
		try {
			// Permission check: admin-only
			if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
				return interaction.reply({
					content: "You need Administrator permissions to use this command.",
					ephemeral: true,
				});
			}

			if (!database.useDatabase) {
				return interaction.reply({
					content: "DATABASE_URL not set; cannot wipe Postgres database.",
					ephemeral: true,
				});
			}

			const row = makeRow({ userId: interaction.user.id });
			await interaction.reply({
				content: "This will permanently drop and recreate all tables. Are you absolutely sure?",
				components: [row],
				ephemeral: true,
			});
		}
		catch (error) {
			console.error("/danger execute error:", error);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: "Error preparing confirmation.", ephemeral: true });
			}
		}
	},

	// Global button handler wired in index.js
	async handleButtonInteraction(interaction) {
		if (!interaction.customId || !interaction.customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) {
			return false; // not ours
		}

		const parts = interaction.customId.split(":");
		const action = parts[1];
		const ownerId = parts[2];

		// Only original requester can confirm/cancel
		if (interaction.user.id !== ownerId) {
			await interaction.reply({ content: "This confirmation isn't for you.", ephemeral: true });
			return true;
		}

		if (action === "cancel") {
			// Disable buttons
			const row = makeRow({ userId: ownerId, disabled: true });
			if (interaction.message && interaction.message.edit) {
				await interaction.update({ content: "Cancelled.", components: [row] });
			}
			else {
				await interaction.reply({ content: "Cancelled.", ephemeral: true });
			}
			return true;
		}

		if (action === "confirm") {
			try {
				// Disable buttons while processing
				const row = makeRow({ userId: ownerId, disabled: true });
				if (interaction.message && interaction.message.edit) {
					await interaction.update({ content: "Wiping database...", components: [row] });
				}
				else {
					await interaction.reply({ content: "Wiping database...", ephemeral: true });
				}

				const ok = await database.purgeAll();
				if (ok) {
					// Inform completion
					if (interaction.followUp) {
						await interaction.followUp({ content: "Database wiped and reinitialized.", ephemeral: true });
					}
				}
				else if (interaction.followUp) {
					await interaction.followUp({ content: "Failed to wipe database. Check logs.", ephemeral: true });
				}
			}
			catch (error) {
				console.error("/danger confirm error:", error);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: "Error during purge.", ephemeral: true });
				}
				else if (interaction.followUp) {
					await interaction.followUp({ content: "Error during purge.", ephemeral: true });
				}
			}
			return true;
		}

		return false;
	},
};
