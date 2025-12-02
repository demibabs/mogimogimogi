const {
	SlashCommandBuilder,
	AttachmentBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require("discord.js");
const { createCanvas, loadImage } = require("canvas");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const DataManager = require("../../utils/dataManager");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");
const ColorPalettes = require("../../utils/colorPalettes");
const GameData = require("../../utils/gameData");
const resolveTargetPlayer = require("../../utils/playerResolver");
const {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
} = require("../../utils/cacheManager");

const {
	getPlayerAvatarUrl,
	drawRoundedPanel,
	drawRoundedImage,
	drawEmoji,
	loadWebPAsPng,
	getCountryFlag,
	drawInlineImage,
	drawTextWithEmojis,
	loadFavoriteCharacterImage,
	loadFavoriteVehicleImage,
} = EmbedEnhancer;

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const EDGE_RADIUS = 30;
const LAYOUT = {
	pagePadding: 80,
	headerHeight: 110,
	headerSubtitleGap: 14,
	headerEmojiSize: 56,
	headerEmojiGap: 18,
	headerAvatarSize: 92,
	headerAvatarRadius: 24,
	headerFavoriteMaxSize: 90,
	headerAssetOffsetX: 25,
	headerAssetGap: 24,
	headerTextAdjustmentY: -4,
	sectionGap: 22,
	tablePadding: 36,
	tableHeaderHeight: 68,
	tableRowMinHeight: 42,
	tableRowMaxHeight: 120,
	footerHeight: 180,
	footerGap: 26,
	footerFontSize: 34,
	footerSubFontSize: 26,
};

const DEFAULT_TRACK_NAME = ColorPalettes.currentTrackName || "RR";
const RANK_THRESHOLDS = PlayerStats.getRankThresholds();
const RANK_ORDER_INDEX = new Map(RANK_THRESHOLDS.map((tier, index) => [tier.key, index]));
const UNKNOWN_RANK_KEY = "unknown";
const DEFAULT_RANK_STATS_COLORS = {
	baseColor: "#2f3f5eea",
	chartColor1: "#3d5179ea",
	chartColor2: "#212d43ea",
	headerColor: "#d6d6e8ff",
	statsTextColor: "#e9f0ffff",
};
const FOOTER_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function applyOpacity(hexColor, alphaHex = "ff") {
	if (typeof hexColor !== "string" || !hexColor.startsWith("#")) {
		return hexColor;
	}
	const normalized = hexColor.slice(1);
	if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(normalized)) {
		return hexColor;
	}
	const base = normalized.slice(0, 6);
	const alpha = /^[0-9a-f]{2}$/i.test(alphaHex) ? alphaHex : "ff";
	return `#${base}${alpha.toLowerCase()}`;
}

function buildRankStatsPalette(trackName) {
	const source = ColorPalettes.rankStatsTrackColors?.[trackName] || DEFAULT_RANK_STATS_COLORS;
	const baseColor = source.baseColor || DEFAULT_RANK_STATS_COLORS.baseColor;
	const chartColor1 = source.chartColor1 || source.baseColor || DEFAULT_RANK_STATS_COLORS.chartColor1;
	const chartColor2 = source.chartColor2 || chartColor1 || baseColor;
	const headerColor = source.headerColor || DEFAULT_RANK_STATS_COLORS.headerColor;
	const statsTextColor = source.statsTextColor || DEFAULT_RANK_STATS_COLORS.statsTextColor;

	return {
		backgroundColor: baseColor,
		headerPanelColor: baseColor,
		tableRowColor: chartColor2,
		tableRowStripeColor: chartColor1,
		tableBorderColor: chartColor1,
		panelBorderColor: chartColor2,
		headerTextColor: headerColor,
		subheaderTextColor: applyOpacity(headerColor, "cc"),
		tableTextColor: statsTextColor,
		tableSubTextColor: applyOpacity(statsTextColor, "cc"),
		statsTextColor,
	};
}

function isValidRankStatsTrack(trackName) {
	return Boolean(trackName && ColorPalettes.rankStatsTrackColors?.[trackName]);
}

function getRandomRankStatsTrack() {
	if (typeof GameData?.getRandomTrack === "function") {
		const random = GameData.getRandomTrack();
		if (isValidRankStatsTrack(random)) {
			return random;
		}
	}
	const trackKeys = Object.keys(ColorPalettes.rankStatsTrackColors || {});
	if (trackKeys.length) {
		return trackKeys[Math.floor(Math.random() * trackKeys.length)];
	}
	return DEFAULT_TRACK_NAME;
}

async function resolveRankStatsTrackName(loungeId, sessionTrackName) {
	if (isValidRankStatsTrack(sessionTrackName)) {
		return sessionTrackName;
	}
	try {
		const userData = await Database.getUserData(loungeId);
		const favoriteTrack = userData?.favorites?.track;
		if (isValidRankStatsTrack(favoriteTrack)) {
			return favoriteTrack;
		}
	}
	catch (error) {
		console.warn(`rank-stats: failed to load favorites for ${loungeId}:`, error);
	}
	return getRandomRankStatsTrack();
}

async function loadImageResource(resource, label = null) {
	if (!resource) {
		return null;
	}
	try {
		return await loadImage(resource);
	}
	catch (error) {
		const descriptor = label || resource;
		console.warn(`rank-stats: failed to load image ${descriptor}:`, error);
		return null;
	}
}

const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FILTERS = {
	timeFilter: "alltime",
	queueFilter: "both",
	playerCountFilter: "both",
};

const FILTER_OPTIONS = {
	timeFilter: new Set(["alltime", "weekly", "season"]),
	queueFilter: new Set(["soloq", "squads", "both"]),
	playerCountFilter: new Set(["12p", "24p", "both"]),
};

function normalizeRankStatsFilters(filters = {}) {
	const normalized = {
		...DEFAULT_FILTERS,
	};
	for (const key of Object.keys(FILTER_OPTIONS)) {
		const rawValue = filters[key];
		if (!rawValue) {
			continue;
		}
		const safeValue = String(rawValue).toLowerCase();
		if (FILTER_OPTIONS[key].has(safeValue)) {
			normalized[key] = safeValue;
		}
	}
	return normalized;
}

const rankStatsSessionCache = new Map();
const rankStatsSessionExpiryTimers = new Map();
const rankStatsRenderTokens = new Map();

function getRankStatsSession(messageId) {
	if (!messageId) {
		return null;
	}
	const session = rankStatsSessionCache.get(messageId);
	if (!session) {
		return null;
	}
	if (session.expiresAt && session.expiresAt <= Date.now()) {
		deleteCacheEntry(rankStatsSessionCache, rankStatsSessionExpiryTimers, messageId);
		return null;
	}
	refreshCacheEntry(rankStatsSessionCache, rankStatsSessionExpiryTimers, messageId, SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + SESSION_CACHE_TTL_MS;
	return session;
}

function storeRankStatsSession(messageId, session) {
	if (!messageId || !session) {
		return;
	}
	const payload = {
		...session,
		messageId,
		expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
	};
	setCacheEntry(rankStatsSessionCache, rankStatsSessionExpiryTimers, messageId, payload, SESSION_CACHE_TTL_MS);
}

function beginRankStatsRender(messageId) {
	if (!messageId) {
		return null;
	}
	const token = Symbol("rankStatsRender");
	rankStatsRenderTokens.set(messageId, token);
	return token;
}

function isRankStatsRenderActive(messageId, token) {
	if (!messageId || !token) {
		return true;
	}
	return rankStatsRenderTokens.get(messageId) === token;
}

function endRankStatsRender(messageId, token) {
	if (!messageId || !token) {
		return;
	}
	if (rankStatsRenderTokens.get(messageId) === token) {
		rankStatsRenderTokens.delete(messageId);
	}
}

function buildRankStatsCustomId(action, { timeFilter, queueFilter, playerCountFilter, loungeId }) {
	const safeAction = (action || "time").toLowerCase();
	const normalizedFilters = normalizeRankStatsFilters({ timeFilter, queueFilter, playerCountFilter });
	const safeLounge = loungeId ?? "";
	return [
		"rankstats",
		safeAction,
		normalizedFilters.timeFilter,
		normalizedFilters.queueFilter,
		normalizedFilters.playerCountFilter,
		safeLounge,
	].join("|");
}

function parseRankStatsCustomId(customId) {
	if (!customId?.startsWith("rankstats|")) {
		return null;
	}
	const parts = customId.split("|");
	if (parts.length < 6) {
		return null;
	}
	const [, actionRaw, timeRaw, queueRaw, playersRaw, loungeId] = parts;
	const normalizedFilters = normalizeRankStatsFilters({
		timeFilter: timeRaw,
		queueFilter: queueRaw,
		playerCountFilter: playersRaw,
	});
	return {
		action: (actionRaw || "time").toLowerCase(),
		...normalizedFilters,
		loungeId: loungeId || null,
	};
}

function buildRankStatsComponentRows({ loungeId, timeFilter, queueFilter, playerCountFilter }) {
	const normalizedFilters = normalizeRankStatsFilters({ timeFilter, queueFilter, playerCountFilter });
	const safeTime = normalizedFilters.timeFilter;
	const safeQueue = normalizedFilters.queueFilter;
	const safePlayers = normalizedFilters.playerCountFilter;
	const rows = [];

	rows.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("time", { timeFilter: "alltime", queueFilter: safeQueue, playerCountFilter: safePlayers, loungeId }))
			.setLabel("all time")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "alltime"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("time", { timeFilter: "weekly", queueFilter: safeQueue, playerCountFilter: safePlayers, loungeId }))
			.setLabel("past week")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "weekly"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("time", { timeFilter: "season", queueFilter: safeQueue, playerCountFilter: safePlayers, loungeId }))
			.setLabel("this season")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "season"),
	));

	rows.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "soloq", playerCountFilter: safePlayers, loungeId }))
			.setLabel("soloq")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "soloq"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "squads", playerCountFilter: safePlayers, loungeId }))
			.setLabel("squads")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "squads"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "both", playerCountFilter: safePlayers, loungeId }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "both"),
	));

	rows.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "12p", loungeId }))
			.setLabel("12p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "12p"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "24p", loungeId }))
			.setLabel("24p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "24p"),
		new ButtonBuilder()
			.setCustomId(buildRankStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "both", loungeId }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "both"),
	));

	return rows;
}

function getTierForMmr(mmr) {
	if (!Number.isFinite(mmr)) {
		return null;
	}
	return PlayerStats.getRankThresholdForMmr(mmr) || null;
}

function getTableTimestamp(table) {
	if (!table) return null;
	const raw = table.verifiedOn || table.createdOn || table.updatedOn || table.date;
	if (!raw) return null;
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTableDateText(table) {
	const timestamp = getTableTimestamp(table);
	return timestamp ? FOOTER_DATE_FORMATTER.format(timestamp) : "date unknown";
}

function getMatchHeaderFormatLine(table) {
	if (!table) {
		return null;
	}
	const playerCount = table.numPlayers;
	const playerText = playerCount ? `${playerCount}p` : "";
	const format = table.format || null;
	if (playerText && format) {
		return `${playerText} ${format}`;
	}
	return playerText || format || null;
}

function computeRoomAveragePrevMmr(players) {
	const mmrs = players
		.map(player => Number(player.prevMmr))
		.filter(value => Number.isFinite(value));
	if (!mmrs.length) {
		return null;
	}
	const total = mmrs.reduce((sum, value) => sum + value, 0);
	return total / mmrs.length;
}

function buildRankingLookup(table) {
	const rankings = PlayerStats.getIndividualPlayerRankings(table) || [];
	const lookup = new Map();
	for (const entry of rankings) {
		const identifiers = PlayerStats.getPlayerIdentifiers(entry);
		if (!identifiers.length) {
			const fallback = PlayerStats.normalizeIdentifier(entry.playerId || entry.id);
			if (fallback) {
				lookup.set(fallback, entry);
			}
			continue;
		}
		for (const id of identifiers) {
			if (!lookup.has(id)) {
				lookup.set(id, entry);
			}
		}
	}
	return { rankings, lookup };
}

function findRankingForPlayer(player, lookup) {
	const identifiers = PlayerStats.getPlayerIdentifiers(player);
	for (const identifier of identifiers) {
		const entry = lookup.get(identifier);
		if (entry) {
			return entry;
		}
	}

	const fallback = PlayerStats.normalizeIdentifier(player.playerId || player.id || player.discordId);
	return fallback ? lookup.get(fallback) || null : null;
}

function compareRankings(primary, opponent) {
	const playerScore = Number(primary?.score);
	const opponentScore = Number(opponent?.score);
	if (Number.isFinite(playerScore) && Number.isFinite(opponentScore)) {
		if (playerScore > opponentScore) return "wins";
		if (playerScore < opponentScore) return "losses";
	}

	const playerRank = Number(primary?.individualRank);
	const opponentRank = Number(opponent?.individualRank);
	if (Number.isFinite(playerRank) && Number.isFinite(opponentRank)) {
		if (playerRank < opponentRank) return "wins";
		if (playerRank > opponentRank) return "losses";
	}

	return "ties";
}

function getBucketKey(tier) {
	return tier?.key || UNKNOWN_RANK_KEY;
}

function createBucket(tier) {
	const label = tier?.label || tier?.text || tier?.key || "Unknown";
	const iconFilename = tier ? PlayerStats.getRankIconFilename(tier.label || tier.text || tier.key) : null;
	const order = tier ? (RANK_ORDER_INDEX.get(tier.key) ?? RANK_THRESHOLDS.length) : RANK_THRESHOLDS.length + 1;
	return {
		key: getBucketKey(tier),
		label,
		iconFilename,
		order,
		wins: 0,
		losses: 0,
		ties: 0,
		encounters: 0,
		roomScoreTotal: 0,
		roomScoreCount: 0,
	};
}

function ensureBucket(map, tier) {
	const key = getBucketKey(tier);
	if (!map.has(key)) {
		map.set(key, createBucket(tier));
	}
	return map.get(key);
}

function getPlayerLabel(player) {
	return player?.playerName || player?.username || player?.loungeName || player?.playerDiscordId || `player ${player?.playerId || "?"}`;
}

function buildMatchSummary({ opponent, tier, table, opponentPrevMmr, playerScore, opponentScore }) {
	return {
		name: getPlayerLabel(opponent),
		prevMmr: opponentPrevMmr,
		rankLabel: tier?.label || tier?.text || tier?.key || "Unknown",
		rankIconFilename: tier ? PlayerStats.getRankIconFilename(tier.label || tier.text || tier.key) : null,
		headerFormatLine: getMatchHeaderFormatLine(table),
		dateText: getTableDateText(table),
		tableId: table?.id || table?.tableId || null,
		playerScore: Number.isFinite(playerScore) ? playerScore : null,
		opponentScore: Number.isFinite(opponentScore) ? opponentScore : null,
	};
}

function aggregateRankStats(tables, playerIdentifier) {
	const normalizedPlayerId = PlayerStats.normalizeIdentifier(playerIdentifier);
	if (!normalizedPlayerId) {
		return { rows: [], bestWin: null, worstLoss: null, tableCount: 0 };
	}

	const tableEntries = Object.values(tables || {});
	const tableCount = tableEntries.length;
	if (!tableEntries.length) {
		return { rows: [], bestWin: null, worstLoss: null, tableCount: 0 };
	}

	const buckets = new Map();
	let bestWin = null;
	let worstLoss = null;

	for (const table of tableEntries) {
		if (!table) continue;
		const players = PlayerStats.getPlayersFromTable(table);
		if (!players.length) continue;

		const { rankings, lookup } = buildRankingLookup(table);
		const playerRanking = rankings.find(entry => PlayerStats.playerMatchesIdentifier(entry, normalizedPlayerId));
		if (!playerRanking) {
			continue;
		}

		const playerScore = Number(playerRanking.score);
		const roomAverage = computeRoomAveragePrevMmr(players);
		if (Number.isFinite(roomAverage)) {
			const roomTier = getTierForMmr(roomAverage);
			const bucket = ensureBucket(buckets, roomTier);
			if (Number.isFinite(playerScore)) {
				bucket.roomScoreTotal += playerScore;
				bucket.roomScoreCount += 1;
			}
		}

		for (const opponent of players) {
			if (PlayerStats.playerMatchesIdentifier(opponent, normalizedPlayerId)) {
				continue;
			}

			const opponentPrevMmr = Number(opponent.prevMmr);
			if (!Number.isFinite(opponentPrevMmr)) {
				continue;
			}

			const tier = getTierForMmr(opponentPrevMmr);
			const bucket = ensureBucket(buckets, tier);
			const opponentRanking = findRankingForPlayer(opponent, lookup);
			if (!opponentRanking) {
				continue;
			}

			const opponentScore = Number(opponentRanking.score);

			const outcome = compareRankings(playerRanking, opponentRanking);
			bucket[outcome] += 1;
			bucket.encounters += 1;

			if (outcome === "wins" && (!bestWin || opponentPrevMmr > bestWin.prevMmr)) {
				bestWin = buildMatchSummary({ opponent, tier, table, opponentPrevMmr, playerScore, opponentScore });
			}
			else if (outcome === "losses" && (!worstLoss || opponentPrevMmr < worstLoss.prevMmr)) {
				worstLoss = buildMatchSummary({ opponent, tier, table, opponentPrevMmr, playerScore, opponentScore });
			}
		}
	}

	const rows = Array.from(buckets.values())
		.filter(bucket => bucket.encounters > 0 || bucket.roomScoreCount > 0)
		.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
		.map(bucket => {
			const total = bucket.encounters;
			const winRate = total > 0 ? bucket.wins / total : null;
			const avgScore = bucket.roomScoreCount > 0 ? bucket.roomScoreTotal / bucket.roomScoreCount : null;
			return {
				...bucket,
				winRate,
				avgScore,
			};
		});

	return { rows, bestWin, worstLoss, tableCount };
}

async function loadRankIcon(filename) {
	if (!filename) {
		return null;
	}
	const resource = `images/ranks/${filename}`;
	try {
		return await loadImage(resource);
	}
	catch (error) {
		console.warn(`failed to load rank icon ${resource}:`, error);
		return null;
	}
}

function formatWinRate(winRate) {
	if (winRate === null || winRate === undefined) {
		return "--";
	}
	return `${Math.round(winRate * 1000) / 10}%`;
}

function formatAvgScore(score) {
	if (!Number.isFinite(score)) {
		return "--";
	}
	return `${(Math.round(score * 10) / 10).toFixed(1)} pts`;
}

function formatRecord(bucket) {
	if (bucket.ties) {return `${bucket.wins}-${bucket.losses}-${bucket.ties}`;}
	else {return `${bucket.wins}-${bucket.losses}`;}
}

function formatScoreLine(playerScore, opponentScore) {
	if (!Number.isFinite(playerScore) || !Number.isFinite(opponentScore)) {
		return "";
	}
	return `(${playerScore} - ${opponentScore})`;
}

function buildMatchLinksMessage(bestWin, worstLoss) {
	const parts = [];
	const appendLink = (entry, label) => {
		const tableId = entry?.tableId ?? entry?.table?.id ?? entry?.table?.tableId;
		if (!tableId) return;
		const normalizedId = String(tableId).trim();
		if (!normalizedId) return;
		const title = label || "view table";
		const link = `https://lounge.mkcentral.com/mkworld/TableDetails/${normalizedId}`;
		parts.push(`[${title}](${link})`);
	};
	appendLink(bestWin, "best win");
	appendLink(worstLoss, "toughest loss");
	return parts.length ? `links: ${parts.join(", ")}` : "";
}

function buildFilterSubtitle(filters, tableCount) {
	const timeLabels = {
		alltime: "all time",
		weekly: "past week",
		season: "this season",
	};
	const queueLabels = {
		soloq: "solo queue",
		squads: "squads",
	};
	const effectiveFilters = normalizeRankStatsFilters(filters);
	const parts = [];
	const timeFilter = effectiveFilters.timeFilter;
	const queueFilter = effectiveFilters.queueFilter;
	const playerCountFilter = effectiveFilters.playerCountFilter;
	const timeLabel = timeLabels[timeFilter] || timeFilter;
	if (timeLabel) {
		parts.push(timeLabel);
	}
	if (queueFilter !== "both" && queueLabels[queueFilter]) {
		parts.push(queueLabels[queueFilter]);
	}
	if (playerCountFilter !== "both" && playerCountFilter) {
		parts.push(playerCountFilter);
	}
	if (Number.isFinite(tableCount)) {
		parts.push(`${tableCount} event${tableCount === 1 ? "" : "s"}`);
	}
	return parts.join(" · ");
}

function drawFooterMatchBlock(ctx, frame, palette, { label, action, entry, align = "left" }) {
	ctx.save();
	ctx.textBaseline = "alphabetic";

	const headerFontSize = 24;
	const playerFontSize = 32;
	const detailsFontSize = 26;
	const HEADER_PLAYER_GAP = 40;
	const PLAYER_DETAILS_GAP = 36;
	const blockHeight = headerFontSize + HEADER_PLAYER_GAP + playerFontSize + PLAYER_DETAILS_GAP + detailsFontSize;
	const blockTop = frame.top + Math.max((frame.height - blockHeight) / 2, 0);
	const headerBaseline = blockTop + headerFontSize;
	const playerBaseline = headerBaseline + HEADER_PLAYER_GAP;
	const detailsBaseline = playerBaseline + PLAYER_DETAILS_GAP;
	const iconSize = 34;
	const isRightAligned = align === "right";
	const textAnchor = isRightAligned ? frame.left + frame.width : frame.left;

	ctx.font = "600 24px Lexend";
	ctx.fillStyle = palette.headerTextColor || "#ffffff";
	let headerText = label;
	if (entry) {
		const contextBits = [];
		const headerFormat = entry.headerFormatLine || null;
		if (entry.dateText) contextBits.push(entry.dateText);
		if (headerFormat) {
			contextBits.push(headerFormat);
		}
		if (contextBits.length) {
			headerText = `${headerText} · ${contextBits.join(" • ")}`;
		}
	}
	ctx.textAlign = "left";
	ctx.fillText(headerText, textAnchor, headerBaseline);

	if (!entry) {
		ctx.font = "400 26px Lexend";
		ctx.fillStyle = palette.tableSubTextColor || "#c7c7c7";
		ctx.fillText("no data yet", textAnchor, playerBaseline);
		ctx.restore();
		return;
	}

	const actionText = `${action || label} `;
	const nameText = entry.name || "unknown player";
	const mmrText = Number.isFinite(entry.prevMmr)
		? ` (${Math.round(entry.prevMmr).toLocaleString()} mmr)`
		: "";

	ctx.font = "600 32px Lexend";
	ctx.fillStyle = palette.headerTextColor || "#ffffff";
	const actionWidth = ctx.measureText(actionText).width;
	const nameWidth = ctx.measureText(nameText).width;
	ctx.font = "400 28px Lexend";
	const mmrWidth = mmrText ? ctx.measureText(mmrText).width : 0;
	const iconGap = 6;
	const iconWidth = entry.iconImage ? iconSize + iconGap : 0;
	const totalPlayerWidth = actionWidth + iconWidth + nameWidth + mmrWidth;
	let cursorX = textAnchor;

	ctx.font = "600 32px Lexend";
	ctx.fillText(actionText, cursorX, playerBaseline);
	cursorX += actionWidth;
	if (entry.iconImage) {
		drawInlineImage(ctx, entry.iconImage, cursorX, playerBaseline, iconSize, { descentRatio: 0.2 });
		cursorX += iconSize + iconGap;
	}
	ctx.fillText(nameText, cursorX, playerBaseline);
	cursorX += nameWidth;

	if (mmrText) {
		ctx.font = "400 28px Lexend";
		ctx.fillStyle = palette.headerTextColor || "#ffffff";
		ctx.fillText(mmrText, cursorX, playerBaseline);
	}

	const scoreText = formatScoreLine(entry.playerScore, entry.opponentScore);
	if (scoreText) {
		ctx.font = "400 26px Lexend";
		ctx.fillStyle = palette.headerTextColor || "#ffffff";
		ctx.fillText(scoreText, textAnchor, detailsBaseline);
	}

	ctx.restore();
}

async function renderRankStatsImage({
	trackName,
	displayName,
	playerDetails,
	rankRows,
	bestWin,
	worstLoss,
	palette,
	avatarImage,
	favoriteCharacterImage,
	favoriteVehicleImage,
	playerEmoji,
	filters,
	tableCount,
}) {
	const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext("2d");

	try {
		const backgroundResource = trackName ? `images/tracks blurred/${trackName}_ranks.png` : null;
		const backgroundImage = backgroundResource ? await loadImageResource(backgroundResource, `${trackName} background`) : null;
		if (backgroundImage) {
			ctx.drawImage(backgroundImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
		}
		else {
			throw new Error("background image not available");
		}
	}
	catch (error) {
		console.warn(`rank-stats: failed to load background image for ${trackName || "default"}:`, error);
		ctx.fillStyle = palette.backgroundColor || "#000000";
		ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	}

	const headerFrame = {
		left: LAYOUT.pagePadding,
		top: LAYOUT.pagePadding,
		width: CANVAS_WIDTH - LAYOUT.pagePadding * 2,
		height: LAYOUT.headerHeight,
	};

	const footerFrame = {
		left: headerFrame.left,
		width: headerFrame.width,
		height: LAYOUT.footerHeight,
		top: CANVAS_HEIGHT - LAYOUT.pagePadding - LAYOUT.footerHeight,
	};

	const tableFrame = {
		left: headerFrame.left,
		top: headerFrame.top + headerFrame.height + LAYOUT.sectionGap,
		width: headerFrame.width,
		height: footerFrame.top - headerFrame.top - headerFrame.height - LAYOUT.sectionGap * 2,
	};

	drawRoundedPanel(ctx, headerFrame, palette.headerPanelColor || "#111111", EDGE_RADIUS);
	drawRoundedPanel(ctx, tableFrame, palette.tableRowColor || "#0f0f0f", EDGE_RADIUS);

	const tableBorderColor = palette.tableBorderColor || palette.panelBorderColor || "#2a2a2a";
	ctx.save();
	ctx.strokeStyle = tableBorderColor;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(tableFrame.left + EDGE_RADIUS, tableFrame.top);
	ctx.lineTo(tableFrame.left + tableFrame.width - EDGE_RADIUS, tableFrame.top);
	ctx.quadraticCurveTo(tableFrame.left + tableFrame.width, tableFrame.top, tableFrame.left + tableFrame.width, tableFrame.top + EDGE_RADIUS);
	ctx.lineTo(tableFrame.left + tableFrame.width, tableFrame.top + tableFrame.height - EDGE_RADIUS);
	ctx.quadraticCurveTo(tableFrame.left + tableFrame.width, tableFrame.top + tableFrame.height, tableFrame.left + tableFrame.width - EDGE_RADIUS, tableFrame.top + tableFrame.height);
	ctx.lineTo(tableFrame.left + EDGE_RADIUS, tableFrame.top + tableFrame.height);
	ctx.quadraticCurveTo(tableFrame.left, tableFrame.top + tableFrame.height, tableFrame.left, tableFrame.top + tableFrame.height - EDGE_RADIUS);
	ctx.lineTo(tableFrame.left, tableFrame.top + EDGE_RADIUS);
	ctx.quadraticCurveTo(tableFrame.left, tableFrame.top, tableFrame.left + EDGE_RADIUS, tableFrame.top);
	ctx.closePath();
	ctx.stroke();
	ctx.restore();

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	let headerTextX = headerFrame.left + LAYOUT.tablePadding;

	if (playerEmoji) {
		const emojiSize = LAYOUT.headerEmojiSize;
		const emojiY = headerFrame.top + (headerFrame.height - emojiSize) / 2;
		try {
			await drawEmoji(ctx, playerEmoji, headerTextX, emojiY, emojiSize);
			headerTextX += emojiSize + LAYOUT.headerEmojiGap;
		}
		catch (error) {
			console.warn("rank-stats: failed to draw emoji", error);
		}
	}

	const titleBaseline = headerFrame.top + headerFrame.height / 2 + LAYOUT.headerTextAdjustmentY;

	ctx.font = "700 55px Lexend";
	ctx.fillStyle = palette.headerTextColor || "#ffffff";
	await drawTextWithEmojis(ctx, `${displayName}'s rank stats`, headerTextX, titleBaseline);

	ctx.font = "400 30px Lexend";
	ctx.fillStyle = palette.subheaderTextColor || "#b3b3b3";
	const subtitleParts = [];
	if (Number.isFinite(playerDetails?.mmr)) {
		subtitleParts.push(`${playerDetails.mmr.toLocaleString()} mmr`);
	}
	const filterSubtitle = buildFilterSubtitle(filters, tableCount);
	if (filterSubtitle) {
		subtitleParts.push(filterSubtitle);
	}
	const subtitle = subtitleParts.join(" · ");
	if (subtitle) {
		ctx.fillText(subtitle, headerTextX, titleBaseline + LAYOUT.headerSubtitleGap + 30);
	}

	const scaleToFavoriteFrame = image => {
		const maxSize = LAYOUT.headerFavoriteMaxSize;
		const width = Math.max(image?.width || 1, 1);
		const height = Math.max(image?.height || 1, 1);
		const scale = maxSize / Math.max(width, height);
		return {
			width: width * scale,
			height: height * scale,
		};
	};

	const headerAssets = [];
	if (favoriteCharacterImage) {
		const { width, height } = scaleToFavoriteFrame(favoriteCharacterImage);
		headerAssets.push({ type: "character", image: favoriteCharacterImage, width, height });
	}
	if (favoriteVehicleImage) {
		const { width, height } = scaleToFavoriteFrame(favoriteVehicleImage);
		headerAssets.push({ type: "vehicle", image: favoriteVehicleImage, width, height });
	}
	if (avatarImage) {
		headerAssets.push({ type: "avatar", image: avatarImage, width: LAYOUT.headerAvatarSize, height: LAYOUT.headerAvatarSize });
	}

	let assetCursor = headerFrame.left + headerFrame.width - LAYOUT.tablePadding + (LAYOUT.headerAssetOffsetX || 0);
	for (let index = headerAssets.length - 1; index >= 0; index--) {
		const asset = headerAssets[index];
		assetCursor -= asset.width;
		const drawX = assetCursor;
		const drawY = headerFrame.top + (headerFrame.height - asset.height) / 2;
		if (asset.type === "avatar") {
			drawRoundedImage(ctx, asset.image, drawX, drawY, asset.width, asset.height, LAYOUT.headerAvatarRadius);
		}
		else {
			ctx.drawImage(asset.image, drawX, drawY, asset.width, asset.height);
		}
		if (index > 0) {
			assetCursor -= LAYOUT.headerAssetGap;
		}
	}

	const rowCount = Math.max(rankRows.length, 1);
	const innerHeight = tableFrame.height - LAYOUT.tablePadding * 2 - LAYOUT.tableHeaderHeight;
	const baseRowHeight = rowCount ? Math.max(innerHeight / rowCount, 0) : LAYOUT.tableRowMaxHeight;
	const rowHeight = rowCount ? Math.min(LAYOUT.tableRowMaxHeight, baseRowHeight) : LAYOUT.tableRowMaxHeight;

	const columns = [
		{ key: "rank", label: "rank", ratio: 0.45 },
		{ key: "winRate", label: "win rate vs. players\nof this rank", ratio: 0.30 },
		{ key: "avgScore", label: "average score in\nrooms of this rank", ratio: 0.25 },
	];
	const columnOffsets = [];
	let accumulator = tableFrame.left + LAYOUT.tablePadding;
	for (const column of columns) {
		columnOffsets.push(accumulator);
		accumulator += column.ratio * (tableFrame.width - LAYOUT.tablePadding * 2);
	}
	const columnWidths = columns.map((column, index) => {
		const nextOffset = index < columns.length - 1 ? columnOffsets[index + 1] : (tableFrame.left + tableFrame.width - LAYOUT.tablePadding);
		return nextOffset - columnOffsets[index];
	});

	// Header row
	ctx.save();
	ctx.font = "600 30px Lexend";
	ctx.fillStyle = palette.tableTextColor || "#f5f5f5";
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	const headerY = tableFrame.top + LAYOUT.tablePadding + LAYOUT.tableHeaderHeight / 2;
	const headerLineSpacing = 34;
	columns.forEach((column, index) => {
		const label = String(column.label || "");
		const lines = label.split("\n");
		const totalHeight = headerLineSpacing * (lines.length - 1);
		const firstLineY = headerY - totalHeight / 2;
		lines.forEach((line, lineIndex) => {
			ctx.fillText(line, columnOffsets[index], firstLineY + lineIndex * headerLineSpacing);
		});
	});
	ctx.restore();

	// Divider line under header
	ctx.save();
	ctx.strokeStyle = tableBorderColor;
	ctx.lineWidth = 2;
	const dividerY = tableFrame.top + LAYOUT.tablePadding + LAYOUT.tableHeaderHeight;
	ctx.beginPath();
	ctx.moveTo(tableFrame.left + LAYOUT.tablePadding, dividerY);
	ctx.lineTo(tableFrame.left + tableFrame.width - LAYOUT.tablePadding, dividerY);
	ctx.stroke();
	ctx.restore();

	const iconSize = 48;
	let cursorY = dividerY;

	for (let index = 0; index < rankRows.length; index++) {
		const row = rankRows[index];
		const rowTop = cursorY;
		const rowBottom = rowTop + rowHeight;
		const isStriped = index % 2 === 1;

		ctx.save();
		ctx.fillStyle = isStriped ? (palette.tableRowStripeColor || "#151515") : (palette.tableRowColor || "#0f0f0f");
		ctx.fillRect(tableFrame.left + 1, rowTop, tableFrame.width - 2, rowHeight);
		ctx.restore();

		ctx.save();
		ctx.textBaseline = "middle";
		const centerY = rowTop + rowHeight / 2;

		// Rank column
		ctx.textAlign = "left";
		ctx.font = "600 34px Lexend";
		ctx.fillStyle = palette.tableTextColor || "#f0f0f0";
		let textX = columnOffsets[0];
		if (row.iconFilename && row.iconImage) {
			ctx.drawImage(row.iconImage, textX, centerY - iconSize / 2, iconSize, iconSize);
			textX += iconSize + 18;
		}
		ctx.fillText(row.label, textX, centerY);
		const labelWidth = ctx.measureText(row.label).width;
		ctx.font = "400 26px Lexend";
		ctx.fillStyle = palette.tableSubTextColor || "#c7c7c7";
		ctx.fillText(`(${row.encounters || 0} opponent${row.encounters === 1 ? "" : "s"})`, textX + labelWidth + 16, centerY);

		// Win rate column
		ctx.textAlign = "left";
		ctx.font = "600 40px Lexend";
		ctx.fillStyle = palette.tableTextColor || "#f0f0f0";
		const winRateLabel = formatWinRate(row.winRate);
		const winColumnX = columnOffsets[1];
		ctx.fillText(winRateLabel, winColumnX, centerY);
		const winRateWidth = ctx.measureText(winRateLabel).width;
		ctx.font = "400 26px Lexend";
		ctx.fillStyle = palette.tableSubTextColor || "#c7c7c7";
		ctx.fillText(`(${formatRecord(row)})`, winColumnX + winRateWidth + 16, centerY);

		// Avg score column
		ctx.font = "600 40px Lexend";
		ctx.fillStyle = palette.tableTextColor || "#f0f0f0";
		ctx.textAlign = "left";
		const avgColumnX = columnOffsets[2];
		ctx.fillText(formatAvgScore(row.avgScore), avgColumnX, centerY);
		ctx.restore();

		cursorY += rowHeight;
	}

	drawRoundedPanel(ctx, footerFrame, palette.headerPanelColor || "#111111", EDGE_RADIUS);
	const footerInner = {
		left: footerFrame.left + LAYOUT.tablePadding,
		top: footerFrame.top + LAYOUT.tablePadding,
		width: footerFrame.width - LAYOUT.tablePadding * 2,
		height: footerFrame.height - LAYOUT.tablePadding * 2,
	};
	const footerColumnWidth = Math.max((footerInner.width - LAYOUT.footerGap) / 2, 0);
	const footerBlocks = [
		{ label: "best win", action: "beat", entry: bestWin },
		{ label: "toughest loss", action: "lost to", entry: worstLoss },
	];
	footerBlocks.forEach((block, index) => {
		const frame = {
			left: footerInner.left + index * (footerColumnWidth + LAYOUT.footerGap),
			top: footerInner.top,
			width: footerColumnWidth,
			height: footerInner.height,
		};
		drawFooterMatchBlock(ctx, frame, palette, block);
	});

	const buffer = canvas.toBuffer("image/png");
	return new AttachmentBuilder(buffer, { name: "rank-stats.png" });
}

async function generateRankStats(interaction, target, serverId, serverDataOverride = null, options = {}) {
	const loungeId = String(target.loungeId || target.playerId || target.id || "").trim();
	if (!loungeId) {
		return { success: false, message: "unable to resolve lounge id for that user." };
	}

	const filters = normalizeRankStatsFilters(options.filters || {});
	const session = options.session || null;
	const hasSessionTables = Boolean(session?.allTables && Object.keys(session.allTables).length);
	const hasSessionDetails = Boolean(session?.playerDetails);
	let favorites = session?.favorites || null;
	let favoriteCharacterImage = session?.favoriteCharacterImage || null;
	let favoriteVehicleImage = session?.favoriteVehicleImage || null;

	let serverData = serverDataOverride || await Database.getServerData(serverId);

	const ensureResult = await DataManager.ensureUserRecord({
		loungeId,
		serverId,
		client: interaction.client,
		guild: interaction.guild ?? null,
	});

	if (ensureResult?.userRecord && ensureResult.userRecord.servers?.includes(serverId)) {
		serverData = serverData || {};
		serverData.users = serverData.users || {};
		serverData.users[loungeId] = ensureResult.userRecord;
	}

	let playerDetails = hasSessionDetails ? session.playerDetails : null;
	if (!playerDetails) {
		playerDetails = await LoungeApi.getPlayerDetailsByLoungeId(loungeId);
		if (!playerDetails) {
			return { success: false, message: "couldn't find that player in lounge." };
		}
	}

	await interaction.editReply("loading tables...");
	let allTables = hasSessionTables ? session.allTables : null;
	if (!allTables) {
		allTables = await LoungeApi.getAllPlayerTables(loungeId, serverId);
		if (!allTables || !Object.keys(allTables).length) {
			return { success: false, message: "no tables found for that player." };
		}
	}

	const filteredTables = typeof PlayerStats.filterTablesByControls === "function"
		? PlayerStats.filterTablesByControls(allTables, filters)
		: allTables;
	const filteredTableIds = Object.keys(filteredTables || {});
	if (!filteredTableIds.length) {
		return { success: false, message: "no tables matched those filters." };
	}

	await interaction.editReply("crunching matchup data...");
	const aggregation = aggregateRankStats(filteredTables, loungeId);
	if (!aggregation.rows.length) {
		return { success: false, message: "not enough matchup data to create rank stats." };
	}

	await interaction.editReply("rendering image...");
	const trackName = await resolveRankStatsTrackName(loungeId, session?.trackName);
	if (!favorites) {
		try {
			const userData = await Database.getUserData(loungeId);
			favorites = userData?.favorites || {};
		}
		catch (error) {
			console.warn(`rank-stats: failed to load favorites for ${loungeId}:`, error);
			favorites = {};
		}
	}
	if (!favoriteCharacterImage || !favoriteVehicleImage) {
		const [characterImage, vehicleImage] = await Promise.all([
			favoriteCharacterImage ? Promise.resolve(favoriteCharacterImage) : loadFavoriteCharacterImage(favorites),
			favoriteVehicleImage ? Promise.resolve(favoriteVehicleImage) : loadFavoriteVehicleImage(favorites),
		]);
		favoriteCharacterImage = characterImage || favoriteCharacterImage;
		favoriteVehicleImage = vehicleImage || favoriteVehicleImage;
	}
	const palette = buildRankStatsPalette(trackName);
	const avatarUrl = getPlayerAvatarUrl(target.discordUser || ensureResult?.discordUser);
	let avatarImage = null;
	if (avatarUrl) {
		try {
			avatarImage = await loadWebPAsPng(avatarUrl);
		}
		catch (error) {
			console.warn("rank-stats: failed to load avatar", error);
		}
	}
	const playerEmoji = getPlayerEmoji(playerDetails);
	const iconImages = await Promise.all(aggregation.rows.map(async row => {
		const image = await loadRankIcon(row.iconFilename);
		return image;
	}));
	aggregation.rows.forEach((row, index) => {
		row.iconImage = iconImages[index];
	});
	const footerIcons = await Promise.all([
		aggregation.bestWin?.rankIconFilename ? loadRankIcon(aggregation.bestWin.rankIconFilename) : Promise.resolve(null),
		aggregation.worstLoss?.rankIconFilename ? loadRankIcon(aggregation.worstLoss.rankIconFilename) : Promise.resolve(null),
	]);
	if (aggregation.bestWin) {
		aggregation.bestWin.iconImage = footerIcons[0];
	}
	if (aggregation.worstLoss) {
		aggregation.worstLoss.iconImage = footerIcons[1];
	}

	const displayName = target.displayName || playerDetails.name || playerDetails.loungeName || `player ${loungeId}`;
	const attachment = await renderRankStatsImage({
		trackName,
		displayName,
		playerDetails,
		rankRows: aggregation.rows,
		bestWin: aggregation.bestWin,
		worstLoss: aggregation.worstLoss,
		palette,
		avatarImage,
		favoriteCharacterImage,
		favoriteVehicleImage,
		playerEmoji,
		filters,
		tableCount: aggregation.tableCount,
	});

	const linkMessage = buildMatchLinksMessage(aggregation.bestWin, aggregation.worstLoss);
	const sessionPayload = {
		loungeId,
		serverId,
		displayName,
		allTables,
		playerDetails,
		filters,
		trackName,
		favorites,
		discordUser: target.discordUser || ensureResult?.discordUser || null,
		target: {
			loungeId,
			displayName,
		},
	};

	return { success: true, attachment, content: linkMessage, filters, session: sessionPayload };
}

function getPlayerEmoji(playerDetails) {
	const countryCode = playerDetails?.countryCode || playerDetails?.country_code || playerDetails?.country;
	if (!countryCode) {
		return null;
	}
	try {
		return getCountryFlag(countryCode);
	}
	catch (error) {
		console.warn("rank-stats: unable to resolve emoji", error);
		return null;
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("rank-stats")
		.setDescription("see how you stack up vs. opponents of each rank.")
		.addStringOption(option =>
			option.setName("player")
				.setDescription("lounge name or id. leave blank for yourself.")
				.setAutocomplete(true)),

	autocomplete: async interaction => {
		const focused = interaction.options.getFocused(true);
		if (focused.name !== "player") {
			await interaction.respond([]);
			return;
		}

		const guild = interaction.guild;
		if (!guild) {
			await interaction.respond([]);
			return;
		}

		const rawQuery = (focused.value || "").trim();
		const normalizedQuery = rawQuery.toLowerCase();
		const serverLimit = 5;
		const globalLimit = 5;
		const suggestions = [];
		const seen = new Set();

		try {
			const serverData = await Database.getServerData(guild.id);
			const users = Object.values(serverData?.users || {});
			const filtered = users
				.filter(entry => entry?.loungeName)
				.filter(entry => !normalizedQuery || entry.loungeName.toLowerCase().includes(normalizedQuery))
				.sort((a, b) => a.loungeName.localeCompare(b.loungeName));

			for (const entry of filtered) {
				const value = String(entry.loungeId ?? entry.id ?? entry.loungeName);
				if (seen.has(value)) continue;
				suggestions.push({ name: entry.loungeName, value });
				seen.add(value);
				if (suggestions.length >= serverLimit) break;
			}
		}
		catch (error) {
			console.warn("rank-stats autocomplete server fetch failed", error);
		}

		if (rawQuery && suggestions.length < serverLimit + globalLimit) {
			try {
				const globalResults = await LoungeApi.searchPlayers(rawQuery, { limit: globalLimit });
				for (const player of globalResults) {
					const loungeId = [player.id, player.playerId, player.loungeId]
						.map(id => id === undefined || id === null ? null : String(id))
						.find(Boolean);
					if (!loungeId || seen.has(loungeId)) continue;
					const displayName = player.name || player.loungeName || player.playerName || player.username;
					if (!displayName) continue;
					suggestions.push({
						name: displayName.length > 100 ? `${displayName.slice(0, 97)}...` : displayName,
						value: loungeId,
					});
					seen.add(loungeId);
					if (suggestions.length >= serverLimit + globalLimit) break;
				}
			}
			catch (error) {
				console.warn("rank-stats autocomplete global search failed", error);
			}
		}

		if (!suggestions.length && normalizedQuery) {
			suggestions.push({ name: `search "${rawQuery}"`, value: rawQuery });
		}

		await interaction.respond(suggestions.slice(0, serverLimit + globalLimit));
	},

	execute: async interaction => {
		try {
			await interaction.deferReply();
			await interaction.editReply("validating user...");

			const serverId = interaction.guildId;
			const rawPlayer = interaction.options.getString("player");
			const initialFilters = normalizeRankStatsFilters(DEFAULT_FILTERS);
			let components = [];

			const validation = await AutoUserManager.validateUserForCommand(interaction.user.id, serverId, interaction.client);
			if (!validation.success) {
				await interaction.editReply({ content: validation.message || "unable to validate command user.", components, files: [] });
				return;
			}

			const serverData = await Database.getServerData(serverId);
			const target = await resolveTargetPlayer(interaction, {
				rawInput: rawPlayer,
				defaultToInvoker: !rawPlayer,
				serverData,
			});

			if (target.error) {
				await interaction.editReply({ content: target.error, components, files: [] });
				return;
			}

			components = buildRankStatsComponentRows({
				loungeId: target.loungeId,
				timeFilter: initialFilters.timeFilter,
				queueFilter: initialFilters.queueFilter,
				playerCountFilter: initialFilters.playerCountFilter,
			});

			const result = await generateRankStats(interaction, target, serverId, serverData, { filters: initialFilters });
			if (!result.success) {
				await interaction.editReply({ content: result.message || "unable to compute rank stats.", components, files: [] });
				return;
			}

			const replyMessage = await interaction.editReply({ content: result.content ?? "", files: [result.attachment], components });
			if (replyMessage && result.session) {
				storeRankStatsSession(replyMessage.id, {
					...result.session,
					filters: result.filters || initialFilters,
					pendingFilters: null,
					activeRequestToken: null,
				});
			}
		}
		catch (error) {
			console.error("rank-stats command error", error);
			try {
				await interaction.editReply({ content: "error: unable to generate rank stats." });
			}
			catch (editError) {
				console.error("rank-stats fallback reply failed", editError);
			}
		}
	},

	handleButtonInteraction: async interaction => {
		const parsed = parseRankStatsCustomId(interaction.customId);
		if (!parsed) {
			return false;
		}

		try {
			await interaction.deferUpdate();

			const messageId = interaction.message?.id || null;
			const cachedSession = messageId ? getRankStatsSession(messageId) : null;
			const defaultFilters = normalizeRankStatsFilters(DEFAULT_FILTERS);
			const baseFilters = normalizeRankStatsFilters(cachedSession?.pendingFilters || cachedSession?.filters || defaultFilters);
			let nextFilters = { ...baseFilters };
			if (parsed.action === "time") {
				nextFilters.timeFilter = parsed.timeFilter;
			}
			else if (parsed.action === "queue") {
				nextFilters.queueFilter = parsed.queueFilter;
			}
			else if (parsed.action === "players") {
				nextFilters.playerCountFilter = parsed.playerCountFilter;
			}
			nextFilters = normalizeRankStatsFilters(nextFilters);

			const loungeId = parsed.loungeId || cachedSession?.loungeId;
			if (!loungeId) {
				await interaction.editReply({ content: "unable to determine which player to load.", components: [], files: [] });
				return true;
			}

			const components = buildRankStatsComponentRows({
				loungeId,
				timeFilter: nextFilters.timeFilter,
				queueFilter: nextFilters.queueFilter,
				playerCountFilter: nextFilters.playerCountFilter,
			});

			const serverId = interaction.guild?.id;
			if (!serverId) {
				await interaction.editReply({ content: "unable to determine server context for this request.", components, files: [] });
				return true;
			}

			const serverData = await Database.getServerData(serverId);
			let target = null;
			if (cachedSession && cachedSession.loungeId === loungeId) {
				target = {
					loungeId,
					displayName: cachedSession.displayName || cachedSession.target?.displayName || `player ${loungeId}`,
					discordUser: cachedSession.discordUser || null,
				};
			}
			else {
				target = await resolveTargetPlayer(interaction, { loungeId, serverData });
				if (target.error) {
					await interaction.editReply({ content: target.error, components, files: [] });
					return true;
				}
			}

			const renderToken = messageId ? beginRankStatsRender(messageId) : null;
			if (cachedSession) {
				cachedSession.pendingFilters = nextFilters;
				if (renderToken) {
					cachedSession.activeRequestToken = renderToken;
				}
			}

			try {
				const result = await generateRankStats(interaction, target, serverId, serverData, {
					filters: nextFilters,
					session: cachedSession && cachedSession.loungeId === loungeId ? cachedSession : null,
				});

				if (!isRankStatsRenderActive(messageId, renderToken)) {
					return true;
				}

				if (result?.success) {
					await interaction.editReply({ content: result.content ?? "", files: [result.attachment], components });
					if (messageId && result.session) {
						storeRankStatsSession(messageId, {
							...result.session,
							filters: result.filters || nextFilters,
							pendingFilters: null,
							activeRequestToken: null,
						});
					}
				}
				else {
					await interaction.editReply({ content: result?.message || "unable to compute rank stats.", components, files: [] });
				}

				return true;
			}
			finally {
				if (messageId) {
					endRankStatsRender(messageId, renderToken);
				}
				if (cachedSession) {
					cachedSession.pendingFilters = null;
					cachedSession.activeRequestToken = null;
				}
			}
		}
		catch (error) {
			console.error("rank-stats button error", error);
			return false;
		}
	},
};
