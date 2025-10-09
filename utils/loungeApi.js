/**
 * Lounge API utility functions for Discord bot
 * Updated for Mario Kart World lounge API
 */

const { DataManager } = require("discord.js");
const ServerData = require("./serverData");

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
		const serverData = await ServerData.getServerData(serverId);
		const user = serverData?.users?.[userId];
	    const maxTableId = Math.max(...(user?.tables || [0]));
		const tables = {};
		if (maxTableId !== 0) {
			for (const tableId of user.tables) {
				tables[tableId] = serverData.tables[tableId];
			}
		}
		const params = {
		    discordId: userId,
		    game: "mkworld",
		};
		for (let season = 0; season <= DEFAULT_SEASON; season++) {
		    params.season = season;
		    const details = await apiGet("/player/details", params);
		    const changes = details.mmrChanges.filter(c => c.reason === "Table" && c.changeId > maxTableId);
		    for (const change of changes) {
		    	tables[change.changeId] = await getTable(change.changeId);
		    }
		}
		return tables;

	}
    	catch (error) {
		if (error.message.includes("404")) {
			return {};
		}
		throw error;
	}
}

/**
 * Get player strikes/penalties
 * @param {string} name - Player name
 * @param {number} season - Season number (optional, defaults to current season)
 * @returns {Promise<Array>} Array of strikes/penalties
 */


module.exports = {
	getPlayer,
	getPlayerByDiscordId,
	getTable,
	getAllPlayerTables,
	DEFAULT_SEASON,
};