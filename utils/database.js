const { Pool } = require("pg");
const fs = require("fs").promises;
const path = require("path");

class Database {
	constructor() {
		// Use Railway's provided DATABASE_URL or fallback to local file storage
		this.useDatabase = !!process.env.DATABASE_URL;
		this.dataDir = path.join(__dirname, "..", "data", "servers");

		if (this.useDatabase) {
			this.pool = new Pool({
				connectionString: process.env.DATABASE_URL,
				ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
			});
			this.initializeDatabase();
		}
	}

	async initializeDatabase() {
		try {
			// Server-specific data (users, settings, but no tables)
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS server_data (
					server_id VARCHAR(20) PRIMARY KEY,
					data JSONB NOT NULL,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			// Global table data (shared across all servers)
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS tables (
					table_id VARCHAR(20) PRIMARY KEY,
					table_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			// Link users to tables they participated in
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS user_tables (
					id SERIAL PRIMARY KEY,
					user_id VARCHAR(20) NOT NULL,
					table_id VARCHAR(20) NOT NULL,
					server_id VARCHAR(20) NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(user_id, table_id, server_id),
					FOREIGN KEY (table_id) REFERENCES tables(table_id) ON DELETE CASCADE
				)
			`);

			// Leaderboard cache table for persistent cache across deploys
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS leaderboard_cache (
					id SERIAL PRIMARY KEY,
					server_id VARCHAR(20) NOT NULL,
					user_id VARCHAR(20) NOT NULL,
					cache_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(server_id, user_id)
				)
			`);

			// Index for faster cache lookups
			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_server 
				ON leaderboard_cache(server_id)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_updated 
				ON leaderboard_cache(updated_at)
			`);

			// Streak cache table for persistent streak cache across deploys
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS streak_cache (
					id SERIAL PRIMARY KEY,
					server_id VARCHAR(20) NOT NULL,
					user_id VARCHAR(20) NOT NULL,
					cache_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(server_id, user_id)
				)
			`);

			// Index for faster streak cache lookups
			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_streak_cache_server 
				ON streak_cache(server_id)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_streak_cache_updated 
				ON streak_cache(updated_at)
			`);

			console.log("Database initialized successfully");
		}
		catch (error) {
			console.error("Database initialization error:", error);
		}
	}

	async getServerData(serverId) {
		if (!this.useDatabase) {
			// Fallback to file storage for local development
			return await this._getServerDataFromFile(serverId);
		}

		try {
			const result = await this.pool.query(
				"SELECT data FROM server_data WHERE server_id = $1",
				[serverId],
			);

			if (result.rows.length === 0) {
				// Return default structure if no data exists
				return {
					users: {},
					tables: {},
					setupComplete: false,
				};
			}

			return result.rows[0].data;
		}
		catch (error) {
			console.error("Database read error:", error);
			throw error;
		}
	}

	async saveServerData(serverId, data) {
		if (!this.useDatabase) {
			// Fallback to file storage for local development
			return await this._saveServerDataToFile(serverId, data);
		}

		try {
			await this.pool.query(
				`INSERT INTO server_data (server_id, data, updated_at) 
				 VALUES ($1, $2, CURRENT_TIMESTAMP)
				 ON CONFLICT (server_id) 
				 DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP`,
				[serverId, JSON.stringify(data)],
			);
		}
		catch (error) {
			console.error("Database write error:", error);
			throw error;
		}
	}

	async deleteServerData(serverId) {
		if (!this.useDatabase) {
			// Fallback to file storage for local development
			return await this._deleteServerDataFile(serverId);
		}

		try {
			await this.pool.query(
				"DELETE FROM server_data WHERE server_id = $1",
				[serverId],
			);
		}
		catch (error) {
			console.error("Database delete error:", error);
			throw error;
		}
	}

	async getAllServerIds() {
		if (!this.useDatabase) {
			// Fallback to file storage for local development
			return await this._getAllServerIdsFromFiles();
		}

		try {
			const result = await this.pool.query("SELECT server_id FROM server_data");
			return result.rows.map(row => row.server_id);
		}
		catch (error) {
			console.error("Database query error:", error);
			throw error;
		}
	}

	// Table management methods
	async saveTable(tableId, tableData) {
		if (!this.useDatabase) {
			return await this._saveTableToFile(tableId, tableData);
		}

		try {
			await this.pool.query(
				`INSERT INTO tables (table_id, table_data, updated_at) 
				 VALUES ($1, $2, CURRENT_TIMESTAMP)
				 ON CONFLICT (table_id) 
				 DO UPDATE SET table_data = $2, updated_at = CURRENT_TIMESTAMP`,
				[tableId, JSON.stringify(tableData)],
			);
			return true;
		}
		catch (error) {
			console.error("Database table save error:", error);
			return false;
		}
	}

	async getTable(tableId) {
		if (!this.useDatabase) {
			return await this._getTableFromFile(tableId);
		}

		try {
			const result = await this.pool.query(
				"SELECT table_data FROM tables WHERE table_id = $1",
				[tableId],
			);

			if (result.rows.length === 0) {
				return null;
			}

			return result.rows[0].table_data;
		}
		catch (error) {
			console.error("Database table read error:", error);
			return null;
		}
	}

	async linkUserToTable(userId, tableId, serverId) {
		if (!this.useDatabase) {
			return await this._linkUserToTableInFile(userId, tableId, serverId);
		}

		try {
			await this.pool.query(
				`INSERT INTO user_tables (user_id, table_id, server_id) 
				 VALUES ($1, $2, $3)
				 ON CONFLICT (user_id, table_id, server_id) DO NOTHING`,
				[userId, tableId, serverId],
			);
			return true;
		}
		catch (error) {
			console.error("Database user-table link error:", error);
			return false;
		}
	}

	async getUserTables(userId, serverId) {
		if (!this.useDatabase) {
			return await this._getUserTablesFromFile(userId, serverId);
		}

		try {
			const result = await this.pool.query(
				`SELECT t.table_id, t.table_data 
				 FROM tables t
				 JOIN user_tables ut ON t.table_id = ut.table_id
				 WHERE ut.user_id = $1 AND ut.server_id = $2`,
				[userId, serverId],
			);

			return result.rows.map(row => ({
				id: row.table_id,
				...row.table_data,
			}));
		}
		catch (error) {
			console.error("Database user tables query error:", error);
			return [];
		}
	}

	// File storage fallback methods
	async _ensureDataDir() {
		try {
			await fs.mkdir(this.dataDir, { recursive: true });
		}
		catch (error) {
			console.error("Error creating data directory:", error);
		}
	}

	_getServerDataPath(serverId) {
		return path.join(this.dataDir, `${serverId}.json`);
	}

	async _getServerDataFromFile(serverId) {
		try {
			const filePath = this._getServerDataPath(serverId);
			const data = await fs.readFile(filePath, "utf8");
			return JSON.parse(data);
		}
		catch (error) {
			// File doesn't exist, return default structure
			return {
				serverId,
				users: {},
				tables: {},
				createdAt: new Date().toISOString(),
			};
		}
	}

	async _saveServerDataToFile(serverId, data) {
		try {
			await this._ensureDataDir();
			const filePath = this._getServerDataPath(serverId);
			data.updatedAt = new Date().toISOString();
			await fs.writeFile(filePath, JSON.stringify(data, null, 2));
			return true;
		}
		catch (error) {
			console.error("Error saving server data:", error);
			return false;
		}
	}

	async _deleteServerDataFile(serverId) {
		try {
			const filePath = this._getServerDataPath(serverId);
			await fs.unlink(filePath);
			return true;
		}
		catch (error) {
			console.error("Error deleting server data:", error);
			return false;
		}
	}

	async _getAllServerIdsFromFiles() {
		try {
			await this._ensureDataDir();
			const files = await fs.readdir(this.dataDir);
			return files
				.filter(file => file.endsWith(".json"))
				.map(file => file.replace(".json", ""));
		}
		catch (error) {
			console.error("Error reading data directory:", error);
			return [];
		}
	}

	// File storage methods for normalized schema
	async _saveTableToFile(tableId, tableData) {
		try {
			const tablesDir = path.join(__dirname, "..", "data", "tables");
			await fs.mkdir(tablesDir, { recursive: true });

			const tablePath = path.join(tablesDir, `${tableId}.json`);
			await fs.writeFile(tablePath, JSON.stringify(tableData, null, 2));
			return true;
		}
		catch (error) {
			console.error(`Error saving table ${tableId} to file:`, error);
			return false;
		}
	}

	async _getTableFromFile(tableId) {
		try {
			const tablePath = path.join(__dirname, "..", "data", "tables", `${tableId}.json`);
			const data = await fs.readFile(tablePath, "utf8");
			return JSON.parse(data);
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error(`Error reading table ${tableId} from file:`, error);
			}
			return null;
		}
	}

	async _linkUserToTableInFile(userId, tableId, serverId) {
		try {
			const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
			await fs.mkdir(relationshipsDir, { recursive: true });

			const relationshipPath = path.join(relationshipsDir, `${serverId}.json`);

			// Read existing relationships
			let relationships = {};
			try {
				const data = await fs.readFile(relationshipPath, "utf8");
				relationships = JSON.parse(data);
			}
			catch (readError) {
				if (readError.code !== "ENOENT") {
					console.error("Error reading relationships file:", readError);
				}
			}

			// Add new relationship
			if (!relationships[userId]) {
				relationships[userId] = [];
			}

			if (!relationships[userId].includes(tableId)) {
				relationships[userId].push(tableId);
			}

			// Save relationships
			await fs.writeFile(relationshipPath, JSON.stringify(relationships, null, 2));
			return true;
		}
		catch (error) {
			console.error(`Error linking user ${userId} to table ${tableId}:`, error);
			return false;
		}
	}

	async _getUserTablesFromFile(userId, serverId) {
		try {
			const relationshipPath = path.join(__dirname, "..", "data", "user_tables", `${serverId}.json`);
			const data = await fs.readFile(relationshipPath, "utf8");
			const relationships = JSON.parse(data);

			const userTableIds = relationships[userId] || [];
			const tables = [];

			for (const tableId of userTableIds) {
				const tableData = await this._getTableFromFile(tableId);
				if (tableData) {
					tables.push({ id: tableId, ...tableData });
				}
			}

			return tables;
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error(`Error getting user tables for ${userId}:`, error);
			}
			return [];
		}
	}

	// Leaderboard cache methods
	async getLeaderboardCache(serverId) {
		if (!this.useDatabase) {
			return new Map();
		}

		try {
			const result = await this.pool.query(
				"SELECT user_id, cache_data, updated_at FROM leaderboard_cache WHERE server_id = $1",
				[serverId],
			);

			const cache = new Map();
			for (const row of result.rows) {
				cache.set(row.user_id, {
					...row.cache_data,
					lastUpdated: row.updated_at,
				});
			}

			return cache;
		}
		catch (error) {
			console.error("Error getting leaderboard cache:", error);
			return new Map();
		}
	}

	async saveLeaderboardCache(serverId, userCache) {
		if (!this.useDatabase) {
			return;
		}

		try {
			// Begin transaction for atomic updates
			const client = await this.pool.connect();
			
			try {
				await client.query("BEGIN");

				// Clear existing cache for this server
				await client.query(
					"DELETE FROM leaderboard_cache WHERE server_id = $1",
					[serverId],
				);

				// Insert new cache data
				for (const [userId, cacheData] of userCache) {
					await client.query(
						`INSERT INTO leaderboard_cache (server_id, user_id, cache_data, updated_at)
						 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
						[serverId, userId, JSON.stringify(cacheData)],
					);
				}

				await client.query("COMMIT");
				console.log(`Saved leaderboard cache for server ${serverId} (${userCache.size} users)`);
			}
			catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
			finally {
				client.release();
			}
		}
		catch (error) {
			console.error("Error saving leaderboard cache:", error);
		}
	}

	async getLeaderboardCacheAge(serverId) {
		if (!this.useDatabase) {
			return null;
		}

		try {
			const result = await this.pool.query(
				"SELECT MAX(updated_at) as last_update FROM leaderboard_cache WHERE server_id = $1",
				[serverId],
			);

			return result.rows[0]?.last_update || null;
		}
		catch (error) {
			console.error("Error getting cache age:", error);
			return null;
		}
	}

	async clearLeaderboardCache(serverId) {
		if (!this.useDatabase) {
			return;
		}

		try {
			await this.pool.query(
				"DELETE FROM leaderboard_cache WHERE server_id = $1",
				[serverId],
			);
			console.log(`Cleared leaderboard cache for server ${serverId}`);
		}
		catch (error) {
			console.error("Error clearing cache:", error);
		}
	}

	async getAllServerCacheInfo() {
		if (!this.useDatabase) {
			return [];
		}

		try {
			const result = await this.pool.query(`
				SELECT 
					server_id,
					COUNT(*) as user_count,
					MAX(updated_at) as last_update,
					MIN(updated_at) as oldest_update
				FROM leaderboard_cache 
				GROUP BY server_id
				ORDER BY last_update DESC
			`);

			return result.rows.map(row => ({
				serverId: row.server_id,
				userCount: parseInt(row.user_count),
				lastUpdate: row.last_update,
				oldestUpdate: row.oldest_update,
			}));
		}
		catch (error) {
			console.error("Error getting all cache info:", error);
			return [];
		}
	}

	async saveStreakCache(serverId, streakCache) {
		if (!this.useDatabase) {
			return;
		}

		try {
			// Begin transaction for atomic updates
			const client = await this.pool.connect();
			
			try {
				await client.query("BEGIN");

				// Clear existing streak cache for this server
				await client.query(
					"DELETE FROM streak_cache WHERE server_id = $1",
					[serverId],
				);

				// Insert new streak cache data
				for (const [playerNameKey, streakData] of streakCache) {
					// The key is now playerName.toLowerCase(), but we need userId for database
					// The streakData contains userId, so extract it
					if (streakData.userId) {
						await client.query(
							`INSERT INTO streak_cache (server_id, user_id, cache_data, updated_at)
							 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
							[serverId, streakData.userId, JSON.stringify(streakData)],
						);
					}
				}

				await client.query("COMMIT");
				console.log(`Saved streak cache for server ${serverId} (${streakCache.size} users)`);
			}
			catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
			finally {
				client.release();
			}
		}
		catch (error) {
			console.error("Error saving streak cache:", error);
		}
	}

	async loadStreakCache(serverId) {
		if (!this.useDatabase) {
			return new Map();
		}

		try {
			const result = await this.pool.query(
				"SELECT user_id, cache_data FROM streak_cache WHERE server_id = $1",
				[serverId],
			);

			const cache = new Map();
			const corruptedUserIds = [];
			
			for (const row of result.rows) {
				// PostgreSQL JSONB data is already parsed, no need for JSON.parse()
				if (row.cache_data && typeof row.cache_data === "object") {
					// The cache expects player names as keys, not userIds
					// Extract the loungeUser name from the stored data
					if (row.cache_data.loungeUser && row.cache_data.loungeUser.name) {
						const playerName = row.cache_data.loungeUser.name.toLowerCase();
						
						// Convert date strings back to Date objects
						const streakData = { ...row.cache_data };
						if (streakData.longestStreakStart) {
							streakData.longestStreakStart = new Date(streakData.longestStreakStart);
						}
						if (streakData.longestStreakEnd) {
							streakData.longestStreakEnd = new Date(streakData.longestStreakEnd);
						}
						
						cache.set(playerName, streakData);
					}
					else {
						console.warn(`Streak data missing loungeUser.name for user ${row.user_id}`);
						corruptedUserIds.push(row.user_id);
					}
				}
				else {
					console.warn(`Invalid streak cache data for user ${row.user_id}`);
					// Track invalid entries to clean them up
					corruptedUserIds.push(row.user_id);
				}
			}

			// Clean up corrupted entries
			if (corruptedUserIds.length > 0) {
				console.log(`Cleaning up ${corruptedUserIds.length} corrupted streak cache entries for server ${serverId}`);
				try {
					for (const userId of corruptedUserIds) {
						await this.pool.query(
							"DELETE FROM streak_cache WHERE server_id = $1 AND user_id = $2",
							[serverId, userId],
						);
					}
					console.log(`Cleaned up corrupted entries for server ${serverId}`);
				}
				catch (cleanupError) {
					console.warn("Failed to clean up corrupted entries:", cleanupError);
				}
			}

			console.log(`Loaded streak cache for server ${serverId} (${cache.size} users)`);
			return cache;
		}
		catch (error) {
			// If table doesn't exist yet, return empty cache
			if (error.code === "42P01") {
				console.log(`Streak cache table doesn't exist yet for server ${serverId}`);
				return new Map();
			}
			console.error("Error loading streak cache:", error);
			return new Map();
		}
	}

	async clearStreakCache(serverId) {
		if (!this.useDatabase) {
			return;
		}

		try {
			await this.pool.query(
				"DELETE FROM streak_cache WHERE server_id = $1",
				[serverId],
			);
			console.log(`Cleared streak cache for server ${serverId}`);
		}
		catch (error) {
			console.error("Error clearing streak cache:", error);
		}
	}

	async getStreakCacheAge(serverId) {
		if (!this.useDatabase) {
			return null;
		}

		try {
			const result = await this.pool.query(
				"SELECT MAX(updated_at) as last_update FROM streak_cache WHERE server_id = $1",
				[serverId],
			);

			return result.rows[0]?.last_update || null;
		}
		catch (error) {
			console.error("Error getting streak cache age:", error);
			return null;
		}
	}
}

module.exports = new Database();