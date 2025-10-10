/**
 * Streak Cache System
 * Caches streak data for fast retrieval
 */

const PlayerStats = require("./playerStats");

class StreakCache {
	constructor() {
		// serverId -> Map(playerName -> streakData)
		this.cache = new Map();
		// serverId -> timestamp
		this.lastUpdate = new Map();
		// 1 hour
		this.updateInterval = 60 * 60 * 1000;
		
		// Load cache from database on startup
		this.loadCacheFromDatabase();
	}

	/**
	 * Load existing streak cache from database on startup
	 */
	async loadCacheFromDatabase() {
		try {
			console.log("Loading streak cache from database...");
			const database = require("./database");
			
			// Load cache for all servers (if table exists)
			const allCacheInfo = await database.getAllServerCacheInfo();
			let loadedCount = 0;
			
			for (const serverInfo of allCacheInfo) {
				try {
					const serverCache = await database.loadStreakCache(serverInfo.serverId);
					if (serverCache.size > 0) {
						this.cache.set(serverInfo.serverId, serverCache);
						this.lastUpdate.set(serverInfo.serverId, Date.now());
						loadedCount++;
					}
				}
				catch (error) {
					console.warn(`Failed to load streak cache for server ${serverInfo.serverId}, will rebuild on demand:`, error.message);
					// Clear corrupted data for this server
					try {
						await database.clearStreakCache(serverInfo.serverId);
						console.log(`Cleared corrupted streak cache for server ${serverInfo.serverId}`);
					}
					catch (clearError) {
						console.warn(`Failed to clear corrupted cache for server ${serverInfo.serverId}:`, clearError.message);
					}
				}
			}
			
			console.log(`Loaded streak cache for ${loadedCount} servers`);
		}
		catch (error) {
			// If streak_cache table doesn't exist yet, just continue
			if (error.code === "42P01") {
				console.log("Streak cache table doesn't exist yet, will be created on next database init");
			}
			else {
				console.error("Failed to load streak cache from database:", error);
				// If there are widespread corruption issues, consider clearing all data
				try {
					const database = require("./database");
					await database.pool.query("DELETE FROM streak_cache");
					console.log("Cleared all corrupted streak cache data");
				}
				catch (clearAllError) {
					console.warn("Failed to clear all streak cache data:", clearAllError.message);
				}
			}
		}
	}

	/**
	 * Save streak cache to database
	 */
	async saveCacheToDatabase(serverId) {
		try {
			const database = require("./database");
			const serverCache = this.cache.get(serverId);
			
			if (serverCache) {
				await database.saveStreakCache(serverId, serverCache);
				console.log(`Streak cache saved to database for server ${serverId}`);
			}
		}
		catch (error) {
			console.error(`Failed to save streak cache for server ${serverId}:`, error);
		}
	}

	/**
	 * Get streak data for all players in a server
	 * @param {string} serverId - Server ID
	 * @param {Array} leaderboardData - Leaderboard data from optimized cache
	 * @returns {Array} Array of players with streak data
	 */
	async getServerStreaks(serverId, leaderboardData) {
		const cacheKey = serverId;
		const now = Date.now();
		const lastUpdate = this.lastUpdate.get(cacheKey) || 0;

		// Check if cache is stale
		if (now - lastUpdate > this.updateInterval || !this.cache.has(cacheKey)) {
			console.log(`Updating streak cache for server ${serverId}...`);
			await this.updateServerStreaks(serverId, leaderboardData);
		}

		const serverCache = this.cache.get(cacheKey) || new Map();
		const result = [];

		for (const userData of leaderboardData) {
			if (!userData.userId) continue;
			const streakData = serverCache.get(userData.userId);
			if (streakData) {
				result.push({
					...userData,
					...streakData,
				});
			}
		}

		return result;
	}

	/**
	 * Refresh streak cache for a server using server data
	 * @param {string} serverId - Server ID
	 */
	async refreshServerStreaksFromDB(serverId) {
		try {
			const database = require("./database");
			const LoungeApi = require("./loungeApi");
			
			console.log(`Refreshing streak cache for server ${serverId}...`);
			
			const serverData = await database.getServerData(serverId);
			if (!serverData || !serverData.users) {
				console.log(`No server data found for ${serverId}`);
				return;
			}

			const serverCache = new Map();
			const userEntries = Object.entries(serverData.users);

			// Process users in batches
			const batchSize = 5;
			for (let i = 0; i < userEntries.length; i += batchSize) {
				const batch = userEntries.slice(i, i + batchSize);
				
				await Promise.all(batch.map(async ([userId, userData]) => {
					try {
						// Get lounge user info
						const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
						if (!loungeUser?.name) return;

						// Get player's table data
						const allTables = await LoungeApi.getAllPlayerTables(userId, serverId);

						const streakStats = await this.calculatePlayerStreaksFromTables(allTables, userId);
						if (streakStats) {
							serverCache.set(userId, {
								userId,
								loungeUser,
								...streakStats,
							});
						}
					}
					catch (error) {
						console.warn(`Error calculating streaks for user ${userId}:`, error);
					}
				}));

				// Small delay between batches
				if (i + batchSize < userEntries.length) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			// Update cache
			this.cache.set(serverId, serverCache);
			this.lastUpdate.set(serverId, Date.now());
			
			// Save to database for persistence
			await this.saveCacheToDatabase(serverId);
			
			console.log(`Streak cache updated for server ${serverId} with ${serverCache.size} users`);
		}
		catch (error) {
			console.error(`Error refreshing streak cache for server ${serverId}:`, error);
		}
	}

	/**
	 * Update streak cache for a server
	 * @param {string} serverId - Server ID
	 * @param {Array} leaderboardData - Leaderboard data
	 */
	async updateServerStreaks(serverId, leaderboardData) {
		const startTime = Date.now();
		const serverCache = new Map();
		const LoungeApi = require("./loungeApi");

		console.log(`Calculating streaks for ${leaderboardData.length} players...`);

		for (const userData of leaderboardData) {
			try {
				if (!userData.loungeUser?.name || !userData.userId) continue;
				console.log(`Calculating streaks for player: ${userData.loungeUser.name} (ID: ${userData.userId})`);
				
				// Get player's table data using the same method as leaderboard
				const allTables = await LoungeApi.getAllPlayerTables(userData.userId, serverId);
				console.log(`Found ${Object.keys(allTables).length} tables for ${userData.loungeUser.name}`);
				
				if (Object.keys(allTables).length > 0) {
					const streakData = this.calculatePlayerStreaksFromTables(allTables, userData.userId);
					console.log(`Streak data for ${userData.loungeUser.name}:`, streakData);
					
					if (streakData) {
						serverCache.set(userData.userId, {
							userId: userData.userId,
							loungeUser: userData.loungeUser,
							currentWinStreak: streakData.currentWinStreak || 0,
							currentStreakMmrGain: streakData.currentStreakMmrGain || 0,
							longestWinStreak: streakData.longestWinStreak || 0,
							longestStreakMmrGain: streakData.longestStreakMmrGain || 0,
							longestStreakStart: streakData.longestStreakStart,
							longestStreakEnd: streakData.longestStreakEnd,
						});
					}
				}
			}
			catch (error) {
				console.error(`Error calculating streaks for ${userData.loungeUser?.name}:`, error);
			}
		}

		this.cache.set(serverId, serverCache);
		this.lastUpdate.set(serverId, Date.now());

		// Save to database (currently just logs)
		await this.saveCacheToDatabase(serverId);

		const duration = ((Date.now() - startTime) / 1000).toFixed(1);
		console.log(`Streak cache updated for server ${serverId} in ${duration}s`);
	}

	/**
	 * Get player's table data from server tables
	 * @param {Array} tableIds - Array of table IDs
	 * @param {string} playerName - Player name
	 * @returns {Array} Array of table data where player participated
	 */
	async getPlayerTablesFromServer(tableIds, playerName) {
		const database = require("./database");
		const playerTables = [];

		console.log(`Checking ${tableIds.length} tables for player ${playerName}`);

		// Go through each table and check if player participated
		for (const tableId of tableIds) {
			try {
				const tableData = await database.getTableData(tableId);
				if (!tableData || !tableData.teams || !tableData.createdOn) continue;

				// Find player in this table
				let playerData = null;
				for (const team of tableData.teams) {
					const player = team.scores.find(p =>
						p.playerName.toLowerCase() === playerName.toLowerCase(),
					);
					if (player) {
						playerData = {
							...player,
							rank: team.rank,
							date: new Date(tableData.createdOn),
							tableId: parseInt(tableId),
						};
						break;
					}
				}

				if (playerData) {
					playerTables.push(playerData);
				}
			}
			catch (error) {
				console.warn(`Failed to load table ${tableId}:`, error);
			}
		}

		// Sort by date (oldest first)
		playerTables.sort((a, b) => a.date - b.date);
		return playerTables;
	}

	/**
	 * Calculate win streaks for a player from their table data (using LoungeApi format)
	 * Win streaks are calculated only for the current season (Season 1)
	 * @param {Object} tables - Tables object from LoungeApi.getAllPlayerTables
	 * @param {string} playerDiscordId - Player Discord ID
	 * @returns {Object} Streak data for current season
	 */
	calculatePlayerStreaksFromTables(tables, playerDiscordId) {
		const playerTables = [];

		// Convert LoungeApi table format to our format - optimized for streak calculation
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams || !table.createdOn) continue;

			// Flatten all players from all teams to find our target player efficiently
			for (const team of table.teams) {
				for (const player of team.scores) {
					if (player.playerDiscordId === playerDiscordId) {
						playerTables.push({
							delta: player.delta,
							date: new Date(table.createdOn),
							tableId: parseInt(tableId),
						});
						// Found player, no need to check more players in this table
						break;
					}
				}
			}
		}

		// Sort by date (oldest first)
		playerTables.sort((a, b) => a.date - b.date);

		if (playerTables.length === 0) {
			return {
				currentWinStreak: 0,
				currentStreakMmrGain: 0,
				longestWinStreak: 0,
				longestStreakMmrGain: 0,
				longestStreakStart: null,
				longestStreakEnd: null,
			};
		}

		let currentStreak = 0;
		let currentStreakMmr = 0;
		let longestStreak = 0;
		let longestStreakMmr = 0;
		let longestStreakStart = null;
		let longestStreakEnd = null;
		let currentStreakStart = null;

		// Track streaks going through tables chronologically
		for (let i = 0; i < playerTables.length; i++) {
			const table = playerTables[i];
			// Win = positive MMR gain
			const isWin = table.delta > 0;

			if (isWin) {
				if (currentStreak === 0) {
					currentStreakStart = table.date;
				}
				currentStreak++;
				currentStreakMmr += table.delta || 0;

				// Check if this is our new longest streak
				if (currentStreak > longestStreak) {
					longestStreak = currentStreak;
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
				else if (currentStreak === longestStreak && currentStreakMmr > longestStreakMmr) {
					// Same length but more MMR gained
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
			}
			else {
				// Streak broken
				currentStreak = 0;
				currentStreakMmr = 0;
				currentStreakStart = null;
			}
		}

		const result = {
			currentWinStreak: currentStreak,
			currentStreakMmrGain: currentStreakMmr,
			longestWinStreak: longestStreak,
			longestStreakMmrGain: longestStreakMmr,
			longestStreakStart: longestStreakStart,
			longestStreakEnd: longestStreakEnd,
		};

		return result;
	}

	/**
	 * Force refresh streak cache for a server
	 * @param {string} serverId - Server ID
	 * @param {Array} leaderboardData - Leaderboard data
	 */
	async refreshServerStreaks(serverId, leaderboardData) {
		this.lastUpdate.delete(serverId);
		await this.updateServerStreaks(serverId, leaderboardData);
	}

	/**
	 * Clear streak cache for a server
	 * @param {string} serverId - Server ID
	 */
	async clearServerStreaks(serverId) {
		try {
			const database = require("./database");
			
			// Clear from memory
			this.cache.delete(serverId);
			this.lastUpdate.delete(serverId);
			
			// Clear from database
			await database.clearStreakCache(serverId);
			
			console.log(`Cleared streak cache for server ${serverId}`);
		}
		catch (error) {
			console.error(`Error clearing streak cache for server ${serverId}:`, error);
		}
	}

	/**
	 * Get cache info for a server
	 * @param {string} serverId - Server ID
	 * @returns {Object} Cache information
	 */
	getCacheInfo(serverId) {
		const serverCache = this.cache.get(serverId);
		const lastUpdate = this.lastUpdate.get(serverId);

		return {
			exists: !!serverCache,
			playerCount: serverCache ? serverCache.size : 0,
			lastUpdate: lastUpdate ? new Date(lastUpdate) : null,
			isStale: lastUpdate ? (Date.now() - lastUpdate) > this.updateInterval : true,
		};
	}

	/**
	 * Get cache info for all servers
	 * @returns {Array} Array of cache info objects
	 */
	getAllCacheInfo() {
		const result = [];
		for (const serverId of this.cache.keys()) {
			result.push({
				serverId,
				...this.getCacheInfo(serverId),
			});
		}
		return result;
	}
}

// Export singleton instance
module.exports = new StreakCache();