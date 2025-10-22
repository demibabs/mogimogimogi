/**
 * Lounge API utility functions for Discord bot
 * Updated for Mario Kart World lounge API
 */

const database = require("./database");

// Use the Mario Kart World lounge API endpoint
const LOUNGE_API_BASE = "https://lounge.mkcentral.com/api";

// Default season (can be updated as needed for MK World)
const DEFAULT_SEASON = 1;

// Authentication config - many endpoints work without auth
const AUTH_CONFIG = {
	// You can add credentials here if needed for authenticated endpoints
	// username: "your_username",
	// password: "your_password",
};

/**
 * Get authorization header for API requests (if credentials are provided)
 * @returns {string|undefined} Basic auth header or undefined
 */
function getAuthHeader() {
	if (AUTH_CONFIG.username && AUTH_CONFIG.password) {
		const auth = Buffer.from(`${AUTH_CONFIG.username}:${AUTH_CONFIG.password}`).toString("base64");
		return `Basic ${auth}`;
	}
	return undefined;
}

/**
 * Common headers for API requests
 * @returns {Object} HTTP headers object
 */
function getCommonHeaders() {
	const headers = {
		"Content-Type": "application/json",
	};

	const authHeader = getAuthHeader();
	if (authHeader) {
		headers.Authorization = authHeader;
	}

	return headers;
}

/**
 * Make a GET request to the Lounge API
 * @param {string} endpoint - API endpoint (e.g., '/player', '/table')
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response
 */
async function apiGet(endpoint, params = {}) {
	const url = new URL(`${LOUNGE_API_BASE}${endpoint}`);
	Object.keys(params).forEach(key => {
		if (params[key] !== null && params[key] !== undefined) {
			url.searchParams.append(key, params[key].toString());
		}
	});

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: getCommonHeaders(),
	});

	if (!response.ok) {
		throw new Error(`API Error: ${response.status} ${response.statusText}`);
	}

	return await response.json();
}

/**
 * Search for a player by name
 * @param {string} name - Player name
 * @param {number} season - Season number (optional, defaults to current season)
 * @returns {Promise<Object|null>} Player data or null if not found
 */
async function getPlayer(name, season = DEFAULT_SEASON) {
	try {
		const params = {
			name: name,
			season: season,
			game: "mkworld",
		};

		return await apiGet("/player", params);
	}
	catch (error) {
		if (error.message.includes("404")) {
			return null;
		}
		throw error;
	}
}

/**
 * Search for a player by Discord ID
 * @param {string} discordId - Discord user ID
 * @param {number} season - Season number (optional, defaults to current season)
 * @returns {Promise<Object|null>} Player data or null if not found
 */
async function getPlayerByDiscordId(discordId, season = DEFAULT_SEASON) {
	try {
		const params = {
			discordId: discordId,
			season: season,
			game: "mkworld",
		};

		return await apiGet("/player", params);
	}
	catch (error) {
		if (error.message.includes("404")) {
			return null;
		}
		throw error;
	}
}
async function getPlayerByDiscordIdDetailed(discordId, season = DEFAULT_SEASON) {
	try {
		const params = {
			discordId: discordId,
			season: season,
			game: "mkworld",
		};

		return await apiGet("/player/details", params);
	}
	catch (error) {
		if (error.message.includes("404")) {
			return null;
		}
		throw error;
	}
}

/**
 * Get table (race) information by table ID
 * @param {number} tableId - Table ID
 * @returns {Promise<Object|null>} Table data or null if not found
 */
async function getTable(tableId) {
	try {
		const params = {
			tableId: tableId,
		};

		return await apiGet("/table", params);
	}
	catch (error) {
		if (error.message.includes("404")) {
			return null;
		}
		throw error;
	}
}

/**
 * Get all tables for a player from API and server data
 * @param {string} userId - Discord user ID
 * @param {string} serverId - Discord server ID
 * @returns {Promise<Object>} Object containing all player tables
 */
async function getAllPlayerTables(userId, serverId) {
	try {
		// Get existing tables from normalized storage
		let existingTables = [];
		try {
			existingTables = await database.getUserTables(userId, serverId);
		}
		catch (error) {
			console.warn(`Could not get existing tables for user ${userId}:`, error);
			// Continue with empty array
		}

		const tables = {};

		// Load existing tables into the result
		for (const userTable of existingTables) {
			try {
				const tableData = await database.getTable(userTable.id);
				if (tableData) {
					tables[userTable.id] = tableData;
				}
			}
			catch (error) {
				console.warn(`Could not load table ${userTable.id}:`, error);
			}
		}

		// Find the maximum table ID we already have
		const maxTableId = existingTables.length > 0 ?
			Math.max(...existingTables.map(t => parseInt(t.id))) : 0;

		// Get new tables from API
		const params = {
			discordId: userId,
			game: "mkworld",
		};

		for (let season = 0; season <= DEFAULT_SEASON; season++) {
			params.season = season;
			try {
				const details = await apiGet("/player/details", params);
				const changes = details.mmrChanges.filter(c => c.reason === "Table" && c.changeId > maxTableId);

				for (const change of changes) {
					try {
						const tableData = await getTable(change.changeId);
						if (tableData) {
							tables[change.changeId] = tableData;
						}
					}
					catch (error) {
						console.warn(`Could not fetch table ${change.changeId}:`, error);
					}
				}
			}
			catch (error) {
				// Skip this season if API call fails
				console.warn(`API call failed for season ${season}, user ${userId}:`, error);
			}
		}

		return tables;
	}
	catch (error) {
		if (error.message.includes("404")) {
			return {};
		}
		console.error(`Error in getAllPlayerTables for user ${userId}:`, error);
		return {};
	}
}

/**
 * Get player strikes/penalties
 * @param {string} name - Player name
 * @param {number} season - Season number (optional, defaults to current season)
 * @returns {Promise<Array>} Array of strikes/penalties
 */

/**
 * Get current MMR for a player by Discord ID
 * @param {string} discordId - Discord user ID
 * @param {number} season - Season number (optional, defaults to current season)
 * @returns {Promise<number|null>} Current MMR or null if not found
 */
async function getCurrentMMR(discordId, season = DEFAULT_SEASON) {
	try {
		const player = await getPlayerByDiscordId(discordId, season);
		if (!player) {
			return null;
		}

		// The player object should contain current MMR
		return player.mmr || null;
	}
	catch (error) {
		console.error(`Error getting current MMR for Discord ID ${discordId}:`, error);
		return null;
	}
}


async function getTotalNumberOfRankedPlayers(season = DEFAULT_SEASON) {
	try {
		const params = {
			game: "mkworld",
			season: season,
		};
		const stats = await apiGet("/player/stats", params);
		return stats.totalPlayers;
	}
	catch (error) {
		console.error("Error getting total number of ranked players:", error);
	}
}

/**
 * Get weekly MMR change for a player
 * @param {string} userId - Discord user ID
 * @returns {Promise<number|null>} Weekly MMR change or null if not found
 */
async function getWeeklyMMRChange(userId) {
	try {
		const oneWeekAgo = new Date();
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		const params = {
			discordId: userId,
			game: "mkworld",
		};

		let totalChange = 0;
		let hasChanges = false;

		for (let season = 0; season <= DEFAULT_SEASON; season++) {
			params.season = season;
			try {
				const details = await apiGet("/player/details", params);

				if (details.mmrChanges) {
					const weeklyChanges = details.mmrChanges.filter(change => {
						// Check if the change is from the past week
						const changeDate = new Date(change.time);
						return changeDate >= oneWeekAgo;
					});

					for (const change of weeklyChanges) {
						// Add the MMR delta
						if (change.mmrDelta !== undefined) {
							totalChange += change.mmrDelta;
							hasChanges = true;
						}
					}
				}
			}
			catch (error) {
				console.warn(`API call failed for season ${season}, user ${userId}:`, error);
			}
		}

		return hasChanges ? totalChange : null;
	}
	catch (error) {
		console.error(`Error getting weekly MMR change for user ${userId}:`, error);
		return null;
	}
}

/**
 * Get season MMR change for a player
 * @param {string} userId - Discord user ID
 * @param {number} season - Season to check (defaults to current season)
 * @returns {Promise<number|null>} Season MMR change or null if not found
 */
async function getSeasonMMRChange(userId, season = DEFAULT_SEASON) {
	try {
		const params = {
			discordId: userId,
			game: "mkworld",
			season: season,
		};

		let totalChange = 0;
		let hasChanges = false;

		try {
			const details = await apiGet("/player/details", params);

			if (details.mmrChanges) {
				const seasonChanges = details.mmrChanges;

				for (const change of seasonChanges) {
					// Add the MMR delta
					if (change.mmrDelta !== undefined) {
						totalChange += change.mmrDelta;
						hasChanges = true;
					}
				}
			}
		}
		catch (error) {
			console.warn(`API call failed for season ${season}, user ${userId}:`, error);
		}

		return hasChanges ? totalChange : null;
	}
	catch (error) {
		console.error(`Error getting season MMR change for user ${userId}:`, error);
		return null;
	}
}


module.exports = {
	getPlayer,
	getPlayerByDiscordId,
	getPlayerByDiscordIdDetailed,
	getTable,
	getAllPlayerTables,
	getCurrentMMR,
	getWeeklyMMRChange,
	getSeasonMMRChange,
	apiGet,
	getTotalNumberOfRankedPlayers,
	DEFAULT_SEASON,
};