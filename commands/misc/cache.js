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
				.setDescription("clear the cache completely."))
		.addSubcommand(subcommand =>
			subcommand
				.setName("refresh-all-streaks")
				.setDescription("force refresh streak cache for all servers the bot is in.")),

	async execute(interaction) {
		if (!interaction.member.permissions.has("Administrator")) {
			return await interaction.reply({
				content: "you need administrator permissions to use cache commands.",
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
			case "refresh-all-streaks":
				await this.refreshAllStreakCaches(interaction);
				break;
			}
		}
		catch (error) {
			console.error("error in cache command:", error);
			await interaction.editReply({
				content: "an error occurred while managing the cache.",
			});
		}
	},

	async showAllServersStatus(interaction) {
		// Get all cached servers
		const allCacheInfo = this.getAllCacheInfo();

		const embed = new EmbedBuilder()
			.setTitle("global cache status")
			.setColor("#4ECDC4")
			.setTimestamp();

		if (allCacheInfo.length === 0) {
			embed.setDescription("no servers have cached data.");
			return await interaction.editReply({ embeds: [embed] });
		}

		// Sort by last update (most recent first)
		allCacheInfo.sort((a, b) => {
			if (!a.lastUpdate) return 1;
			if (!b.lastUpdate) return -1;
			return b.lastUpdate.getTime() - a.lastUpdate.getTime();
		});

		let description = `**total servers**: ${allCacheInfo.length}\n\n`;

		// Show summary stats
		const freshCount = allCacheInfo.filter(info => !info.isStale).length;
		const staleCount = allCacheInfo.filter(info => info.isStale).length;
		const totalUsers = allCacheInfo.reduce((sum, info) => sum + info.userCount, 0);

		description += "**Summary:**\n";
		description += `fresh: ${freshCount} servers\n`;
		description += `stale: ${staleCount} servers\n`;
		description += `total users: ${totalUsers}\n\n`;

		// Show individual server status (limit to top 10)
		description += "**server details:**\n";
		for (let i = 0; i < Math.min(allCacheInfo.length, 10); i++) {
			const info = allCacheInfo[i];
			const status = info.isStale ? "stale" : "fresh";

			let serverName = "unknown server";
			try {
				const guild = await interaction.client.guilds.fetch(info.serverId);
				serverName = guild.name;
			}
			catch (error) {
				serverName = `server ${info.serverId.slice(-4)}`;
			}

			const timeAgo = info.lastUpdate ?
				this.getTimeAgo(info.lastUpdate) : "never";

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
			.setTitle("cache information")
			.setColor("#4ECDC4")
			.setTimestamp();

		let description = "**leaderboard cache:**\n";

		if (cacheInfo.lastUpdate) {
			const timeSinceUpdate = Date.now() - cacheInfo.lastUpdate.getTime();
			const minutes = Math.floor(timeSinceUpdate / (1000 * 60));
			const seconds = Math.floor((timeSinceUpdate % (1000 * 60)) / 1000);

			description += `**last update:** ${cacheInfo.lastUpdate.toLocaleString()}\n`;
			description += `**time since update:** ${minutes}m ${seconds}s ago\n`;
		}
		else {
			description += "**last update:** never\n";
		}

		description += `**cached users:** ${cacheInfo.userCount}\n`;
		description += `**status:** ${cacheInfo.isStale ? "stale" : "fresh"}\n\n`;

		description += "**streak cache:**\n";
		if (streakCacheInfo.lastUpdate) {
			const timeSinceUpdate = Date.now() - streakCacheInfo.lastUpdate.getTime();
			const minutes = Math.floor(timeSinceUpdate / (1000 * 60));
			const seconds = Math.floor((timeSinceUpdate % (1000 * 60)) / 1000);

			description += `**last update:** ${streakCacheInfo.lastUpdate.toLocaleString()}\n`;
			description += `**time since update:** ${minutes}m ${seconds}s ago\n`;
		}
		else {
			description += "**last update:** never\n";
		}

		description += `**cached players:** ${streakCacheInfo.playerCount}\n`;
		description += `**status:** ${streakCacheInfo.isStale ? "stale" : "fresh"}\n\n`;

		embed.setDescription(description);

		await interaction.editReply({ embeds: [embed] });
	},

	async refreshCache(interaction, serverId) {
		const embed = new EmbedBuilder()
			.setTitle("refreshing cache")
			.setDescription("please wait while both leaderboard and streak caches are being updated...")
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
				.setTitle("cache refreshed successfully")
				.setColor("#4ECDC4")
				.setTimestamp();

			let description = `**refresh duration:** ${duration} seconds\n\n`;
			description += "**leaderboard cache:**\n";
			description += `• cached users: ${cacheInfo.userCount}\n`;
			description += `• updated at: ${new Date().toLocaleString()}\n\n`;
			description += "**streak cache:**\n";
			description += `• cached players: ${streakCacheInfo.playerCount}\n`;
			description += `• updated at: ${new Date().toLocaleString()}\n\n`;
			description += "both caches have been updated with the latest data!";

			successEmbed.setDescription(description);

			await interaction.editReply({ embeds: [successEmbed] });
		}
		catch (error) {
			console.error("error refreshing cache:", error);

			const errorEmbed = new EmbedBuilder()
				.setTitle("cache refresh failed")
				.setDescription("an error occurred while refreshing the cache. please try again later.")
				.setColor("#FF6B6B");

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},

	async clearCache(interaction, serverId) {
		const embed = new EmbedBuilder()
			.setTitle("cache cleared")
			.setDescription("both leaderboard and streak caches have been cleared. they will be rebuilt on the next request.")
			.setColor("#FFA726");

		try {
			await optimizedLeaderboard.clearCache(serverId);
			await optimizedLeaderboard.getStreakCache().clearServerStreaks(serverId);
			await interaction.editReply({ embeds: [embed] });
		}
		catch (error) {
			console.error("error clearing cache:", error);
			await interaction.editReply({
				content: "an error occurred while clearing the cache.",
			});
		}
	},

	async refreshAllCaches(interaction) {
		console.log("starting refreshAllCaches command...");

		try {
			const embed = new EmbedBuilder()
				.setTitle("refreshing all server caches")
				.setDescription("please wait while all server caches are being updated...")
				.setColor("#FFA726");

			await interaction.editReply({ embeds: [embed] });
			console.log("initial embed sent, starting cache refresh...");

			// Get all servers the bot is in
			const allGuilds = interaction.client.guilds.cache;
			const serverIds = Array.from(allGuilds.keys());

			console.log(`found ${serverIds.length} servers to refresh cache for`);

			const startTime = Date.now();

			// Refresh cache for each server the bot is in
			for (const serverId of serverIds) {
				try {
					await optimizedLeaderboard.updateServerCache(serverId);
					console.log(`refreshed cache for server ${serverId}`);
				}
				catch (error) {
					console.error(`failed to refresh cache for server ${serverId}:`, error);
				}
			}

			const endTime = Date.now();
			const duration = ((endTime - startTime) / 1000).toFixed(1);

			console.log(`cache refresh completed in ${duration}s`);

			// Get updated cache info for all servers
			const allCacheInfo = this.getAllCacheInfo();
			const serverCount = allCacheInfo.length;

			console.log(`found ${serverCount} servers with cache`);

			const successEmbed = new EmbedBuilder()
				.setTitle("all server caches refreshed")
				.setDescription(`successfully refreshed caches for **${serverIds.length}** servers in **${duration}s**\n\nBuilt cache for servers: **${serverCount}** with data`)
				.setColor("#4ECDC4")
				.setTimestamp();

			if (serverCount > 0) {
				// Show summary of refreshed servers (first 10 only)
				const serverSummary = allCacheInfo
					.slice(0, 10)
					.map(info => `• **${info.serverId}**: ${info.userCount} users`)
					.join("\n");

				successEmbed.addFields({
					name: `refreshed servers ${serverCount > 10 ? "(showing first 10)" : ""}`,
					value: serverSummary || "no servers found",
					inline: false,
				});

				if (serverCount > 10) {
					successEmbed.addFields({
						name: "total summary",
						value: `**${serverCount}** total servers refreshed`,
						inline: false,
					});
				}
			}
			else {
				successEmbed.setDescription("no servers with cache found to refresh.");
			}

			await interaction.editReply({ embeds: [successEmbed] });
		}
		catch (error) {
			console.error("error refreshing all caches:", error);

			const errorEmbed = new EmbedBuilder()
				.setTitle("cache refresh failed")
				.setDescription(`an error occurred while refreshing server caches:\n\`\`\`${error.message}\`\`\``)
				.setColor("#FF6B6B")
				.setTimestamp();

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},

	async refreshAllStreakCaches(interaction) {
		try {
			await interaction.editReply({
				content: "starting streak cache refresh for all servers...",
			});

			const allServers = interaction.client.guilds.cache;
			const startTime = Date.now();
			let successCount = 0;
			let errorCount = 0;
			const errors = [];

			const serverPromises = allServers.map(async (guild) => {
				try {
					console.log(`refreshing streak cache for server: ${guild.name} (${guild.id})`);
					await optimizedLeaderboard.getStreakCache().refreshServerStreaksFromDB(guild.id);
					successCount++;
				}
				catch (error) {
					console.error(`error refreshing streak cache for server ${guild.id}:`, error);
					errors.push(`${guild.name}: ${error.message}`);
					errorCount++;
				}
			});

			await Promise.all(serverPromises);

			const endTime = Date.now();
			const duration = ((endTime - startTime) / 1000).toFixed(1);

			const embed = new EmbedBuilder()
				.setTitle("streak cache refresh complete")
				.addFields(
					{ name: "successful", value: `${successCount} servers`, inline: true },
					{ name: "failed", value: `${errorCount} servers`, inline: true },
					{ name: "duration", value: `${duration}s`, inline: true },
				)
				.setColor(errorCount === 0 ? "#4ECDC4" : "#FFA726")
				.setTimestamp();

			if (errors.length > 0 && errors.length <= 5) {
				embed.addFields({
					name: "errors",
					value: errors.join("\n"),
					inline: false,
				});
			}
			else if (errors.length > 5) {
				embed.addFields({
					name: "errors",
					value: `${errors.slice(0, 3).join("\n")}\n... and ${errors.length - 3} more`,
					inline: false,
				});
			}

			await interaction.editReply({ embeds: [embed] });
		}
		catch (error) {
			console.error("Error in refreshAllStreakCaches:", error);
			const errorEmbed = new EmbedBuilder()
				.setTitle("streak cache refresh failed")
				.setDescription(`an error occurred while refreshing streak caches:\n\`\`\`${error.message}\`\`\``)
				.setColor("#FF6B6B")
				.setTimestamp();

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},
};