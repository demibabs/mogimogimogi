const { SlashCommandBuilder } = require("discord.js");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const DataManager = require("../../utils/dataManager");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("adds server lounge users to database."),

	async execute(interaction) {
		await interaction.reply({ content: "you no longer have to use this command for the time being. just keep in mind commands will be slower the first time you use them on someone." });
		return;

		/*
		if (!interaction.guild) {
			await interaction.reply({ content: "this command can only be used in a server.", ephemeral: true });
			return;
		}

		await interaction.deferReply();

		try {
			// Check if already setup
			const existingState = await Database.getServerSetupState(interaction.guild.id);
			const baseMessage = existingState?.completed
				? "updating server... scanning members"
				: "scanning members (this may take a while)";

			await interaction.editReply(`${baseMessage}...`);

			// Ensure cache is complete
			if (interaction.guild.memberCount > interaction.guild.members.cache.size) {
				try {
					await interaction.guild.members.fetch();
				}
				catch (e) {
					console.warn("setup: failed to fetch members:", e);
				}
			}

			const members = interaction.guild.members.cache;
			const total = members.size;
			let processed = 0;
			let found = 0;
			let newFound = 0;

			const memberList = Array.from(members.values());
			const chunkSize = 5;

			for (let i = 0; i < memberList.length; i += chunkSize) {

				const chunk = memberList.slice(i, i + chunkSize);
				await Promise.all(chunk.map(async (member) => {
					const id = member.id;
					try {
						// Check cache first
						const cached = await Database.getUserByDiscordId(id);
						if (cached) {
							found++;
							return;
						}

						// Not cached, check API
						const player = await LoungeApi.getPlayerByDiscordId(id);
						if (player?.id) {
							await DataManager.updateServerUser(interaction.guild.id, id, interaction.client, player);
							found++;
							newFound++;
						}
					}
					catch (e) {
						// ignore
					}
				}));

				processed += chunk.length;
				await interaction.editReply(`${baseMessage}... (${processed}/${total})`);
			}

			await Database.markServerSetupComplete(interaction.guild.id, {
				totalMembers: total,
				detectedLoungers: found,
				addedUsers: newFound,
				removedUsers: 0,
				initiatedBy: interaction.user.id,
				source: "setup",
			});

			await interaction.editReply("setup complete! use </about-me:1446020866356940860> for all commands.");
		}
		catch (error) {
			console.error("setup error:", error);
			await interaction.editReply("an error occurred during setup. please try again later.");
		}
		*/
	},
};