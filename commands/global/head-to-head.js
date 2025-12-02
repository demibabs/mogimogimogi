// commands/head-to-head.js
const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	AttachmentBuilder,
} = require("discord.js");
const { createCanvas, loadImage } = require("canvas");

const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const DataManager = require("../../utils/dataManager");
const PlayerStats = require("../../utils/playerStats");
const ColorPalettes = require("../../utils/colorPalettes");
const Fonts = require("../../utils/fonts");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const resolveTargetPlayer = require("../../utils/playerResolver");
const AutoUserManager = require("../../utils/autoUserManager");
const {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
} = require("../../utils/cacheManager");

// -------------------- constants --------------------
const EDGE_RADIUS = 30;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

const COLUMN_PADDING = 64;
const CENTER_GAP = 52;
const MMR_ICON_SIZE = 52;
const MMR_ICON_GAP = 22;
const HIGHLIGHT_PANEL_PADDING = 28;
const HIGHLIGHT_BOTTOM_MARGIN = 64;
const HIGHLIGHT_PANEL_HEIGHT_OFFSET = -5;
const STATS_EXTRA_OFFSET = 40;
const STATS_PANEL_MARGIN = 60;
const PLAYER_AVATAR_SIZE = 132;
const PLAYER_AVATAR_RADIUS = 40;
const PLAYER_AVATAR_GAP = 28;
const PLAYER_HEADER_BASELINE_OFFSET = 100;
const PLAYER_AVATAR_VERTICAL_OFFSET = 35;
const CENTER_RECORD_BASE_OFFSET = 360;
const CENTER_RECORD_LABEL_GAP = 80;
const CENTER_RECORD_SUBTITLE_GAP = 60;
const PLAYER_NAME_FONT = `700 60px ${Fonts.FONT_FAMILY_STACK}`;
const PLAYER_MMR_FONT = `500 45px ${Fonts.FONT_FAMILY_STACK}`;
const STATS_VALUE_FONT = `700 70px ${Fonts.FONT_FAMILY_STACK}`;
const STATS_LABEL_FONT = `500 32px ${Fonts.FONT_FAMILY_STACK}`;
const RECORD_VALUE_FONT = `700 80px ${Fonts.FONT_FAMILY_STACK}`;
const RECORD_LABEL_FONT = `500 48px ${Fonts.FONT_FAMILY_STACK}`;
const RECORD_SUBTITLE_FONT = `400 34px ${Fonts.FONT_FAMILY_STACK}`;
const HIGHLIGHT_TITLE_FONT = `600 36px ${Fonts.FONT_FAMILY_STACK}`;
const HIGHLIGHT_DESCRIPTOR_FONT = `400 26px ${Fonts.FONT_FAMILY_STACK}`;
const HIGHLIGHT_SUMMARY_FONT = `500 35px ${Fonts.FONT_FAMILY_STACK}`;
const STATS_ROWS_START_OFFSET = 45;
const STATS_ROW_GAP = 120;
const MMR_OFFSET_Y = 70;
const STATS_LABEL_OFFSET = 80;

const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const BACKGROUND_RESOURCE = "images/other backgrounds blurred/headtoheadbg.png";

const DEFAULT_FILTERS = {
	timeFilter: "alltime", // alltime | weekly | season
	queueFilter: "both", // soloq | squads | both
	playerCountFilter: "both", // 12p | 24p | both  (extend as needed)
};

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");
const EVENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

// -------------------- caches / state --------------------
const headToHeadSessionCache = new Map(); // messageId -> { ...session, expiresAt }
const headToHeadSessionExpiryTimers = new Map();
const headToHeadRenderTokens = new Map(); // messageId -> Symbol

// -------------------- session helpers --------------------
function getHeadToHeadSession(messageId) {
	if (!messageId) return null;
	const session = headToHeadSessionCache.get(messageId);
	if (!session) return null;
	if (session.expiresAt && session.expiresAt <= Date.now()) {
		deleteCacheEntry(headToHeadSessionCache, headToHeadSessionExpiryTimers, messageId);
		return null;
	}
	refreshCacheEntry(headToHeadSessionCache, headToHeadSessionExpiryTimers, messageId, SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + SESSION_CACHE_TTL_MS;
	return session;
}
function storeHeadToHeadSession(messageId, session) {
	if (!messageId || !session) return;
	const payload = {
		...session,
		messageId,
		expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
	};
	setCacheEntry(headToHeadSessionCache, headToHeadSessionExpiryTimers, messageId, payload, SESSION_CACHE_TTL_MS);
}
function beginHeadToHeadRender(messageId) {
	if (!messageId) return null;
	const token = Symbol("headToHeadRender");
	headToHeadRenderTokens.set(messageId, token);
	return token;
}
function isHeadToHeadRenderActive(messageId, token) {
	if (!messageId || !token) return true;
	return headToHeadRenderTokens.get(messageId) === token;
}
function endHeadToHeadRender(messageId, token) {
	if (!messageId || !token) return;
	if (headToHeadRenderTokens.get(messageId) === token) {
		headToHeadRenderTokens.delete(messageId);
	}
}

// -------------------- image helpers --------------------
async function loadImageResource(resource, label = null) {
	if (!resource) return null;
	try {
		return await loadImage(resource);
	}
	catch (err) {
		const descriptor = label || resource;
		console.warn(`head-to-head: failed to load image ${descriptor}:`, err);
		return null;
	}
}
async function getRankIcon(rankName, mmr) {
	const filename =
	PlayerStats.getRankIconFilename(rankName) ||
	PlayerStats.getRankIconFilenameForMmr(mmr);
	if (!filename) return null;
	return loadImageResource(`images/ranks/${filename}`, `rank icon ${rankName || mmr}`);
}
function formatRecordText(record) {
	if (!record) return "-";
	const { wins = 0, losses = 0, ties = 0 } = record;
	const base = `${wins}-${losses}`;
	return ties ? `${base}-${ties}` : base;
}

function formatSignedDelta(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return "+0";
	const rounded = Math.round(numeric);
	const magnitude = Math.abs(rounded);
	const sign = rounded >= 0 ? "+" : "-";
	return `${sign}${NUMBER_FORMATTER.format(magnitude)}`;
}

function getTableTimestamp(table) {
	if (!table) return null;
	const raw = table.verifiedOn || table.createdOn || table.date || table.updatedOn;
	if (!raw) return null;
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDescriptor(table) {
	if (!table) return "event details unavailable";
	const date = getTableTimestamp(table);
	const formattedDate = date ? EVENT_DATE_FORMATTER.format(date) : "date unknown";
	const count = table.numPlayers ?? table.numplayers ?? table.playerCount;
	const format = table.format || table.queue || "room";
	return `${formattedDate} • ${count || "?"}p ${format}`;
}

// -------------------- customId helpers --------------------
// Format: h2h|action|time|queue|players|loungeId1|loungeId2
function buildCustomId(action, { loungeId1, loungeId2, timeFilter, queueFilter, playerCountFilter }) {
	const safeAction = (action || "time").toLowerCase();
	const safeTime = (timeFilter || DEFAULT_FILTERS.timeFilter).toLowerCase();
	const safeQueue = (queueFilter || DEFAULT_FILTERS.queueFilter).toLowerCase();
	const safePlayers = (playerCountFilter || DEFAULT_FILTERS.playerCountFilter).toLowerCase();
	const id1 = loungeId1 ?? "";
	const id2 = loungeId2 ?? "";
	return ["h2h", safeAction, safeTime, safeQueue, safePlayers, id1, id2].join("|");
}
function parseCustomId(customId) {
	if (!customId?.startsWith("h2h|")) return null;
	const parts = customId.split("|");
	if (parts.length < 7) return null;
	const [, actionRaw, timeRaw, queueRaw, playersRaw, loungeId1, loungeId2] = parts;
	return {
		action: (actionRaw || "").toLowerCase(),
		timeFilter: (timeRaw || DEFAULT_FILTERS.timeFilter).toLowerCase(),
		queueFilter: (queueRaw || DEFAULT_FILTERS.queueFilter).toLowerCase(),
		playerCountFilter: (playersRaw || DEFAULT_FILTERS.playerCountFilter).toLowerCase(),
		loungeId1: loungeId1 || null,
		loungeId2: loungeId2 || null,
	};
}

// -------------------- component rows --------------------
function buildComponentRows({ loungeId1, loungeId2, timeFilter, queueFilter, playerCountFilter }) {
	const safeTime = timeFilter || DEFAULT_FILTERS.timeFilter;
	const safeQueue = queueFilter || DEFAULT_FILTERS.queueFilter;
	const safePlayers = playerCountFilter || DEFAULT_FILTERS.playerCountFilter;

	const timeRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { loungeId1, loungeId2, timeFilter: "alltime", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("all time")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "alltime"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { loungeId1, loungeId2, timeFilter: "weekly", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("past week")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "weekly"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { loungeId1, loungeId2, timeFilter: "season", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("this season")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "season"),
	);

	const queueRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: "soloq", playerCountFilter: safePlayers }))
			.setLabel("soloq")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "soloq"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: "squads", playerCountFilter: safePlayers }))
			.setLabel("squads")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "squads"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: "both", playerCountFilter: safePlayers }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "both"),
	);

	const playerRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "12p" }))
			.setLabel("12p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "12p"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "24p" }))
			.setLabel("24p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "24p"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { loungeId1, loungeId2, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "both" }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "both"),
	);

	return [timeRow, queueRow, playerRow];
}

// -------------------- renderer --------------------
async function renderHeadToHeadImage({
	backgroundImage,
	palette,
	playerLeft,
	playerRight,
	record,
	filters,
}) {
	const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext("2d");

	ctx.patternQuality = "best";
	ctx.quality = "best";

	const wrapTextLines = (rawText, font, maxWidth) => {
		if (!rawText || maxWidth <= 0) return [];
		const prevFont = ctx.font;
		ctx.font = font;
		const segments = String(rawText).split(/\r?\n/);
		const lines = [];
		for (const segment of segments) {
			const words = segment.split(/\s+/).filter(Boolean);
			if (!words.length) {
				if (segment.trim()) {
					lines.push(segment.trim());
				}
				continue;
			}
			let currentLine = "";
			const flushLine = () => {
				if (currentLine) {
					lines.push(currentLine);
					currentLine = "";
				}
			};
			for (const word of words) {
				const candidate = currentLine ? `${currentLine} ${word}` : word;
				if (ctx.measureText(candidate).width <= maxWidth) {
					currentLine = candidate;
					continue;
				}
				flushLine();
				if (ctx.measureText(word).width <= maxWidth) {
					currentLine = word;
					continue;
				}
				let slice = "";
				for (const char of word) {
					const extended = slice + char;
					if (ctx.measureText(extended).width > maxWidth && slice) {
						lines.push(slice);
						slice = char;
					}
					else {
						slice = extended;
					}
				}
				currentLine = slice;
			}
			flushLine();
		}
		ctx.font = prevFont;
		return lines;
	};

	if (backgroundImage) {
		ctx.drawImage(backgroundImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	}
	else {
		ctx.fillStyle = palette?.backgroundColor || ColorPalettes.headToHeadPalette.backgroundColor;
		ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	}

	const subtitleParts = [];
	const timeLabels = { alltime: "all time", weekly: "past week", season: "this season" };
	const queueLabels = { soloq: "solo queue", squads: "squads" };
	const timeLabel = timeLabels[filters.timeFilter] || filters.timeFilter;
	if (timeLabel) subtitleParts.push(timeLabel);
	if (filters.queueFilter !== "both" && queueLabels[filters.queueFilter]) {
		subtitleParts.push(queueLabels[filters.queueFilter]);
	}
	if (filters.playerCountFilter !== "both") {
		subtitleParts.push(filters.playerCountFilter);
	}
	if (Number.isFinite(record?.eventsPlayed)) {
		subtitleParts.push(`${record.eventsPlayed} shared events`);
	}
	const subtitle = subtitleParts.join(" · ");
	if (subtitle && !record.subtitle) {
		record.subtitle = subtitle;
	}

	// Stats container
	const statsFrame = {
		left: STATS_PANEL_MARGIN,
		top: STATS_PANEL_MARGIN,
		width: CANVAS_WIDTH - 2 * STATS_PANEL_MARGIN,
		height: CANVAS_HEIGHT - 2 * STATS_PANEL_MARGIN,
	};
	EmbedEnhancer.drawRoundedPanel(
		ctx,
		statsFrame,
		palette?.baseColor || ColorPalettes.headToHeadPalette.panelColor,
		EDGE_RADIUS,
	);

	const availableWidth = statsFrame.width - CENTER_GAP;
	const columnWidth = availableWidth / 2;
	const leftColumn = {
		left: statsFrame.left,
		top: statsFrame.top,
		width: columnWidth,
		height: statsFrame.height,
	};
	const rightColumn = {
		left: statsFrame.left + columnWidth + CENTER_GAP,
		top: statsFrame.top,
		width: columnWidth,
		height: statsFrame.height,
	};
	const centerX = statsFrame.left + statsFrame.width / 2;

	// Player sub-renderer
	const drawPlayerSection = async (frame, player, alignment) => {
		const centerY = frame.top + PLAYER_HEADER_BASELINE_OFFSET;
		const flagSize = 54;
		const flagGap = 18;
		const avatarImage = player.avatarImage || null;
		const avatarSize = player.avatarSize || PLAYER_AVATAR_SIZE;
		const avatarRadius = player.avatarRadius ?? PLAYER_AVATAR_RADIUS;
		const avatarGap = player.avatarGap ?? PLAYER_AVATAR_GAP;
		const avatarOffset = avatarImage ? avatarSize + avatarGap : 0;
		const textBoundary = alignment === "left"
			? frame.left + COLUMN_PADDING + avatarOffset
			: frame.left + frame.width - COLUMN_PADDING - avatarOffset;

		if (avatarImage) {
			const avatarX = alignment === "left"
				? frame.left + COLUMN_PADDING
				: frame.left + frame.width - COLUMN_PADDING - avatarSize;
			const avatarY = centerY - avatarSize / 2 + PLAYER_AVATAR_VERTICAL_OFFSET;
			EmbedEnhancer.drawRoundedImage(ctx, avatarImage, avatarX, avatarY, avatarSize, avatarSize, avatarRadius);
		}

		ctx.save();
		ctx.textAlign = alignment;
		ctx.textBaseline = "middle";

		const displayName = player.displayName;
		const mmrText = player.mmrDisplay;
		const rankIcon = player.rankIcon;
		const flagEmoji = player.flagEmoji;

		ctx.font = PLAYER_NAME_FONT;
		ctx.fillStyle = palette?.textColor || ColorPalettes.headToHeadPalette.textColor;
		const flagOffset = flagEmoji ? flagSize + flagGap : 0;
		const nameX = alignment === "left"
			? textBoundary + flagOffset
			: textBoundary - flagOffset;
		// Constrain name within column bounds to avoid crossing the center gap
		const columnLeft = frame.left + COLUMN_PADDING;
		const columnRight = frame.left + frame.width - COLUMN_PADDING;
		const maxNameWidth = alignment === "left"
			? Math.max(0, columnRight - nameX)
			: Math.max(0, nameX - columnLeft);
		const fittedName = EmbedEnhancer.truncateTextWithEmojis(ctx, displayName, maxNameWidth, {
			font: ctx.font,
			emojiSize: 60 * 0.85,
		});
		await EmbedEnhancer.drawTextWithEmojis(ctx, fittedName, nameX, centerY, {
			font: ctx.font,
			fillStyle: ctx.fillStyle,
			emojiSize: 60 * 0.85,
			lineHeight: 60 * 1.15,
			textAlign: alignment,
			baseline: "middle",
		});
		if (flagEmoji) {
			try {
				const emojiX = alignment === "left" ? textBoundary : textBoundary - flagSize;
				await EmbedEnhancer.drawEmoji(ctx, flagEmoji, emojiX, centerY - flagSize / 2, flagSize);
			}
			catch (emojiError) {
				console.warn("head-to-head: failed to draw flag emoji:", emojiError);
			}
		}

		ctx.font = PLAYER_MMR_FONT;
		const mmrX = alignment === "left"
			? textBoundary + (rankIcon ? MMR_ICON_SIZE + MMR_ICON_GAP : 0)
			: textBoundary - (rankIcon ? MMR_ICON_SIZE + MMR_ICON_GAP : 0);
		ctx.fillText(mmrText, mmrX, centerY + MMR_OFFSET_Y);

		if (rankIcon) {
			const iconX = alignment === "left"
				? textBoundary
				: textBoundary - MMR_ICON_SIZE;
			ctx.drawImage(
				rankIcon,
				iconX,
				centerY + MMR_OFFSET_Y - MMR_ICON_SIZE / 2,
				MMR_ICON_SIZE,
				MMR_ICON_SIZE,
			);
		}
		ctx.restore();

		const statsStartY = centerY + MMR_OFFSET_Y + STATS_ROWS_START_OFFSET + STATS_EXTRA_OFFSET;
		const stats = player.stats;
		ctx.save();
		ctx.textAlign = alignment;
		ctx.textBaseline = "top";
		ctx.font = STATS_LABEL_FONT;
		ctx.fillStyle = palette?.textColor || ColorPalettes.headToHeadPalette.textColor;
		const statBaseX = alignment === "left"
			? frame.left + COLUMN_PADDING
			: frame.left + frame.width - COLUMN_PADDING;
		for (let i = 0; i < stats.length; i++) {
			const stat = stats[i];
			const val = stat.value ?? "-";
			const label = stat.label;
			const y = statsStartY + i * STATS_ROW_GAP;
			ctx.font = STATS_VALUE_FONT;
			// value color (e.g., positive/negative mmr delta), fallback to default text color
			ctx.fillStyle = stat.valueColor || (palette?.textColor || ColorPalettes.headToHeadPalette.textColor);
			ctx.fillText(`${val}`, statBaseX, y);
			ctx.font = STATS_LABEL_FONT;
			ctx.globalAlpha = 0.7;
			ctx.fillStyle = palette?.textColor || ColorPalettes.headToHeadPalette.textColor;
			ctx.fillText(label, statBaseX, y + STATS_LABEL_OFFSET);
			ctx.globalAlpha = 1;
		}
		ctx.restore();

		if (player.highlight) {
			const highlightWidth = frame.width - COLUMN_PADDING * 2;
			const highlightTitleLineHeight = 38;
			const highlightDescriptorLineHeight = 30;
			const highlightSummaryLineHeight = 34;
			const descriptorGap = 18;
			const summaryGap = 26;
			const maxContentWidth = highlightWidth - HIGHLIGHT_PANEL_PADDING * 2;
			const titleLines = wrapTextLines(player.highlight.title, HIGHLIGHT_TITLE_FONT, maxContentWidth);
			const descriptorLines = wrapTextLines(player.highlight.descriptor, HIGHLIGHT_DESCRIPTOR_FONT, maxContentWidth);
			const summaryLines = wrapTextLines(player.highlight.summary, HIGHLIGHT_SUMMARY_FONT, maxContentWidth);
			if (titleLines.length || descriptorLines.length || summaryLines.length) {
				let highlightHeight = HIGHLIGHT_PANEL_PADDING * 2;
				let sectionRendered = false;
				if (titleLines.length) {
					highlightHeight += titleLines.length * highlightTitleLineHeight;
					sectionRendered = true;
				}
				if (descriptorLines.length) {
					if (sectionRendered) highlightHeight += descriptorGap;
					highlightHeight += descriptorLines.length * highlightDescriptorLineHeight;
					sectionRendered = true;
				}
				if (summaryLines.length) {
					if (sectionRendered) highlightHeight += summaryGap;
					highlightHeight += summaryLines.length * highlightSummaryLineHeight;
				}

				const rawHighlightTop = frame.top + frame.height - HIGHLIGHT_BOTTOM_MARGIN - highlightHeight;
				const offsetHighlightTop = rawHighlightTop + HIGHLIGHT_PANEL_HEIGHT_OFFSET;
				const panelFrame = {
					left: frame.left + COLUMN_PADDING,
					top: offsetHighlightTop,
					width: highlightWidth,
					height: highlightHeight,
				};
				EmbedEnhancer.drawRoundedPanel(
					ctx,
					panelFrame,
					palette?.highlightPanelColor || ColorPalettes.headToHeadPalette.highlightPanelColor,
					EDGE_RADIUS / 2,
				);

				ctx.save();
				ctx.textAlign = alignment;
				ctx.textBaseline = "top";
				ctx.fillStyle = palette?.textColor || ColorPalettes.headToHeadPalette.textColor;

				const contentX = alignment === "left"
					? panelFrame.left + HIGHLIGHT_PANEL_PADDING
					: panelFrame.left + panelFrame.width - HIGHLIGHT_PANEL_PADDING;
				const totalAdditionalLines =
					Math.max(0, titleLines.length - 1) +
					Math.max(0, descriptorLines.length - 1) +
					Math.max(0, summaryLines.length - 1);
				const verticalShift = totalAdditionalLines > 0 ? Math.min(24, totalAdditionalLines * 6) : 0;
				let cursorY = panelFrame.top + HIGHLIGHT_PANEL_PADDING - verticalShift;
				const minCursorY = panelFrame.top + 8;
				if (cursorY < minCursorY) {
					cursorY = minCursorY;
				}

				let previousRendered = false;
				if (titleLines.length) {
					ctx.font = HIGHLIGHT_TITLE_FONT;
					for (const line of titleLines) {
						await EmbedEnhancer.drawTextWithEmojis(ctx, line, contentX, cursorY, {
							font: HIGHLIGHT_TITLE_FONT,
							fillStyle: ctx.fillStyle,
							emojiSize: 36 * 0.95,
							lineHeight: highlightTitleLineHeight,
							textAlign: alignment,
							baseline: "top",
						});
						cursorY += highlightTitleLineHeight;
					}
					previousRendered = true;
				}
				if (descriptorLines.length) {
					if (previousRendered) cursorY += descriptorGap;
					ctx.font = HIGHLIGHT_DESCRIPTOR_FONT;
					ctx.globalAlpha = 0.75;
					for (const line of descriptorLines) {
						await EmbedEnhancer.drawTextWithEmojis(ctx, line, contentX, cursorY, {
							font: HIGHLIGHT_DESCRIPTOR_FONT,
							fillStyle: ctx.fillStyle,
							emojiSize: 26 * 0.95,
							lineHeight: highlightDescriptorLineHeight,
							textAlign: alignment,
							baseline: "top",
						});
						cursorY += highlightDescriptorLineHeight;
					}
					ctx.globalAlpha = 1;
					previousRendered = true;
				}
				if (summaryLines.length) {
					if (previousRendered) cursorY += summaryGap;
					ctx.font = HIGHLIGHT_SUMMARY_FONT;
					for (const line of summaryLines) {
						await EmbedEnhancer.drawTextWithEmojis(ctx, line, contentX, cursorY, {
							font: HIGHLIGHT_SUMMARY_FONT,
							fillStyle: ctx.fillStyle,
							emojiSize: 35 * 0.95,
							lineHeight: highlightSummaryLineHeight,
							textAlign: alignment,
							baseline: "top",
						});
						cursorY += highlightSummaryLineHeight;
					}
				}
				ctx.restore();
			}
		}
	};

	// Center metrics (record + labels)
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = RECORD_VALUE_FONT;
	ctx.fillStyle = palette?.textColor || ColorPalettes.headToHeadPalette.textColor;
	ctx.fillText(formatRecordText(record), centerX, statsFrame.top + CENTER_RECORD_BASE_OFFSET);

	ctx.font = RECORD_LABEL_FONT;
	ctx.globalAlpha = 0.8;
	ctx.fillText(
		"head-to-head record",
		centerX,
		statsFrame.top + CENTER_RECORD_BASE_OFFSET + CENTER_RECORD_LABEL_GAP,
	);
	ctx.globalAlpha = 1;

	const recordSubtitle = record?.subtitle || "";
	if (recordSubtitle) {
		ctx.font = RECORD_SUBTITLE_FONT;
		ctx.globalAlpha = 0.7;
		ctx.fillText(
			recordSubtitle,
			centerX,
			statsFrame.top + CENTER_RECORD_BASE_OFFSET + CENTER_RECORD_LABEL_GAP + CENTER_RECORD_SUBTITLE_GAP,
		);
		ctx.globalAlpha = 1;
	}
	ctx.restore();

	await drawPlayerSection(leftColumn, playerLeft, "left");
	await drawPlayerSection(rightColumn, playerRight, "right");

	const buffer = canvas.toBuffer("image/png");
	return new AttachmentBuilder(buffer, { name: "head-to-head.png" });
}

// -------------------- autocomplete helper --------------------
function buildAutocompleteSuggestions(serverPlayers, query, limit = 10) {
	const normalizedQuery = query.trim().toLowerCase();
	const suggestions = [];
	const seen = new Set();

	for (const entry of serverPlayers) {
		const loungeName = entry.loungeName || entry.username;
		if (!loungeName) continue;
		const lower = loungeName.toLowerCase();
		if (normalizedQuery && !lower.includes(normalizedQuery)) continue;
		const value = String(entry.loungeId ?? entry.id ?? loungeName);
		if (seen.has(value)) continue;
		suggestions.push({ name: loungeName, value });
		seen.add(value);
		if (suggestions.length >= limit) break;
	}
	return suggestions;
}

// -------------------- command export --------------------
module.exports = {
	data: new SlashCommandBuilder()
		.setName("head-to-head")
		.setDescription("compare head-to-head stats of two players.")
		.addStringOption((option) =>
			option
				.setName("player")
				.setDescription("lounge name or id for a player.")
				.setAutocomplete(true)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("player2")
				.setDescription("defaults to you if left blank.")
				.setAutocomplete(true)
				.setRequired(false),
		),

	autocomplete: async (interaction) => {
		const focused = interaction.options.getFocused(true);
		if (!focused?.name?.startsWith("player")) {
			await interaction.respond([]);
			return;
		}
		const rawQuery = (focused.value || "").trim();
		const guild = interaction.guild;
		if (!guild) {
			await interaction.respond([]);
			return;
		}

		try {
			const serverData = await Database.getServerData(guild.id);
			const serverUsers = Object.values(serverData?.users || {});
			const serverSuggestions = buildAutocompleteSuggestions(serverUsers, rawQuery, 5);

			const suggestions = [...serverSuggestions];
			const seen = new Set(serverSuggestions.map((e) => e.value));

			if (rawQuery && suggestions.length < 10) {
				const globalResults = await LoungeApi.searchPlayers(rawQuery, { limit: 5 });
				for (const player of globalResults) {
					const loungeId = [player.id, player.playerId, player.loungeId]
						.map((v) => (v == null ? null : String(v)))
						.find(Boolean);
					if (!loungeId || seen.has(loungeId)) continue;
					const name = player.name || player.loungeName || player.playerName || player.username;
					if (!name) continue;
					suggestions.push({
						name: name.length > 100 ? `${name.slice(0, 97)}...` : name,
						value: loungeId,
					});
					seen.add(loungeId);
					if (suggestions.length >= 10) break;
				}
			}

			if (!suggestions.length && rawQuery) {
				suggestions.push({ name: `search "${rawQuery}"`, value: rawQuery });
			}

			await interaction.respond(suggestions.slice(0, 10));
		}
		catch (error) {
			console.warn("head-to-head autocomplete error:", error);
			try {
				await interaction.respond([]);
			}
			catch (respondError) {
				console.warn("failed to send autocomplete response:", respondError);
			}
		}
	},

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("validating players...");

			const serverId = interaction.guildId;
			const rawPlayer1 = interaction.options.getString("player");
			const rawPlayer2 = interaction.options.getString("player2");
			const validation = await AutoUserManager.ensureServerReady(serverId);
			if (!validation.success) {
				await interaction.editReply({
					content: validation.message || "unable to validate command user.",
					files: [],
				});
				return;
			}

			const serverData = await Database.getServerData(serverId);

			const target1 = await resolveTargetPlayer(interaction, {
				rawInput: rawPlayer1,
				serverData,
			});
			if (target1.error) {
				await interaction.editReply({ content: target1.error, files: [] });
				return;
			}

			const target2 = await resolveTargetPlayer(interaction, {
				rawInput: rawPlayer2,
				defaultToInvoker: !rawPlayer2,
				serverData,
			});
			if (target2.error) {
				await interaction.editReply({ content: target2.error, files: [] });
				return;
			}

			const filters = { ...DEFAULT_FILTERS };

			const result = await this.generateHeadToHead(interaction, {
				playerLeft: target1,
				playerRight: target2,
				serverData,
				filters,
			});

			if (!result.success) {
				await interaction.editReply({
					content: result.message || "unable to load head-to-head data.",
					files: [],
				});
				return;
			}

			const components = buildComponentRows({
				loungeId1: target1.loungeId,
				loungeId2: target2.loungeId,
				...filters,
			});

			const replyMessage = await interaction.editReply({
				content: result.content ?? "",
				files: result.files,
				components,
			});

			if (replyMessage && result.session) {
				storeHeadToHeadSession(replyMessage.id, {
					...result.session,
					filters,
					pendingFilters: null,
					activeRequestToken: null,
				});
			}
		}
		catch (error) {
			console.error("head-to-head command error:", error);
			try {
				await interaction.editReply({
					content: "error: something went wrong while generating head-to-head stats.",
					files: [],
				});
			}
			catch (editError) {
				console.error("failed to edit reply after error:", editError);
			}
		}
	},

	async handleButtonInteraction(interaction) {
		const parsed = parseCustomId(interaction.customId);
		if (!parsed) return false;

		try {
			await interaction.deferUpdate();

			const messageId = interaction.message?.id || null;
			const cachedSession = messageId ? getHeadToHeadSession(messageId) : null;

			const baseFilters = cachedSession?.pendingFilters || cachedSession?.filters || DEFAULT_FILTERS;

			let { timeFilter, queueFilter, playerCountFilter } = baseFilters;
			if (parsed.action === "time") {
				timeFilter = parsed.timeFilter || DEFAULT_FILTERS.timeFilter;
			}
			else if (parsed.action === "queue") {
				queueFilter = parsed.queueFilter || DEFAULT_FILTERS.queueFilter;
			}
			else if (parsed.action === "players") {
				playerCountFilter = parsed.playerCountFilter || DEFAULT_FILTERS.playerCountFilter;
			}

			const filters = { timeFilter, queueFilter, playerCountFilter };
			if (cachedSession) {
				cachedSession.pendingFilters = filters;
			}

			const serverId = interaction.guildId;
			const serverData = await Database.getServerData(serverId);

			const target1 = await resolveTargetPlayer(interaction, {
				loungeId: parsed.loungeId1,
				serverData,
			});
			if (target1.error) {
				await interaction.editReply({ content: target1.error, files: [] });
				return true;
			}
			const target2 = await resolveTargetPlayer(interaction, {
				loungeId: parsed.loungeId2,
				serverData,
			});
			if (target2.error) {
				await interaction.editReply({ content: target2.error, files: [] });
				return true;
			}

			const components = buildComponentRows({
				loungeId1: target1.loungeId,
				loungeId2: target2.loungeId,
				...filters,
			});

			const renderToken = beginHeadToHeadRender(messageId);
			if (cachedSession) cachedSession.activeRequestToken = renderToken;

			try {
				const result = await this.generateHeadToHead(interaction, {
					playerLeft: target1,
					playerRight: target2,
					serverData,
					filters,
					session: cachedSession,
				});

				if (isHeadToHeadRenderActive(messageId, renderToken)) {
					if (result && result.success) {
						await interaction.editReply({
							content: result.content ?? "",
							files: result.files,
							components,
						});
						if (messageId && result.session) {
							storeHeadToHeadSession(messageId, {
								...result.session,
								filters,
								pendingFilters: null,
								activeRequestToken: null,
							});
						}
					}
					else {
						await interaction.editReply({
							content: result?.message || "unable to load head-to-head data.",
							files: [],
							components,
						});
					}
				}
			}
			finally {
				endHeadToHeadRender(messageId, renderToken);
				if (cachedSession) {
					cachedSession.pendingFilters = null;
					cachedSession.activeRequestToken = null;
				}
			}

			return true;
		}
		catch (error) {
			console.error("head-to-head button interaction error:", error);
			return false;
		}
	},

	async generateHeadToHead(
		interaction,
		{
			playerLeft,
			playerRight,
			serverData,
			filters,
			session = null,
		},
	) {
		try {
			const serverId = interaction.guildId;

			if (!playerLeft?.loungeId || !playerRight?.loungeId) {
				return { success: false, message: "couldn't determine lounge id." };
			}

			const normalizedLeftId = String(playerLeft.loungeId);
			const normalizedRightId = String(playerRight.loungeId);
			const targetSession = session || {};

			let leftPlayerDetails = targetSession.playerLeftDetails || null;
			let rightPlayerDetails = targetSession.playerRightDetails || null;

			if (!leftPlayerDetails) {
				leftPlayerDetails = await LoungeApi.getPlayerDetailsByLoungeId(normalizedLeftId);
			}
			if (!rightPlayerDetails) {
				rightPlayerDetails = await LoungeApi.getPlayerDetailsByLoungeId(normalizedRightId);
			}
			if (!leftPlayerDetails || !rightPlayerDetails) {
				return { success: false, message: "unable to load player details from lounge." };
			}

			const ensureAndMergeUser = async (target, normalizedId, playerDetails) => {
				try {
					const result = await AutoUserManager.ensureUserAndMembership({
						interaction,
						target,
						serverId,
						serverData,
						loungeId: normalizedId,
						loungeName: playerDetails?.name || target.loungeName || target.displayName || null,
						displayName: target.displayName,
						discordUser: target.discordUser,
						storedRecord: serverData?.users?.[normalizedId],
						fallbackName: `player ${normalizedId}`,
					});

					if (result.serverData) {
						serverData = result.serverData;
					}
				}
				catch (ensureError) {
					console.warn("failed to ensure user record:", ensureError);
					if (!target.displayName) {
						target.displayName = playerDetails?.name || target.loungeName || `player ${normalizedId}`;
					}
				}
			};

			await ensureAndMergeUser(playerLeft, normalizedLeftId, leftPlayerDetails);
			await ensureAndMergeUser(playerRight, normalizedRightId, rightPlayerDetails);

			if (!playerLeft.displayName) {
				playerLeft.displayName = leftPlayerDetails.name || playerLeft.loungeName || `player ${normalizedLeftId}`;
			}
			if (!playerRight.displayName) {
				playerRight.displayName = rightPlayerDetails.name || playerRight.loungeName || `player ${normalizedRightId}`;
			}

			await interaction.editReply(`getting ${playerLeft.displayName} & ${playerRight.displayName}'s mogis...`);

			const parseEventsPlayed = (details) => {
				const value = Number(details?.eventsPlayed);
				return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
			};
			const leftEventsPlayed = parseEventsPlayed(leftPlayerDetails);
			const rightEventsPlayed = parseEventsPlayed(rightPlayerDetails);

			const fetchCachedTableCount = async (loungeId) => {
				try {
					const entries = await Database.getUserTables(loungeId);
					return Array.isArray(entries) ? entries.length : 0;
				}
				catch (error) {
					console.warn(`head-to-head: failed to read cached tables for ${loungeId}:`, error);
					return 0;
				}
			};

			const [leftCachedTableCount, rightCachedTableCount] = await Promise.all([
				fetchCachedTableCount(normalizedLeftId),
				fetchCachedTableCount(normalizedRightId),
			]);

			const selectPreferredBaseId = () => {
				const leftHasCache = leftCachedTableCount > 0;
				const rightHasCache = rightCachedTableCount > 0;
				if (leftHasCache && !rightHasCache) {
					return normalizedLeftId;
				}
				if (rightHasCache && !leftHasCache) {
					return normalizedRightId;
				}
				if (leftHasCache && rightHasCache && leftCachedTableCount !== rightCachedTableCount) {
					return leftCachedTableCount > rightCachedTableCount ? normalizedLeftId : normalizedRightId;
				}
				return leftEventsPlayed <= rightEventsPlayed ? normalizedLeftId : normalizedRightId;
			};

			const preferredBaseId = selectPreferredBaseId();

			let basePlayerId = targetSession.primaryPlayerId || null;
			let basePlayerTables = targetSession.primaryPlayerTables || null;
			if (basePlayerId !== preferredBaseId) {
				basePlayerTables = null;
			}
			const computedBaseId = preferredBaseId;
			const secondaryPlayerId = computedBaseId === normalizedLeftId ? normalizedRightId : normalizedLeftId;

			if (!basePlayerTables) {
				basePlayerTables = await LoungeApi.getAllPlayerTables(computedBaseId, serverId);
			}
			basePlayerId = computedBaseId;
			if (!basePlayerTables || Object.keys(basePlayerTables).length === 0) {
				return { success: false, message: "no shared events found between these players." };
			}

			const sharedTables = await PlayerStats.getH2HTables(basePlayerTables, secondaryPlayerId, serverId);
			if (!sharedTables || Object.keys(sharedTables).length === 0) {
				return { success: false, message: "no shared events found between these players." };
			}

			await interaction.editReply("filtering...");

			const filteredTables =
				typeof PlayerStats.filterTablesByControls === "function"
					? PlayerStats.filterTablesByControls(sharedTables, filters)
					: sharedTables; // fallback if helper not present

			if (!filteredTables || Object.keys(filteredTables).length === 0) {
				return { success: false, message: "no shared events found matching the specified filters." };
			}

			await interaction.editReply("calculating...");

			const filteredTableIds = Object.keys(filteredTables);
			const computeMmrDeltaForPlayer = (_playerDetails, playerId) => {
				// For head-to-head, mmr delta should strictly reflect the shared filtered tables only
				// (no season-wide totals). The filteredTables already respect time/queue/playerCount filters.
				return PlayerStats.getTotalMmrDeltaFromTables(filteredTables, playerId);
			};
			const leftMmrDelta = computeMmrDeltaForPlayer(leftPlayerDetails, normalizedLeftId);
			const rightMmrDelta = computeMmrDeltaForPlayer(rightPlayerDetails, normalizedRightId);
			const record = PlayerStats.getH2H(filteredTables, normalizedLeftId, normalizedRightId);
			const eventsPlayed = filteredTableIds.length;

			const leftAverageScore = PlayerStats.getAverageScore(filteredTables, normalizedLeftId);
			const rightAverageScore = PlayerStats.getAverageScore(filteredTables, normalizedRightId);
			const leftAveragePlacement = PlayerStats.getAveragePlacement(filteredTables, normalizedLeftId);
			const rightAveragePlacement = PlayerStats.getAveragePlacement(
				filteredTables,
				normalizedRightId,
			);

			const leftBestWin = PlayerStats.getBiggestDifference(
				filteredTables,
				normalizedLeftId,
				normalizedRightId,
			);
			const rightBestWin = PlayerStats.getBiggestDifference(
				filteredTables,
				normalizedRightId,
				normalizedLeftId,
			);

			const backgroundImage = await loadImageResource(BACKGROUND_RESOURCE, "background");
			const palette = ColorPalettes.headToHeadPalette;

			const formatPlayerSide = async (
				player,
				playerDetails,
				averageScore,
				averagePlacement,
				mmrDeltaValue,
				cachedAvatar = null,
			) => {
				const mmr = Number(playerDetails?.mmr);
				const mmrDisplay = Number.isFinite(mmr) ? `${NUMBER_FORMATTER.format(Math.round(mmr))} mmr` : "mmr unavailable";
				const rankName = playerDetails?.rankName || playerDetails?.rank;
				const rankIcon = await getRankIcon(rankName, mmr);
				let avatarImage = cachedAvatar?.image || null;
				let avatarSource = cachedAvatar?.source || null;
				const avatarUrl = player.discordUser ? EmbedEnhancer.getPlayerAvatarUrl(player.discordUser) : null;
				if (avatarUrl && avatarUrl !== avatarSource) {
					try {
						avatarImage = await EmbedEnhancer.loadWebPAsPng(avatarUrl);
						avatarSource = avatarUrl;
					}
					catch (avatarError) {
						console.warn("head-to-head: failed to load avatar image:", avatarError);
					}
				}
				const posColor = (palette && palette.valuePositiveColor) || ColorPalettes.headToHeadPalette.valuePositiveColor;
				const negColor = (palette && palette.valueNegativeColor) || ColorPalettes.headToHeadPalette.valueNegativeColor;
				const mmrColor = Number.isFinite(mmrDeltaValue) ? (mmrDeltaValue >= 0 ? posColor : negColor) : null;
				return {
					displayName: player.displayName,
					mmrDisplay,
					rankIcon,
					flagEmoji: EmbedEnhancer.getCountryFlag(playerDetails?.countryCode) || null,
					stats: [
						{ label: "avg score", value: Number.isFinite(averageScore) ? averageScore.toFixed(2) : "-" },
						{ label: "avg placement", value: Number.isFinite(averagePlacement) ? averagePlacement.toFixed(2) : "-" },
						{ label: "mmr delta", value: formatSignedDelta(mmrDeltaValue), valueColor: mmrColor },
					],
					avatarImage,
					avatarSource,
					avatarSize: PLAYER_AVATAR_SIZE,
					avatarRadius: PLAYER_AVATAR_RADIUS,
					avatarGap: PLAYER_AVATAR_GAP,
				};
			};

			const playerLeftRender = await formatPlayerSide(
				playerLeft,
				leftPlayerDetails,
				leftAverageScore,
				leftAveragePlacement,
				leftMmrDelta,
				null,
			);
			const playerRightRender = await formatPlayerSide(
				playerRight,
				rightPlayerDetails,
				rightAverageScore,
				rightAveragePlacement,
				rightMmrDelta,
				null,
			);

			const highlights = { left: null, right: null };
			const buildHighlight = (winner, loser, bestWin) => {
				if (!bestWin?.tableId) return null;
				const table = filteredTables?.[bestWin.tableId];
				if (!table) return null;
				const winnerScore = Number.isFinite(bestWin.player1Score) ? NUMBER_FORMATTER.format(bestWin.player1Score) : "?";
				const loserScoreRaw = Number.isFinite(bestWin.player1Score) && Number.isFinite(bestWin.scoreDifference)
					? bestWin.player1Score - bestWin.scoreDifference
					: null;
				const loserScore = Number.isFinite(loserScoreRaw) ? NUMBER_FORMATTER.format(loserScoreRaw) : "?";
				return {
					title: `${winner.displayName}'s biggest win`,
					descriptor: formatEventDescriptor(table),
					summary: `${winner.displayName} scored ${winnerScore} while ${loser.displayName} scored ${loserScore}.`,
				};
			};

			highlights.left = buildHighlight(playerLeft, playerRight, leftBestWin);
			highlights.right = buildHighlight(playerRight, playerLeft, rightBestWin);

			const nextLeftAvatar = null;
			const nextRightAvatar = null;

			await interaction.editReply("rendering image...");

			const attachment = await renderHeadToHeadImage({
				backgroundImage,
				palette,
				playerLeft: { ...playerLeftRender, highlight: highlights.left },
				playerRight: { ...playerRightRender, highlight: highlights.right },
				record: { ...record, eventsPlayed },
				filters,
			});

			const sessionData = {
				playerLeftDetails: leftPlayerDetails,
				playerRightDetails: rightPlayerDetails,
				primaryPlayerTables: basePlayerTables,
				primaryPlayerId: basePlayerId,
				sharedTables,
				filters,
				target: {
					left: playerLeft,
					right: playerRight,
				},
			};

			const linkParts = [];
			if (leftBestWin?.tableId) {
				linkParts.push(
					`[${playerLeft.displayName}'s biggest win](https://lounge.mkcentral.com/mkworld/TableDetails/${leftBestWin.tableId})`,
				);
			}
			if (rightBestWin?.tableId) {
				linkParts.push(
					`[${playerRight.displayName}'s biggest win](https://lounge.mkcentral.com/mkworld/TableDetails/${rightBestWin.tableId})`,
				);
			}
			const content = linkParts.length ? `links: ${linkParts.join(", ")}` : "";

			return {
				success: true,
				content,
				files: [attachment],
				session: sessionData,
			};
		}
		catch (error) {
			console.error("error generating head-to-head:", error);
			return {
				success: false,
				message:
          "an error occurred while generating head-to-head stats. please try again later.",
			};
		}
	},
};
