/**
 * Data management utility for Discord bot
 * High-level operations for managing server users and tables
 */
const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const ServerData = require("./serverData");

class DataManager {
	/**
	 * Add a new user to server data
	 * @param {string} serverId - Discord server ID
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @returns {Promise<boolean>} Success status
	 */
	static async addServerUser(serverId, userId, client) {
		try {
			const serverData = await ServerData.getServerData(serverId);
			if (!serverData.users) serverData.users = {};
			if (!serverData.tables) serverData.tables = {};

			// Check if user already exists
			if (serverData.users[userId]) {
				return true;
			}

			await DataManager.updateServerUser(serverId, userId, client);
			return true;
		}
		catch (error) {
			console.error(`Error adding user ${userId} to server ${serverId}:`, error);
			return false;
		}
	}

	/**
	 * Update an existing user's data in server storage
	 * @param {string} serverId - Discord server ID
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @returns {Promise<boolean>} Success status
	 */
	static async updateServerUser(serverId, userId, client) {
		try {
			const serverData = await ServerData.getServerData(serverId);

			// Fetch user info from Discord
			const user = await client.users.fetch(userId);
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				console.warn(`User ${userId} not found in Lounge API`);
				return false;
			}

			const userTables = await LoungeApi.getAllPlayerTables(userId, serverId);

			// Get current user's table count (or 0 if new user)
			const currentTableCount = serverData.users[userId]?.tables?.length || 0;

			if (Object.keys(userTables).length > currentTableCount) {
				serverData.tables = {
					...serverData.tables,
					...userTables,
				};
			}

			serverData.users[userId] = {
				username: user.username,
				loungeName: loungeUser.name,
				tables: Object.keys(userTables),
				lastUpdated: new Date().toISOString(),
		    };

			const saveResult = await ServerData.saveServerData(serverId, serverData);
			return saveResult;
		}
		catch (error) {
			console.error(`Error updating user ${userId}:`, error);
			return false;
		}
	}


	/**
	 * Get username from stored data or fetch from Discord
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @param {string|null} serverId - Discord server ID (optional)
	 * @returns {Promise<string>} Username or "Unknown User" if failed
	 */
	static async getUsernameFromId(userId, client, serverId = null) {
		try {
			// Try to get from stored data first (if serverId provided)
			if (serverId) {
				const serverData = await ServerData.getServerData(serverId);
				const storedUser = serverData.users?.[userId];
				if (storedUser && storedUser.username) {
					return storedUser.username;
				}
			}

			// Fetch fresh from Discord
			const user = await client.users.fetch(userId);
			return user.username;
		}
		catch (error) {
			console.error(`Error fetching username for ${userId}:`, error);
			return "Unknown User";
		}
	}
}

module.exports = DataManager;