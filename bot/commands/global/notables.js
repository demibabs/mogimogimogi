const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("canvas");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const DataManager = require("../../utils/dataManager");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");
const GameData = require("../../utils/gameData");
const ColorPalettes = require("../../utils/colorPalettes");
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
	loadFavoriteCharacterImage,
	loadFavoriteVehicleImage,
	loadWebPAsPng,
	getCountryFlag,
	drawEmoji,
	drawTextWithEmojis,
	truncateTextWithEmojis,
} = EmbedEnhancer;

const EDGE_RADIUS = 30;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const NOTABLES_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

const notablesSessionCache = new Map();
const notablesSessionExpiryTimers = new Map();
const notablesRenderTokens = new Map();

function beginNotablesRender(messageId) {
	if (!messageId) {
		return null;
	}
	const token = Symbol("notablesRender");
	notablesRenderTokens.set(messageId, token);
	return token;
}

function isNotablesRenderActive(messageId, token) {
	if (!messageId || !token) {
		return true;
	}
	return notablesRenderTokens.get(messageId) === token;
}

function endNotablesRender(messageId, token) {
	if (!messageId || !token) {
		return;
	}
	if (notablesRenderTokens.get(messageId) === token) {
		notablesRenderTokens.delete(messageId);
	}
}

const EVENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

const LAYOUT = {
	pagePadding: 75,
	columnGap: 45,
	sectionGap: 35,
	headerHeight: 120,
	headerPaddingHorizontal: 60,
	headerPaddingVertical: 14,
	headerTitleFontSize: 60,
	headerSubtitleFontSize: 30,
	headerSubtitleGap: 10,
	headerTextVerticalAdjustment: -8,
	headerEmojiSize: 54,
	headerEmojiGap: 22,
	headerFavoriteMaxSize: 100,
	headerAvatarSize: 100,
	headerAvatarRadius: 30,
	headerAssetGap: 28,
	headerAssetOffsetX: 48,
	columnPadding: 46,
	eventTitleFontSize: 37,
	eventTitleOpacity: 0.5,
	eventTitleGap: 12,
	eventBodyFontSize: 36,
	eventGap: 44,
	footnoteFontSize: 30,
	eventFootnoteOpacity: 0.4,
};

const goodBSMessages = [
	"nice!",
	"excellent work!",
	"can you do even better?",
	"skill was on your side that day. (or luck...)",
	"typical mogi for the goat.",
	"why can't every mogi be this good?",
	"cheating?",
	"luck was on your side that day. (or skill...)",
	"isn't this game so good when you win?",
	"unstoppable.",
	"#gonein1.",
	"holy moly!",
];

const badBSMessages = [
	"great score, but not good enough for 1st :(",
	"guess someone else was cooking even harder.",
	"someone had to steal your thunder i guess.",
	"i know you have at least 10 more points in you!",
];

const goodWSMessages = [
	"if that sucked, think about whoever you beat.",
	"your worst ever and you didn't get last? we take it.",
	"ouch.",
	"at least you beat somebody!",
	"hey, losing makes winning feel even better!",
	"sometimes when you gamble, you lose.",
	"you suck. (jk.)",
	"only uphill from here, at least?",
	"a record you should hope NOT to beat.",
];

const badWSMessages = [
	"gaming isn't for everyone. maybe try sports?",
	"yowch.",
	"at least you beat somebody! wait, no you didn't.",
	"thanks for donating your mmr to those other players.",
	"can't blame any teammates for that one.",
	"you suck.",
	"i don't even have a joke. that was just sad.",
];

const oPMessages = [
	"against all odds!",
	"they never saw it coming.",
	"they underestimated you, but i knew you were like that.",
	"great job!",
	"holy w.",
	"how do you do it?",
	"the up and coming goat.",
	"you're overpowered.",
	"i went to underrated town and they all knew you.",
	"better than the movies!",
];

const uPMessages = [
	"well, even lightning mcqueen has lost races before.",
	"but you were just unlucky, right?",
	"oof.",
	"guess the room was punching above its weight.",
	"washed?",
	"yikes.",
	"everyone was silently judging you.",
	"not your mogi.",
	"what a sell.",
	"ur gameplay was wurse than my speling.",
	"you were among the best in the room, but only in theory.",
	"bro is throwing.",
];

const bCMessages = [
	"someone had to pick up the slack.",
	"does your back hurt?",
	"you did everything you could.",
	"impressive!",
	"did the rest of your team suck or are you just that good?",
	"you're the type of mate we all need.",
	"holy carry.",
	"lebron type performance.",
	"everyone else had a team but you had to fly solo.",
	"we all know how that feels. not good.",
];

const bAMessages = [
	"smh.",
	"your team needed you, but you vanished.",
	"someone had to pick up the slack, and it wasn't you.",
	"ow.",
	"thank god for teammates.",
	"bad day?",
	"they call you the Partner Average Killer.",
	"tip: having a team doesn't mean you take the day off.",
	"hopefully your team doesn't hold grudges.",
	"you had one job.",
];

function getRandomMessage(pool) {
	if (!pool) return "";
	if (Array.isArray(pool) && pool.length) {
		const index = Math.floor(Math.random() * pool.length);
		return pool[index];
	}
	if (typeof pool === "string") {
		return pool;
	}
	return "";
}

async function loadImageResource(resource) {
	if (!resource) {
		return null;
	}
	try {
		return await loadImage(resource);
	}
	catch (error) {
		console.warn(`failed to load image ${resource}:`, error);
		return null;
	}
}

function wrapText(ctx, text, maxWidth) {
	if (!text) {
		return [];
	}
	const lines = [];
	const paragraphs = String(text).split(/\n+/);
	for (const paragraph of paragraphs) {
		const words = paragraph.trim().split(/\s+/).filter(Boolean);
		if (!words.length) {
			lines.push("");
			continue;
		}
		let current = words.shift();
		for (const word of words) {
			const candidate = `${current} ${word}`;
			if (ctx.measureText(candidate).width <= maxWidth) {
				current = candidate;
			}
			else {
				lines.push(current);
				current = word;
			}
		}
		if (current) {
			lines.push(current);
		}
	}
	return lines;
}

function buildNotablesCustomId(action, { timeFilter, queueFilter, playerCountFilter, loungeId }) {
	const safeAction = action || "time";
	const safeTime = timeFilter || "alltime";
	const safeQueue = queueFilter || "both";
	const safePlayers = playerCountFilter || "both";
	const safeLounge = loungeId ?? "";
	return ["notables", safeAction, safeTime, safeQueue, safePlayers, safeLounge].join("|");
}

function buildNotablesComponentRows({ loungeId, timeFilter, queueFilter, playerCountFilter }) {
	const safeTime = timeFilter || "alltime";
	const safeQueue = queueFilter || "both";
	const safePlayerCount = playerCountFilter || "both";
	const rows = [];

	const timeRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("time", { timeFilter: "alltime", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("all time")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "alltime"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("time", { timeFilter: "weekly", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("past week")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "weekly"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("time", { timeFilter: "season", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("this season")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "season"),
		);
	rows.push(timeRow);

	const queueRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("queue", { timeFilter: safeTime, queueFilter: "soloq", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("soloq")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "soloq"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("queue", { timeFilter: safeTime, queueFilter: "squads", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("squads")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "squads"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("queue", { timeFilter: safeTime, queueFilter: "both", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("both")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "both"),
		);
	rows.push(queueRow);

	const playerRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "12p", loungeId }))
				.setLabel("12p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "12p"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "24p", loungeId }))
				.setLabel("24p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "24p"),
			new ButtonBuilder()
				.setCustomId(buildNotablesCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "both", loungeId }))
				.setLabel("both")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "both"),
		);
	rows.push(playerRow);

	return rows;
}

function parseNotablesInteraction(customId) {
	if (!customId?.startsWith("notables|")) {
		return null;
	}
	const parts = customId.split("|");
	if (parts.length < 6) {
		return null;
	}
	const [, actionRaw, timeRaw, queueRaw, playerRaw, loungeId] = parts;
	return {
		action: (actionRaw || "").toLowerCase(),
		timeFilter: (timeRaw || "alltime").toLowerCase(),
		queueFilter: (queueRaw || "both").toLowerCase(),
		playerCountFilter: (playerRaw || "both").toLowerCase(),
		loungeId,
	};
}

function getNotablesSession(messageId) {
	if (!messageId) {
		return null;
	}
	const session = notablesSessionCache.get(messageId);
	if (!session) {
		return null;
	}
	if (session.expiresAt && session.expiresAt <= Date.now()) {
		deleteCacheEntry(notablesSessionCache, notablesSessionExpiryTimers, messageId);
		return null;
	}
	refreshCacheEntry(notablesSessionCache, notablesSessionExpiryTimers, messageId, NOTABLES_SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + NOTABLES_SESSION_CACHE_TTL_MS;
	return session;
}

function storeNotablesSession(messageId, session) {
	if (!messageId || !session) {
		return;
	}
	const expiresAt = Date.now() + NOTABLES_SESSION_CACHE_TTL_MS;
	const payload = {
		...session,
		messageId,
		expiresAt,
	};
	setCacheEntry(notablesSessionCache, notablesSessionExpiryTimers, messageId, payload, NOTABLES_SESSION_CACHE_TTL_MS);
}

function refreshNotablesSession(messageId) {
	if (!messageId) {
		return;
	}
	const session = notablesSessionCache.get(messageId);
	if (!session) {
		return;
	}
	refreshCacheEntry(notablesSessionCache, notablesSessionExpiryTimers, messageId, NOTABLES_SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + NOTABLES_SESSION_CACHE_TTL_MS;
}

function getTableTimestamp(table) {
	if (!table) {
		return null;
	}
	const raw = table.verifiedOn || table.createdOn || table.date || table.updatedOn;
	if (!raw) {
		return null;
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTableDescriptor(table) {
	if (!table) {
		return "event details unavailable";
	}
	const date = getTableTimestamp(table);
	const formattedDate = date ? EVENT_DATE_FORMATTER.format(date) : "date unknown";
	const count = table.numPlayers ?? table.numplayers ?? table.playerCount;
	const format = table.format || table.queue || "room";
	return `${formattedDate} • ${count || "?"}p ${format}`;
}

function buildColumnEvents({ filteredTables, loungeId, metrics }) {
	const { bestScore, worstScore, overperformance, underperformance, carry, anchor } = metrics;
	const getTable = tableId => filteredTables?.[tableId] || null;

	const goodEvents = [
		bestScore && {
			title: "best score",
			tableId: bestScore.tableId,
			table: getTable(bestScore.tableId),
			description: (() => {
				const table = getTable(bestScore.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const message = getRandomMessage(bestScore.placement === 1 ? goodBSMessages : badBSMessages);
				const placementWord = bestScore.placement === 1 ? "and" : "but";
				return `${descriptor}\nyou scored ${bestScore.score} ${placementWord} finished rank ${bestScore.placement}. ${message}`;
			})(),
		},
		overperformance && {
			title: "biggest overperformance",
			tableId: overperformance.tableId,
			table: getTable(overperformance.tableId),
			description: (() => {
				const table = getTable(overperformance.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const message = getRandomMessage(oPMessages);
				return `${descriptor}\nyou were seed ${overperformance.placement + overperformance.overperformance} but scored ${overperformance.score} and finished rank ${overperformance.placement}. ${message}`;
			})(),
		},
		carry && {
			title: "biggest carry",
			tableId: carry.tableId,
			table: getTable(carry.tableId),
			description: (() => {
				const table = getTable(carry.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const teammateLabel = table.format === "2v2" ? "mate scored" : "teammates averaged";
				const message = getRandomMessage(bCMessages);
				const mateScore = carry.score - carry.carryAmount;
				return `${descriptor}\nyou were rank ${carry.placement} and scored ${carry.score} while your ${teammateLabel} ${mateScore}. ${message}`;
			})(),
		},
	].filter(Boolean);

	const badEvents = [
		worstScore && {
			title: "worst score",
			tableId: worstScore.tableId,
			table: getTable(worstScore.tableId),
			description: (() => {
				const table = getTable(worstScore.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const message = getRandomMessage(worstScore.placement === table.numPlayers ? badWSMessages : goodWSMessages);
				return `${descriptor}\nyou scored ${worstScore.score} and were rank ${worstScore.placement}. ${message}`;
			})(),
		},
		underperformance && {
			title: "biggest underperformance",
			tableId: underperformance.tableId,
			table: getTable(underperformance.tableId),
			description: (() => {
				const table = getTable(underperformance.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const message = getRandomMessage(uPMessages);
				return `${descriptor}\nyou were seed ${underperformance.placement + underperformance.underperformance} but scored ${underperformance.score} and ended up rank ${underperformance.placement}. ${message}`;
			})(),
		},
		anchor && {
			title: "biggest anchor",
			tableId: anchor.tableId,
			table: getTable(anchor.tableId),
			description: (() => {
				const table = getTable(anchor.tableId);
				if (!table) return null;
				const descriptor = formatTableDescriptor(table);
				const teammateLabel = table.format === "2v2" ? "mate scored" : "teammates averaged";
				const message = getRandomMessage(bAMessages);
				const mateScore = anchor.score - anchor.anchorAmount;
				return `${descriptor}\nyou were rank ${anchor.placement} and scored ${anchor.score} while your ${teammateLabel} ${mateScore}. ${message}`;
			})(),
		},
	].filter(Boolean);

	return { goodEvents, badEvents };
}

function buildTableLinksMessage(events) {
	const parts = [];
	for (const event of events) {
		const tableId = event?.tableId ?? event?.table?.id;
		if (!tableId) continue;
		const normalizedId = String(tableId).trim();
		if (!normalizedId) continue;
		const link = `https://lounge.mkcentral.com/mkworld/TableDetails/${normalizedId}`;
		const label = event?.title ? `${event.title}` : "";
		parts.push(`[${label}](${link})`.trim());
	}
	return "**links:** " + parts.join(", ");
}

function drawEventsColumn(ctx, frame, trackColors, events) {
	drawRoundedPanel(ctx, frame, trackColors.baseColor, EDGE_RADIUS);
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	const titleFont = `600 ${LAYOUT.eventTitleFontSize}px Lexend`;
	const bodyFontRegular = `${LAYOUT.footnoteFontSize}px Lexend`;
	const bodyFontBold = `500 ${LAYOUT.eventBodyFontSize}px Lexend`;
	const bodyLineHeight = LAYOUT.eventBodyFontSize * 1.32;
	const contentWidth = frame.width - LAYOUT.columnPadding * 2;
	const processed = [];

	ctx.font = bodyFontBold;
	for (const event of events) {
		if (!event?.description) continue;
		const bodyLines = wrapText(ctx, event.description, contentWidth);
		processed.push({
			...event,
			bodyLines,
			contentHeight: LAYOUT.eventTitleFontSize + LAYOUT.eventTitleGap + bodyLines.length * bodyLineHeight,
		});
	}

	if (!processed.length) {
		ctx.restore();
		return;
	}

	const topY = frame.top + LAYOUT.columnPadding;
	const bottomY = frame.top + frame.height - LAYOUT.columnPadding;
	const availableHeight = bottomY - topY;
	const totalContentHeight = processed.reduce((sum, event) => sum + event.contentHeight, 0);
	let gapSize = 0;
	let cursorY = topY;

	if (processed.length === 1) {
		const extra = Math.max(availableHeight - totalContentHeight, 0);
		cursorY = topY + extra;
	}
	else if (processed.length > 1) {
		gapSize = Math.max((availableHeight - totalContentHeight) / (processed.length - 1), 0);
	}

	for (let index = 0; index < processed.length; index++) {
		const event = processed[index];
		ctx.font = titleFont;
		const textColor = trackColors.statsTextColor || "#333333";
		ctx.fillStyle = textColor;
		ctx.globalAlpha = LAYOUT.eventTitleOpacity;
		ctx.fillText(event.title, frame.left + LAYOUT.columnPadding, cursorY);
		ctx.globalAlpha = 1;
		cursorY += LAYOUT.eventTitleFontSize;
		cursorY += LAYOUT.eventTitleGap;

		ctx.fillStyle = textColor;
		for (let lineIndex = 0; lineIndex < event.bodyLines.length; lineIndex++) {
			const line = event.bodyLines[lineIndex];
			const isFootnote = lineIndex === 0;
			ctx.font = isFootnote ? bodyFontRegular : bodyFontBold;
			ctx.globalAlpha = isFootnote ? LAYOUT.eventFootnoteOpacity : 1;
			ctx.fillText(line, frame.left + LAYOUT.columnPadding, cursorY);
			cursorY += bodyLineHeight;
		}
		ctx.globalAlpha = 1;

		if (index < processed.length - 1) {
			cursorY += gapSize;
		}
	}

	ctx.restore();
}

async function renderNotablesImage({
	trackName,
	trackColors,
	displayName,
	playerDetails,
	discordUser,
	favorites,
	favoriteCharacterImage,
	favoriteVehicleImage,
	goodEvents,
	badEvents,
	timeFilter,
	queueFilter,
	playerCountFilter,
	totalEvents,
}) {
	const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext("2d");
	ctx.patternQuality = "best";
	ctx.quality = "best";

	try {
		const backgroundImage = await loadImageResource(`bot/images/tracks blurred/${trackName}_notables.png`);
		if (backgroundImage) {
			ctx.drawImage(backgroundImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
		}
		else {
			throw new Error("background image not available");
		}
	}
	catch (error) {
		console.warn(`failed to load background image for ${trackName}:`, error);
		ctx.fillStyle = trackColors?.baseColor || "#000";
		ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	}

	const headerFrame = {
		left: LAYOUT.pagePadding,
		top: LAYOUT.pagePadding,
		width: CANVAS_WIDTH - LAYOUT.pagePadding * 2,
		height: LAYOUT.headerHeight,
	};

	const columnHeight = CANVAS_HEIGHT - headerFrame.top - headerFrame.height - LAYOUT.sectionGap - LAYOUT.pagePadding;
	const columnWidth = (CANVAS_WIDTH - LAYOUT.pagePadding * 2 - LAYOUT.columnGap) / 2;

	const leftColumn = {
		left: LAYOUT.pagePadding,
		top: headerFrame.top + headerFrame.height + LAYOUT.sectionGap,
		width: columnWidth,
		height: columnHeight,
	};

	const rightColumn = {
		left: leftColumn.left + columnWidth + LAYOUT.columnGap,
		top: leftColumn.top,
		width: columnWidth,
		height: columnHeight,
	};

	drawRoundedPanel(ctx, headerFrame, trackColors.baseColor, EDGE_RADIUS);

	const headerTitle = `${displayName}'s notables`;
	const timeLabels = {
		alltime: "all time",
		weekly: "past week",
		season: "this season",
	};
	const queueLabels = {
		soloq: "solo queue",
		squads: "squads",
	};
	const subtitleParts = [];
	const timeLabel = timeLabels[timeFilter] || timeFilter;
	if (timeLabel) {
		subtitleParts.push(timeLabel);
	}
	if (queueFilter !== "both" && queueLabels[queueFilter]) {
		subtitleParts.push(queueLabels[queueFilter]);
	}
	if (playerCountFilter !== "both") {
		subtitleParts.push(playerCountFilter);
	}
	const eventsLabel = `${totalEvents} event${totalEvents === 1 ? "" : "s"}`;
	subtitleParts.push(eventsLabel);
	const subtitleText = subtitleParts.join(" · ");

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
		const dimensions = scaleToFavoriteFrame(favoriteCharacterImage);
		headerAssets.push({
			type: "character",
			image: favoriteCharacterImage,
			width: dimensions.width,
			height: dimensions.height,
		});
	}
	if (favoriteVehicleImage) {
		const dimensions = scaleToFavoriteFrame(favoriteVehicleImage);
		headerAssets.push({
			type: "vehicle",
			image: favoriteVehicleImage,
			width: dimensions.width,
			height: dimensions.height,
		});
	}

	let avatarImage = null;
	const avatarUrl = getPlayerAvatarUrl(discordUser);
	if (avatarUrl) {
		try {
			avatarImage = await loadWebPAsPng(avatarUrl);
		}
		catch (error) {
			console.warn("failed to load avatar image:", error);
		}
	}
	if (avatarImage) {
		headerAssets.push({
			type: "avatar",
			image: avatarImage,
			width: LAYOUT.headerAvatarSize,
			height: LAYOUT.headerAvatarSize,
		});
	}

	const assetsWidth = headerAssets.reduce((sum, asset) => sum + asset.width, 0);
	const assetsGaps = Math.max(headerAssets.length - 1, 0) * LAYOUT.headerAssetGap;
	// Calculate how much space the assets take from the right edge of the header frame
	// The assets start at headerFrame.left + headerFrame.width - LAYOUT.headerPaddingHorizontal + LAYOUT.headerAssetOffsetX
	// And grow leftwards.
	// Actually, let's just calculate the leftmost X of the assets.
	let assetsLeftX = headerFrame.left + headerFrame.width - LAYOUT.headerPaddingHorizontal + LAYOUT.headerAssetOffsetX;
	// We need to simulate the loop to find the leftmost point
	let tempCursor = assetsLeftX;
	for (let index = headerAssets.length - 1; index >= 0; index--) {
		const asset = headerAssets[index];
		tempCursor -= asset.width;
		if (index > 0) {
			tempCursor -= LAYOUT.headerAssetGap;
		}
	}
	assetsLeftX = tempCursor;

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	const playerEmoji = getCountryFlag(playerDetails?.countryCode);
	const emojiSize = LAYOUT.headerEmojiSize;
	const emojiGap = LAYOUT.headerEmojiGap;
	const titleFontSize = LAYOUT.headerTitleFontSize;
	const subtitleFontSize = LAYOUT.headerSubtitleFontSize;
	const hasSubtitle = Boolean(subtitleText);
	const textBlockHeight = titleFontSize + (hasSubtitle ? LAYOUT.headerSubtitleGap + subtitleFontSize : 0);
	const textBlockTop = headerFrame.top + (headerFrame.height - textBlockHeight) / 2 + LAYOUT.headerTextVerticalAdjustment;
	const titleBaseline = textBlockTop + titleFontSize;
	const subtitleBaseline = hasSubtitle ? titleBaseline + LAYOUT.headerSubtitleGap + subtitleFontSize : null;
	let textX = headerFrame.left + LAYOUT.headerPaddingHorizontal;

	if (playerEmoji) {
		const emojiY = headerFrame.top + (headerFrame.height - emojiSize) / 2;
		try {
			await drawEmoji(ctx, playerEmoji, textX, emojiY, emojiSize);
		}
		catch (emojiError) {
			console.warn("failed to draw header emoji:", emojiError);
		}
		textX += emojiSize + emojiGap;
	}

	ctx.font = `700 ${titleFontSize}px Lexend`;
	ctx.fillStyle = trackColors.headerColor || trackColors.statsTextColor || "#111111";

	// Calculate available width for text
	// textX is where text starts. assetsLeftX is where assets start.
	// We want some padding between text and assets.
	const textRightPadding = 20;
	const maxTitleWidth = Math.max(0, assetsLeftX - textX - textRightPadding);

	const fittedTitle = truncateTextWithEmojis(ctx, headerTitle, maxTitleWidth, {
		font: ctx.font,
		emojiSize: titleFontSize * 0.92,
	});

	await drawTextWithEmojis(ctx, fittedTitle, textX, titleBaseline, {
		font: ctx.font,
		fillStyle: ctx.fillStyle,
		emojiSize: titleFontSize * 0.92,
		lineHeight: titleFontSize * 1.2,
	});

	if (hasSubtitle && subtitleBaseline !== null) {
		ctx.font = `${subtitleFontSize}px Lexend`;
		ctx.fillStyle = trackColors.statsTextColor || "#333333";
		ctx.fillText(subtitleText, textX, subtitleBaseline);
	}
	ctx.restore();

	let assetCursor = headerFrame.left + headerFrame.width - LAYOUT.headerPaddingHorizontal + LAYOUT.headerAssetOffsetX;
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

	drawEventsColumn(ctx, leftColumn, trackColors, goodEvents);
	drawEventsColumn(ctx, rightColumn, trackColors, badEvents);

	const pngBuffer = canvas.toBuffer("image/png");
	return new AttachmentBuilder(pngBuffer, { name: "notables.png" });
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("notables")
		.setDescription("your best and worst mogis.")
		.addStringOption(option =>
			option.setName("player")
				.setDescription("lounge name, id or disocrd id. leave blank for yourself.")
				.setAutocomplete(true)),

	autocomplete: async interaction => {
		const focused = interaction.options.getFocused(true);
		if (focused.name !== "player") {
			await interaction.respond([]);
			return;
		}

		const rawQuery = (focused.value || "").trim();
		const suggestions = [];
		const seenValues = new Set();

		if (rawQuery) {
			try {
				const globalResults = await LoungeApi.searchPlayers(rawQuery, { limit: 10 });
				for (const player of globalResults) {
					const loungeId = [player.id, player.playerId, player.loungeId]
						.map(id => id === undefined || id === null ? null : String(id))
						.find(Boolean);
					if (!loungeId || seenValues.has(loungeId)) continue;

					const displayName = player.name;
					if (!displayName) continue;

					suggestions.push({
						name: displayName.length > 100 ? displayName.slice(0, 97) + "..." : displayName,
						value: loungeId,
					});
					seenValues.add(loungeId);
					if (suggestions.length >= 10) break;
				}
			}
			catch (error) {
				console.warn("notables global autocomplete error:", error);
			}
		}

		if (!suggestions.length && rawQuery) {
			// allow raw query fallback for direct name or id lookups
			suggestions.push({
				name: `search "${rawQuery}"`,
				value: rawQuery,
			});
		}

		await interaction.respond(suggestions);
	},

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("validating user...");

			const serverId = interaction.guildId;


			const rawPlayer = interaction.options.getString("player");
			const timeFilter = "alltime";
			const queueFilter = "both";
			const playerCountFilter = "both";
			const currentFilters = { timeFilter, queueFilter, playerCountFilter };

			const target = await resolveTargetPlayer(interaction, {
				rawInput: rawPlayer,
				defaultToInvoker: !rawPlayer,
			});

			if (target.error) {
				await interaction.editReply({
					content: target.error,
					components: [],
					files: [],
				});
				return;
			}

			const components = buildNotablesComponentRows({
				loungeId: target.loungeId,
				timeFilter,
				queueFilter,
				playerCountFilter,
			});

			const result = await this.generateNotables(interaction, target, serverId, queueFilter, playerCountFilter, timeFilter);

			if (!result.success) {
				await interaction.editReply({
					content: result.message || "unable to load notables data.",
					components,
					files: [],
				});
				return;
			}

			const replyMessage = await interaction.editReply({
				content: result.content ?? "",
				files: result.files,
				components,
			});

			if (replyMessage && result.session) {
				storeNotablesSession(replyMessage.id, {
					...result.session,
					discordUser: target.discordUser || result.session.discordUser || null,
					filters: currentFilters,
					pendingFilters: null,
					activeRequestToken: null,
				});
			}
		}
		catch (error) {
			console.error("notables command error:", error);
			try {
				await interaction.editReply({ content: "error: something went wrong while calculating notables." });
			}
			catch (editError) {
				console.error("failed to edit reply with error message:", editError);
			}
		}
	},

	async handleButtonInteraction(interaction) {
		const parsed = parseNotablesInteraction(interaction.customId);
		if (!parsed) return false;

		try {
			const { action, timeFilter: rawTime, queueFilter: rawQueue, playerCountFilter: rawPlayers, loungeId } = parsed;
			const messageId = interaction.message?.id || null;
			const cachedSession = messageId ? getNotablesSession(messageId) : null;
			const fallbackFilters = {
				timeFilter: rawTime || "alltime",
				queueFilter: rawQueue || "both",
				playerCountFilter: rawPlayers || "both",
			};
			// Prefer the ID state (fallbackFilters) over the session state, because the session might be stale
			// (e.g. after an error where we updated buttons but not the session).
			const baseFilters = fallbackFilters;

			let timeFilter = baseFilters.timeFilter;
			let queueFilter = baseFilters.queueFilter;
			let playerCountFilter = baseFilters.playerCountFilter;

			if (action === "queue") {
				queueFilter = rawQueue || "both";
			}
			else if (action === "players") {
				playerCountFilter = rawPlayers || "both";
			}
			else if (action === "time") {
				timeFilter = rawTime || "alltime";
			}
			else {
				console.warn(`unknown notables action received: ${action}`);
			}

			const futureFilters = { timeFilter, queueFilter, playerCountFilter };

			const components = buildNotablesComponentRows({
				loungeId: loungeId || cachedSession?.loungeId,
				timeFilter,
				queueFilter,
				playerCountFilter,
			});

			await interaction.update({ components });

			const serverId = interaction.guild?.id || "DM";
			const target = await resolveTargetPlayer(interaction, {
				loungeId,
			});

			if (target.error) {
				await interaction.editReply({
					content: target.error,
					components,
					files: [],
				});
				return true;
			}

			if (cachedSession) {
				cachedSession.pendingFilters = futureFilters;
			}

			let freshUserData = null;
			try {
				if (loungeId) {
					freshUserData = await Database.getUserData(loungeId);
					if (freshUserData?.favorites) {
						if (cachedSession) {
							cachedSession.favorites = freshUserData.favorites;
							if (freshUserData.favorites.track) {
								cachedSession.trackName = freshUserData.favorites.track;
							}
						}
					}
				}
			}
			catch (error) {
				console.warn("failed to refresh favorites", error);
			}

			const renderToken = beginNotablesRender(messageId);
			if (cachedSession) {
				cachedSession.activeRequestToken = renderToken;
			}

			let result;
			try {
				result = await this.generateNotables(
					interaction,
					target,
					serverId,
					queueFilter,
					playerCountFilter,
					timeFilter,
					null,
					{ session: cachedSession, filtersOverride: futureFilters, userData: freshUserData },
				);

				if (isNotablesRenderActive(messageId, renderToken)) {
					if (result && result.success) {
						await interaction.editReply({ content: result.content ?? "", files: result.files, components });
						if (messageId && result.session) {
							storeNotablesSession(messageId, {
								...result.session,
								discordUser: target.discordUser || result.session.discordUser || null,
								filters: futureFilters,
								pendingFilters: null,
								activeRequestToken: null,
							});
						}
					}
					else {
						await interaction.editReply({
							content: result?.message || "unable to load notables data.",
							components,
							files: [],
						});
					}
				}
			}
			finally {
				endNotablesRender(messageId, renderToken);
				if (cachedSession) {
					cachedSession.pendingFilters = null;
					cachedSession.activeRequestToken = null;
				}
			}

			return true;
		}
		catch (error) {
			console.error("error in notables button interaction:", error);
			return false;
		}
	},

	async generateNotables(interaction, target, serverId, queueFilter, playerCountFilter, timeFilter = "alltime", serverDataOverride = null, cacheOptions = {}) {
		try {
			const {
				session: sessionOption = null,
				filtersOverride = null,
				userData: userDataOption = null,
				onProgress = null,
				skipAutoUserAndMembership = false,
			} = cacheOptions || {};

			const reportProgress = async message => {
				if (!message) return;
				if (typeof onProgress === "function") {
					try {
						await onProgress(message);
					}
					catch (error) {
						console.warn("notables progress callback failed:", error);
					}
				}
				if (interaction?.editReply) {
					try {
						await interaction.editReply(message);
					}
					catch (error) {
						console.warn("notables progress edit failed:", error);
					}
				}
			};

			const { loungeId } = target;
			const normalizedLoungeId = String(loungeId);
			const fallbackName = `player ${normalizedLoungeId}`;
			const session = sessionOption;
			const useSession = Boolean(session && session.playerDetails && session.allTables && session.trackName);
			const filters = filtersOverride || { timeFilter, queueFilter, playerCountFilter };
			timeFilter = filters.timeFilter || timeFilter;
			queueFilter = filters.queueFilter || queueFilter;
			playerCountFilter = filters.playerCountFilter || playerCountFilter;

			let displayName = target.displayName || target.loungeName || fallbackName;
			let loungeName = target.loungeName || displayName || fallbackName;
			let playerDetails = useSession ? session.playerDetails : null;

			// Invalidate playerDetails if it doesn't match the specific requested mode
			if (playerDetails) {
				const currentCountFilter = playerCountFilter || "both";
				if (currentCountFilter && currentCountFilter !== "both") {
					const expectedMode = currentCountFilter.includes("24p") ? "mkworld24p" : "mkworld12p";
					if (playerDetails.gameMode !== expectedMode) {
						playerDetails = null;
					}
				} else if (currentCountFilter === "both" && session && session.filters && session.filters.playerCountFilter !== "both") {
					// If switching back to "both" from a specific filter, invalidate to allow smart selection logic to run again
					playerDetails = null;
				}
			}

			let allTables = useSession ? session.allTables : null;
			let favorites = useSession ? session.favorites || {} : null;
			let favoriteCharacterImage = null;
			let favoriteVehicleImage = null;
			let trackName = useSession ? session.trackName : null;
			let discordUser = target.discordUser || (useSession ? session.discordUser : null);
			let storedRecord = null;

			if (!playerDetails) {
				let gameMode = "mkworld12p";
				let details = null;

				if (playerCountFilter && playerCountFilter !== "both") {
					// Specific mode requested
					gameMode = playerCountFilter.includes("24p") ? "mkworld24p" : "mkworld12p";
					details = await LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, gameMode);
				} else {
					// "both" or unspecified -> fetch both and compare
					const [details12p, details24p] = await Promise.all([
						LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, "mkworld12p"),
						LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, "mkworld24p")
					]);

					if (!details12p && !details24p) {
						return { success: false, message: "couldn't find that player in mkw lounge." };
					}

					if (details12p && !details24p) {
						details = details12p;
						gameMode = "mkworld12p";
					} else if (!details12p && details24p) {
						details = details24p;
						gameMode = "mkworld24p";
					} else {
						// Both exist, compare MMR
						const mmr12p = details12p.mmr || 0;
						const mmr24p = details24p.mmr || 0;
						if (mmr24p > mmr12p) {
							details = details24p;
							gameMode = "mkworld24p";
						} else {
							details = details12p;
							gameMode = "mkworld12p";
						}
					}
				}

				if (!details) {
					return { success: false, message: "couldn't find that player in mkw lounge." };
				}
				playerDetails = details;
				// Inject the gameMode
				playerDetails.gameMode = gameMode;
			}

			if (!useSession && !skipAutoUserAndMembership) {
				const result = await AutoUserManager.ensureUserAndMembership({
					interaction,
					target,
					serverId,
					serverData: null,
					loungeId: normalizedLoungeId,
					loungeName,
					displayName,
					discordUser,
					storedRecord,
					fallbackName,
					playerDetails,
				});

				target = result.target;
				loungeName = result.loungeName;
				displayName = result.displayName;
				discordUser = result.discordUser;
				storedRecord = result.storedRecord;
			}

			displayName = target.displayName || loungeName || fallbackName;
			loungeName = loungeName || fallbackName;
			if (discordUser && !target.discordUser) {
				target.discordUser = discordUser;
			}

			const existingTables = await Database.getUserTables(normalizedLoungeId);
			let loadingMessage = `getting ${displayName}'s mogis...`;
			if (!existingTables || existingTables.length === 0) {
				loadingMessage = `getting ${displayName}'s mogis (${displayName} is not in my database yet, so this will take longer than usual)...`;
			}
			await reportProgress(loadingMessage);

			if (!allTables) {
				allTables = await LoungeApi.getAllPlayerTables(normalizedLoungeId, serverId, playerDetails);
			}
			if (!allTables || Object.keys(allTables).length === 0) {
				return { success: false, message: "no events found for this player." };
			}

			await reportProgress("filtering...");

			const filteredTables = PlayerStats.filterTablesByControls(allTables, { timeFilter, queueFilter, playerCountFilter });
			const filteredTableIds = Object.keys(filteredTables);
			if (!filteredTableIds.length) {
				return { success: false, message: "no events found matching the specified filters." };
			}

			await reportProgress("calculating...");

			let userData = userDataOption || null;
			if (!favorites) {
				if (!userData) {
					userData = await Database.getUserData(normalizedLoungeId);
				}
				favorites = userData?.favorites || {};
			}

			const tipMessage = await AutoUserManager.getCustomizeTip({
				interaction,
				target,
				discordUser,
				favorites,
				userData,
				loungeId: normalizedLoungeId,
			});

			if (!trackName) {
				trackName = favorites.track || GameData.getRandomTrack();
			}
			if (!favoriteCharacterImage || !favoriteVehicleImage) {
				const [characterImage, vehicleImage] = await Promise.all([
					favoriteCharacterImage ? Promise.resolve(favoriteCharacterImage) : loadFavoriteCharacterImage(favorites),
					favoriteVehicleImage ? Promise.resolve(favoriteVehicleImage) : loadFavoriteVehicleImage(favorites),
				]);
				favoriteCharacterImage = characterImage || favoriteCharacterImage;
				favoriteVehicleImage = vehicleImage || favoriteVehicleImage;
			}

			const bestScore = PlayerStats.getBestScore(filteredTables, normalizedLoungeId);
			const worstScore = PlayerStats.getWorstScore(filteredTables, normalizedLoungeId);
			const overperformance = PlayerStats.getBiggestOverperformance(filteredTables, normalizedLoungeId);
			const underperformance = PlayerStats.getBiggestUnderperformance(filteredTables, normalizedLoungeId);
			const carry = PlayerStats.getBiggestCarry(filteredTables, normalizedLoungeId);
			const anchor = PlayerStats.getBiggestAnchor(filteredTables, normalizedLoungeId);

			if (!bestScore || !worstScore || !overperformance || !underperformance || !carry || !anchor) {
				return { success: false, message: "insufficient data to calculate notables for this player." };
			}

			const { goodEvents, badEvents } = buildColumnEvents({ filteredTables, loungeId: normalizedLoungeId, metrics: { bestScore, worstScore, overperformance, underperformance, carry, anchor } });
			const linkMessage = buildTableLinksMessage([...goodEvents, ...badEvents]);

			await reportProgress("rendering image...");

			const trackColors = ColorPalettes.notablesTrackColors[trackName] || ColorPalettes.notablesTrackColors[ColorPalettes.currentTrackName] || {
				baseColor: "#ffffffd9",
				headerColor: "#111111",
				statsTextColor: "#333333",
			};

			const attachment = await renderNotablesImage({
				trackName,
				trackColors,
				displayName,
				playerDetails,
				discordUser,
				favorites,
				favoriteCharacterImage,
				favoriteVehicleImage,
				goodEvents,
				badEvents,
				timeFilter,
				queueFilter,
				playerCountFilter,
				totalEvents: filteredTableIds.length,
			});

			const updatedSession = {
				loungeId: normalizedLoungeId,
				serverId,
				displayName,
				loungeName,
				playerDetails,
				allTables,
				favorites,
				trackName,
				discordUser,
				filters: { timeFilter, queueFilter, playerCountFilter },
				pendingFilters: null,
				activeRequestToken: null,
				target: {
					loungeId: normalizedLoungeId,
					loungeName,
					displayName,
				},
			};

			return {
				success: true,
				content: tipMessage + (linkMessage || ""),
				files: [attachment],
				session: updatedSession,
				userData,
			};
		}
		catch (error) {
			console.error("error generating notables:", error);
			return { success: false, message: "an error occurred while generating notables. please try again later." };
		}
	},
};