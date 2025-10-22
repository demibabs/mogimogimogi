/**
 * Enhanced Cache System with Smart Updates
 * Addresses real-time stat updates while maintaining performance
 */

const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const database = require("./database");

class EnhancedLeaderboardCache {
	constructor() {
		this.cache = new Map();
		this.lastUpdate = new Map();
		this.lastTableCheck = new Map(); // Track last known table IDs
		this.updateInterval = 5 * 60 * 1000; // 5 minutes
		this.quickCheckInterval = 30 * 1000; // 30 seconds for quick checks
	}

	/**
	 * Enhanced cache update strategy with incremental updates
	 */
	async getCachedStats(serverId, timeFilter = "all", serverOnly = false, squads = null) {
		const lastUpdate = this.lastUpdate.get(serverId) || 0;
		const lastQuickCheck = this.lastTableCheck.get(serverId) || 0;
		const now = Date.now();

		// Strategy 1: Quick check for new tables (every 30 seconds)
		if (now - lastQuickCheck > this.quickCheckInterval) {
			await this.quickTableCheck(serverId);
		}

		// Strategy 2: Full cache refresh (every 5 minutes)
		if (now - lastUpdate > this.updateInterval || !this.cache.has(serverId)) {
			await this.fullCacheRefresh(serverId);
		}

		const serverCache = this.cache.get(serverId);
		if (!serverCache) {
			return [];
		}

		return this.filterCachedStats(serverCache, timeFilter, serverOnly, squads);
	}

	/**
	 * Quick check for new tables without full cache rebuild
	 */
	async quickTableCheck(serverId) {
		try {
			const serverData = await database.getServerData(serverId);
			if (!serverData?.users) return;

			// Check if any users have new tables by comparing max table IDs
			let hasNewTables = false;

			for (const [userId] of Object.entries(serverData.users)) {
				try {
					// Get user's recent activity (last few tables)
					const recentTables = await this.getRecentUserTables(userId);
					const maxTableId = Math.max(...Object.keys(recentTables).map(id => parseInt(id)));

					const lastKnownId = this.getLastKnownTableId(userId);
					if (maxTableId > lastKnownId) {
						hasNewTables = true;
						this.setLastKnownTableId(userId, maxTableId);

						// Update specific user's cache incrementally
						await this.updateUserCache(serverId, userId);
					}
				}
				catch (error) {
					console.warn(`Quick check failed for user ${userId}:`, error);
				}
			}

			this.lastTableCheck.set(serverId, Date.now());

			if (hasNewTables) {
				console.log(`Quick update: Found new tables for server ${serverId}`);
			}
		}
		catch (error) {
			console.warn(`Quick table check failed for server ${serverId}:`, error);
		}
	}

	/**
	 * Get recent tables for a user (last 10-20 tables)
	 */
	async getRecentUserTables(userId, limit = 20) {
		// This would be optimized to only fetch recent tables
		// instead of all tables like the current system does
		const allTables = await LoungeApi.getAllPlayerTables(userId);

		// Sort by table ID and get most recent
		const sortedTables = Object.entries(allTables)
			.sort(([a], [b]) => parseInt(b) - parseInt(a))
			.slice(0, limit);

		return Object.fromEntries(sortedTables);
	}

	/**
	 * Update cache for a specific user when they have new tables
	 */
	async updateUserCache(serverId, userId) {
		try {
			const serverData = await database.getServerData(serverId);
			const userData = serverData.users[userId];

			if (!userData) return;

			// Recompute stats for this user only
			const userStats = await this.computeUserStats(
				userId,
				serverId,
				userData,
				Date.now() - (7 * 24 * 60 * 60 * 1000), // One week ago
				this.getSeasonStartTimestamp(),
			);

			if (userStats) {
				const serverCache = this.cache.get(serverId) || new Map();
				serverCache.set(userId, userStats);
				this.cache.set(serverId, serverCache);

				console.log(`Updated cache for user ${userId} with new tables`);
			}
		}
		catch (error) {
			console.warn(`Failed to update user cache for ${userId}:`, error);
		}
	}

	/**
	 * Track last known table ID for a user
	 */
	getLastKnownTableId(userId) {
		// This could be stored in memory or database
		// For now, return 0 to always check
		return 0;
	}

	setLastKnownTableId(userId, tableId) {
		// Store the last known table ID for future comparisons
		// Implementation depends on storage preference
	}

	/**
	 * Full cache refresh (existing method)
	 */
	async fullCacheRefresh(serverId) {
		// Your existing updateServerCache method
		await this.updateServerCache(serverId);
	}

	// ... rest of your existing methods
}

module.exports = new EnhancedLeaderboardCache();