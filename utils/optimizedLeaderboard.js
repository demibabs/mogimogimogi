/**
 * Optimized Leaderboard System
 * Uses caching to dramatically improve performance by pre-computing statistics
 */

const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const database = require("./database");
const StreakCache = require("./streakCache");

class LeaderboardCache {
	constructor() {
		this.cache = new Map();
		this.lastUpdate = new Map();
		this.updateInterval = 60 * 60 * 1000;
		this.backgroundRefreshes = new Map();
		this.streakCache = new StreakCache();
		
		// Start background refresh timers for active servers
		this.startBackgroundRefresh();
		
		// Load cache from database on startup
		this.loadCacheFromDatabase();
	}

	/**
	 * Load existing cache from database on startup
	 */
	async loadCacheFromDatabase() {
		try {
			const allCacheInfo = await database.getAllServerCacheInfo();
			console.log(`Loading cache for ${allCacheInfo.length} servers from database...`);
			
			for (const cacheInfo of allCacheInfo) {
				try {
					const serverCache = await database.getLeaderboardCache(cacheInfo.serverId);
					if (serverCache.size > 0) {
						this.cache.set(cacheInfo.serverId, serverCache);
						this.lastUpdate.set(cacheInfo.serverId, cacheInfo.lastUpdate.getTime());
						console.log(`Loaded cache for server ${cacheInfo.serverId} (${serverCache.size} users)`);
					}
				}
				catch (error) {
					console.error(`Failed to load cache for server ${cacheInfo.serverId}:`, error);
				}
			}
			
			console.log(`Cache loaded from database for ${this.cache.size} servers`);
		}
		catch (error) {
			console.error("Failed to load cache from database:", error);
		}
	}

	/**
	 * Start background refresh for active servers
	 */
	startBackgroundRefresh() {
		// Check every 10 minutes for servers that need background refresh
		setInterval(() => {
			this.performBackgroundRefreshes();
		}, 10 * 60 * 1000);
	}

	/**
	 * Perform background refreshes for servers with active users
	 */
	async performBackgroundRefreshes() {
		for (const [serverId, lastUpdate] of this.lastUpdate) {
			const now = Date.now();
			const timeSinceUpdate = now - lastUpdate;
			
			// If cache is 50 minutes old, refresh in background (before 1 hour expiry)
			if (timeSinceUpdate > (50 * 60 * 1000) && timeSinceUpdate < this.updateInterval) {
				if (!this.backgroundRefreshes.get(serverId)) {
					this.backgroundRefreshes.set(serverId, true);
					console.log(`Starting background refresh for server ${serverId}`);
					
					// Refresh in background without blocking
					this.updateServerCache(serverId).then(() => {
						this.backgroundRefreshes.delete(serverId);
						console.log(`Background refresh completed for server ${serverId}`);
					}).catch(error => {
						console.error(`Background refresh failed for server ${serverId}:`, error);
						this.backgroundRefreshes.delete(serverId);
					});
				}
			}
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
				console.log(`No cache found for server ${serverId}, building initial cache`);
				await this.updateServerCache(serverId);
			}
			else if (timeSinceUpdate > this.updateInterval) {
				// Cache is expired - use existing cache and trigger background refresh if not already running
				if (!this.backgroundRefreshes.get(serverId)) {
					console.log(`Cache expired for server ${serverId} (${Math.round(timeSinceUpdate / 60000)} minutes old), refreshing in background`);
					this.backgroundRefreshes.set(serverId, true);
					
					// Non-blocking background refresh
					this.updateServerCache(serverId).then(() => {
						this.backgroundRefreshes.delete(serverId);
						console.log(`Background refresh completed for server ${serverId}`);
					}).catch(error => {
						console.error("Background refresh failed:", error);
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
					console.warn(`Error processing cached user ${userId}:`, error);
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
			console.error(`Error generating leaderboard for server ${serverId}:`, error);
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
			console.warn("Error filtering cached stats:", error);
			return null;
		}
	}

	/**
	 * Update cache for a specific server
	 * @param {string} serverId - Discord server ID
	 */
	async updateServerCache(serverId) {
		try {
			console.log(`Updating leaderboard cache for server ${serverId}...`);
			
			const serverData = await database.getServerData(serverId);
			if (!serverData || !serverData.users) {
				console.log(`No server data found for ${serverId}`);
				return;
			}

			const userCache = new Map();
			const now = Date.now();
			const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
			const seasonStartTimestamp = this.getSeasonStartTimestamp();

			console.log(`Processing ${Object.keys(serverData.users).length} users...`);

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
						console.warn(`Error computing stats for user ${userId}:`, error);
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
				console.log(`Cache saved to database for server ${serverId} with ${userCache.size} users`);
			}
			catch (error) {
				console.error(`Failed to save cache to database for server ${serverId}:`, error);
			}
			
			console.log(`Cache updated for server ${serverId} with ${userCache.size} users`);
			
			// Also update streak cache when leaderboard cache updates
			try {
				console.log(`Updating streak cache for server ${serverId}...`);
				await this.streakCache.updateServerStreaks(serverId);
				console.log(`Streak cache updated for server ${serverId}`);
			}
			catch (error) {
				console.error(`Failed to update streak cache for server ${serverId}:`, error);
			}
		}
		catch (error) {
			console.error(`Error updating cache for server ${serverId}:`, error);
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
				all: this.computeTimeFilteredStats(allTables, loungeUser.name, serverId),
				
				// Weekly stats
				weekly: this.computeTimeFilteredStats(weeklyTables, loungeUser.name, serverId),
				
				// Season stats
				season: this.computeTimeFilteredStats(seasonTables, loungeUser.name, serverId),
			};

			return stats;
		}
		catch (error) {
			console.warn(`Error computing user stats for ${userId}:`, error);
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
	computeTimeFilteredStats(tables, playerName, serverId) {
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
			stats[key].all = this.computeBasicStats(tables, playerName);
			stats[key].squads = this.computeBasicStats(
				this.filterTablesByTier(tables, "SQ"),
				playerName,
			);
			stats[key].regular = this.computeBasicStats(
				this.filterTablesByTier(tables, "!SQ"),
				playerName,
			);
		}

		return stats;
	}

	/**
	 * Compute basic statistics from tables
	 * @param {Object} tables - Table data
	 * @param {string} playerName - Player's lounge name
	 * @returns {Object} Basic statistics
	 */
	computeBasicStats(tables, playerName) {
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
				winRate: PlayerStats.getWinRate(tables, playerName),
				averageScore: PlayerStats.getAverageScore(tables, playerName),
				bestScore: PlayerStats.getBestScore(tables, playerName)?.score || null,
				eventsPlayed: PlayerStats.getMatchesPlayed(tables, playerName),
			};
		}
		catch (error) {
			console.warn(`Error computing basic stats for ${playerName}:`, error);
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
		return Date.now() - (90 * 24 * 60 * 60 * 1000);
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
			console.error(`Failed to clear database cache for server ${serverId}:`, error);
		}
		
		console.log(`Cache cleared for server ${serverId}`);
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
				console.log("Cleared all database cache");
			}
		}
		catch (error) {
			console.error("Failed to clear all database cache:", error);
		}
		
		console.log(`All caches cleared for ${serverCount} servers`);
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
			console.error("Failed to get database cache servers:", error);
		}
		
		// Combine and deduplicate servers
		const allServers = [...new Set([...memoryServers, ...dbServers])];
		console.log(`Force refreshing caches for ${allServers.length} servers...`);
		
		for (const serverId of allServers) {
			try {
				await this.updateServerCache(serverId);
				console.log(`✅ Refreshed cache for server ${serverId}`);
			}
			catch (error) {
				console.error(`❌ Failed to refresh cache for server ${serverId}:`, error);
			}
		}
		
		console.log(`Completed refresh for all ${allServers.length} servers`);
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
		return this.streakCache;
	}
}

// Export singleton instance
module.exports = new LeaderboardCache();