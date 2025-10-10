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
			
			// For now, we'll use a simple approach and rebuild cache as needed
			// In the future, could add dedicated database tables for streak cache
			console.log("Streak cache will be built on demand");
		}
		catch (error) {
			console.error("Failed to load streak cache from database:", error);
		}
	}

	/**
	 * Save streak cache to database
	 */
	async saveCacheToDatabase(serverId) {
		try {
			// For now, we don't persist streak cache to database
			// It will be rebuilt as needed since it's derived from table data
			console.log(`Streak cache for server ${serverId} updated in memory`);
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
			if (!userData.loungeUser?.name) continue;
			const streakData = serverCache.get(userData.loungeUser.name.toLowerCase());
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
					const streakData = this.calculatePlayerStreaksFromTables(allTables, userData.loungeUser.name);
					console.log(`Streak data for ${userData.loungeUser.name}:`, streakData);
					
					if (streakData) {
						serverCache.set(userData.loungeUser.name.toLowerCase(), {
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
	 * @param {Object} tables - Tables object from LoungeApi.getAllPlayerTables
	 * @param {string} playerName - Player name
	 * @returns {Object} Streak data
	 */
	calculatePlayerStreaksFromTables(tables, playerName) {
		console.log(`Calculating streaks for ${playerName} from ${Object.keys(tables).length} tables`);

		const playerTables = [];

		// Convert LoungeApi table format to our format
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams || !table.createdOn) continue;

			// Find player in this table
			let playerData = null;
			for (const team of table.teams) {
				const player = team.scores.find(p =>
					p.playerName.toLowerCase() === playerName.toLowerCase(),
				);
				if (player) {
					playerData = {
						...player,
						rank: team.rank,
						date: new Date(table.createdOn),
						tableId: parseInt(tableId),
					};
					break;
				}
			}

			if (playerData) {
				playerTables.push(playerData);
			}
		}

		console.log(`Found ${playerTables.length} tables where ${playerName} participated`);

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
			const isWin = table.rank === 1;

			console.log(`Table ${table.tableId}: rank ${table.rank}, isWin: ${isWin}, delta: ${table.delta}`);

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

		console.log(`Final streak results for ${playerName}:`, result);
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
	clearServerStreaks(serverId) {
		this.cache.delete(serverId);
		this.lastUpdate.delete(serverId);
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

// Export the class
module.exports = StreakCache;