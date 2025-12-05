const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("canvas");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");
const ColorPalettes = require("../../utils/colorPalettes");
const Fonts = require("../../utils/fonts");
const resolveTargetPlayer = require("../../utils/playerResolver");
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
const BACKGROUND_RESOURCE = "images/other backgrounds blurred/leaderboardbg.png";

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
	return loadImageResource(`images/ranks/${filename}`, `rank icon ${rankName}`);
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

function buildLeaderboardCustomId(action, { timeFilter, serverId }) {
	const safeAction = action || "time";
	const safeTime = (timeFilter && TIME_FILTERS.includes(timeFilter)) ? timeFilter : "alltime";
	const safeServer = serverId ? String(serverId) : "";
	return ["leaderboard", safeAction, safeTime, safeServer].join("|");
}

function parseLeaderboardInteraction(customId) {
	if (!customId?.startsWith("leaderboard|")) {
		return null;
	}
	const parts = customId.split("|");
	if (parts.length < 3) {
		return null;
	}
	const [, action, timeFilter, serverId] = parts;
	return {
		action,
		timeFilter: TIME_FILTERS.includes(timeFilter) ? timeFilter : "alltime",
		serverId: serverId || null,
	};
}

function buildLeaderboardComponents({ timeFilter, serverId }) {
	const row = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { timeFilter: "alltime", serverId }))
				.setLabel("current")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "alltime"),
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { timeFilter: "weekly", serverId }))
				.setLabel("past week")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "weekly"),
			new ButtonBuilder()
				.setCustomId(buildLeaderboardCustomId("time", { timeFilter: "season", serverId }))
				.setLabel("this season")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(timeFilter === "season"),
		);
	return [row];
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
	entries,
	palette,
	totalEligible,
	guildIcon,
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
	const subtitleParts = [timeLabel, `${playerCount} player${playerCount === 1 ? "" : "s"}`];
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

	await drawLeaderboardColumn(ctx, columns[0], leftEntries, palette, 1, timeFilter);
	await drawLeaderboardColumn(ctx, columns[1], rightEntries, palette, ENTRIES_PER_COLUMN + 1, timeFilter);

	const buffer = canvas.toBuffer("image/png");
	return new AttachmentBuilder(buffer, { name: "leaderboard.png" });
}

async function drawLeaderboardColumn(ctx, frame, entries, palette, startingRank, timeFilter) {
	if (!entries.length) {
		return;
	}

	const cardGap = LAYOUT.entryCardGap;
	const innerHeight = frame.height;
	const totalGap = Math.max(entries.length - 1, 0) * cardGap;
	const cardHeight = entries.length ? (innerHeight - totalGap) / entries.length : 0;

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
		ctx.font = `600 ${LAYOUT.nameFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
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

async function collectLeaderboardEntries(interaction) {
	const members = await interaction.guild.members.fetch();
	const memberList = Array.from(members.values()).filter(m => !m.user.bot);
	const entries = [];
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
				const details = await LoungeApi.getPlayerByDiscordIdDetailed(member.id);
				if (!details) return null;

				const mmr = Number(details.mmr ?? details.currentMmr ?? details.mmrValue);
				if (!Number.isFinite(mmr)) {
					return null;
				}

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
					loungeId: String(details.id),
					mmr,
					activity,
					countryCode: details.countryCode || null,
					rankName: details.rankName || details.rank || null,
					mmrChanges,
					metrics: {
						alltime: mmr,
						weekly: weeklyDelta,
						season: seasonDelta,
					},
					playerDetails: {
						name: details.name || details.loungeName || null,
					},
					displayName: member.displayName,
					flagEmoji: getCountryFlag(details.countryCode),
				};
			}
			catch (error) {
				// console.warn(`leaderboard: failed to load player details for ${member.displayName}:`, error);
				return null;
			}
		});

		const results = await Promise.all(promises);
		entries.push(...results.filter(Boolean));
	}

	entries.sort((a, b) => b.mmr - a.mmr);
	return entries;
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
	session: existingSession = null,
} = {}) {
	const serverId = interaction.guildId;
	const guildName = (interaction.guild?.name || "server") + " leaderboard";
	const components = buildLeaderboardComponents({ timeFilter, serverId });
	const palette = getPalette();

	let session = existingSession || null;

	if (!session) {
		await interaction.editReply("scanning members...");
		const entries = await collectLeaderboardEntries(interaction);
		session = {
			serverId,
			serverName: guildName,
			entries,
			generatedAt: Date.now(),
		};
	}
	await interaction.editReply("sorting players...");
	const pool = session.entries.filter(entry => {
		if (timeFilter === "alltime") return true;
		return Boolean(entry.activity?.[timeFilter]);
	});

	if (!pool.length) {
		return {
			success: false,
			message: `no tracked players have mmr data for ${TIME_LABELS[timeFilter] || timeFilter}.`,
			components,
		};
	}

	const sortedPool = [...pool].sort((a, b) => compareEntriesByTimeFilter(a, b, timeFilter));
	const topEntries = sortedPool.slice(0, MAX_ENTRIES);
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
		entries: topEntries,
		palette,
		totalEligible: pool.length,
		guildIcon: iconForRender,
	});

	session = {
		...session,
		timeFilter,
		pendingTimeFilter: null,
		activeRequestToken: null,
	};


	return {
		success: true,
		content: "",
		files: [attachment],
		components,
		session,
	};
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("see your server's mmr leaderboard."),

	async execute(interaction) {
		try {
			await interaction.deferReply();

			const validation = await AutoUserManager.ensureServerReady(interaction.guildId);
			if (!validation.success) {
				await interaction.editReply({
					content: validation.message || "unable to validate command user.",
					components: [],
					files: [],
				});
				return;
			}

			const result = await generateLeaderboard(interaction, {
				timeFilter: "alltime",
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
			// Prefer the ID state (parsed.timeFilter) over the session state
			const nextTimeFilter = parsed.timeFilter || fallbackTimeFilter;

			if (session) {
				session.pendingTimeFilter = nextTimeFilter;
			}

			const components = buildLeaderboardComponents({
				timeFilter: nextTimeFilter,
				serverId: parsed.serverId || interaction.guildId,
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
					session,
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