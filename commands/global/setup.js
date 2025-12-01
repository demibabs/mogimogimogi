const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");
// cache system removed

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("adds every server user with a lounge account."),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("starting setup process...");

			const serverId = interaction.guild.id;
			const members = await interaction.guild.members.fetch();
			let serverData = await database.getServerData(serverId);
			const setupState = await database.getServerSetupState(serverId);
			const needsCleanup = Boolean(setupState?.completed);

			const loungers = [];
			const totalMembers = members.size;
			let processedCount = 0;
			const recordSetupCompletion = async (stats = {}) => {
				try {
					await database.markServerSetupComplete(serverId, {
						initiatedBy: interaction.user?.id || null,
						totalMembers,
						...stats,
					});
				}
				catch (stateError) {
					console.warn("setup: failed to store setup metadata:", stateError);
				}
			};

			let removedCount = 0;
			if (needsCleanup) {
				const storedUsers = Object.entries(serverData?.users || {});
				if (storedUsers.length) {
					await interaction.editReply(`verifying ${storedUsers.length} stored members before setup...`);
					let inspected = 0;
					for (const [loungeId, record] of storedUsers) {
						inspected++;
						const discordIds = Array.isArray(record?.discordIds)
							? record.discordIds.map(String)
							: [];
						const stillMember = discordIds.some(discordId => members.has(discordId));
						if (!stillMember) {
							const removed = await DataManager.removeServerUser(serverId, { loungeId });
							if (removed) {
								removedCount++;
							}
						}
						if (inspected % 25 === 0 || inspected === storedUsers.length) {
							await interaction.editReply(`verifying stored members... (${inspected}/${storedUsers.length}) | removed ${removedCount}`);
						}
					}
				}
				serverData = await database.getServerData(serverId);
			}

			await interaction.editReply(`processing ${totalMembers} server members...`);

			// Find users with Lounge accounts who aren't already in server data
			for (const [userId, member] of members) {
				if (member.user.bot) continue;

				try {
					const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
					if (!loungeUser) continue;
					if (serverData?.discordIndex?.[userId]) continue;
					loungers.push(userId);
				}
				catch (error) {
					console.warn(`error checking user ${userId}:`, error);
				}

				processedCount++;

				// Update progress every user
				await interaction.editReply(`processing members... (${processedCount}/${totalMembers})`);
			}

			if (loungers.length === 0) {
				await recordSetupCompletion({ detectedLoungers: 0, addedUsers: 0, removedUsers: removedCount });
				return await interaction.editReply("setup complete! no users to add. :)");
			}

			await interaction.editReply(`adding ${loungers.length} new users to server data...`);

			// Add new users
			let addedCount = 0;
			for (const lounger of loungers) {
				try {
					await DataManager.addServerUser(interaction.guild.id, lounger, interaction.client);
					addedCount++;
					// Update progress every user
					await interaction.editReply(`adding users... (${addedCount}/${loungers.length})`);
				}
				catch (error) {
					console.error(`failed to add user ${lounger}:`, error);
				}
			}

			await recordSetupCompletion({
				detectedLoungers: loungers.length,
				addedUsers: addedCount,
				removedUsers: removedCount,
			});

			const removedSuffix = removedCount ? ` removed ${removedCount} stale entr${removedCount === 1 ? "y" : "ies"}.` : "";
			await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
				loungers.length === 1 ? "" : "s"}.${removedSuffix} use /about-me to see all commands`);
		}
		catch (error) {
			console.error("setup error:", error);
			await interaction.editReply("an error occurred during setup. please check the console for details.");
		}
	},
};