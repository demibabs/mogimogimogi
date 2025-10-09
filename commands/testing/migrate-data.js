const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("migrate-data")
		.setDescription("Migrate server data to normalized schema (bot owner only)")
		.addBooleanOption(option =>
			option.setName("all-servers")
				.setDescription("Migrate all servers the bot is in (bot owner only)")
				.setRequired(false)),
	async execute(interaction) {
		try {
			// Check if user is bot owner (you can replace this with your Discord ID)
			const botOwnerId = process.env.BOT_OWNER_ID || "YOUR_DISCORD_ID_HERE";
			const isAllServers = interaction.options.getBoolean("all-servers");

			if (isAllServers && interaction.user.id !== botOwnerId) {
				return await interaction.reply({
					content: "ERROR: Only the bot owner can migrate all servers.",
					ephemeral: true,
				});
			}

			if (!isAllServers && !interaction.member.permissions.has("Administrator")) {
				return await interaction.reply({
					content: "ERROR: You must be an administrator to migrate this server.",
					ephemeral: true,
				});
			}

			await interaction.deferReply();

			if (isAllServers) {
				await interaction.editReply("Starting migration for ALL servers... This may take a while.");

				// Get all server IDs from the database
				const serverIds = await database.getAllServerIds();
				let successCount = 0;
				let errorCount = 0;

				await interaction.editReply(`Found ${serverIds.length} servers to migrate. Starting migration...`);

				for (const serverId of serverIds) {
					try {
						const success = await DataManager.migrateServerData(serverId);
						if (success) {
							successCount++;
							console.log(`Successfully migrated server: ${serverId}`);
						}
						else {
							errorCount++;
							console.log(`Failed to migrate server: ${serverId}`);
						}

						// Update progress every 5 servers
						if ((successCount + errorCount) % 5 === 0) {
							await interaction.editReply(
								`Migration progress: ${successCount + errorCount}/${serverIds.length} servers processed. ` +
								`${successCount} successful, ${errorCount} failed.`,
							);
						}
					}
					catch (error) {
						errorCount++;
						console.error(`Error migrating server ${serverId}:`, error);
					}
				}

				await interaction.editReply(
					"**Migration Complete!**\n" +
					`**Results:** ${successCount + errorCount}/${serverIds.length} servers processed\n` +
					`**Successful:** ${successCount} servers\n` +
					`**Failed:** ${errorCount} servers\n\n` +
					`${errorCount > 0 ? "Check console logs for error details." : "All servers migrated successfully!"}`,
				);
			}
			else {
				await interaction.editReply("Starting data migration for this server...");

				const serverId = interaction.guild.id;
				const success = await DataManager.migrateServerData(serverId);

				if (success) {
					await interaction.editReply("Data migration completed successfully! Tables are now stored in normalized format.");
				}
				else {
					await interaction.editReply("Data migration failed. Check console logs for details.");
				}
			}
		}
		catch (error) {
			console.error("Migration command error:", error);
			const errorMessage = "An error occurred during migration.";

			if (interaction.deferred) {
				await interaction.editReply(errorMessage);
			}
			else {
				await interaction.reply(errorMessage);
			}
		}
	},
};