const { SlashCommandBuilder } = require("discord.js");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("force-tables")
		.setDescription("Force populate tables for a user (bot owner only)")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("User to populate tables for")
				.setRequired(true)),
	async execute(interaction) {
		try {
			// Check if user is bot owner
			const botOwnerId = process.env.BOT_OWNER_ID || "YOUR_DISCORD_ID_HERE";

			if (interaction.user.id !== botOwnerId) {
				return await interaction.reply({
					content: "ERROR: Only the bot owner can use this command.",
					ephemeral: true,
				});
			}

			await interaction.deferReply();

			const targetUser = interaction.options.getUser("user");
			const serverId = interaction.guild.id;

			await interaction.editReply(`Force populating tables for ${targetUser.username}...`);

			// Get player details from API directly
			const loungeUser = await LoungeApi.getPlayerByDiscordId(targetUser.id);
			if (!loungeUser) {
				return await interaction.editReply("User not found in Lounge API.");
			}

			let totalTables = 0;
			const params = {
				discordId: targetUser.id,
				game: "mkworld",
			};

			for (let season = 0; season <= LoungeApi.DEFAULT_SEASON; season++) {
				params.season = season;
				try {
					const details = await LoungeApi.apiGet("/player/details", params);
					const tableChanges = details.mmrChanges.filter(c => c.reason === "Table");

					await interaction.editReply(`Processing ${tableChanges.length} tables from season ${season}...`);

					for (const change of tableChanges) {
						try {
							// Get table data from API
							const tableData = await LoungeApi.getTable(change.changeId);
							if (tableData) {
								// Save table globally
								await database.saveTable(change.changeId, tableData);
								// Link user to table
								await database.linkUserToTable(targetUser.id, change.changeId, serverId);
								totalTables++;

								if (totalTables % 10 === 0) {
									await interaction.editReply(`Processed ${totalTables} tables so far...`);
								}
							}
						}
						catch (tableError) {
							console.warn(`Failed to save table ${change.changeId}:`, tableError);
						}
					}
				}
				catch (seasonError) {
					console.warn(`Failed to get season ${season} for user ${targetUser.id}:`, seasonError);
				}
			}

			await interaction.editReply(`✅ Successfully populated ${totalTables} tables for ${targetUser.username}!`);

		}
		catch (error) {
			console.error("Force tables command error:", error);
			const errorMessage = `Error: ${error.message}`;

			if (interaction.deferred) {
				await interaction.editReply(errorMessage);
			}
			else {
				await interaction.reply(errorMessage);
			}
		}
	},
};