/**
 * Server data utility functions
 * Pure data access and persistence functions for server-specific data
 */

const fs = require("fs").promises;
const path = require("path");

class ServerData {
	static dataDir = path.join(__dirname, "..", "data", "servers");

	/**
	 * Ensure the data directory exists
	 */
	static async ensureDataDir() {
		try {
			await fs.mkdir(this.dataDir, { recursive: true });
		}
		catch (error) {
			console.error("Error creating data directory:", error);
		}
	}

	/**
	 * Get the file path for a server's data
	 * @param {string} serverId - Discord server ID
	 * @returns {string} File path for the server's data
	 */
	static getServerDataPath(serverId) {
		return path.join(this.dataDir, `${serverId}.json`);
	}

	/**
	 * Get server data from file
	 * @param {string} serverId - Discord server ID
	 * @returns {Promise<Object>} Server data object
	 */
	static async getServerData(serverId) {
		try {
			const filePath = this.getServerDataPath(serverId);
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

	/**
	 * Save server data to file
	 * @param {string} serverId - Discord server ID
	 * @param {Object} data - Server data to save
	 * @returns {Promise<boolean>} Success status
	 */
	static async saveServerData(serverId, data) {
		try {
			await this.ensureDataDir();
			const filePath = this.getServerDataPath(serverId);
			data.updatedAt = new Date().toISOString();
			await fs.writeFile(filePath, JSON.stringify(data, null, 2));
			return true;
		}
		catch (error) {
			console.error("Error saving server data:", error);
			return false;
		}
	}

	/**
	 * Update server data with partial updates
	 * @param {string} serverId - Discord server ID
	 * @param {Object} updates - Partial updates to apply
	 * @returns {Promise<boolean>} Success status
	 */
	static async updateServerData(serverId, updates) {
		const currentData = await this.getServerData(serverId);
		const updatedData = { ...currentData, ...updates };
		return await this.saveServerData(serverId, updatedData);
	}

	/**
	 * Get all server IDs that have data files
	 * @returns {Promise<Array<string>>} Array of server IDs
	 */
	static async getAllServerIds() {
		try {
			await this.ensureDataDir();
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

	/**
	 * Delete server data file
	 * @param {string} serverId - Discord server ID
	 * @returns {Promise<boolean>} Success status
	 */
	static async deleteServerData(serverId) {
		try {
			const filePath = this.getServerDataPath(serverId);
			await fs.unlink(filePath);
			return true;
		}
		catch (error) {
			console.error("Error deleting server data:", error);
			return false;
		}
	}
}

module.exports = ServerData;