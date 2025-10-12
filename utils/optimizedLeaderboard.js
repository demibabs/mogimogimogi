/**
 * Optimized Leaderboard System
 * Uses caching to dramatically improve performance by pre-computing statistics
 */

const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const database = require("./database");
const streakCache = require("./streakCache");

class LeaderboardCache {
	constructor() {
		this.cache = new Map();
		this.lastUpdate = new Map();
		this.updateInterval = 24 * 60 * 60 * 1000;
		this.backgroundRefreshes = new Map();

		// Start daily scheduled refresh for all servers
		this.startDailyRefresh();

		// Load cache from database on startup
		this.loadCacheFromDatabase();
	}

	/**
	 * Load existing cache from database on startup
	 */
	async loadCacheFromDatabase() {
		try {
			const allCacheInfo = await database.getAllServerCacheInfo();
			console.log(`loading cache for ${allCacheInfo.length} servers from database...`);

			for (const cacheInfo of allCacheInfo) {
				try {
					const serverCache = await database.getLeaderboardCache(cacheInfo.serverId);
					if (serverCache.size > 0) {
						this.cache.set(cacheInfo.serverId, serverCache);
						this.lastUpdate.set(cacheInfo.serverId, cacheInfo.lastUpdate.getTime());
						console.log(`loaded cache for server ${cacheInfo.serverId} (${serverCache.size} users)`);
					}
				}
				catch (error) {
					console.error(`failed to load cache for server ${cacheInfo.serverId}:`, error);
				}
			}

			console.log(`cache loaded from database for ${this.cache.size} servers`);
		}
		catch (error) {
			console.error("failed to load cache from database:", error);
		}
	}

	/**
	 * Start daily scheduled refresh for all servers
	 */
	startDailyRefresh() {
		// Calculate milliseconds until next hour mark (:00)
		const now = new Date();
		const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

		console.log(`scheduling first cache refresh in ${Math.round(msUntilNextHour / 1000 / 60)} minutes at ${new Date(Date.now() + msUntilNextHour).toLocaleTimeString()}`);

		// Set initial timeout to sync with hour mark
		setTimeout(() => {
			// Perform initial refresh
			this.refreshAllServerCaches();

			// Then set up interval to refresh every day
			setInterval(() => {
				this.refreshAllServerCaches();
			}, 24 * 60 * 60 * 1000);

		}, msUntilNextHour);
	}

	/**
	 * Refresh all server caches (called every hour at :00)
	 */
	async refreshAllServerCaches() {
		try {
			const now = new Date();
			console.log(`starting scheduled cache refresh for all servers at ${now.toLocaleTimeString()}`);

			// Get all servers that have cache data
			const allCacheInfo = await database.getAllServerCacheInfo();
			console.log(`found ${allCacheInfo.length} servers with existing cache data`);

			let refreshed = 0;
			let failed = 0;

			// Refresh each server cache in parallel (with some concurrency control)
			const batchSize = 3;
			for (let i = 0; i < allCacheInfo.length; i += batchSize) {
				const batch = allCacheInfo.slice(i, i + batchSize);

				await Promise.all(batch.map(async (cacheInfo) => {
					try {
						console.log(`refreshing leaderboard cache for server ${cacheInfo.serverId}...`);
						await this.updateServerCache(cacheInfo.serverId);
						refreshed++;
						console.log(`leaderboard cache refreshed for server ${cacheInfo.serverId}`);
					}
					catch (error) {
						console.error(`failed to refresh leaderboard cache for server ${cacheInfo.serverId}:`, error);
						failed++;
					}
				}));

				// Small delay between batches to be nice to the API
				if (i + batchSize < allCacheInfo.length) {
					await new Promise(resolve => setTimeout(resolve, 2000));
				}
			}

			console.log(`scheduled refresh complete: ${refreshed} refreshed, ${failed} failed`);

			// Also refresh streak caches
			await this.refreshAllStreakCaches();

		}
		catch (error) {
			console.error("error during scheduled cache refresh:", error);
		}
	}

	/**
	 * Refresh streak caches for all servers
	 */
	async refreshAllStreakCaches() {
		try {
			console.log("refreshing streak caches for all servers...");

			// Get all servers that have cache data
			const allCacheInfo = await database.getAllServerCacheInfo();

			let refreshed = 0;
			let failed = 0;

			for (const cacheInfo of allCacheInfo) {
				try {
					await streakCache.refreshServerStreaksFromDB(cacheInfo.serverId);
					refreshed++;
					console.log(`streak cache refreshed for server ${cacheInfo.serverId}`);
				}
				catch (error) {
					console.error(`failed to refresh streak cache for server ${cacheInfo.serverId}:`, error);
					failed++;
				}
			}

			console.log(`streak cache refresh complete: ${refreshed} refreshed, ${failed} failed`);
		}
		catch (error) {
			console.error("error during streak cache refresh:", error);
		}
	}

	/**
	 * Get optimized leaderboard data for a server
	 * @param {string} serverId - Discord server ID
	 * @param {string} stat - Statistic type (mMR, tWR, aS, hS, eP)
	 * @param {string} timeFilter - Time filter (all, weekly, season)
	 * @param {boolean} serverOnly - Server-only filter
	 * @param {boolean|null} squads - Squad filter
	 * @returns {Promise<Array>} Sorted leaderboard data
	 */
	async getLeaderboard(serverId, stat, timeFilter = "all", serverOnly = false, squads = null) {
		try {
			const lastUpdate = this.lastUpdate.get(serverId) || 0;
			const now = Date.now();
			const timeSinceUpdate = now - lastUpdate;

			// Force refresh only if cache is missing
			if (!this.cache.has(serverId)) {
				console.log(`no leaderboard cache found for server ${serverId}, building initial cache`);
				await this.updateServerCache(serverId);
			}
			else if (timeSinceUpdate > this.updateInterval) {
				// Cache is expired - use existing cache and trigger background refresh if not already running
				if (!this.backgroundRefreshes.get(serverId)) {
					console.log(`leaderboard cache expired for server ${serverId} (${Math.round(timeSinceUpdate / 60000)} minutes old), refreshing in background`);
					this.backgroundRefreshes.set(serverId, true);

					// Non-blocking background refresh
					this.updateServerCache(serverId).then(() => {
						this.backgroundRefreshes.delete(serverId);
						console.log(`cackground refresh completed for server ${serverId}`);
					}).catch(error => {
						console.error("background refresh failed:", error);
						this.backgroundRefreshes.delete(serverId);
					});
				}
			}

			const serverCache = this.cache.get(serverId);
			if (!serverCache) {
				return [];
			}

			// Generate leaderboard from cached data
			const leaderboardData = [];

			for (const [userId, userCache] of serverCache) {
				try {
					let statValue = null;

					// Get the appropriate statistic
					if (stat === "mMR") {
						// Use pre-computed MMR values
						if (timeFilter === "weekly") {
							statValue = userCache.weeklyMMRChange;
							// Filter to positive values only
							if (statValue <= 0) continue;
						}
						else if (timeFilter === "season") {
							statValue = userCache.seasonMMRChange;
							// Filter to positive values only
							if (statValue <= 0) continue;
						}
						else {
							statValue = userCache.currentMMR;
						}
					}
					else {
						// Get pre-computed table statistics
						const stats = this.getFilteredStats(userCache, timeFilter, serverOnly, squads);

						switch (stat) {
						case "tWR":
							statValue = stats?.winRate;
							break;
						case "aS":
							statValue = stats?.averageScore;
							break;
						case "hS":
							statValue = stats?.bestScore;
							break;
						case "eP":
							statValue = stats?.eventsPlayed;
							break;
						}
					}

					if (statValue !== null && statValue !== undefined && statValue !== -1) {
						leaderboardData.push({
							userId,
							displayName: userCache.displayName,
							statValue,
							loungeUser: userCache.loungeUser,
						});
					}
				}
				catch (error) {
					console.warn(`error processing cached user ${userId}:`, error);
				}
			}

			// Sort by stat value (descending)
			leaderboardData.sort((a, b) => {
				// Handle different stat types
				if (typeof a.statValue === "number" && typeof b.statValue === "number") {
					return b.statValue - a.statValue;
				}
				return 0;
			});

			return leaderboardData.slice(0, 10);
		}
		catch (error) {
			console.error(`error generating leaderboard for server ${serverId}:`, error);
			return [];
		}
	}

	/**
	 * Get filtered statistics from user cache
	 * @param {Object} userCache - User's cached data
	 * @param {string} timeFilter - Time filter
	 * @param {boolean} serverOnly - Server filter
	 * @param {boolean|null} squads - Squad filter
	 * @returns {Object|null} Filtered statistics
	 */
	getFilteredStats(userCache, timeFilter, serverOnly, squads) {
		try {
			// Get time period data
			let timeData;
			switch (timeFilter) {
			case "weekly":
				timeData = userCache.weekly;
				break;
			case "season":
				timeData = userCache.season;
				break;
			default:
				timeData = userCache.all;
			}

			if (!timeData) return null;

			// Get server filter data
			const serverData = serverOnly ? timeData.serverOnly : timeData.allTables;
			if (!serverData) return null;

			// Get squad filter data
			if (squads === true) {
				return serverData.squads;
			}
			else if (squads === false) {
				return serverData.regular;
			}
			else {
				return serverData.all;
			}
		}
		catch (error) {
			console.warn("error filtering cached stats:", error);
			return null;
		}
	}

	/**
	 * Update cache for a specific server
	 * @param {string} serverId - Discord server ID
	 */
	async updateServerCache(serverId) {
		try {
			console.log(`updating leaderboard cache for server ${serverId}...`);

			const serverData = await database.getServerData(serverId);
			if (!serverData || !serverData.users) {
				console.log(`no server data found for ${serverId}`);
				return;
			}

			const userCache = new Map();
			const now = Date.now();
			const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
			const seasonStartTimestamp = this.getSeasonStartTimestamp();

			console.log(`processing ${Object.keys(serverData.users).length} users...`);

			// Process users in batches to avoid overwhelming the API
			const userEntries = Object.entries(serverData.users);
			const batchSize = 5;

			for (let i = 0; i < userEntries.length; i += batchSize) {
				const batch = userEntries.slice(i, i + batchSize);

				await Promise.all(batch.map(async ([userId, userData]) => {
					try {
						const userStats = await this.computeUserStats(
							userId,
							serverId,
							userData,
							oneWeekAgo,
							seasonStartTimestamp,
						);

						if (userStats) {
							userCache.set(userId, userStats);
						}
					}
					catch (error) {
						console.warn(`error computing stats for user ${userId}:`, error);
					}
				}));

				// Small delay between batches to be respectful to the API
				if (i + batchSize < userEntries.length) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			this.cache.set(serverId, userCache);
			this.lastUpdate.set(serverId, now);

			// Save cache to database for persistence across deploys
			try {
				await database.saveLeaderboardCache(serverId, userCache);
				console.log(`cache saved to database for server ${serverId} with ${userCache.size} users`);
			}
			catch (error) {
				console.error(`failed to save cache to database for server ${serverId}:`, error);
			}

			console.log(`cache updated for server ${serverId} with ${userCache.size} users`);

			// Also update streak cache when leaderboard cache updates
			try {
				console.log(`updating streak cache for server ${serverId}...`);
				await streakCache.refreshServerStreaksFromDB(serverId);
				console.log(`streak cache updated for server ${serverId}`);
			}
			catch (error) {
				console.error(`failed to update streak cache for server ${serverId}:`, error);
			}
		}
		catch (error) {
			console.error(`error updating cache for server ${serverId}:`, error);
		}
	}

	/**
	 * Compute comprehensive statistics for a user
	 * @param {string} userId - Discord user ID
	 * @param {string} serverId - Discord server ID
	 * @param {Object} userData - User data from server
	 * @param {number} oneWeekAgo - Weekly filter timestamp
	 * @param {number} seasonStartTimestamp - Season filter timestamp
	 * @returns {Promise<Object|null>} User statistics
	 */
	async computeUserStats(userId, serverId, userData, oneWeekAgo, seasonStartTimestamp) {
		try {
			// Get basic user info
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
			if (!loungeUser) {
				return null;
			}

			// Get proper display name (try Discord first, then fallback to lounge name)
			let displayName = userData.loungePlayerName || `User ${userId}`;
			try {
				// We'll need to get this from the interaction context since we don't have client access here
				// For now, use the lounge name as primary and userData as fallback
				displayName = loungeUser.name || userData.loungePlayerName || `User ${userId}`;
			}
			catch (error) {
				// Use lounge name if available
				displayName = loungeUser.name || userData.loungePlayerName || `User ${userId}`;
			}

			// Get MMR data
			const currentMMR = await LoungeApi.getCurrentMMR(userId);
			const weeklyMMRChange = await LoungeApi.getWeeklyMMRChange(userId);
			const seasonMMRChange = await LoungeApi.getSeasonMMRChange(userId);

			// Get all user tables once
			const allTables = await LoungeApi.getAllPlayerTables(userId, serverId);

			// Pre-filter tables by time periods
			const weeklyTables = PlayerStats.filterTablesByWeek(allTables, true);
			const seasonTables = PlayerStats.filterTablesBySeason(allTables, true);

			// Compute comprehensive statistics
			const stats = {
				userId,
				loungeUser,
				displayName,
				currentMMR,
				weeklyMMRChange,
				seasonMMRChange,

				// All-time stats
				all: this.computeTimeFilteredStats(allTables, userId, serverId),

				// Weekly stats
				weekly: this.computeTimeFilteredStats(weeklyTables, userId, serverId),

				// Season stats
				season: this.computeTimeFilteredStats(seasonTables, userId, serverId),
			};

			return stats;
		}
		catch (error) {
			console.warn(`error computing user stats for ${userId}:`, error);
			return null;
		}
	}

	/**
	 * Compute statistics for filtered tables
	 * @param {Object} tables - Table data
	 * @param {string} playerName - Player's lounge name
	 * @param {string} serverId - Server ID for filtering
	 * @returns {Object} Statistics object
	 */
	computeTimeFilteredStats(tables, playerDiscordId, serverId) {
		if (!tables || Object.keys(tables).length === 0) {
			return {
				serverOnly: { all: null, squads: null, regular: null },
				allTables: { all: null, squads: null, regular: null },
			};
		}

		const stats = {
			serverOnly: {},
			allTables: {},
		};

		// For now, treat all tables as both server and non-server
		// This can be enhanced later with proper server table detection
		for (const serverFilter of [true, false]) {
			const key = serverFilter ? "serverOnly" : "allTables";

			// Compute for all, squads only, and regular only
			stats[key].all = this.computeBasicStats(tables, playerDiscordId);
			stats[key].squads = this.computeBasicStats(
				this.filterTablesByTier(tables, "SQ"),
				playerDiscordId,
			);
			stats[key].regular = this.computeBasicStats(
				this.filterTablesByTier(tables, "!SQ"),
				playerDiscordId,
			);
		}

		return stats;
	}

	/**
	 * Compute basic statistics from tables
	 * @param {Object} tables - Table data
	 * @param {string} playerDiscordId - Player's Discord ID
	 * @returns {Object} Basic statistics
	 */
	computeBasicStats(tables, playerDiscordId) {
		if (!tables || Object.keys(tables).length === 0) {
			return {
				winRate: null,
				averageScore: null,
				bestScore: null,
				eventsPlayed: null,
			};
		}

		try {
			return {
				winRate: PlayerStats.getWinRate(tables, playerDiscordId),
				averageScore: PlayerStats.getAverageScore(tables, playerDiscordId),
				bestScore: PlayerStats.getBestScore(tables, playerDiscordId)?.score || null,
				eventsPlayed: PlayerStats.getMatchesPlayed(tables, playerDiscordId),
			};
		}
		catch (error) {
			console.warn(`error computing basic stats for ${playerDiscordId}:`, error);
			return {
				winRate: null,
				averageScore: null,
				bestScore: null,
				eventsPlayed: null,
			};
		}
	}

	/**
	 * Filter tables by tier
	 * @param {Object} tables - Table data
	 * @param {string} tierFilter - "SQ" or "!SQ"
	 * @returns {Object} Filtered tables
	 */
	filterTablesByTier(tables, tierFilter) {
		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (tierFilter === "SQ" && table.tier === "SQ") {
				filtered[tableId] = table;
			}
			else if (tierFilter === "!SQ" && table.tier !== "SQ") {
				filtered[tableId] = table;
			}
		}
		return filtered;
	}

	/**
	 * Get season start timestamp
	 * @returns {number} Season start timestamp
	 */
	getSeasonStartTimestamp() {
		// This should be configured based on actual season start
		// For now, using 3 months ago as placeholder
		return new Date("2025-09-07T12:00:00.000Z");
	}

	/**
	 * Force cache refresh for a server
	 * @param {string} serverId - Discord server ID
	 */
	async refreshCache(serverId) {
		this.lastUpdate.delete(serverId);
		await this.updateServerCache(serverId);
	}

	/**
	 * Clear cache for a server
	 * @param {string} serverId - Discord server ID
	 */
	async clearCache(serverId) {
		this.cache.delete(serverId);
		this.lastUpdate.delete(serverId);
		this.backgroundRefreshes.delete(serverId);

		// Also clear from database
		try {
			await database.clearLeaderboardCache(serverId);
		}
		catch (error) {
			console.error(`failed to clear database cache for server ${serverId}:`, error);
		}

		console.log(`cache cleared for server ${serverId}`);
	}

	/**
	 * Clear all caches for all servers
	 */
	async clearAllCaches() {
		const serverCount = this.cache.size;
		this.cache.clear();
		this.lastUpdate.clear();
		this.backgroundRefreshes.clear();

		// Also clear all database cache
		try {
			if (database.useDatabase) {
				await database.pool.query("DELETE FROM leaderboard_cache");
				console.log("cleared all database cache");
			}
		}
		catch (error) {
			console.error("failed to clear all database cache:", error);
		}

		console.log(`all caches cleared for ${serverCount} servers`);
	}

	/**
	 * Force refresh all server caches
	 */
	async refreshAllCaches() {
		// Get servers from both in-memory cache and database
		const memoryServers = Array.from(this.cache.keys());
		let dbServers = [];

		try {
			const dbCacheInfo = await database.getAllServerCacheInfo();
			dbServers = dbCacheInfo.map(info => info.serverId);
		}
		catch (error) {
			console.error("failed to get database cache servers:", error);
		}

		// Combine and deduplicate servers
		const allServers = [...new Set([...memoryServers, ...dbServers])];
		console.log(`force refreshing caches for ${allServers.length} servers...`);

		for (const serverId of allServers) {
			try {
				await this.updateServerCache(serverId);
				console.log(`refreshed cache for server ${serverId}`);
			}
			catch (error) {
				console.error(`failed to refresh cache for server ${serverId}:`, error);
			}
		}

		console.log(`completed refresh for all ${allServers.length} servers`);
	}

	/**
	 * Get cache information
	 * @param {string} serverId - Discord server ID
	 * @returns {Object} Cache information
	 */
	getCacheInfo(serverId) {
		const lastUpdate = this.lastUpdate.get(serverId);
		const userCount = this.cache.get(serverId)?.size || 0;

		return {
			lastUpdate: lastUpdate ? new Date(lastUpdate) : null,
			userCount,
			isStale: lastUpdate ? (Date.now() - lastUpdate > this.updateInterval) : true,
		};
	}

	/**
	 * Get all cached server IDs
	 * @returns {string[]} Array of server IDs
	 */
	getAllCachedServerIds() {
		return Array.from(this.cache.keys());
	}

	/**
	 * Get cache information for all servers
	 * @returns {Object[]} Array of cache info for all servers
	 */
	getAllCacheInfo() {
		const cacheInfo = [];

		for (const serverId of this.cache.keys()) {
			const info = this.getCacheInfo(serverId);
			cacheInfo.push({
				serverId,
				...info,
			});
		}

		return cacheInfo;
	}

	/**
	 * Get the streak cache instance
	 * @returns {StreakCache} The streak cache instance
	 */
	getStreakCache() {
		return streakCache;
	}
}

// Export singleton instance
module.exports = new LeaderboardCache();