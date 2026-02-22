const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("canvas");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");
const ColorPalettes = require("../../utils/colorPalettes");
const Fonts = require("../../utils/fonts");
const {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
} = require("../../utils/cacheManager");

const {
	drawRoundedPanel,
	drawEmoji,
	getCountryFlag,
	drawTextWithEmojis,
	truncateTextWithEmojis,
} = EmbedEnhancer;

const EDGE_RADIUS = 30;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LEADERBOARD_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 10;
const ENTRIES_PER_COLUMN = 5;
const BACKGROUND_RESOURCE = "bot/images/other backgrounds blurred/leaderboardbg.png";

const leaderboardSessionCache = new Map();
const leaderboardSessionExpiryTimers = new Map();
const leaderboardRenderTokens = new Map();

function beginLeaderboardRender(messageId) {
	if (!messageId) {
		return null;
	}
	const token = Symbol("leaderboardRender");
	leaderboardRenderTokens.set(messageId, token);
	return token;
}

function isLeaderboardRenderActive(messageId, token) {
	if (!messageId || !token) {
		return true;
	}
	return leaderboardRenderTokens.get(messageId) === token;
}

function endLeaderboardRender(messageId, token) {
	if (!messageId || !token) {
		return;
	}
	if (leaderboardRenderTokens.get(messageId) === token) {
		leaderboardRenderTokens.delete(messageId);
	}
}

const MMR_NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

const LAYOUT = {
	pagePadding: 100,
	headerHeight: 160,
	headerPaddingHorizontal: 40,
	headerTitleFontSize: 64,
	headerSubtitleFontSize: 30,
	headerSubtitleGap: 14,
	titleOffset: 5,
	columnGap: null,
	headerIconGap: 28,
	headerIconSizeExtra: 20,
	columnPadding: 0,
	entryCardRadius: 28,
	entryCardPaddingHorizontal: 42,
	entryCardPaddingVertical: 32,
	entryCardGap: 26,
	rankFontSize: 44,
	rankGap: 26,
	flagSize: 42,
	flagGap: 18,
	nameFontSize: 40,
	mmrFontSize: 36,
 	rankIconSize: 48,
 	rankIconGap: 18,
};

const TIME_FILTERS = ["alltime", "weekly", "season"];
const TIME_LABELS = {
	alltime: "current",
	weekly: "past week",
	season: "this season",
};
const GAME_MODES = ["mkworld12p", "mkworld24p"];


function getPalette() {
	return {
		...(ColorPalettes.leaderboardPalette || {}),
	};
}

async function getRankIconImage(rankName) {
	const filename = PlayerStats.getRankIconFilename(rankName);
	if (!filename) {
		return null;
	}
	return loadImageResource(`bot/images/ranks/${filename}`, `rank icon ${rankName}`);
}

function getMetricValue(entry, timeFilter) {
	if (!entry) {
		return null;
	}
	if (timeFilter === "alltime") {
		const mmr = Number(entry.mmr);
		return Number.isFinite(mmr) ? mmr : null;
	}
	const metrics = entry.metrics;
	if (!metrics) {
		return null;
	}
	const rawValue = metrics[timeFilter];
	const value = Number(rawValue);
	return Number.isFinite(value) ? value : null;
}

function formatMetricText(entry, timeFilter) {
	const value = getMetricValue(entry, timeFilter);
	if (value === null) {
		return "-";
	}
	if (timeFilter === "alltime") {
		return `${MMR_NUMBER_FORMATTER.format(value)} mmr`;
	}
	if (value === 0) {
		return "+0 mmr";
	}
	const sign = value > 0 ? "+" : "-";
	const formattedMagnitude = MMR_NUMBER_FORMATTER.format(Math.abs(value));
	return `${sign}${formattedMagnitude} mmr`;
}

function compareByAlltimeMmr(a, b) {
	const aMmr = Number(a?.mmr);
	const bMmr = Number(b?.mmr);
	const aHas = Number.isFinite(aMmr);
	const bHas = Number.isFinite(bMmr);
	if (!aHas && !bHas) {
		return 0;
	}
	if (!aHas) {
		return 1;
	}
	if (!bHas) {
		return -1;
	}
	if (bMmr === aMmr) {
		return 0;
	}
	return bMmr - aMmr;
}

function compareEntriesByTimeFilter(a, b, timeFilter) {
	if (timeFilter === "alltime") {
		return compareByAlltimeMmr(a, b);
	}
	const aValue = getMetricValue(a, timeFilter);
	const bValue = getMetricValue(b, timeFilter);
	const aHas = aValue !== null;
	const bHas = bValue !== null;
	if (aHas && bHas) {
		if (bValue !== aValue) {
			return bValue - aValue;
		}
		return compareByAlltimeMmr(a, b);
	}
	if (aHas) {
		return -1;
	}
	if (bHas) {
		return 1;
	}
	return compareByAlltimeMmr(a, b);
}

function truncateText(ctx, text, maxWidth) {
	if (!text) {
		return "";
	}
	const fullWidth = ctx.measureText(text).width;
	if (fullWidth <= maxWidth) {
		return text;
	}
	const ellipsis = "...";
	const ellipsisWidth = ctx.measureText(ellipsis).width;
	if (ellipsisWidth > maxWidth) {
		return ellipsis;
	}
	let trimmed = text;
	while (trimmed.length > 0) {
		trimmed = trimmed.slice(0, -1);
		const candidate = `${trimmed}${ellipsis}`;
		if (ctx.measureText(candidate).width <= maxWidth) {
			return candidate;
		}
	}
	return ellipsis;
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
		console.warn(`leaderboard: failed to load image ${descriptor}:`, error);
		return null;
	}
}

function safeParseDate(value) {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function computeActivityFlags(mmrChanges = []) {
	let weekly = false;
	let season = false;
	let lastActivity = null;
	const cutoff = Date.now() - ONE_WEEK_MS;

	for (const change of mmrChanges) {
		const timestamp = safeParseDate(change?.time || change?.createdOn || change?.updatedOn || change?.date);
		if (timestamp) {
			if (!lastActivity || timestamp > lastActivity) {
				lastActivity = timestamp;
			}
			if (timestamp >= cutoff) {
				weekly = true;
			}
		}

		if (change?.season === undefined || change?.season === null) {
			season = true;
		}
		else if (Number(change.season) === Number(LoungeApi.DEFAULT_SEASON)) {
			season = true;
		}
	}

	return {
		alltime: true,
		weekly,
		season: season || mmrChanges.length > 0,
		lastActivity,
	};
}

function buildLeaderboardCustomId(action, { timeFilter, serverId, page, game, roleId }) {
	const safeAction = action || "time";
	const safeTime = (timeFilter && TIME_FILTERS.includes(timeFilter)) ? timeFilter : "alltime";
	const safeServer = serverId ? String(serverId) : "";
	const safePage = page ? String(page) : "1";
	const safeGame = (game && GAME_MODES.includes(game)) ? game : "mkworld12p";
	const safeRole = roleId ? String(roleId) : "";
	return ["leaderboard", safeAction, safeTime, safeServer, safePage, safeGame, safeRole].join("|");
}

function parseLeaderboardInteraction(customId) {
	if (!customId?.startsWith("leaderboard|")) {
		return null;
	}
	const parts = customId.split("|");
	if (parts.length < 3) {
		return null;
	}
	const [, action, timeFilter, serverId, page, game, roleId] = parts;
	return {
		action,
		timeFilter: TIME_FILTERS.includes(timeFilter) ? timeFilter : "alltime",
		serverId: serverId || null,
		page: page ? parseInt(page, 10) : 1,
		game: (game && GAME_MODES.includes(game)) ? game : "mkworld12p",
		roleId: roleId || null,
	};
}

function buildLeaderboardComponents({ timeFilter, serverId, page = 1, totalPages = 1, game = "mkworld12p", roleId = null }) {
	const commonParams = { timeFilter, serverId, page: 1, roleId };

	const timeRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { ...commonParams, game, timeFilter: "alltime" }))
				.setLabel("current")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "alltime"),
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { ...commonParams, game, timeFilter: "weekly" }))
				.setLabel("past week")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "weekly"),
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { ...commonParams, game, timeFilter: "season" }))
				.setLabel("this season")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "season"),
		);

	const formatRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("format", { ...commonParams, page, game: "mkworld12p" }))
				.setLabel("12p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(game === "mkworld12p"),
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("format", { ...commonParams, page, game: "mkworld24p" }))
				.setLabel("24p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(game === "mkworld24p"),
		);

	const paginationRow = new ActionRowBuilder();

	const pageParams = { timeFilter, serverId, game, roleId };

	if (totalPages > 2) {
		paginationRow.addComponents(
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("first", { ...pageParams, page: 1 }))
				.setLabel("≪")
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page <= 1),
		);
	}

	paginationRow.addComponents(
		new ButtonBuilder()
			.setCustomId(buildLeaderboardCustomId("prev", { ...pageParams, page: page - 1 }))
			.setLabel("◀")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page <= 1),
		new ButtonBuilder()
			.setCustomId(buildLeaderboardCustomId("next", { ...pageParams, page: page + 1 }))
			.setLabel("▶")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page >= totalPages),
	);

	if (totalPages > 2) {
		paginationRow.addComponents(
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("last", { ...pageParams, page: totalPages }))
				.setLabel("≫")
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page >= totalPages),
		);
	}

	paginationRow.addComponents(
		new ButtonBuilder()
			.setCustomId(buildLeaderboardCustomId("find", { ...pageParams, page }))
			.setLabel("find me")
			.setStyle(ButtonStyle.Success),
	);

	return [paginationRow, formatRow, timeRow];
}

function storeLeaderboardSession(messageId, session) {
	if (!messageId || !session) {
		return;
	}
	const payload = {
		...session,
		messageId,
		expiresAt: Date.now() + LEADERBOARD_SESSION_CACHE_TTL_MS,
	};
	setCacheEntry(leaderboardSessionCache, leaderboardSessionExpiryTimers, messageId, payload, LEADERBOARD_SESSION_CACHE_TTL_MS);
}

function getLeaderboardSession(messageId) {
	if (!messageId) {
		return null;
	}
	const session = leaderboardSessionCache.get(messageId);
	if (!session) {
		return null;
	}
	if (session.expiresAt && session.expiresAt <= Date.now()) {
		deleteCacheEntry(leaderboardSessionCache, leaderboardSessionExpiryTimers, messageId);
		return null;
	}
	refreshCacheEntry(leaderboardSessionCache, leaderboardSessionExpiryTimers, messageId, LEADERBOARD_SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + LEADERBOARD_SESSION_CACHE_TTL_MS;
	return session;
}

async function renderLeaderboardImage({
	serverName,
	timeFilter,
	gameLabel,
	entries,
	palette,
	totalEligible,
	guildIcon,
	page = 1,
	totalPages = 1,
	highlightDiscordId = null,
	highlightLoungeId = null,
}) {
	const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext("2d");
	ctx.patternQuality = "best";
	ctx.quality = "best";

	try {
		const background = await loadImageResource(BACKGROUND_RESOURCE, "background");
		if (background) {
			ctx.drawImage(background, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
		}
		else {
			throw new Error("background not available");
		}
	}
	catch (error) {
		console.warn("leaderboard: failed to load background image:", error);
		ctx.fillStyle = palette.baseColor || "#ffffff";
		ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	}

	const headerFrame = {
		left: LAYOUT.pagePadding,
		top: LAYOUT.pagePadding,
		width: CANVAS_WIDTH - LAYOUT.pagePadding * 2,
		height: LAYOUT.headerHeight,
	};

	drawRoundedPanel(ctx, headerFrame, palette.baseColor, EDGE_RADIUS);

	const timeLabel = TIME_LABELS[timeFilter] || timeFilter;
	const playerCount = Number.isFinite(totalEligible) ? totalEligible : entries.length;
	const subtitleParts = [gameLabel, timeLabel, `${playerCount} player${playerCount === 1 ? "" : "s"}`];
	if (totalPages > 1) {
		subtitleParts.push(`page ${page}/${totalPages}`);
	}
	const subtitleText = subtitleParts.join(" · ");

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";

	const titleBaseline = headerFrame.top + (headerFrame.height / 2) + LAYOUT.titleOffset;

	let textStartX = headerFrame.left + LAYOUT.headerPaddingHorizontal;
	if (guildIcon) {
		try {
			const icon = guildIcon;
			const iconSize = LAYOUT.headerTitleFontSize + (LAYOUT.headerIconSizeExtra || 0);
			const iconX = headerFrame.left + LAYOUT.headerPaddingHorizontal;
			const iconY = headerFrame.top + (headerFrame.height - iconSize) / 2;
			const iconRadius = iconSize / 2;
			const centerX = iconX + iconRadius;
			const centerY = iconY + iconRadius;

			ctx.save();
			ctx.beginPath();
			ctx.arc(centerX, centerY, iconRadius, 0, Math.PI * 2);
			ctx.fillStyle = palette.baseColor || "rgba(255,255,255,0.82)";
			ctx.fill();
			ctx.restore();

			ctx.save();
			ctx.beginPath();
			ctx.arc(centerX, centerY, iconRadius, 0, Math.PI * 2);
			ctx.clip();
			ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
			ctx.restore();

			textStartX = iconX + iconSize + (LAYOUT.headerIconGap || 0);
		}
		catch (iconError) {
			console.warn("leaderboard: failed to draw guild icon:", iconError);
		}
	}
	ctx.font = `700 ${LAYOUT.headerTitleFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
	ctx.fillStyle = palette.headerColor || "#000000";
	const maxTitleWidth = headerFrame.left + headerFrame.width - textStartX - 20;
	const fittedTitle = truncateTextWithEmojis(ctx, serverName, maxTitleWidth, {
		font: ctx.font,
		emojiSize: LAYOUT.headerTitleFontSize * 0.92,
	});
	await drawTextWithEmojis(ctx, fittedTitle, textStartX, titleBaseline, {
		font: ctx.font,
		fillStyle: ctx.fillStyle,
		emojiSize: LAYOUT.headerTitleFontSize * 0.92,
		lineHeight: LAYOUT.headerTitleFontSize * 1.2,
	});

	ctx.font = `${LAYOUT.headerSubtitleFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
	ctx.fillStyle = palette.headerColor || "#000000";
	ctx.fillText(subtitleText, textStartX, titleBaseline + LAYOUT.headerSubtitleGap + LAYOUT.headerSubtitleFontSize);
	ctx.restore();

	const headerToColumnGap = LAYOUT.entryCardGap;
	const boardFrame = {
		left: LAYOUT.pagePadding,
		top: headerFrame.top + headerFrame.height + headerToColumnGap,
		width: CANVAS_WIDTH - LAYOUT.pagePadding * 2,
		height: CANVAS_HEIGHT - (headerFrame.top + headerFrame.height + headerToColumnGap) - LAYOUT.pagePadding,
	};

	const columnGap = LAYOUT.columnGap != null ? LAYOUT.columnGap : LAYOUT.entryCardGap;
	const columnWidth = (boardFrame.width - columnGap) / 2;
	const columnHeight = boardFrame.height;

	const columns = [
		{
			left: boardFrame.left,
			top: boardFrame.top,
			width: columnWidth,
			height: columnHeight,
		},
		{
			left: boardFrame.left + columnWidth + columnGap,
			top: boardFrame.top,
			width: columnWidth,
			height: columnHeight,
		},
	];

	const leftEntries = entries.slice(0, ENTRIES_PER_COLUMN);
	const rightEntries = entries.slice(ENTRIES_PER_COLUMN, ENTRIES_PER_COLUMN * 2);

	const startRank = (page - 1) * MAX_ENTRIES + 1;

	await drawLeaderboardColumn(ctx, columns[0], leftEntries, palette, startRank, timeFilter, highlightDiscordId, highlightLoungeId);
	await drawLeaderboardColumn(ctx, columns[1], rightEntries, palette, startRank + ENTRIES_PER_COLUMN, timeFilter, highlightDiscordId, highlightLoungeId);

	const buffer = canvas.toBuffer("image/png");
	return new AttachmentBuilder(buffer, { name: "leaderboard.png" });
}

async function drawLeaderboardColumn(ctx, frame, entries, palette, startingRank, timeFilter, highlightDiscordId = null, highlightLoungeId = null) {
	if (!entries.length) {
		return;
	}

	const cardGap = LAYOUT.entryCardGap;
	const innerHeight = frame.height;
	const totalGap = Math.max(ENTRIES_PER_COLUMN - 1, 0) * cardGap;
	const cardHeight = (innerHeight - totalGap) / ENTRIES_PER_COLUMN;

	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const cardTop = frame.top + index * (cardHeight + cardGap);
		const cardFrame = {
			left: frame.left,
			top: cardTop,
			width: frame.width,
			height: cardHeight,
		};
		const centerY = cardFrame.top + cardFrame.height / 2;
		const rankText = `#${startingRank + index}`;
		const valueText = formatMetricText(entry, timeFilter);
		const metricValue = getMetricValue(entry, timeFilter);

		drawRoundedPanel(ctx, cardFrame, palette.baseColor || "#ffffff", LAYOUT.entryCardRadius, {
			highlightOpacity: 0.08,
		});

		ctx.save();
		ctx.font = `700 ${LAYOUT.mmrFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
		const valueWidth = ctx.measureText(valueText).width;
		ctx.restore();

		const valueX = cardFrame.left + cardFrame.width - LAYOUT.entryCardPaddingHorizontal;
		const rankIconImage = await getRankIconImage(entry.rankName);
		const iconSize = LAYOUT.rankIconSize;
		const hasRankIcon = Boolean(rankIconImage && iconSize > 0);
		const iconGap = hasRankIcon ? LAYOUT.rankIconGap : 0;
		const iconSpace = hasRankIcon ? iconSize + iconGap : 0;
		const maxNameRight = valueX - valueWidth - iconSpace - LAYOUT.rankGap;
		let currentX = cardFrame.left + LAYOUT.entryCardPaddingHorizontal;

		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = `700 ${LAYOUT.rankFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
		ctx.fillStyle = palette.leaderboardTextColor || "#000000";
		ctx.fillText(rankText, currentX, centerY);
		const rankWidth = ctx.measureText(rankText).width;
		currentX += rankWidth + LAYOUT.rankGap;

		const flag = entry.flagEmoji;
		if (flag) {
			try {
				await drawEmoji(ctx, flag, currentX, centerY - LAYOUT.flagSize / 2, LAYOUT.flagSize);
				currentX += LAYOUT.flagSize + LAYOUT.flagGap;
			}
			catch (error) {
				console.warn("leaderboard: failed to draw flag icon:", error);
			}
		}

		const nameMaxWidth = Math.max(maxNameRight - currentX, 0);
		const nameValue = entry.displayName || entry.playerDetails?.name || `player ${entry.loungeId}`;
		const isHighlightedEntry = (
			highlightDiscordId && String(entry?.discordId) === String(highlightDiscordId)
		) || (
			highlightLoungeId && String(entry?.loungeId) === String(highlightLoungeId)
		);
		ctx.font = `600 ${LAYOUT.nameFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
		ctx.fillStyle = isHighlightedEntry
			? (palette.valuePositiveColor || palette.leaderboardTextColor || "#000000")
			: (palette.leaderboardTextColor || "#000000");
		const fittedName = truncateTextWithEmojis(ctx, nameValue, nameMaxWidth, {
			font: ctx.font,
			emojiSize: LAYOUT.nameFontSize * 0.92,
		});
		await drawTextWithEmojis(ctx, fittedName, currentX, centerY, {
			font: ctx.font,
			fillStyle: ctx.fillStyle,
			emojiSize: LAYOUT.nameFontSize * 0.92,
			baseline: "middle",
			textAlign: "left",
		});
		ctx.restore();

		ctx.save();
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		ctx.font = `700 ${LAYOUT.mmrFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
		let valueColor = palette.leaderboardTextColor || "#000000";
		if (timeFilter !== "alltime") {
			if (metricValue === null) {
				valueColor = palette.leaderboardTextColor || "#000000";
			}
			else {
				valueColor = metricValue >= 0
					? (palette.valuePositiveColor || palette.leaderboardTextColor || "#000000")
					: (palette.valueNegativeColor || palette.leaderboardTextColor || "#000000");
			}
		}
		ctx.fillStyle = valueColor;
		if (hasRankIcon) {
			try {
				const iconX = valueX - valueWidth - iconGap - iconSize;
				ctx.drawImage(rankIconImage, iconX, centerY - iconSize / 2, iconSize, iconSize);
			}
			catch (iconError) {
				console.warn("leaderboard: failed to draw rank icon:", iconError);
			}
		}
		ctx.fillText(valueText, valueX, centerY);
		ctx.restore();
	}
}

async function collectLeaderboardEntries(interaction, roleId = null) {
	// Ensure cache is complete
	if (interaction.guild.memberCount > interaction.guild.members.cache.size) {
		try {
			await interaction.editReply("fetching server members...");
			await interaction.guild.members.fetch();
		}
		catch (e) {
			console.warn("leaderboard: failed to fetch members:", e);
		}
	}

	// Use the global cache which is populated on startup
	const members = interaction.guild.members.cache;
	let memberList = Array.from(members.values()).filter(m => !m.user.bot);

	if (roleId) {
		memberList = memberList.filter(m => m.roles.cache.has(roleId));
	}

	const entries12p = [];
	const entries24p = [];
	const BATCH_SIZE = 5;
	const total = memberList.length;

	for (let i = 0; i < total; i += BATCH_SIZE) {
		const batch = memberList.slice(i, i + BATCH_SIZE);
		if (i % 20 === 0 && i > 0) {
			try {
				await interaction.editReply(`scanning members... (${i}/${total})`);
			}
			catch (e) { /* ignore */ }
		}

		const promises = batch.map(async (member) => {
			try {
				const [details12p, details24p] = await Promise.all([
					LoungeApi.getPlayerByDiscordIdDetailed(member.id, LoungeApi.DEFAULT_SEASON, "mkworld12p"),
					LoungeApi.getPlayerByDiscordIdDetailed(member.id, LoungeApi.DEFAULT_SEASON, "mkworld24p"),
				]);

				const processDetails = (details) => {
					if (!details) return null;
					const mmr = Number(details.mmr ?? details.currentMmr ?? details.mmrValue);
					if (!Number.isFinite(mmr)) return null;
					const loungeId = details?.id ?? details?.loungeId ?? details?.playerId;
					if (loungeId === undefined || loungeId === null) return null;

					const mmrChanges = Array.isArray(details.mmrChanges) ? details.mmrChanges : [];
					const activity = computeActivityFlags(mmrChanges);
					const weeklyDelta = PlayerStats.computeMmrDeltaForFilter({
						playerDetails: details,
						timeFilter: "weekly",
					});
					const seasonDelta = PlayerStats.computeMmrDeltaForFilter({
						playerDetails: details,
						timeFilter: "season",
					});

					return {
						loungeId: String(loungeId),
						discordId: String(member.id),
						mmr,
						activity,
						countryCode: details.countryCode || null,
						rankName: details.rankName || details.rank || null,
						metrics: {
							alltime: mmr,
							weekly: weeklyDelta,
							season: seasonDelta,
						},
						playerDetails: {
							name: details.name || details.loungeName || null,
						},
						displayName: member.user.displayName,
						flagEmoji: getCountryFlag(details.countryCode),
					};
				};

				return {
					entry12p: processDetails(details12p),
					entry24p: processDetails(details24p),
				};
			}
			catch (error) {
				return null;
			}
		});

		const results = await Promise.all(promises);
		for (const result of results) {
			if (result) {
				if (result.entry12p) entries12p.push(result.entry12p);
				if (result.entry24p) entries24p.push(result.entry24p);
			}
		}
	}

	entries12p.sort((a, b) => b.mmr - a.mmr);
	entries24p.sort((a, b) => b.mmr - a.mmr);

	// Hydrate immediately to fix display names
	// Wait, hydrateEntryDisplay is async?
	// No, it handles fallback logic.
	// We can do it in generateLeaderboard or here.

	return { entries12p, entries24p };
}

async function hydrateEntryDisplay(interaction, entry) {
	if (entry.displayName) {
		return entry;
	}
	// Fallback if somehow missing
	const fallbackName = entry.playerDetails?.name || `player ${entry.loungeId}`;
	entry.displayName = fallbackName;
	entry.flagEmoji = entry.flagEmoji || "";
	return entry;
}

async function generateLeaderboard(interaction, {
	timeFilter = "alltime",
	page = 1,
	game = "mkworld12p",
	roleId = null,
	session: existingSession = null,
	highlightDiscordId = null,
	highlightLoungeId = null,
} = {}) {
	const serverId = interaction.guildId;
	const selectedGame = game || existingSession?.game || "mkworld12p";
	const selectedRoleId = roleId || existingSession?.roleId || null;
	const gameLabel = selectedGame.includes("24p") ? "24p" : "12p";

	let roleName = "";
	if (selectedRoleId) {
		const role = interaction.guild.roles.cache.get(selectedRoleId);
		if (role) {
			roleName = ` (${role.name})`;
		}
	}

	const guildName = (interaction.guild?.name || "server") + roleName + " leaderboard";
	const palette = getPalette();

	// If no session, make a dummy one for logic below, but we'll overwrite it
	let session = existingSession;
	if (!session) {
		session = {
			serverId,
			serverName: guildName,
			game: selectedGame,
			roleId: selectedRoleId,
			entries: [],
			generatedAt: 0,
		};
	}

	// Regenerate session (fetch data) if cache is stale or if role changed
	const isStale = (Date.now() - (session.generatedAt || 0)) > (5 * 60 * 1000);
	const hasEntries = session.entries12p?.length > 0 || session.entries24p?.length > 0;

	if (!hasEntries || session.roleId !== selectedRoleId || isStale) {
		await interaction.editReply("scanning members...");
		const { entries12p, entries24p } = await collectLeaderboardEntries(interaction, selectedRoleId);
		session = {
			...session,
			serverId,
			serverName: guildName,
			game: selectedGame, // Just for reference
			roleId: selectedRoleId,
			entries12p,
			entries24p,
			generatedAt: Date.now(),
		};
	}

	await interaction.editReply("sorting players...");

	// Select the correct list based on game mode
	const currentEntries = selectedGame.includes("24p") ? (session.entries24p || []) : (session.entries12p || []);

	const pool = currentEntries.filter(entry => {
		if (timeFilter === "alltime") return true;
		return Boolean(entry.activity?.[timeFilter]);
	});

	if (!pool.length) {
		const components = buildLeaderboardComponents({ timeFilter, serverId, page: 1, totalPages: 1, game: selectedGame, roleId: selectedRoleId });
		return {
			success: false,
			message: `no tracked players have mmr data for ${TIME_LABELS[timeFilter] || timeFilter}.`,
			components,
		};
	}

	const sortedPool = [...pool].sort((a, b) => compareEntriesByTimeFilter(a, b, timeFilter));

	const totalPages = Math.ceil(sortedPool.length / MAX_ENTRIES) || 1;
	const safePage = Math.max(1, Math.min(page, totalPages));
	const startIndex = (safePage - 1) * MAX_ENTRIES;
	const endIndex = startIndex + MAX_ENTRIES;
	const topEntries = sortedPool.slice(startIndex, endIndex);

	for (const entry of topEntries) {
		await hydrateEntryDisplay(interaction, entry);
	}

	await interaction.editReply("rendering image...");

	const guildIconUrl = interaction.guild?.iconURL({ extension: "png", size: 256 }) || null;
	const guildIconImage = guildIconUrl ? await loadImageResource(guildIconUrl, "guild icon") : null;
	const iconForRender = guildIconImage;

	const attachment = await renderLeaderboardImage({
		serverName: session.serverName || guildName,
		timeFilter,
		gameLabel,
		entries: topEntries,
		palette,
		totalEligible: pool.length,
		guildIcon: iconForRender,
		page: safePage,
		totalPages,
		highlightDiscordId,
		highlightLoungeId,
	});

	session = {
		...session,
		timeFilter,
		page: safePage,
		totalPages,
		pendingTimeFilter: null,
		activeRequestToken: null,
	};

	const components = buildLeaderboardComponents({
		timeFilter,
		serverId,
		page: safePage,
		totalPages,
		game: selectedGame, // Fix: pass game mode to component builder
		roleId: selectedRoleId,
	});

	return {
		success: true,
		content: "",
		files: [attachment],
		components,
		session: {
			...session,
			timeFilter,
			game: selectedGame,
			roleId: selectedRoleId,
			page: safePage,
			totalPages,
		},
	};
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("see your server's mmr leaderboard.")
		.addRoleOption(option =>
			option.setName("role")
				.setDescription("filter by role")
				.setRequired(false),
		),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			if (!interaction.inGuild()) {
				await interaction.editReply("this command can only be used inside a server.");
				return;
			}

			const role = interaction.options.getRole("role");
			const roleId = role ? role.id : null;

			const result = await generateLeaderboard(interaction, {
				timeFilter: "alltime",
				page: 1,
				game: "mkworld12p",
				roleId,
			});

			if (!result.success) {
				await interaction.editReply({
					content: result.message || "unable to build leaderboard.",
					components: result.components || [],
					files: [],
				});
				return;
			}

			const replyMessage = await interaction.editReply({
				content: "",
				files: result.files,
				components: result.components,
			});

			if (replyMessage && result.session) {
				storeLeaderboardSession(replyMessage.id, result.session);
			}
		}
		catch (error) {
			console.error("leaderboard command error:", error);
			try {
				await interaction.editReply({ content: "error: something went wrong while generating the leaderboard." });
			}
			catch (editError) {
				console.error("leaderboard: failed to send error message:", editError);
			}
		}
	},

	async handleButtonInteraction(interaction) {
		const parsed = parseLeaderboardInteraction(interaction.customId);
		if (!parsed) {
			return false;
		}

		try {
			const messageId = interaction.message?.id || null;
			const session = messageId ? getLeaderboardSession(messageId) : null;
			const fallbackTimeFilter = parsed.timeFilter || "alltime";

			// If we don't have a session, we need to reconstruct basic context or fail gracefully.
			// However, parseLeaderboardInteraction returns serverId, so we might be able to restart if needed,
			// but we'd lose the original role filter if it wasn't encoded in the button.
			// Luckily we added roleId to the customId parser now!

			const nextTimeFilter = parsed.timeFilter || (session ? session.timeFilter : fallbackTimeFilter);
			let requestedPage = parsed.page || 1;
			const nextGame = parsed.game || (session ? session.game : "mkworld12p");
			const nextRoleId = parsed.roleId || (session ? session.roleId : null);
			let highlightDiscordId = null;
			let highlightLoungeId = null;

			if (parsed.action === "find" && !session) {
				await interaction.deferUpdate();

				const seedResult = await generateLeaderboard(interaction, {
					timeFilter: nextTimeFilter,
					page: 1,
					game: nextGame,
					roleId: nextRoleId,
					session: null,
				});

				if (!seedResult.success) {
					await interaction.editReply({
						content: seedResult.message || "unable to update leaderboard.",
						files: [],
						components: seedResult.components || [],
					});
					return true;
				}

				const freshSession = seedResult.session;
				const currentEntries = nextGame.includes("24p") ? (freshSession?.entries24p || []) : (freshSession?.entries12p || []);
				const userId = String(interaction.user.id);
				const hasAccountForFormat = currentEntries.some(entry => String(entry?.discordId) === userId);
				let fallbackLoungeId = null;
				if (!hasAccountForFormat) {
					try {
						const direct = await LoungeApi.getPlayerByDiscordIdDetailed(interaction.user.id, LoungeApi.DEFAULT_SEASON, nextGame);
						if (direct?.id !== undefined && direct?.id !== null) {
							fallbackLoungeId = String(direct.id);
						}
					}
					catch (lookupError) {
						console.warn("leaderboard find me fallback lookup failed:", lookupError);
					}
				}

				if (!hasAccountForFormat && !fallbackLoungeId) {
					await interaction.followUp({
						content: "you don't appear to have a lounge account for this format.",
						ephemeral: true,
					});
					if (messageId && seedResult.session) {
						storeLeaderboardSession(messageId, seedResult.session);
					}
					return true;
				}

				const pool = currentEntries.filter(entry => {
					if (nextTimeFilter === "alltime") return true;
					return Boolean(entry.activity?.[nextTimeFilter]);
				});
				const sortedPool = [...pool].sort((a, b) => compareEntriesByTimeFilter(a, b, nextTimeFilter));

				const targetIndex = sortedPool.findIndex(entry => {
					if (String(entry?.discordId) === userId) return true;
					if (fallbackLoungeId && String(entry?.loungeId) === fallbackLoungeId) return true;
					return false;
				});

				if (targetIndex < 0) {
					await interaction.followUp({
						content: "you're not present on this leaderboard for the selected filters.",
						ephemeral: true,
					});
					if (messageId && seedResult.session) {
						storeLeaderboardSession(messageId, seedResult.session);
					}
					return true;
				}

				requestedPage = Math.floor(targetIndex / MAX_ENTRIES) + 1;
				highlightDiscordId = userId;
				highlightLoungeId = String(sortedPool[targetIndex]?.loungeId || fallbackLoungeId || "");
				const finalResult = await generateLeaderboard(interaction, {
					timeFilter: nextTimeFilter,
					page: requestedPage,
					game: nextGame,
					roleId: nextRoleId,
					session: freshSession,
					highlightDiscordId,
					highlightLoungeId,
				});

				if (!finalResult.success) {
					await interaction.editReply({
						content: finalResult.message || "unable to update leaderboard.",
						files: [],
						components: finalResult.components || [],
					});
					return true;
				}

				await interaction.editReply({
					content: "",
					files: finalResult.files,
					components: finalResult.components,
				});

				if (messageId && finalResult.session) {
					storeLeaderboardSession(messageId, {
						...finalResult.session,
						pendingTimeFilter: null,
						activeRequestToken: null,
					});
				}

				return true;
			}

			if (parsed.action === "find") {
				const currentEntries = nextGame.includes("24p") ? (session.entries24p || []) : (session.entries12p || []);
				const userId = String(interaction.user.id);
				const hasAccountForFormat = currentEntries.some(entry => String(entry?.discordId) === userId);
				let fallbackLoungeId = null;
				if (!hasAccountForFormat) {
					try {
						const direct = await LoungeApi.getPlayerByDiscordIdDetailed(interaction.user.id, LoungeApi.DEFAULT_SEASON, nextGame);
						if (direct?.id !== undefined && direct?.id !== null) {
							fallbackLoungeId = String(direct.id);
						}
					}
					catch (lookupError) {
						console.warn("leaderboard find me fallback lookup failed:", lookupError);
					}
				}

				if (!hasAccountForFormat && !fallbackLoungeId) {
					await interaction.reply({
						content: "you don't appear to have a lounge account for this format.",
						ephemeral: true,
					});
					return true;
				}

				const pool = currentEntries.filter(entry => {
					if (nextTimeFilter === "alltime") return true;
					return Boolean(entry.activity?.[nextTimeFilter]);
				});
				const sortedPool = [...pool].sort((a, b) => compareEntriesByTimeFilter(a, b, nextTimeFilter));

				const targetIndex = sortedPool.findIndex(entry => {
					if (String(entry?.discordId) === userId) return true;
					if (fallbackLoungeId && String(entry?.loungeId) === fallbackLoungeId) return true;
					return false;
				});
				if (targetIndex < 0) {
					await interaction.reply({
						content: "you're not present on this leaderboard for the selected filters.",
						ephemeral: true,
					});
					return true;
				}

				requestedPage = Math.floor(targetIndex / MAX_ENTRIES) + 1;
				highlightDiscordId = userId;
				highlightLoungeId = String(sortedPool[targetIndex]?.loungeId || fallbackLoungeId || "");
			}

			let totalPages = 1;

			// Check if we need to regenerate data (format or role changed)
			const needsDataRefresh = !session || session.game !== nextGame || session.roleId !== nextRoleId;

			if (!needsDataRefresh && session && session.timeFilter === nextTimeFilter) {
				// If filter hasn't changed and data is same, we can trust session.totalPages
				totalPages = session.totalPages || 1;
			}

			if (session) {
				session.pendingTimeFilter = nextTimeFilter;
			}

			const components = buildLeaderboardComponents({
				timeFilter: nextTimeFilter,
				serverId: parsed.serverId || interaction.guildId,
				page: requestedPage,
				totalPages: totalPages,
				game: nextGame,
				roleId: nextRoleId,
			});

			await interaction.update({ components });

			const renderToken = beginLeaderboardRender(messageId);
			if (session) {
				session.activeRequestToken = renderToken;
			}

			let result;
			try {
				result = await generateLeaderboard(interaction, {
					timeFilter: nextTimeFilter,
					page: requestedPage,
					game: nextGame,
					roleId: nextRoleId,
					session,
					highlightDiscordId,
					highlightLoungeId,
				});

				if (isLeaderboardRenderActive(messageId, renderToken)) {
					if (!result.success) {
						await interaction.editReply({
							content: result.message || "unable to update leaderboard.",
							files: [],
							components: result.components || [],
						});
					}
					else {
						await interaction.editReply({
							content: "",
							files: result.files,
							components: result.components,
						});
						if (messageId && result.session) {
							storeLeaderboardSession(messageId, {
								...result.session,
								pendingTimeFilter: null,
								activeRequestToken: null,
							});
						}
					}
				}
			}
			finally {
				endLeaderboardRender(messageId, renderToken);
				if (session) {
					session.pendingTimeFilter = null;
					session.activeRequestToken = null;
				}
			}

			return true;
		}
		catch (error) {
			console.error("leaderboard button interaction error:", error);
			return false;
		}
	},
};