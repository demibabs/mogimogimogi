const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const optimizedLeaderboard = require("../../utils/optimizedLeaderboard");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("streaks")
		.setDescription("Shows win streak leaderboard for the current season."),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			const serverId = interaction.guild.id;
			
			// Get cached leaderboard data (use mmr, all time, no filters for streak base data)
			const leaderboardData = await optimizedLeaderboard.getLeaderboard(
				serverId,
				"mMR",
				"all",
				false,
				null,
			);
			
			if (!leaderboardData || leaderboardData.length === 0) {
				return await interaction.editReply({
					content: "no leaderboard data available for this server. try running /setup first.",
				});
			}

			// Show current streaks by default
			await this.showStreaks(interaction, leaderboardData, "current");
		}
		catch (error) {
			console.error("error in streaks command:", error);
			await interaction.editReply({
				content: "an error occurred while fetching streak data.",
			});
		}
	},

	async showStreaks(interaction, leaderboardData, type) {
		try {
			const serverId = interaction.guild.id;
			
			// Get streak data from cache
			const streakData = await optimizedLeaderboard.getStreakCache().getServerStreaks(serverId, leaderboardData);
			
			// Filter to only players with active streaks
			const playersWithStreaks = streakData.filter(player => {
				if (type === "current") {
					return player.currentWinStreak > 0;
				}
				else {
					return player.longestWinStreak > 0;
				}
			});

			// Sort by streak (descending), then by mmr gain (descending)
			playersWithStreaks.sort((a, b) => {
				const aStreak = type === "current" ? a.currentWinStreak : a.longestWinStreak;
				const bStreak = type === "current" ? b.currentWinStreak : b.longestWinStreak;
				const aMmr = type === "current" ? a.currentStreakMmrGain : a.longestStreakMmrGain;
				const bMmr = type === "current" ? b.currentStreakMmrGain : b.longestStreakMmrGain;
				
				if (bStreak === aStreak) {
					return bMmr - aMmr;
				}
				return bStreak - aStreak;
			});

			// Create embed
			const embed = new EmbedBuilder()
				.setTitle(`winstreaks - ${type}`)
				.setColor("#4ECDC4")
				.setTimestamp();

			if (playersWithStreaks.length === 0) {
				embed.setDescription("no active win streaks found.");
			}
			else {
				// Build leaderboard description (top 5 only)
				let description = "";
				const maxUsers = Math.min(playersWithStreaks.length, 5);
				
				for (let i = 0; i < maxUsers; i++) {
					const user = playersWithStreaks[i];
					const rank = i + 1;
					
					// Get country flag emoji
					const flagEmoji = this.getCountryFlag(user.loungeUser?.countryCode);
					
					// Get Discord display name
					let displayName = "unknown";
					try {
						const discordUser = await interaction.client.users.fetch(user.userId);
						displayName = discordUser.displayName || discordUser.username;
					}
					catch (error) {
						displayName = user.loungeUser?.name || "unknown";
					}
					
					let streakText, mmrText, dateText = "";
					if (type === "current") {
						streakText = `${user.currentWinStreak} win streak`;
						mmrText = user.currentStreakMmrGain > 0 ? `(+${user.currentStreakMmrGain} mmr)` : "(+0 mmr)";
					}
					else {
						streakText = `${user.longestWinStreak} win streak`;
						mmrText = user.longestStreakMmrGain > 0 ? `(+${user.longestStreakMmrGain} mmr)` : "(+0 mmr)";
						
						// Add dates for all-time streaks on separate line
						if (user.longestStreakStart && user.longestStreakEnd) {
							const startDate = user.longestStreakStart.toLocaleDateString();
							const endDate = user.longestStreakEnd.toLocaleDateString();
							dateText = `\n   ${startDate} - ${endDate}`;
						}
					}
					
					description += `${rank}. ${flagEmoji} ${displayName}: ${streakText} ${mmrText}${dateText}\n`;
				}

				embed.setDescription(description);
				
				// Set thumbnail to first place player's profile picture
				if (playersWithStreaks.length > 0) {
					try {
						const firstPlaceUser = await interaction.client.users.fetch(playersWithStreaks[0].userId);
						embed.setThumbnail(firstPlaceUser.displayAvatarURL());
					}
					catch (error) {
						console.warn("could not set thumbnail for first place user:", error);
					}
				}
				
				if (playersWithStreaks.length > 5) {
					embed.setFooter({ text: `showing top 5 of ${playersWithStreaks.length} users with streaks` });
				}
			}

			// Create buttons
			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setCustomId("streaks_current")
						.setLabel("current")
						.setStyle(type === "current" ? ButtonStyle.Primary : ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId("streaks_alltime")
						.setLabel("all time")
						.setStyle(type === "alltime" ? ButtonStyle.Primary : ButtonStyle.Secondary),
				);

			await interaction.editReply({
				embeds: [embed],
				components: [row],
			});
		}
		catch (error) {
			console.error("error showing streaks:", error);
			await interaction.editReply({
				content: "an error occurred while displaying streak data.",
			});
		}
	},

	getCountryFlag(countryCode) {
		if (!countryCode || countryCode.length !== 2) {
			// Default flag for unknown countries
			return "🏳️";
		}
		
		// Convert country code to flag emoji
		const codePoints = countryCode
			.toUpperCase()
			.split("")
			.map(char => 127397 + char.charCodeAt());
		
		return String.fromCodePoint(...codePoints);
	},

	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("streaks_")) {
			return false;
		}

		try {
			await interaction.deferUpdate();

			const serverId = interaction.guild.id;
			const leaderboardData = await optimizedLeaderboard.getLeaderboard(
				serverId,
				"mMR",
				"all",
				false,
				null,
			);
			
			if (!leaderboardData || leaderboardData.length === 0) {
				return await interaction.editReply({
					content: "no leaderboard data available for this server.",
					components: [],
				});
			}

			const type = interaction.customId === "streaks_current" ? "current" : "alltime";
			await this.showStreaks(interaction, leaderboardData, type);
			
			return true;
		}
		catch (error) {
			console.error("error handling streaks button:", error);
			await interaction.editReply({
				content: "an error occurred while updating streak data.",
				components: [],
			});
			return true;
		}
	},
};