const { SlashCommandBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("Adds every server user with a Lounge account. Takes a while."),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("Starting setup process...");

			const members = await interaction.guild.members.fetch();
			const serverData = await database.getServerData(interaction.guild.id);

			const loungers = [];
			const totalMembers = members.size;
			let processedCount = 0;

			await interaction.editReply(`Processing ${totalMembers} server members...`);

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
					console.warn(`Error checking user ${userId}:`, error);
				}

				processedCount++;

				// Update progress every user
				await interaction.editReply(`Processing members... (${processedCount}/${totalMembers})`);
			}

			if (loungers.length === 0) {
				return await interaction.editReply("Setup complete! No new users to add. :)");
			}

			await interaction.editReply(`Adding ${loungers.length} new users to server data...`);

			// Add new users
			let addedCount = 0;
			for (const lounger of loungers) {
				try {
					await DataManager.addServerUser(interaction.guild.id, lounger, interaction.client);
					addedCount++;
					// Update progress every user
					await interaction.editReply(`Adding users... (${addedCount}/${loungers.length})`);
				}
				catch (error) {
					console.error(`Failed to add user ${lounger}:`, error);
				}
			}

			await interaction.editReply(`Setup complete! Added ${addedCount} of ${loungers.length} user${
				loungers.length === 1 ? "" : "s"}.`);
		}
		catch (error) {
			console.error("Setup error:", error);
			await interaction.editReply("ERROR: An error occurred during setup. Please check the console for details.");
		}
	},
};