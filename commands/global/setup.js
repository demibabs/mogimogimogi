const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");
const optimizedLeaderboard = require("../../utils/optimizedLeaderboard");
const streakCache = require("../../utils/streakCache");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("adds every server user with a lounge account and builds leaderboard cache."),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("starting setup process...");

			const members = await interaction.guild.members.fetch();
			const serverData = await database.getServerData(interaction.guild.id);

			const loungers = [];
			const totalMembers = members.size;
			let processedCount = 0;

			await interaction.editReply(`processing ${totalMembers} server members...`);

			// Find users with Lounge accounts who aren't already in server data
			for (const [userId, member] of members) {
				if (member.user.bot) continue;

				try {
					const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
					if (!loungeUser) continue;
					if (serverData?.users?.[userId]) continue;
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
				return await interaction.editReply("setup complete! no new users to add. :)");
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

			await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
				loungers.length === 1 ? "" : "s"}.`);

			// Check if server has cache, and create it if it doesn't
			const serverId = interaction.guild.id;
			const cacheInfo = optimizedLeaderboard.getCacheInfo(serverId);
			
			if (!cacheInfo.exists) {
				await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
					loungers.length === 1 ? "" : "s"}.\n\nbuilding leaderboard cache...`);
				
				try {
					await optimizedLeaderboard.updateServerCache(serverId);
					const newCacheInfo = optimizedLeaderboard.getCacheInfo(serverId);
					
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\nleaderboard cache created with ${newCacheInfo.userCount} users!\n\nbuilding streak cache...`);
					
					// Also create streak cache
					await streakCache.refreshServerStreaksFromDB(serverId);
					
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\nleaderboard cache created with ${newCacheInfo.userCount} users!\nstreak cache created!`);
				}
				catch (error) {
					console.error("failed to create cache during setup:", error);
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\ncache creation failed.`);
				}
			}
			else {
				// If leaderboard cache exists, still check and create streak cache if needed
				try {
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\nbuilding streak cache...`);
					
					await streakCache.refreshServerStreaksFromDB(serverId);
					
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\nstreak cache created!`);
				}
				catch (error) {
					console.error("failed to create streak cache during setup:", error);
					await interaction.editReply(`setup complete! added ${addedCount} of ${loungers.length} user${
						loungers.length === 1 ? "" : "s"}.\n\nstreak cache creation failed.`);
				}
			}
		}
		catch (error) {
			console.error("setup error:", error);
			await interaction.editReply("an error occurred during setup. please check the console for details.");
		}
	},
};