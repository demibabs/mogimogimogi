/**
 * Enhanced data management utility for Discord bot
 * High-level operations for managing server users and normalized table storage
 */
const LoungeApi = require("./loungeApi");
const PlayerStats = require("./playerStats");
const database = require("./database");

class DataManager {
	/**
	 * Add a new user to server data and update their tables
	 * @param {string} serverId - Discord server ID
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @returns {Promise<boolean>} Success status
	 */
	static async addServerUser(serverId, userId, client) {
		try {
			const serverData = await database.getServerData(serverId);
			if (!serverData.users) serverData.users = {};

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
	 * Update an existing user's data and their tables using normalized storage
	 * @param {string} serverId - Discord server ID
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @returns {Promise<boolean>} Success status
	 */
	static async updateServerUser(serverId, userId, client) {
		try {
			const serverData = await database.getServerData(serverId);

			// Fetch user info from Discord
			const user = await client.users.fetch(userId);
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				console.warn(`User ${userId} not found in Lounge API`);
				return false;
			}

			// Get tables using a safe method that handles both old and new formats
			let userTables = {};
			try {
				userTables = await LoungeApi.getAllPlayerTables(userId, serverId);
			}
			catch (error) {
				console.warn(`Failed to get player tables for ${userId}:`, error);
				// Continue with empty tables rather than failing completely
				userTables = {};
			}

			// Get current user's table count from user_tables relationship
			const existingTables = await database.getUserTables(userId, serverId);
			const currentTableCount = existingTables.length;

			// Save new tables to normalized storage
			if (Object.keys(userTables).length > currentTableCount) {
				for (const [tableId, tableData] of Object.entries(userTables)) {
					// Check if table is already saved
					const existingTable = await database.getTable(tableId);
					if (!existingTable) {
						await database.saveTable(tableId, tableData);
					}

					// Link user to this table (if not already linked)
					await database.linkUserToTable(userId, tableId, serverId);
				}
			}

			// Update user data in server_data (without tables)
			serverData.users[userId] = {
				username: user.username,
				loungeName: loungeUser.name,
				lastUpdated: new Date().toISOString(),
		    };

			// Save server data without embedded tables
			const saveResult = await database.saveServerData(serverId, serverData);
			return saveResult;
		}
		catch (error) {
			console.error(`Error updating user ${userId}:`, error);
			return false;
		}
	}

	/**
	 * Get tables for a specific user in a server (normalized)
	 * @param {string} userId - User ID
	 * @param {string} serverId - Server ID
	 * @returns {Promise<Array>} Array of table objects
	 */
	static async getUserTables(userId, serverId) {
		return await database.getUserTables(userId, serverId);
	}

	/**
	 * Get all tables for users in a server (for head-to-head comparisons)
	 * @param {string} serverId - Server ID
	 * @param {Array<string>} userIds - Array of user IDs to get tables for
	 * @returns {Promise<Object>} Object with tableId as key, table data as value
	 */
	static async getTablesForUsers(serverId, userIds) {
		const tables = {};
		const tableIds = new Set();

		// Get all table IDs for these users
		for (const userId of userIds) {
			const userTables = await this.getUserTables(userId, serverId);
			userTables.forEach(table => tableIds.add(table.id));
		}

		// Fetch all unique tables
		for (const tableId of tableIds) {
			const table = await database.getTable(tableId);
			if (table) {
				tables[tableId] = { id: tableId, ...table };
			}
		}

		return tables;
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
				const serverData = await database.getServerData(serverId);
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

	/**
	 * Migrate old server data format to new normalized format
	 * @param {string} serverId - Server ID to migrate
	 * @returns {Promise<boolean>} Success status
	 */
	static async migrateServerData(serverId) {
		try {
			// Get current server data (might include embedded tables)
			const fullData = await database.getServerData(serverId);

			if (!fullData.tables) {
				console.log(`Server ${serverId} has no tables to migrate`);
				return true;
			}

			console.log(`Migrating ${Object.keys(fullData.tables).length} tables for server ${serverId}`);

			// Extract and save each table
			for (const [tableId, tableData] of Object.entries(fullData.tables)) {
				await database.saveTable(tableId, tableData);

				// Link users who participated in this table
				if (tableData.players) {
					for (const player of tableData.players) {
						if (player.loungeName && fullData.users) {
							// Find user ID by lounge name
							const userId = Object.keys(fullData.users).find(uid =>
								fullData.users[uid].loungeName === player.loungeName,
							);
							if (userId) {
								await database.linkUserToTable(userId, tableId, serverId);
							}
						}
					}
				}
			}

			// Save server data without tables
			const serverOnlyData = { ...fullData };
			delete serverOnlyData.tables;
			await database.saveServerData(serverId, serverOnlyData);

			console.log(`Migration completed for server ${serverId}`);
			return true;
		}
		catch (error) {
			console.error(`Migration failed for server ${serverId}:`, error);
			return false;
		}
	}

	/**
	 * Delete server data and all associated user-table links
	 * @param {string} serverId - Server ID
	 * @returns {Promise<boolean>} Success status
	 */
	static async deleteServerData(serverId) {
		return await database.deleteServerData(serverId);
	}
}

module.exports = DataManager;