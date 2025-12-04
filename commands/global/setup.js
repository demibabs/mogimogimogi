const { SlashCommandBuilder } = require("discord.js");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("scans the server to cache lounge players for faster commands."),

	async execute(interaction) {
		if (!interaction.guild) {
			await interaction.reply({ content: "this command can only be used in a server.", ephemeral: true });
			return;
		}

		await interaction.deferReply();

		try {
			// Check if already setup
			const existingState = await Database.getServerSetupState(interaction.guild.id);
			if (existingState?.completed) {
				await interaction.editReply("updating global cache... scanning members...");
			}
			else {
				await interaction.editReply("setting up server... scanning members (this may take a while)...");
			}

			const members = await interaction.guild.members.fetch();
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
							await Database.saveUserData(player.id, {
								loungeName: player.name,
								discordIds: [id],
								countryCode: player.countryCode,
							});
							found++;
							newFound++;
						}
					}
					catch (e) {
						// ignore
					}
				}));

				processed += chunk.length;
			}

			await Database.markServerSetupComplete(interaction.guild.id, {
				memberCount: total,
				foundCount: found,
			});

			await interaction.editReply(`setup complete! scanned ${total} members. found ${found} lounge players (${newFound} new to cache).`);
		}
		catch (error) {
			console.error("setup error:", error);
			await interaction.editReply("an error occurred during setup. please try again later.");
		}
	},
};