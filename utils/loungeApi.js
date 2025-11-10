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

async function searchPlayers(query, options = {}) {
	const { limit = 25, season = DEFAULT_SEASON, skip = 0 } = options;
	const trimmedQuery = (query ?? "").trim();
	if (!trimmedQuery) {
		return [];
	}

	const boundedLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
	const boundedSkip = Math.max(0, Number(skip) || 0);

	try {
		const params = {
			search: trimmedQuery,
			pageSize: boundedLimit,
			skip: boundedSkip,
			season,
			game: "mkworld",
		};

		const result = await apiGet("/player/leaderboard", params);
		if (!result) return [];
		if (Array.isArray(result.data)) {
			return result.data;
		}
		if (Array.isArray(result.players)) {
			return result.players;
		}
		return [];
	}
	catch (error) {
		if (String(error.message).includes("404")) {
			return [];
		}
		console.warn(`Failed to search lounge players for query "${trimmedQuery}":`, error);
		return [];
	}
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

async function getPlayerByLoungeId(loungeId, season = DEFAULT_SEASON) {
	try {
		if (loungeId === null || loungeId === undefined) {
			return null;
		}

		const params = {
			id: Number(loungeId),
			season,
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

async function getPlayerDetailsByLoungeId(loungeId, season = DEFAULT_SEASON) {
	try {
		if (loungeId === null || loungeId === undefined) {
			return null;
		}

		const params = {
			id: Number(loungeId),
			season,
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
async function getAllPlayerTables(loungeId, serverId) {
	try {
		const normalizedId = String(loungeId ?? "").trim();
		if (!normalizedId) {
			throw new Error(`Invalid loungeId provided: ${loungeId}`);
		}
		// Get existing tables from normalized storage
		let existingTables = [];
		try {
			existingTables = await database.getUserTables(normalizedId);
		}
		catch (error) {
			console.warn(`Could not get existing tables for lounge user ${normalizedId}:`, error);
			// Continue with empty array
		}

		const tables = {};
		const tablesToPersist = new Map();

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

		const numericId = Number(normalizedId);
		if (Number.isNaN(numericId)) {
			return tables;
		}

		// Find the maximum table ID we already have
		const maxTableId = existingTables.length > 0 ?
			Math.max(...existingTables.map(t => {
				const value = Number.parseInt(String(t.id), 10);
				return Number.isNaN(value) ? 0 : value;
			})) : 0;

		// Get new tables from API
		for (let season = 0; season <= DEFAULT_SEASON; season++) {
			try {
				const details = await getPlayerDetailsByLoungeId(numericId, season);
				if (!details?.mmrChanges) {
					continue;
				}
				const changes = details.mmrChanges.filter(c => c.reason === "Table" && c.changeId > maxTableId);

				for (const change of changes) {
					try {
						const tableData = await getTable(change.changeId);
						if (tableData) {
							tables[change.changeId] = tableData;
							tablesToPersist.set(String(change.changeId), tableData);
						}
					}
					catch (error) {
						console.warn(`Could not fetch table ${change.changeId}:`, error);
					}
				}
			}
			catch (error) {
				// Skip this season if API call fails
				console.warn(`API call failed for season ${season}, lounge user ${numericId}:`, error);
			}
		}

		for (const [tableId, tableData] of tablesToPersist.entries()) {
			try {
				await database.saveTable(tableId, tableData);
			}
			catch (error) {
				console.warn(`Failed to persist table ${tableId} for lounge user ${normalizedId}:`, error);
			}
		}

		try {
			await database.rememberGlobalUserTables(normalizedId, Object.keys(tables));
		}
		catch (error) {
			console.warn(`Failed to update global cache for lounge user ${normalizedId}:`, error);
		}

		return tables;
	}
	catch (error) {
		if (error.message.includes("404")) {
			return {};
		}
		console.error(`Error in getAllPlayerTables for lounge user ${loungeId}:`, error);
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
async function getCurrentMMR(loungeId, season = DEFAULT_SEASON) {
	try {
		const player = await getPlayerByLoungeId(loungeId, season);
		if (!player) {
			return null;
		}

		// The player object should contain current MMR
		return player.mmr || null;
	}
	catch (error) {
		console.error(`Error getting current MMR for loungeId ${loungeId}:`, error);
		return null;
	}
}

/**
 * Get weekly MMR change for a player
 * @param {string} userId - Discord user ID
 * @returns {Promise<number|null>} Weekly MMR change or null if not found
 */
async function getWeeklyMMRChange(loungeId) {
	try {
		const oneWeekAgo = new Date();
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		let totalChange = 0;
		let hasChanges = false;

		for (let season = 0; season <= DEFAULT_SEASON; season++) {
			try {
				const details = await getPlayerDetailsByLoungeId(loungeId, season);
				if (!details?.mmrChanges) {
					continue;
				}

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
			catch (error) {
				console.warn(`API call failed for season ${season}, lounge user ${loungeId}:`, error);
			}
		}

		return hasChanges ? totalChange : null;
	}
	catch (error) {
		console.error(`Error getting weekly MMR change for lounge user ${loungeId}:`, error);
		return null;
	}
}

async function getGlobalStats(season = DEFAULT_SEASON) {
	const params = {
		game: "mkworld",
		season,
	};
	try {
		const stats = await apiGet("/player/stats", params);
		return stats;
	}
	catch (error) {
		console.error("Error of getting rank distribution:", error);
		return null;
	}
}

/**
 * Get season MMR change for a player
 * @param {string} userId - Discord user ID
 * @param {number} season - Season to check (defaults to current season)
 * @returns {Promise<number|null>} Season MMR change or null if not found
 */
async function getSeasonMMRChange(loungeId, season = DEFAULT_SEASON) {
	try {
		let totalChange = 0;
		let hasChanges = false;

		try {
			const details = await getPlayerDetailsByLoungeId(loungeId, season);

			if (details?.mmrChanges) {
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
			console.warn(`API call failed for season ${season}, lounge user ${loungeId}:`, error);
		}

		return hasChanges ? totalChange : null;
	}
	catch (error) {
		console.error(`Error getting season MMR change for lounge user ${loungeId}:`, error);
		return null;
	}
}


module.exports = {
	getPlayer,
	getPlayerByLoungeId,
	getPlayerByDiscordId,
	getPlayerByDiscordIdDetailed,
	getPlayerDetailsByLoungeId,
	getTable,
	getAllPlayerTables,
	getCurrentMMR,
	getWeeklyMMRChange,
	getSeasonMMRChange,
	apiGet,
	getGlobalStats,
	searchPlayers,
	DEFAULT_SEASON,
};