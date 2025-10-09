const { Pool } = require("pg");

class Database {
	constructor() {
		// Use Railway's provided DATABASE_URL or fallback to local file storage
		this.useDatabase = !!process.env.DATABASE_URL;
		
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
			const ServerData = require("./serverData");
			return await ServerData.getServerData(serverId);
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
			const ServerData = require("./serverData");
			return await ServerData.saveServerData(serverId, data);
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
			const ServerData = require("./serverData");
			return await ServerData.deleteServerData(serverId);
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
			const ServerData = require("./serverData");
			return await ServerData.getAllServerIds();
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
}

module.exports = new Database();