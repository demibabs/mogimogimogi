/**
 * Server data utility functions
 * Pure data access and persistence functions for server-specific data
 */

const database = require("./database");

class ServerData {
	/**
	 * Get server data
	 * @param {string} serverId - Discord server ID
	 * @returns {Promise<Object>} Server data object
	 */
	static async getServerData(serverId) {
		// Use database if available, otherwise fallback to file storage
		return await database.getServerData(serverId);
	}

	/**
	 * Save server data
	 * @param {string} serverId - Discord server ID
	 * @param {Object} data - Server data to save
	 * @returns {Promise<boolean>} Success status
	 */
	static async saveServerData(serverId, data) {
		try {
			await database.saveServerData(serverId, data);
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
	 * Get all server IDs that have data
	 * @returns {Promise<Array<string>>} Array of server IDs
	 */
	static async getAllServerIds() {
		return await database.getAllServerIds();
	}

	/**
	 * Delete server data
	 * @param {string} serverId - Discord server ID
	 * @returns {Promise<boolean>} Success status
	 */
	static async deleteServerData(serverId) {
		try {
			await database.deleteServerData(serverId);
			return true;
		}
		catch (error) {
			console.error("Error deleting server data:", error);
			return false;
		}
	}
}

module.exports = ServerData;