const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup-all")
		.setDescription("Run setup across all servers: adds every member with a Lounge account."),

	async execute(interaction) {
		// Restrict to bot owner / privileged users if desired: ephemeral + simple guard
		await interaction.deferReply({ ephemeral: true });
		await interaction.editReply("Starting multi-server setup...");

		const client = interaction.client;
		const initiatorId = interaction.user?.id || null;
		const guilds = client.guilds.cache;
		if (!guilds.size) {
			return interaction.editReply("No guilds found.");
		}

		let totalAdded = 0;
		let processedGuilds = 0;
		const perGuildSummary = [];

		for (const [guildId, guild] of guilds) {
			processedGuilds++;
			let added = 0;
			let considered = 0;
			try {
				await interaction.editReply(`Processing guild ${processedGuilds}/${guilds.size}: ${guild.name}`);
				const members = await guild.members.fetch();
				for (const [userId, member] of members) {
					if (member.user.bot) continue;
					considered++;
					try {
						const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
						if (!loungeUser) continue;
						// Add server user if not already associated
						const serverData = await database.getServerData(guildId);
						const already = Object.values(serverData.users || {}).some(u => (u.discordIds || []).includes(String(userId)));
						if (already) continue;
						const ok = await DataManager.addServerUser(guildId, userId, client);
						if (ok) {
							added++;
							totalAdded++;
						}
					}
					catch (err) {
						console.warn(`Failed add attempt for ${userId} in guild ${guildId}:`, err.message);
					}
				}
				perGuildSummary.push(`• ${guild.name}: added ${added} user(s) out of ${considered} member(s)`);
				try {
					await database.markServerSetupComplete(guildId, {
						initiatedBy: initiatorId,
						totalMembers: members.size,
						detectedLoungers: added,
						addedUsers: added,
						source: "setup-all",
					});
				}
				catch (stateError) {
					console.warn(`setup-all: failed to store setup metadata for ${guildId}:`, stateError);
				}
			}
			catch (error) {
				console.error(`Setup-all error for guild ${guildId}:`, error);
				perGuildSummary.push(`• ${guild.name}: error (${error.message})`);
			}
		}

		await interaction.editReply(`Setup-all complete. Added ${totalAdded} users across ${guilds.size} guild(s).\n\n${perGuildSummary.join("\n")}`);
	},
};
