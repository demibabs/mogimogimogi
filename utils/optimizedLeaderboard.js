/**
 * Optimized Leaderboard System
 * Uses caching to dramatically improve performance by pre-computing statistics
 */

const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const database = require("./database");

class LeaderboardCache {
	constructor() {
		this.cache = new Map();
		this.lastUpdate = new Map();
		this.updateInterval = 5 * 60 * 1000;
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
			// Check if we need to update cache
			const lastUpdate = this.lastUpdate.get(serverId) || 0;
			const now = Date.now();
			
			if (now - lastUpdate > this.updateInterval || !this.cache.has(serverId)) {
				await this.updateServerCache(serverId);
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
			
			console.log(`Cache updated for server ${serverId} with ${userCache.size} users`);
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
	clearCache(serverId) {
		this.cache.delete(serverId);
		this.lastUpdate.delete(serverId);
		console.log(`Cache cleared for server ${serverId}`);
	}

	/**
	 * Clear all caches
	 */
	clearAllCaches() {
		this.cache.clear();
		this.lastUpdate.clear();
		console.log("All caches cleared");
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
}

// Export singleton instance
module.exports = new LeaderboardCache();