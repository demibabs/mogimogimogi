/**
 * Lounge API utility functions for Discord bot
 * Updated for Mario Kart World lounge API
 */

const database = require("./database");

// Use the Mario Kart World lounge API endpoint
const LOUNGE_API_BASE = "https://lounge.mkcentral.com/api";

// Default season (can be updated as needed for MK World)
const DEFAULT_SEASON = 2;
const DEFAULT_GAME = "mkworld12p";

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
async function apiGet(endpoint, params = {}, retries = 3) {
	const url = new URL(`${LOUNGE_API_BASE}${endpoint}`);
	Object.keys(params).forEach(key => {
		if (params[key] !== null && params[key] !== undefined) {
			url.searchParams.append(key, params[key].toString());
		}
	});

	let lastError;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url.toString(), {
				method: "GET",
				headers: getCommonHeaders(),
			});

			if (!response.ok) {
				// Retry on 5xx server errors or 429 rate limits
				if (response.status >= 500 || response.status === 429) {
					throw new Error(`API Error: ${response.status} ${response.statusText}`);
				}
				// Don't retry on other client errors (e.g. 404)
				throw new Error(`API Error: ${response.status} ${response.statusText}`);
			}

			return await response.json();
		}
		catch (error) {
			lastError = error;

			// If it's a client error (4xx) that isn't 429, don't retry.
			if (error.message.startsWith("API Error: 4") && !error.message.includes("429")) {
				throw error;
			}

			if (attempt === retries) break;

			// Exponential backoff: 1s, 2s...
			const delay = 1000 * Math.pow(2, attempt - 1);
			console.warn(`[LoungeAPI] Request to ${endpoint} failed (Attempt ${attempt}/${retries}). Retrying in ${delay}ms... Error: ${error.message}`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

async function searchPlayers(query, options = {}) {
	const { limit = 25, season = DEFAULT_SEASON, skip = 0, game = DEFAULT_GAME } = options;
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
			game,
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
async function getPlayer(name, season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	try {
		const params = {
			name: name,
			season: season,
			game: game,
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

async function getPlayerByLoungeId(loungeId, season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	try {
		if (loungeId === null || loungeId === undefined) {
			return null;
		}

		const params = {
			id: Number(loungeId),
			season,
			game: game,
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
async function getPlayerByDiscordId(discordId, season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	try {
		const params = {
			discordId: discordId,
			season: season,
			game: game,
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
async function getPlayerByDiscordIdDetailed(discordId, season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	try {
		const params = {
			discordId: discordId,
			season: season,
			game: game,
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

async function getPlayerDetailsByLoungeId(loungeId, season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	try {
		if (loungeId === null || loungeId === undefined) {
			return null;
		}

		const params = {
			id: Number(loungeId),
			season,
			game: game,
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
async function getAllPlayerTables(loungeId, serverId, currentSeasonPlayerDetails = null) {
	try {
		const normalizedId = String(loungeId ?? "").trim();
		if (!normalizedId) {
			throw new Error(`Invalid loungeId provided: ${loungeId}`);
		}
		// Get existing tables from normalized storage
		let existingTables = [];
		try {
			existingTables = await database.getUserTablesWithData(normalizedId);
		}
		catch (error) {
			console.warn(`Could not get existing tables for lounge user ${normalizedId}:`, error);
			// Continue with empty array
		}

		const tables = {};
		const tablesToPersist = new Map();

		// Load existing tables into the result
		for (const { id, data } of existingTables) {
			if (data) {
				tables[id] = data;
			}
		}

		const numericId = Number(normalizedId);
		if (Number.isNaN(numericId)) {
			return tables;
		}

		// Find the maximum table ID we already have and its season
		// let maxTableId = 0;
		// let startSeason = 0;

		// for (const table of Object.values(tables)) {
		// 	const tId = Number(table.id);
		// 	if (!Number.isNaN(tId) && tId > maxTableId) {
		// 		maxTableId = tId;
		// 		const tSeason = Number(table.season);
		// 		startSeason = !Number.isNaN(tSeason) ? tSeason : 0;
		// 	}
		// }

		// Get new tables from API
		// We iterate through all seasons to ensure we don't miss any tables (filling holes)
		for (let season = 0; season <= DEFAULT_SEASON; season++) {
			// Iterate over game modes relevant for the season
			const gameModes = season < 2 ? ["mkworld"] : ["mkworld12p", "mkworld24p"];

			for (const gameMode of gameModes) {
				try {
					let details = null;
					// If a specific details object was passed, only use it if it matches our loop
					// Assume that if gameMode is missing, it corresponds to DEFAULT_GAME (likely 12p)
					const detailsGameMode = currentSeasonPlayerDetails?.gameMode || DEFAULT_GAME;

					if (currentSeasonPlayerDetails &&
						Number(currentSeasonPlayerDetails.season) === season &&
						detailsGameMode === gameMode) {

						details = currentSeasonPlayerDetails;
					}
					else {
						details = await getPlayerDetailsByLoungeId(numericId, season, gameMode);
					}

					if (!details?.mmrChanges) {
						continue;
					}

					// Fetch tables from mmrChanges...
					// Note: tables are global entities so we can just merge them.
					// However, we need to be careful not to double count or confuse counts if we are cross-checking 'eventsPlayed'.
					// For now, let's just grab all tables referenced in mmrChanges.

					const newTables = details.mmrChanges.filter(c => c.reason === "Table" && !tables[c.changeId]);

					const CHUNK_SIZE = 5;
					for (let i = 0; i < newTables.length; i += CHUNK_SIZE) {
						const chunk = newTables.slice(i, i + CHUNK_SIZE);
						await Promise.all(chunk.map(async (change) => {
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
						}));
					}
				}
				catch (error) {
					// Skip this mode if API call fails (e.g. 404 for a game mode not played)
					// console.warn(`API call failed for season ${season}/${gameMode}, lounge user ${numericId}:`, error);
				}
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

async function getGlobalStats(season = DEFAULT_SEASON, game = DEFAULT_GAME) {
	const params = {
		game,
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
	DEFAULT_SEASON,
	DEFAULT_GAME,
	getCurrentMMR,
	getWeeklyMMRChange,
	getSeasonMMRChange,
	apiGet,
	getGlobalStats,
	searchPlayers,
	DEFAULT_SEASON,
};