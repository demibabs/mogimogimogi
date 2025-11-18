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
				loungers.length === 1 ? "" : "s"}. use /about-me to see all commands`);
		}
		catch (error) {
			console.error("setup error:", error);
			await interaction.editReply("an error occurred during setup. please check the console for details.");
		}
	},
};