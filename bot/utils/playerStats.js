/**
 * Player statistics utility functions
 * Pure functions that calculate stats from table data without data fetching
 */

const database = require("./database");
const LoungeApi = require("./loungeApi");

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const RANK_SUFFIX_REGEX = /\s*(?:\d+|[ivxlcdm]+)$/i;

function normalizeRankName(name) {
	if (!name) {
		return "";
	}
	let normalized = String(name).trim().toLowerCase();
	while (RANK_SUFFIX_REGEX.test(normalized)) {
		normalized = normalized.replace(RANK_SUFFIX_REGEX, "");
	}
	return normalized;
}

const RANK_THRESHOLDS_12P = [
	{ key: "iron", label: "iron", text: "iron", min: 0, max: 2000, emoji: "⛏️" },
	{ key: "bronze", label: "bronze", text: "bronze", min: 2000, max: 4000, emoji: "🧸" },
	{ key: "silver", label: "silver", text: "silver", min: 4000, max: 6000, emoji: "💿" },
	{ key: "gold", label: "gold", text: "gold", min: 6000, max: 7500, emoji: "⭐" },
	{ key: "platinum", label: "platinum", text: "platinum", min: 7500, max: 9000, emoji: "🦚" },
	{ key: "sapphire", label: "sapphire", text: "sapphire", min: 9000, max: 10500, emoji: "🌊" },
	{ key: "ruby", label: "ruby", text: "ruby", min: 10500, max: 12000, emoji: "🍓" },
	{ key: "diamond", label: "diamond", text: "diamond", min: 12000, max: 13500, emoji: "💎" },
	{ key: "master", label: "master", text: "master", min: 13500, max: 14500, emoji: "🪻" },
	{ key: "grandmaster", label: "grandmaster", text: "grandmaster", min: 14500, max: Infinity, emoji: "🎸" },
];

const RANK_THRESHOLDS_24P = [
	{ key: "iron", label: "iron", text: "iron", min: 0, max: 2000, emoji: "⛏️" },
	{ key: "bronze", label: "bronze", text: "bronze", min: 2000, max: 4000, emoji: "🧸" },
	{ key: "silver", label: "silver", text: "silver", min: 4000, max: 6000, emoji: "💿" },
	{ key: "gold", label: "gold", text: "gold", min: 6000, max: 8000, emoji: "⭐" },
	{ key: "platinum", label: "platinum", text: "platinum", min: 8000, max: 10000, emoji: "🦚" },
	{ key: "sapphire", label: "sapphire", text: "sapphire", min: 10000, max: 11500, emoji: "🌊" },
	{ key: "ruby", label: "ruby", text: "ruby", min: 11500, max: 13000, emoji: "🍓" },
	{ key: "diamond", label: "diamond", text: "diamond", min: 13000, max: 14500, emoji: "💎" },
	{ key: "master", label: "master", text: "master", min: 14500, max: 15500, emoji: "🪻" },
	{ key: "grandmaster", label: "grandmaster", text: "grandmaster", min: 15500, max: Infinity, emoji: "🎸" },
];

const RANK_THRESHOLDS = RANK_THRESHOLDS_12P;

function createRankThresholdMap(thresholds) {
	return thresholds.reduce((map, tier) => {
		const aliases = [tier.key, tier.label, tier.text];
		for (const alias of aliases) {
			const normalized = normalizeRankName(alias);
			if (!normalized) {
				continue;
			}
			map[normalized] = tier;
		}
		return map;
	}, Object.create(null));
}

const RANK_THRESHOLD_MAP_12P = createRankThresholdMap(RANK_THRESHOLDS_12P);
const RANK_THRESHOLD_MAP_24P = createRankThresholdMap(RANK_THRESHOLDS_24P);
const RANK_THRESHOLD_MAP = RANK_THRESHOLD_MAP_12P;

const RANK_ICON_FILENAME_MAP = RANK_THRESHOLDS.reduce((map, tier) => {
	const aliases = [tier.key, tier.label, tier.text];
	const filename = `${tier.text}.png`;
	for (const alias of aliases) {
		const normalized = normalizeRankName(alias);
		if (!normalized) {
			continue;
		}
		if (!map[normalized]) {
			map[normalized] = filename;
		}
	}
	return map;
}, Object.create(null));

class PlayerStats {
	static getRankThresholds(mode = "12p") {
		if (mode === "24p" || mode === "mkworld24p") {
			return RANK_THRESHOLDS_24P;
		}
		return RANK_THRESHOLDS_12P;
	}

	static getRankThresholdByName(name, mode = "12p") {
		const normalized = normalizeRankName(name);
		const map = (mode === "24p" || mode === "mkworld24p") ? RANK_THRESHOLD_MAP_24P : RANK_THRESHOLD_MAP_12P;
		return normalized ? (map[normalized] || null) : null;
	}

	static getRankThresholdForMmr(mmr, mode = "12p") {
		const value = Number(mmr);
		if (!Number.isFinite(value)) {
			return null;
		}
		const thresholds = (mode === "24p" || mode === "mkworld24p") ? RANK_THRESHOLDS_24P : RANK_THRESHOLDS_12P;
		for (const tier of thresholds) {
			if (value >= tier.min && (value < tier.max || !Number.isFinite(tier.max))) {
				return tier;
			}
		}
		return thresholds[thresholds.length - 1] || null;
	}

	static getRankIconFilename(name, mode = "12p") {
		const normalized = normalizeRankName(name);
		if (normalized) {
			const direct = RANK_ICON_FILENAME_MAP[normalized];
			if (direct) {
				return direct;
			}
		}
		const tier = PlayerStats.getRankThresholdByName(name, mode);
		if (tier) {
			const normalizedTier = normalizeRankName(tier.label);
			return normalizedTier ? (RANK_ICON_FILENAME_MAP[normalizedTier] || null) : null;
		}
		return null;
	}

	static getRankIconFilenameForMmr(mmr, mode = "12p") {
		const tier = PlayerStats.getRankThresholdForMmr(mmr, mode);
		if (!tier) {
			return null;
		}
		const normalized = normalizeRankName(tier.label);
		return normalized ? (RANK_ICON_FILENAME_MAP[normalized] || null) : null;
	}

	static normalizeRankName(name) {
		return normalizeRankName(name);
	}

	static findColorForRank(colorMap, name) {
		if (!colorMap || typeof colorMap !== "object") {
			return null;
		}
		const normalized = normalizeRankName(name);
		if (!normalized) {
			return null;
		}
		for (const [key, value] of Object.entries(colorMap)) {
			if (normalizeRankName(key) === normalized) {
				return value;
			}
		}
		return null;
	}

	static resolveRankColor({ rankName = null, mmr = null, colorMap = null } = {}) {
		const map = colorMap || {};
		const colorFromName = PlayerStats.findColorForRank(map, rankName);
		if (colorFromName) {
			return colorFromName;
		}
		const tier = PlayerStats.getRankThresholdForMmr(mmr);
		if (tier) {
			return PlayerStats.findColorForRank(map, tier.label)
				|| PlayerStats.findColorForRank(map, tier.key)
				|| PlayerStats.findColorForRank(map, tier.text);
		}
		return null;
	}

	/**
	 * Normalize any identifier we might receive (Discord ID, lounge ID, etc.)
	 * @param {string|number|undefined|null} identifier
	 * @returns {string|null}
	 */
	static normalizeIdentifier(identifier) {
		if (identifier === null || identifier === undefined) {
			return null;
		}
		const normalized = String(identifier).trim();
		return normalized.length > 0 ? normalized : null;
	}

	/**
	 * Collect all identifiers that can reference the player.
	 * @param {Object} player
	 * @returns {Array<string>}
	 */
	static getPlayerIdentifiers(player) {
		const identifiers = [];
		if (!player || typeof player !== "object") {
			return identifiers;
		}
		const candidateKeys = [
			"playerDiscordId",
			"playerId",
			"discordId",
			"id",
		];
		for (const key of candidateKeys) {
			if (player[key] === undefined || player[key] === null) continue;
			const normalized = PlayerStats.normalizeIdentifier(player[key]);
			if (normalized) {
				identifiers.push(normalized);
			}
		}
		return Array.from(new Set(identifiers));
	}

	/**
	 * Determine if a player matches a given identifier (discord or lounge id).
	 * @param {Object} player
	 * @param {string|number} identifier
	 * @returns {boolean}
	 */
	static playerMatchesIdentifier(player, identifier) {
		const normalized = PlayerStats.normalizeIdentifier(identifier);
		if (!normalized) {
			return false;
		}
		const playerIds = PlayerStats.getPlayerIdentifiers(player);
		return playerIds.includes(normalized);
	}
	/**
	 * Get individual player rankings from a table, sorted by score
	 * @param {Object} table - Table object from the API
	 * @returns {Array} Array of players with rankings, sorted by score (highest first)
	 */
	static getIndividualPlayerRankings(table) {

		const allPlayers = PlayerStats.getPlayersFromTable(table);

		// Sort by score (highest first)
		allPlayers.sort((a, b) => b.score - a.score);

		// Add individual rankings
		let currentRank = 1;
		let previousScore = null;
		let playersWithSameScore = 0;

		return allPlayers.map((player, index) => {
			// Handle ties - players with same score get same rank
			if (previousScore !== null && player.score < previousScore) {
				currentRank = index + 1;
				playersWithSameScore = 0;
			}
			else if (previousScore !== null && player.score === previousScore) {
				playersWithSameScore++;
			}

			previousScore = player.score;

			return {
				...player,
				individualRank: currentRank,
				isTied: playersWithSameScore > 0,
			};
		});
	}

	static getIndividualPlayerSeeds(table) {
		const allPlayers = PlayerStats.getPlayersFromTable(table);

		allPlayers.sort((a, b) => b.prevMmr - a.prevMmr);

		return allPlayers.map((player, index) => {
			return {
				...player,
				individualSeed: index + 1,
			};
		});
	}

	/**
	 * Get a specific player's individual ranking from a table
	 * @param {Object} table - Table object from the API
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Player object with ranking info, or null if not found
	 */
	static getPlayerRankingInTable(table, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}
		const rankings = PlayerStats.getIndividualPlayerRankings(table);
		return rankings.find(player =>
			PlayerStats.playerMatchesIdentifier(player, normalizedId),
		) || null;
	}

	/**
	 * Get all players from a table with team information
	 * @param {Object} table - Table object from the API
	 * @returns {Array} Array of all players with team info
	 */
	static getPlayersFromTable(table) {
		if (!table || !table.teams) {
			return [];
		}

		const allPlayers = [];

		table.teams.forEach((team, teamIndex) => {
			team.scores.forEach(player => {
				allPlayers.push({
					...player,
					teamRank: team.rank,
					teamIndex: teamIndex + 1,
				});
			});
		});

		return allPlayers;
	}

	static getTotalMmrDeltaFromTables(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return 0;
		}
		if (!tables || typeof tables !== "object") {
			return 0;
		}

		let totalDelta = 0;
		for (const tableKey of Object.keys(tables)) {
			const table = tables[tableKey];
			if (!table) continue;

			const players = PlayerStats.getPlayersFromTable(table);
			for (const player of players) {
				if (!PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					continue;
				}
				const prevMmr = Number(player.prevMmr);
				const newMmr = Number(player.newMmr);
				const fallbackDelta = Number.isFinite(prevMmr) && Number.isFinite(newMmr)
					? newMmr - prevMmr
					: null;
				const delta = Number(player.delta ?? player.mmrDelta ?? fallbackDelta);
				if (Number.isFinite(delta)) {
					totalDelta += delta;
				}
				break;
			}
		}

		return totalDelta;
	}

	static computeMmrDeltaForFilter({
		playerDetails = null,
		mmrChanges: mmrChangesOverride = null,
		tableIds = null,
		timeFilter = "alltime",
		queueFilter = "both",
		playerCountFilter = "both",
		now = Date.now(),
	} = {}) {
		let changes = Array.isArray(mmrChangesOverride)
			? mmrChangesOverride
			: Array.isArray(playerDetails?.mmrChanges)
				? [...playerDetails.mmrChanges]
				: [];

		// If we are looking at "both" counts, we must also include changes from the alternate mode
		if (playerCountFilter === "both" && playerDetails?.alternateDetails?.mmrChanges) {
			changes = changes.concat(playerDetails.alternateDetails.mmrChanges);
		}

		if (!changes.length) {
			return 0;
		}

		// When calculating season delta with NO specific queue/count filters, we sum everything.
		// However, if we have specific filters (like "soloq" or "squads"), we MUST rely on table filtering.
		const includeAllSeason = timeFilter === "season"
			&& queueFilter === "both"
			&& playerCountFilter === "both";

		if (includeAllSeason) {
			let seasonDelta = 0;
			for (const change of changes) {
				if (!change) continue;
				const delta = Number(change.mmrDelta ?? change.delta);
				if (!Number.isFinite(delta)) continue;
				seasonDelta += delta;
			}
			return seasonDelta;
		}

		const tableIdSet = new Set();
		if (Array.isArray(tableIds)) {
			for (const id of tableIds) {
				if (id === null || id === undefined) continue;
				tableIdSet.add(String(id));
			}
		}

		const includeNonTableWeekly = timeFilter === "weekly"
			&& queueFilter === "both"
			&& playerCountFilter === "both";
		const weeklyCutoffMs = includeNonTableWeekly ? now - ONE_WEEK_MS : null;

		let totalDelta = 0;
		for (const change of changes) {
			if (!change) continue;
			const delta = Number(change.mmrDelta ?? change.delta);
			if (!Number.isFinite(delta)) continue;

			const rawTableId = change.tableId ?? change.changeId;
			const changeTableId = rawTableId != null ? String(rawTableId) : null;
			let include = false;
			if (changeTableId && tableIdSet.has(changeTableId)) {
				include = true;
			}
			else if (includeNonTableWeekly) {
				const timestampRaw = change.time ?? change.createdOn ?? change.updatedOn ?? change.date;
				const changeTimeMs = timestampRaw ? Date.parse(timestampRaw) : NaN;
				if (!Number.isNaN(changeTimeMs) && weeklyCutoffMs !== null && changeTimeMs >= weeklyCutoffMs) {
					include = true;
				}
			}

			if (include) {
				totalDelta += delta;
			}
		}

		return totalDelta;
	}

	static filterTablesByControls(tables, { timeFilter = "alltime", queueFilter = "both", playerCountFilter = "both", currentSeason = undefined } = {}) {
		let filtered = tables || {};
		if (!filtered || typeof filtered !== "object") {
			return {};
		}

		const seasonNum = currentSeason || LoungeApi.DEFAULT_SEASON;

		if (timeFilter === "weekly") {
			filtered = PlayerStats.filterTablesByWeek(filtered, true);
		}
		else if (timeFilter === "season") {
			filtered = PlayerStats.filterTablesBySeason(filtered, true, seasonNum);
		}

		if (queueFilter === "squads") {
			filtered = Object.fromEntries(
				Object.entries(filtered).filter(([, table]) => table?.tier === "SQ"),
			);
		}
		else if (queueFilter === "soloq") {
			filtered = Object.fromEntries(
				Object.entries(filtered).filter(([, table]) => table?.tier !== "SQ"),
			);
		}

		if (playerCountFilter !== "both") {
			const desiredCount = playerCountFilter === "12p" || playerCountFilter === "mkworld12p" ? 12 : 24;
			const targetMode = playerCountFilter === "12p" ? "mkworld12p" : (playerCountFilter === "24p" ? "mkworld24p" : playerCountFilter);

			filtered = Object.fromEntries(
				Object.entries(filtered).filter(([, table]) => {
					// If table has gameMode info, use it
					if (table.gameMode || table.game) {
						const mode = table.gameMode || table.game;
						if (mode === targetMode) return true;
						if (mode === "mkworld12p" && desiredCount === 12) return true;
						if (mode === "mkworld24p" && desiredCount === 24) return true;
						// If mode doesn't match, check legacy numPlayers
					}

					const rawValue = table?.numPlayers ?? table?.numplayers ?? table?.playerCount;
					const playerCount = Number(rawValue);
					if (!Number.isFinite(playerCount)) {
						return false;
					}
					return playerCount === desiredCount;
				}),
			);
		}

		return filtered;
	}

	static computeAverageRoomMmr(tables) {
		if (!tables || typeof tables !== "object") {
			return null;
		}

		let total = 0;
		let count = 0;

		for (const table of Object.values(tables)) {
			if (!table) continue;
			const teams = Array.isArray(table.teams) ? table.teams : [];
			for (const team of teams) {
				const scores = Array.isArray(team?.scores) ? team.scores : [];
				for (const score of scores) {
					const prev = Number(score?.prevMmr);
					if (!Number.isFinite(prev)) {
						continue;
					}
					total += prev;
					count += 1;
				}
			}
		}

		if (!count) {
			return null;
		}

		return total / count;
	}

	/**
	 * Calculate number of matches played by a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player
	 * @returns {number} Number of matches played
	 */
	static getMatchesPlayed(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return 0;
		}
		let matches = 0;
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					matches++;
					// Found player in this table, move to next table
					break;
				}
			}

		}
		return matches;
	}

	static getAveragePlayerCount(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return 0;
		}
		let matches = 0;
		let numPlayers = 0;
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					numPlayers += table.numPlayers;
					matches++;
					// Found player in this table, move to next table
					break;
				}
			}

		}
		return numPlayers / matches;
	}

	static getPlayerCountBreakdown(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId || !tables || typeof tables !== "object") {
			return { "12p": 0, "24p": 0 };
		}

		let twelve = 0;
		let twentyFour = 0;

		for (const table of Object.values(tables)) {
			if (!table || !Array.isArray(table.teams)) continue;
			const players = PlayerStats.getPlayersFromTable(table);
			const participates = players.some(player => PlayerStats.playerMatchesIdentifier(player, normalizedId));
			if (!participates) continue;

			if (table.numPlayers === 12) {
				twelve++;
			}
			else {
				twentyFour++;
			}
		}

		return { "12p": twelve, "24p": twentyFour };
	}

	/**
	 * Calculate win rate for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player
	 * @returns {Object} contains win rate, total wins, total losses
	 */
	static getWinRate(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return -1;
		}
		let wins = 0;
		let losses = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					if (player.delta > 0) {
						wins++;
					}
					else if (player.delta < 0) {
						losses++;
					}
					// Found player in this table, move to next table
					break;
				}
			}

		}

		if (wins + losses === 0) return -1;
		return {
			winRate: wins / (wins + losses),
			wins,
			losses,
		};
	}

	/**
	 * Calculate average placement for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player
	 * @returns {number} Average placement or -1 if no matches played
	 */
	static getAveragePlacement(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return -1;
		}
		let totalPlacement = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);
			if (playerRanking) {
				totalPlacement += playerRanking.individualRank;
				matchesFound++;
			}
		}

		if (matchesFound === 0) return -1;
		return totalPlacement / matchesFound;
	}

	static getAverageScore(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return -1;
		}
		let totalScore = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;
			const players = PlayerStats.getPlayersFromTable(table);
			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					totalScore += player.score;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalScore / matchesFound;
	}

	static getAverageSeed(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return -1;
		}
		let totalSeed = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getIndividualPlayerSeeds(table);
			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					totalSeed += player.individualSeed;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalSeed / matchesFound;
	}

	/*
	// Deprecated: We no longer track server-specific user lists.
	static async checkIfServerTable(userIdentifier, table, serverId) {
		if (!serverId) {
			return false;
		}
		const serverData = await database.getServerData(serverId);
		if (!serverData?.users) {
			return false;
		}
		const normalizedUserId = PlayerStats.normalizeIdentifier(userIdentifier);
		const playersTable = PlayerStats.getPlayersFromTable(table);
		for (const [serverUserId, serverUser] of Object.entries(serverData.users)) {
			const normalizedServerUserId = PlayerStats.normalizeIdentifier(serverUserId);
			if (!normalizedServerUserId || normalizedServerUserId === normalizedUserId) {
				continue;
			}
			const discordIds = Array.isArray(serverUser?.discordIds) ? serverUser.discordIds : [];
			const hasServerMember = playersTable.some(player => {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedServerUserId)) {
					return true;
				}
				return discordIds.some(discordId => PlayerStats.playerMatchesIdentifier(player, discordId));
			});
			if (hasServerMember) {
				return true;
			}
		}
		return false;
	}
	*/

	static async getH2HTables(source, otherIdentifier, serverId = null) {
		if (source && typeof source === "object" && !Array.isArray(source)) {
			const normalizedOpponent = PlayerStats.normalizeIdentifier(otherIdentifier);
			if (!normalizedOpponent) {
				return {};
			}
			const entries = source instanceof Map ? Array.from(source.entries()) : Object.entries(source);
			const sharedTables = {};
			for (const [tableId, table] of entries) {
				if (!table) continue;
				const players = PlayerStats.getPlayersFromTable(table);
				const hasOpponent = players.some((player) => PlayerStats.playerMatchesIdentifier(player, normalizedOpponent));
				if (hasOpponent) {
					sharedTables[tableId] = table;
				}
			}
			return sharedTables;
		}

		const normalizedUser1 = PlayerStats.normalizeIdentifier(source);
		const normalizedUser2 = PlayerStats.normalizeIdentifier(otherIdentifier);
		if (!normalizedUser1 || !normalizedUser2) {
			return {};
		}
		const tables = {};
		const userTables = await database.getUserTables(normalizedUser1);

		for (const userTable of userTables) {
			const table = await database.getTable(userTable.id);
			if (!table) continue;

			const playersTable = PlayerStats.getPlayersFromTable(table);
			for (const player of playersTable) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedUser2)) {
					tables[userTable.id] = table;
				}
			}
		}
		return tables;
	}

	/*
	// Deprecated: We no longer track server-specific user lists.
	static async getTotalH2H(tables, playerIdentifier, serverId, serverDataOverride = null) {
		const normalizedTargetId = PlayerStats.normalizeIdentifier(playerIdentifier);
		const record = {
			wins: 0,
			losses: 0,
			ties: 0,
		};
		if (!normalizedTargetId) {
			return record;
		}
		const serverData = serverDataOverride || await database.getServerData(serverId);
		if (!serverData?.users) {
			return record;
		}
		const serverMembers = Object.entries(serverData.users).map(([loungeId, user]) => ({
			loungeId: PlayerStats.normalizeIdentifier(loungeId),
			discordIds: Array.isArray(user?.discordIds) ? user.discordIds.map(id => PlayerStats.normalizeIdentifier(id)).filter(Boolean) : [],
		}));
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table) continue;
			const players = PlayerStats.getPlayersFromTable(table);
			const targetRanking = PlayerStats.getPlayerRankingInTable(table, normalizedTargetId);
			if (!targetRanking) {
				continue;
			}
			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedTargetId)) {
					continue;
				}
				const isServerMember = serverMembers.some(member => {
					if (member.loungeId && PlayerStats.playerMatchesIdentifier(player, member.loungeId)) {
						return true;
					}
					return member.discordIds.some(discordId => PlayerStats.playerMatchesIdentifier(player, discordId));
				});
				if (!isServerMember) {
					continue;
				}
				const opponentId = player.playerDiscordId ?? player.playerId ?? player.id;
				const opponentRanking = PlayerStats.getPlayerRankingInTable(table, opponentId);
				if (!opponentRanking) {
					continue;
				}
				if (targetRanking.individualRank < opponentRanking.individualRank) {
					record.wins++;
				}
				else if (targetRanking.individualRank > opponentRanking.individualRank) {
					record.losses++;
				}
				else {
					record.ties++;
				}
			}
		}
		return record;
	}
	*/

	/**
	 * Get head-to-head record between two specific players across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} player1Id - Discord or lounge ID of the first player
	 * @param {string|number} player2Id - Discord or lounge ID of the second player
	 * @returns {Object} Record object with {wins, losses, ties} from player1's perspective
	 */
	static getH2H(tables, player1Id, player2Id) {
		const record = {
			wins: 0,
			losses: 0,
			ties: 0,
		};
		const normalizedPlayer1Id = PlayerStats.normalizeIdentifier(player1Id);
		const normalizedPlayer2Id = PlayerStats.normalizeIdentifier(player2Id);
		if (!normalizedPlayer1Id || !normalizedPlayer2Id) {
			return record;
		}

		// Return empty record if same player
		if (normalizedPlayer1Id === normalizedPlayer2Id) {
			return record;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, normalizedPlayer1Id);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, normalizedPlayer2Id);

			// Skip table if either player isn't found
			if (!player1Ranking || !player2Ranking) {
				continue;
			}

			// Compare individual rankings (lower rank number = better placement)
			if (player1Ranking.individualRank < player2Ranking.individualRank) {
				record.wins++;
			}
			else if (player1Ranking.individualRank > player2Ranking.individualRank) {
				record.losses++;
			}
			else {
				record.ties++;
			}
		}

		return record;
	}

	/**
	 * Get the biggest score difference where the first player beat the second player
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} player1Id - Discord or lounge ID of the first player
	 * @param {string|number} player2Id - Discord or lounge ID of the second player
	 * @returns {Object|null} Object with {tableId, player1Score, scoreDifference, player1Rank, rankDifference} or null if player1 never beat player2
	 */
	static getBiggestDifference(tables, player1Id, player2Id) {
		let biggestDifference = null;
		let bestResult = null;
		const normalizedPlayer1Id = PlayerStats.normalizeIdentifier(player1Id);
		const normalizedPlayer2Id = PlayerStats.normalizeIdentifier(player2Id);
		if (!normalizedPlayer1Id || !normalizedPlayer2Id) {
			return null;
		}

		// Return null if same player
		if (normalizedPlayer1Id === normalizedPlayer2Id) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, normalizedPlayer1Id);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, normalizedPlayer2Id);

			// Skip table if either player isn't found
			if (!player1Ranking || !player2Ranking) {
				continue;
			}

			// Only consider tables where player1 beat player2 (lower rank = better)
			if (player1Ranking.individualRank >= player2Ranking.individualRank) {
				continue;
			}

			// Calculate differences
			const scoreDifference = player1Ranking.score - player2Ranking.score;
			const rankDifference = player2Ranking.individualRank - player1Ranking.individualRank;

			// Check if this is the biggest score difference
			// Tiebreak by rank difference (bigger rank gap wins tiebreak)
			const isBetter = biggestDifference === null ||
				scoreDifference > biggestDifference ||
				(scoreDifference === biggestDifference && rankDifference > bestResult.rankDifference);

			if (isBetter) {
				biggestDifference = scoreDifference;
				bestResult = {
					tableId: table.id,
					player1Score: player1Ranking.score,
					scoreDifference: scoreDifference,
					player1Rank: player1Ranking.individualRank,
					player2Rank: player2Ranking.individualRank,
					rankDifference: rankDifference,
				};
			}
		}

		return bestResult;
	}

	/**
	 * Compute the average teammate score for non-FFA tables the player participated in
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Player identifier to match against
	 * @returns {Object|null} Object with { average, teammateSamples, tableCount } or null if insufficient data
	 */
	static getPartnerAverage(tables, playerIdentifier) {
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId || !tables || typeof tables !== "object") {
			return null;
		}

		let totalScore = 0;
		let teammateSamples = 0;
		let tableCount = 0;
		let twelve = 0;
		let twentyFour = 0;

		for (const tableId of Object.keys(tables)) {
			const table = tables[tableId];
			if (!table || !Array.isArray(table.teams) || !table.teams.length) {
				continue;
			}
			const format = typeof table.format === "string" ? table.format.trim().toLowerCase() : "";
			if (format === "ffa") {
				continue; // skip free-for-all events
			}

			let matchingTeam = null;
			for (const team of table.teams) {
				if (!team || !Array.isArray(team.scores)) {
					continue;
				}
				if (team.scores.some(player => PlayerStats.playerMatchesIdentifier(player, normalizedId))) {
					matchingTeam = team;
					break;
				}
			}
			if (!matchingTeam) {
				continue;
			}

			let tableContributed = false;
			for (const teammate of matchingTeam.scores || []) {
				if (PlayerStats.playerMatchesIdentifier(teammate, normalizedId)) {
					continue;
				}
				const rawScore = teammate?.score ?? teammate?.points ?? teammate?.total;
				const score = Number(rawScore);
				if (!Number.isFinite(score)) {
					continue;
				}
				totalScore += score;
				teammateSamples++;
				tableContributed = true;
			}

			if (tableContributed) {
				tableCount++;
				if (table.numPlayers == 12) {
					twelve++;
				}
				if (table.numPlayers == 24) {
					twentyFour++;
				}
			}
		}

		if (!teammateSamples) {
			return null;
		}

		const roomAverage = (82 * twelve + 72 * twentyFour) / tableCount;
		let roomAverageFixed = parseFloat(roomAverage.toFixed(Number.isInteger(roomAverage) ? 0 : 1));
		roomAverageFixed = roomAverageFixed.toFixed(Number.isInteger(roomAverageFixed) ? 0 : 1);

		return {
			average: totalScore / teammateSamples,
			roomAverageFixed,
		};
	}

	/**
	 * Get a player's best (highest) score across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getBestScore(tables, playerIdentifier) {
		let bestScore = null;
		let bestResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);

			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					if (bestScore === null || player.score > bestScore) {
						bestScore = player.score;
						bestResult = {
							score: player.score,
							placement: playerRanking ? playerRanking.individualRank : null,
							tableId: table.id,
						};
					}
					break;
				}
			}
		}

		return bestResult;
	}

	/**
	 * Get a player's worst (lowest) score across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getWorstScore(tables, playerIdentifier) {
		let worstScore = null;
		let worstResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);

			for (const player of players) {
				if (PlayerStats.playerMatchesIdentifier(player, normalizedId)) {
					if (worstScore === null || player.score < worstScore) {
						worstScore = player.score;
						worstResult = {
							score: player.score,
							placement: playerRanking ? playerRanking.individualRank : null,
							tableId: table.id,
						};
					}
					break;
				}
			}
		}

		return worstResult;
	}

	/**
	 * Get a player's biggest overperformance (seed minus ranking, higher is better)
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, overperformance} or null
	 */
	static getBiggestOverperformance(tables, playerIdentifier) {
		let bestOverperformance = null;
		let bestResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);
			const playerSeed = seeds.find(p => PlayerStats.playerMatchesIdentifier(p, normalizedId));

			if (playerRanking && playerSeed) {
				const overperformance = playerSeed.individualSeed - playerRanking.individualRank;
				const playerCountRaw = table?.numPlayers ?? table?.numplayers ?? table?.playerCount;
				const playerCount = Number.isFinite(Number(playerCountRaw)) ? Number(playerCountRaw) : null;
				const normalizedOverperformance = playerCount && playerCount > 0
					? overperformance / playerCount
					: overperformance;

				// Check if this is the best overperformance (higher is better)
				// Tiebreak by score (higher score wins tiebreak)
				const isBetter = bestOverperformance === null ||
					normalizedOverperformance > bestOverperformance ||
					(normalizedOverperformance === bestOverperformance && (
						overperformance > bestResult.overperformance ||
						(overperformance === bestResult.overperformance && playerRanking.score > bestResult.score)
					));

				if (isBetter) {
					bestOverperformance = normalizedOverperformance;
					bestResult = {
						tableId: table.id,
						score: playerRanking.score,
						placement: playerRanking.individualRank,
						overperformance: overperformance,
						normalizedOverperformance,
						playerCount: playerCount,
					};
				}
			}
		}

		return bestResult;
	}

	/**
	 * Get a player's biggest underperformance (seed minus ranking, lower is worse)
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, underperformance} or null
	 */
	static getBiggestUnderperformance(tables, playerIdentifier) {
		let worstUnderperformance = null;
		let worstResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);
			const playerSeed = seeds.find(p => PlayerStats.playerMatchesIdentifier(p, normalizedId));

			if (playerRanking && playerSeed) {
				const underperformance = playerSeed.individualSeed - playerRanking.individualRank;
				const playerCountRaw = table?.numPlayers ?? table?.numplayers ?? table?.playerCount;
				const playerCount = Number.isFinite(Number(playerCountRaw)) ? Number(playerCountRaw) : null;
				const normalizedUnderperformance = playerCount && playerCount > 0
					? underperformance / playerCount
					: underperformance;

				// Check if this is the worst underperformance (lower/negative is worse)
				// Tiebreak by score (lower score loses tiebreak)
				const isWorse = worstUnderperformance === null ||
					normalizedUnderperformance < worstUnderperformance ||
					(normalizedUnderperformance === worstUnderperformance && (
						underperformance < worstResult.underperformance ||
						(underperformance === worstResult.underperformance && playerRanking.score < worstResult.score)
					));

				if (isWorse) {
					worstUnderperformance = normalizedUnderperformance;
					worstResult = {
						tableId: table.id,
						score: playerRanking.score,
						placement: playerRanking.individualRank,
						underperformance: underperformance,
						normalizedUnderperformance,
						playerCount: playerCount,
					};
				}
			}
		}

		return worstResult;
	}

	/**
	 * Get when a player carried their team the most (best performance relative to teammates)
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, carryAmount} or null
	 */
	static getBiggestCarry(tables, playerIdentifier) {
		let bestCarry = null;
		let bestResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => PlayerStats.playerMatchesIdentifier(p, normalizedId));
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				!PlayerStats.playerMatchesIdentifier(p, normalizedId) &&
				players.find(player => PlayerStats.playerMatchesIdentifier(player, p.playerDiscordId ?? p.playerId ?? p.id))?.teamIndex === targetPlayer.teamIndex,
			);

			// Skip if no teammates (not a team event)
			if (teammates.length === 0) continue;

			// Calculate average teammate score
			const teammateAvgScore = teammates.reduce((sum, teammate) => sum + teammate.score, 0) / teammates.length;
			const carryAmount = playerRanking.score - teammateAvgScore;

			// Check if this is the biggest carry (higher is better)
			// Tiebreak by score (higher score wins tiebreak)
			const isBetter = bestCarry === null ||
				carryAmount > bestCarry ||
				(carryAmount === bestCarry && playerRanking.score > bestResult.score);

			if (isBetter) {
				bestCarry = carryAmount;
				bestResult = {
					tableId: table.id,
					score: playerRanking.score,
					placement: playerRanking.individualRank,
					carryAmount: carryAmount,
				};
			}
		}

		return bestResult;
	}

	/**
	 * Get when a player anchored their team the most (worst performance relative to teammates)
	 * @param {Object} tables - Object containing table data
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, anchorAmount} or null
	 */
	static getBiggestAnchor(tables, playerIdentifier) {
		let worstAnchor = null;
		let worstResult = null;
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);
			const playerRanking = PlayerStats.getPlayerRankingInTable(table, normalizedId);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => PlayerStats.playerMatchesIdentifier(p, normalizedId));
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				!PlayerStats.playerMatchesIdentifier(p, normalizedId) &&
				players.find(player => PlayerStats.playerMatchesIdentifier(player, p.playerDiscordId ?? p.playerId ?? p.id))?.teamIndex === targetPlayer.teamIndex,
			);

			// Skip if no teammates (not a team event)
			if (teammates.length === 0) continue;

			// Calculate average teammate score
			const teammateAvgScore = teammates.reduce((sum, teammate) => sum + teammate.score, 0) / teammates.length;
			const anchorAmount = playerRanking.score - teammateAvgScore;

			// Check if this is the biggest anchor (lower/negative is worse)
			// Tiebreak by score (lower score loses tiebreak)
			const isWorse = worstAnchor === null ||
				anchorAmount < worstAnchor ||
				(anchorAmount === worstAnchor && playerRanking.score < worstResult.score);

			if (isWorse) {
				worstAnchor = anchorAmount;
				worstResult = {
					tableId: table.id,
					score: playerRanking.score,
					placement: playerRanking.individualRank,
					anchorAmount: anchorAmount,
				};
			}
		}

		return worstResult;
	}

	/**
	 * Filter tables to only include those from the past week
	 * @param {Object} tables - Object of tables indexed by tableId
	 * @param {boolean} weeklyOnly - Whether to filter to past week only
	 * @returns {Object} Filtered tables object
	 */
	static filterTablesByWeek(tables, weeklyOnly = false) {
		if (!weeklyOnly) return tables;

		const oneWeekAgo = new Date();
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.createdOn) {
				const tableDate = new Date(table.createdOn);
				if (tableDate >= oneWeekAgo) {
					filtered[tableId] = table;
				}
			}
		}
		return filtered;
	}

	/**
	 * Filter tables to only include those from the current season
	 * @param {Object} tables - Object of tables indexed by tableId
	 * @param {boolean} seasonOnly - Whether to filter to current season only
	 * @param {number} currentSeason - The current season number (defaults to 1)
	 * @returns {Object} Filtered tables object
	 */
	static filterTablesBySeason(tables, seasonOnly = false, currentSeason = 1) {
		if (!seasonOnly) return tables;

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.season === currentSeason) {
				filtered[tableId] = table;
			}
		}
		return filtered;
	}

	/**
	 * Calculate win streaks for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string|number} playerIdentifier - Discord or lounge ID of the player
	 * @returns {Object} Streak data including current and longest streaks
	 */
	static calculateWinStreaks(tables, playerIdentifier) {
		const playerTables = [];
		const normalizedId = PlayerStats.normalizeIdentifier(playerIdentifier);
		if (!normalizedId) {
			return {
				currentWinStreak: 0,
				currentStreakMmrGain: 0,
				longestWinStreak: 0,
				longestStreakMmrGain: 0,
				longestStreakStart: null,
				longestStreakEnd: null,
			};
		}

		// Collect all tables where player participated
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams || !table.createdOn) continue;

			// Find player in this table
			let playerData = null;
			for (const team of table.teams) {
				const player = team.scores.find(p =>
					PlayerStats.playerMatchesIdentifier(p, normalizedId),
				);
				if (player) {
					playerData = {
						...player,
						rank: team.rank,
						date: new Date(table.createdOn),
						tableId: parseInt(tableId),
					};
					break;
				}
			}

			if (playerData) {
				playerTables.push(playerData);
			}
		}

		// Sort by date (oldest first)
		playerTables.sort((a, b) => a.date - b.date);

		if (playerTables.length === 0) {
			return {
				currentWinStreak: 0,
				currentStreakMmrGain: 0,
				longestWinStreak: 0,
				longestStreakMmrGain: 0,
				longestStreakStart: null,
				longestStreakEnd: null,
			};
		}

		let currentStreak = 0;
		let currentStreakMmr = 0;
		let longestStreak = 0;
		let longestStreakMmr = 0;
		let longestStreakStart = null;
		let longestStreakEnd = null;
		let currentStreakStart = null;

		// Track streaks going through tables chronologically
		for (let i = 0; i < playerTables.length; i++) {
			const table = playerTables[i];
			const isWin = table.rank === 1;

			if (isWin) {
				if (currentStreak === 0) {
					currentStreakStart = table.date;
				}
				currentStreak++;
				currentStreakMmr += table.delta || 0;

				// Check if this is our new longest streak
				if (currentStreak > longestStreak) {
					longestStreak = currentStreak;
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
				else if (currentStreak === longestStreak && currentStreakMmr > longestStreakMmr) {
					// Same length but more MMR gained
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
			}
			else {
				// Streak broken
				currentStreak = 0;
				currentStreakMmr = 0;
				currentStreakStart = null;
			}
		}

		return {
			currentWinStreak: currentStreak,
			currentStreakMmrGain: currentStreakMmr,
			longestWinStreak: longestStreak,
			longestStreakMmrGain: longestStreakMmr,
			longestStreakStart: longestStreakStart,
			longestStreakEnd: longestStreakEnd,
		};
	}
	static mmrToRankEmojiAndText(mmr) {
		const tier = PlayerStats.getRankThresholdForMmr(mmr) || RANK_THRESHOLDS[0];
		return {
			emoji: tier?.emoji || "⛏️",
			text: tier?.text || "iron",
		};
	}
}

module.exports = PlayerStats;