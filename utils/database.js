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
}

module.exports = new Database();