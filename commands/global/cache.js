const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const optimizedLeaderboard = require("../../utils/optimizedLeaderboard");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("cache")
		.setDescription("manage leaderboard cache.")
		.addSubcommand(subcommand =>
			subcommand
				.setName("info")
				.setDescription("show cache information."))
		.addSubcommand(subcommand =>
			subcommand
				.setName("status")
				.setDescription("show cache status for all servers."))
		.addSubcommand(subcommand =>
			subcommand
				.setName("refresh")
				.setDescription("force refresh the cache."))
		.addSubcommand(subcommand =>
			subcommand
				.setName("refresh-all")
				.setDescription("force refresh cache for all servers the bot is in."))
		.addSubcommand(subcommand =>
			subcommand
				.setName("clear")
				.setDescription("clear the cache completely.")),

	async execute(interaction) {
		if (!interaction.member.permissions.has("Administrator")) {
			return await interaction.reply({
				content: "❌ You need Administrator permissions to use cache commands.",
				ephemeral: true,
			});
		}

		try {
			await interaction.deferReply();

			const subcommand = interaction.options.getSubcommand();
			const serverId = interaction.guildId;

			switch (subcommand) {
			case "info":
				await this.showCacheInfo(interaction, serverId);
				break;
			case "status":
				await this.showAllServersStatus(interaction);
				break;
			case "refresh":
				await this.refreshCache(interaction, serverId);
				break;
			case "refresh-all":
				await this.refreshAllCaches(interaction);
				break;
			case "clear":
				await this.clearCache(interaction, serverId);
				break;
			}
		}
		catch (error) {
			console.error("Error in cache command:", error);
			await interaction.editReply({
				content: "❌ An error occurred while managing the cache.",
			});
		}
	},

	async showAllServersStatus(interaction) {
		// Get all cached servers
		const allCacheInfo = this.getAllCacheInfo();

		const embed = new EmbedBuilder()
			.setTitle("📊 Global Cache Status")
			.setColor("#4ECDC4")
			.setTimestamp();

		if (allCacheInfo.length === 0) {
			embed.setDescription("No servers have cached data.");
			return await interaction.editReply({ embeds: [embed] });
		}

		// Sort by last update (most recent first)
		allCacheInfo.sort((a, b) => {
			if (!a.lastUpdate) return 1;
			if (!b.lastUpdate) return -1;
			return b.lastUpdate.getTime() - a.lastUpdate.getTime();
		});

		let description = `**Total Servers**: ${allCacheInfo.length}\n\n`;

		// Show summary stats
		const freshCount = allCacheInfo.filter(info => !info.isStale).length;
		const staleCount = allCacheInfo.filter(info => info.isStale).length;
		const totalUsers = allCacheInfo.reduce((sum, info) => sum + info.userCount, 0);

		description += "**Summary:**\n";
		description += `🟢 Fresh: ${freshCount} servers\n`;
		description += `🟡 Stale: ${staleCount} servers\n`;
		description += `👥 Total Users: ${totalUsers}\n\n`;

		// Show individual server status (limit to top 10)
		description += "**Server Details:**\n";
		for (let i = 0; i < Math.min(allCacheInfo.length, 10); i++) {
			const info = allCacheInfo[i];
			const status = info.isStale ? "🟡" : "🟢";
			
			let serverName = "Unknown Server";
			try {
				const guild = await interaction.client.guilds.fetch(info.serverId);
				serverName = guild.name;
			}
			catch (error) {
				serverName = `Server ${info.serverId.slice(-4)}`;
			}

			const timeAgo = info.lastUpdate ?
				this.getTimeAgo(info.lastUpdate) : "Never";

			description += `${status} **${serverName}**\n`;
			description += `   └ ${info.userCount} users, updated ${timeAgo}\n`;
		}

		if (allCacheInfo.length > 10) {
			description += `\n*...and ${allCacheInfo.length - 10} more servers*`;
		}

		embed.setDescription(description);

		await interaction.editReply({ embeds: [embed] });
	},

	getAllCacheInfo() {
		return optimizedLeaderboard.getAllCacheInfo();
	},

	getTimeAgo(date) {
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMins / 60);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		return `${Math.floor(diffHours / 24)}d ago`;
	},

	async showCacheInfo(interaction, serverId) {
		const cacheInfo = optimizedLeaderboard.getCacheInfo(serverId);
		const streakCacheInfo = optimizedLeaderboard.getStreakCache().getCacheInfo(serverId);

		const embed = new EmbedBuilder()
			.setTitle("📊 Cache Information")
			.setColor("#4ECDC4")
			.setTimestamp();

		let description = "**Leaderboard Cache:**\n";

		if (cacheInfo.lastUpdate) {
			const timeSinceUpdate = Date.now() - cacheInfo.lastUpdate.getTime();
			const minutes = Math.floor(timeSinceUpdate / (1000 * 60));
			const seconds = Math.floor((timeSinceUpdate % (1000 * 60)) / 1000);

			description += `**Last Update:** ${cacheInfo.lastUpdate.toLocaleString()}\n`;
			description += `**Time Since Update:** ${minutes}m ${seconds}s ago\n`;
		}
		else {
			description += "**Last Update:** Never\n";
		}

		description += `**Cached Users:** ${cacheInfo.userCount}\n`;
		description += `**Status:** ${cacheInfo.isStale ? "🟡 Stale" : "🟢 Fresh"}\n\n`;

		description += "**Streak Cache:**\n";
		if (streakCacheInfo.lastUpdate) {
			const timeSinceUpdate = Date.now() - streakCacheInfo.lastUpdate.getTime();
			const minutes = Math.floor(timeSinceUpdate / (1000 * 60));
			const seconds = Math.floor((timeSinceUpdate % (1000 * 60)) / 1000);

			description += `**Last Update:** ${streakCacheInfo.lastUpdate.toLocaleString()}\n`;
			description += `**Time Since Update:** ${minutes}m ${seconds}s ago\n`;
		}
		else {
			description += "**Last Update:** Never\n";
		}

		description += `**Cached Players:** ${streakCacheInfo.playerCount}\n`;
		description += `**Status:** ${streakCacheInfo.isStale ? "🟡 Stale" : "🟢 Fresh"}\n\n`;

		description += "**Benefits of Caching:**\n";
		description += "• ⚡ 10-20x faster generation\n";
		description += "• 📊 Pre-computed statistics & streaks\n";
		description += "• 🔄 Automatic updates every hour\n";
		description += "• 💾 Reduced API load\n";

		embed.setDescription(description);

		await interaction.editReply({ embeds: [embed] });
	},

	async refreshCache(interaction, serverId) {
		const embed = new EmbedBuilder()
			.setTitle("🔄 Refreshing Cache")
			.setDescription("Please wait while both leaderboard and streak caches are being updated...")
			.setColor("#FFA726");

		await interaction.editReply({ embeds: [embed] });

		try {
			const startTime = Date.now();
			
			// Refresh leaderboard cache first
			await optimizedLeaderboard.refreshCache(serverId);
			
			// Get updated leaderboard data for streak calculation
			const leaderboardData = await optimizedLeaderboard.getLeaderboard(
				serverId,
				"mMR",
				"all",
				false,
				null,
			);
			
			// Refresh streak cache
			if (leaderboardData && leaderboardData.length > 0) {
				await optimizedLeaderboard.getStreakCache().refreshServerStreaks(serverId, leaderboardData);
			}
			
			const endTime = Date.now();
			const duration = ((endTime - startTime) / 1000).toFixed(1);

			const cacheInfo = optimizedLeaderboard.getCacheInfo(serverId);
			const streakCacheInfo = optimizedLeaderboard.getStreakCache().getCacheInfo(serverId);

			const successEmbed = new EmbedBuilder()
				.setTitle("✅ Cache Refreshed Successfully")
				.setColor("#4ECDC4")
				.setTimestamp();

			let description = `**Refresh Duration:** ${duration} seconds\n\n`;
			description += "**Leaderboard Cache:**\n";
			description += `• Cached Users: ${cacheInfo.userCount}\n`;
			description += `• Updated At: ${new Date().toLocaleString()}\n\n`;
			description += "**Streak Cache:**\n";
			description += `• Cached Players: ${streakCacheInfo.playerCount}\n`;
			description += `• Updated At: ${new Date().toLocaleString()}\n\n`;
			description += "Both caches have been updated with the latest data!";

			successEmbed.setDescription(description);

			await interaction.editReply({ embeds: [successEmbed] });
		}
		catch (error) {
			console.error("Error refreshing cache:", error);

			const errorEmbed = new EmbedBuilder()
				.setTitle("❌ Cache Refresh Failed")
				.setDescription("An error occurred while refreshing the cache. Please try again later.")
				.setColor("#FF6B6B");

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},

	async clearCache(interaction, serverId) {
		const embed = new EmbedBuilder()
			.setTitle("🗑️ Cache Cleared")
			.setDescription("Both leaderboard and streak caches have been cleared. They will be rebuilt on the next request.")
			.setColor("#FFA726");

		try {
			await optimizedLeaderboard.clearCache(serverId);
			await optimizedLeaderboard.getStreakCache().clearServerStreaks(serverId);
			await interaction.editReply({ embeds: [embed] });
		}
		catch (error) {
			console.error("Error clearing cache:", error);
			await interaction.editReply({
				content: "❌ An error occurred while clearing the cache.",
			});
		}
	},

	async refreshAllCaches(interaction) {
		console.log("Starting refreshAllCaches command...");
		
		try {
			const embed = new EmbedBuilder()
				.setTitle("🔄 Refreshing All Server Caches")
				.setDescription("Please wait while all server caches are being updated...")
				.setColor("#FFA726");

			await interaction.editReply({ embeds: [embed] });
			console.log("Initial embed sent, starting cache refresh...");

			// Get all servers the bot is in
			const allGuilds = interaction.client.guilds.cache;
			const serverIds = Array.from(allGuilds.keys());
			
			console.log(`Found ${serverIds.length} servers to refresh cache for`);

			const startTime = Date.now();
			
			// Refresh cache for each server the bot is in
			for (const serverId of serverIds) {
				try {
					await optimizedLeaderboard.updateServerCache(serverId);
					console.log(`✅ Refreshed cache for server ${serverId}`);
				}
				catch (error) {
					console.error(`❌ Failed to refresh cache for server ${serverId}:`, error);
				}
			}
			
			const endTime = Date.now();
			const duration = ((endTime - startTime) / 1000).toFixed(1);

			console.log(`Cache refresh completed in ${duration}s`);

			// Get updated cache info for all servers
			const allCacheInfo = this.getAllCacheInfo();
			const serverCount = allCacheInfo.length;

			console.log(`Found ${serverCount} servers with cache`);

			const successEmbed = new EmbedBuilder()
				.setTitle("✅ All Server Caches Refreshed")
				.setDescription(`Successfully refreshed caches for **${serverIds.length}** servers in **${duration}s**\n\nBuilt cache for servers: **${serverCount}** with data`)
				.setColor("#4ECDC4")
				.setTimestamp();

			if (serverCount > 0) {
				// Show summary of refreshed servers (first 10 only)
				const serverSummary = allCacheInfo
					.slice(0, 10)
					.map(info => `• **${info.serverId}**: ${info.userCount} users`)
					.join("\n");

				successEmbed.addFields({
					name: `📊 Refreshed Servers ${serverCount > 10 ? "(showing first 10)" : ""}`,
					value: serverSummary || "No servers found",
					inline: false,
				});

				if (serverCount > 10) {
					successEmbed.addFields({
						name: "📈 Total Summary",
						value: `**${serverCount}** total servers refreshed`,
						inline: false,
					});
				}
			}
			else {
				successEmbed.setDescription("No servers with cache found to refresh.");
			}

			await interaction.editReply({ embeds: [successEmbed] });
		}
		catch (error) {
			console.error("Error refreshing all caches:", error);
			
			const errorEmbed = new EmbedBuilder()
				.setTitle("❌ Cache Refresh Failed")
				.setDescription(`An error occurred while refreshing server caches:\n\`\`\`${error.message}\`\`\``)
				.setColor("#FF6B6B")
				.setTimestamp();

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},
};