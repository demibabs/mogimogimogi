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
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS server_data (
					server_id VARCHAR(20) PRIMARY KEY,
					data JSONB NOT NULL,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
}

module.exports = new Database();