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
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
			if (!loungeUser) {
				return false;
			}

			// Just ensure the user exists in the global database
			await DataManager.ensureUserRecord({
				loungeId: loungeUser.id,
				loungeName: loungeUser.name,
				discordUser: { id: userId },
				client,
			});

			return true;
		}
		catch (error) {
			console.error(`Error adding user ${userId} to server ${serverId}:`, error);
			return false;
		}
	}

	static async removeServerUser(serverId, identifiers = {}) {
		// We no longer track server membership, so there's nothing to remove.
		return true;
	}

	static async ensureUserRecord({ loungeId, loungeName = null, serverId = null, client = null, guild = null, loungeProfileOverride = null }) {
		if (loungeId === undefined || loungeId === null) {
			throw new Error("loungeId is required to ensure user record");
		}

		const normalizedId = String(loungeId);
		let existingRecord = null;
		try {
			existingRecord = await database.getUserData(normalizedId);
		}
		catch (error) {
			console.warn(`failed to read user record ${normalizedId}:`, error);
		}

		const record = existingRecord ? JSON.parse(JSON.stringify(existingRecord)) : {
			loungeId: normalizedId,
			discordIds: [],
		};

		record.discordIds = Array.isArray(record.discordIds) ? record.discordIds.map(String) : [];
		let changed = !existingRecord;

		if (!record.loungeName && loungeName) {
			record.loungeName = loungeName;
			changed = true;
		}

		let loungeProfile = loungeProfileOverride;
		if (!loungeProfile) {
			try {
				loungeProfile = await LoungeApi.getPlayerByLoungeId(normalizedId);
			}
			catch (error) {
				console.warn(`failed to load lounge profile for ${normalizedId}:`, error);
			}
		}

		if (loungeProfile && !loungeProfile.discordId) {
			try {
				const basicProfile = await LoungeApi.getPlayerByLoungeId(normalizedId);
				if (basicProfile?.discordId) {
					loungeProfile.discordId = basicProfile.discordId;
				}
			}
			catch (error) {
				// ignore
			}
		}

		if (loungeProfile?.name && record.loungeName !== loungeProfile.name) {
			record.loungeName = loungeProfile.name;
			changed = true;
		}

		const discordId = loungeProfile?.discordId ? String(loungeProfile.discordId) : null;
		let discordUser = null;
		let guildMember = null;

		if (discordId) {
			const discordIdSet = new Set((record.discordIds || []).map(String));
			if (!discordIdSet.has(discordId)) {
				discordIdSet.add(discordId);
				record.discordIds = Array.from(discordIdSet);
				changed = true;
			}

			if (guild) {
				try {
					guildMember = await guild.members.fetch(discordId);
				}
				catch (error) {
					if (error.code !== 10007 && error.status !== 404) {
						console.warn(`failed to fetch guild member ${discordId}:`, error);
					}
				}
			}

			if (!discordUser && guildMember) {
				discordUser = guildMember.user;
			}

			if (!discordUser && client) {
				try {
					discordUser = await client.users.fetch(discordId);
				}
				catch (error) {
					if (error.code !== 10013 && error.status !== 404) {
						console.warn(`failed to fetch discord user ${discordId}:`, error);
					}
				}
			}
		}

		if (!record.createdAt) {
			record.createdAt = new Date().toISOString();
			changed = true;
		}

		if (changed) {
			await database.saveUserData(normalizedId, record);
		}

		return {
			userRecord: record,
			loungeProfile,
			discordId,
			discordUser,
			guildMember,
		};
	}

	/**
	 * Update an existing user's data and their tables using normalized storage
	 * @param {string} serverId - Discord server ID
	 * @param {string} userId - Discord user ID
	 * @param {Object} client - Discord client instance
	 * @returns {Promise<boolean>} Success status
	 */
	static async updateServerUser(serverId, userId, client, loungeUserOverride = null) {
		try {
			const discordId = String(userId);
			// Fetch user info from Discord
			const user = await client.users.fetch(discordId);

			let loungeUser = loungeUserOverride || null;
			let resolvedLoungeId = loungeUser?.id ? String(loungeUser.id) : (loungeUser?.playerId ? String(loungeUser.playerId) : null);

			if (!loungeUser) {
				loungeUser = await LoungeApi.getPlayerByDiscordId(discordId);
				resolvedLoungeId = loungeUser?.id ? String(loungeUser.id) : (loungeUser?.playerId ? String(loungeUser.playerId) : resolvedLoungeId);
			}

			if (!loungeUser || !resolvedLoungeId) {
				// console.warn(`User ${discordId} not found in Lounge API`);
				return false;
			}
			const loungeId = resolvedLoungeId;

			// Load existing cached tables first so we can avoid unnecessary API calls.
			const cachedEntries = await database.getUserTables(loungeId);
			const existingTableIds = new Set(cachedEntries.map(entry => String(entry.id)));
			const cachedTables = {};
			for (const entry of cachedEntries) {
				try {
					const tableData = await database.getTable(entry.id);
					if (tableData) {
						cachedTables[String(entry.id)] = tableData;
					}
				}
				catch (error) {
					console.warn(`failed to load cached table ${entry.id} for ${loungeId}:`, error);
				}
			}

			let userTables = cachedTables;
			if (!Object.keys(userTables).length) {
				try {
					userTables = await LoungeApi.getAllPlayerTables(loungeId, serverId);
				}
				catch (error) {
					console.warn(`Failed to get player tables for lounge user ${loungeId}:`, error);
					userTables = {};
				}
			}

			// Save new tables to normalized storage
			for (const [tableId, tableData] of Object.entries(userTables)) {
				const normalizedTableId = String(tableId);
				if (!existingTableIds.has(normalizedTableId)) {
					await database.saveTable(normalizedTableId, tableData);
					existingTableIds.add(normalizedTableId);
				}

				await database.linkUserToTable(loungeId, normalizedTableId, serverId);
			}

			const existingUser = await database.getUserData(loungeId);
			const discordIds = new Set([...(existingUser?.discordIds || []), discordId]);
			const userPayload = {
				...existingUser,
				loungeId,
				loungeName: loungeUser.name || existingUser?.loungeName || null,
				lastUpdated: new Date().toISOString(),
				discordIds: Array.from(discordIds),
			};

			return await database.saveUserData(loungeId, userPayload);
		}
		catch (error) {
			console.error(`Error updating discord user ${userId}:`, error);
			return false;
		}
	}

	/**
	 * Get tables for a specific user in a server (normalized)
	 * @param {string} userId - User ID
	 * @param {string} serverId - Server ID
	 * @returns {Promise<Array>} Array of table objects
	 */
	static async getUserTables(loungeId, serverId = null) {
		// We no longer filter by serverId as we don't track server membership
		return await database.getUserTables(loungeId);
	}

	/**
	 * Get all tables for users in a server (for head-to-head comparisons)
	 * @param {string} serverId - Server ID
	 * @param {Array<string>} userIds - Array of user IDs to get tables for
	 * @returns {Promise<Object>} Object with tableId as key, table data as value
	 */
	static async getTablesForUsers(serverId, loungeIds) {
		const tables = {};
		const tableIds = new Set();

		// Get all table IDs for these users
		for (const loungeId of loungeIds) {
			const userTables = await this.getUserTables(loungeId, serverId);
			userTables.forEach(table => tableIds.add(String(table.id)));
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
			// Fetch fresh from Discord
			const user = await client.users.fetch(userId);
			return user.globalName || user.username;
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
		// No-op: server data is deprecated
		return true;
	}

	/**
	 * Delete server data and all associated user-table links
	 * @param {string} serverId - Server ID
	 * @returns {Promise<boolean>} Success status
	 */
	static async deleteServerData(serverId) {
		// No-op: server data is deprecated
		return true;
	}
}

module.exports = DataManager;