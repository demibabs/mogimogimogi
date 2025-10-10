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
				.setName("refresh")
				.setDescription("force refresh the cache."))
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
			case "refresh":
				await this.refreshCache(interaction, serverId);
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

	async showCacheInfo(interaction, serverId) {
		const cacheInfo = optimizedLeaderboard.getCacheInfo(serverId);

		const embed = new EmbedBuilder()
			.setTitle("📊 Leaderboard Cache Information")
			.setColor("#4ECDC4")
			.setTimestamp();

		let description = "";

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
		description += `**Cache Status:** ${cacheInfo.isStale ? "🟡 Stale" : "🟢 Fresh"}\n`;
		description += "**Update Interval:** 5 minutes\n\n";

		description += "**Benefits of Caching:**\n";
		description += "• ⚡ 10-20x faster leaderboard generation\n";
		description += "• 📊 Pre-computed statistics\n";
		description += "• 🔄 Automatic updates every 5 minutes\n";
		description += "• 💾 Reduced API load\n";

		embed.setDescription(description);

		await interaction.editReply({ embeds: [embed] });
	},

	async refreshCache(interaction, serverId) {
		const embed = new EmbedBuilder()
			.setTitle("🔄 Refreshing Cache")
			.setDescription("Please wait while the cache is being updated...")
			.setColor("#FFA726");

		await interaction.editReply({ embeds: [embed] });

		try {
			const startTime = Date.now();
			await optimizedLeaderboard.refreshCache(serverId);
			const endTime = Date.now();
			const duration = ((endTime - startTime) / 1000).toFixed(1);

			const cacheInfo = optimizedLeaderboard.getCacheInfo(serverId);

			const successEmbed = new EmbedBuilder()
				.setTitle("✅ Cache Refreshed Successfully")
				.setColor("#4ECDC4")
				.setTimestamp();

			let description = `**Refresh Duration:** ${duration} seconds\n`;
			description += `**Cached Users:** ${cacheInfo.userCount}\n`;
			description += `**Updated At:** ${new Date().toLocaleString()}\n\n`;
			description += "The leaderboard cache has been updated with the latest data!";

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
			.setDescription("The cache has been cleared. It will be rebuilt on the next leaderboard request.")
			.setColor("#FFA726");

		try {
			optimizedLeaderboard.clearCache(serverId);
			await interaction.editReply({ embeds: [embed] });
		}
		catch (error) {
			console.error("Error clearing cache:", error);
			await interaction.editReply({
				content: "❌ An error occurred while clearing the cache.",
			});
		}
	},
};