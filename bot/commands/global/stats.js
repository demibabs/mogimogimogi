const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const { createCanvas, loadImage } = require("canvas");
const Database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const AutoUserManager = require("../../utils/autoUserManager");
const resolveTargetPlayer = require("../../utils/playerResolver");
const Fonts = require("../../utils/fonts");
const EmbedEnhancer = require("../../utils/embedEnhancer");
const GameData = require("../../utils/gameData");
const ColorPalettes = require("../../utils/colorPalettes");
const {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
} = require("../../utils/cacheManager");
const { formatNumber, formatSignedNumber } = EmbedEnhancer;

const STATS_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const statsSessionCache = new Map();
const statsSessionExpiryTimers = new Map();
const statsRenderTokens = new Map();

const EDGE_RADIUS = 30;

const LAYOUT = {
	pagePadding: 100,
	columnGap: 50,
	headerHeight: 120,
	statsHeight: 720,
	sectionGap: 40,
	headerPaddingLeft: 40,
	headerPaddingRight: 25,
	headerEmojiSize: 60,
	headerEmojiGap: 24,
	headerTitleFontSize: 52,
	headerSubtitleFontSize: 26,
	headerSubtitleGap: 10,
	headerAvatarSize: 96,
	headerAvatarRadius: 24,
	headerAssetGap: 15,
	headerAvatarOffset: 12,
	headerTextYOffset: -6,
	headerFavoriteMaxSize: 100,
	statsPadding: 45,
	statsCellPadding: 42,
	statsLabelFontSize: 32,
	statsValueFontSize: 55,
	statsSubLabelFontSize: 25,
	statsCellAdditionalTopPadding: 10,
	statsCellAdditionalBottomPadding: 17,
};

const CHART_DIMENSIONS = { width: 835, height: 880 };
const ICON_SIZE = 54;
const ICON_GAP = 12;
const MAX_BAR_HEIGHT_RATIO = 0.90;

let chartRenderer = null;

if (typeof document === "undefined") {
	global.document = {
		createElement(tag) {
			if (tag !== "canvas") {
				throw new Error(`Unsupported element requested: ${tag}`);
			}
			return createCanvas(64, 64); // size can be small; patternomaly resizes internally
		},
	};
}

function beginStatsRender(messageId) {
	if (!messageId) {
		return null;
	}
	const token = Symbol("statsRender");
	statsRenderTokens.set(messageId, token);
	return token;
}

function isStatsRenderActive(messageId, token) {
	if (!messageId || !token) {
		return true;
	}
	return statsRenderTokens.get(messageId) === token;
}

function endStatsRender(messageId, token) {
	if (!messageId || !token) {
		return;
	}
	if (statsRenderTokens.get(messageId) === token) {
		statsRenderTokens.delete(messageId);
	}
}

function getStatsSession(messageId) {
	if (!messageId) {
		return null;
	}
	const session = statsSessionCache.get(messageId);
	if (!session) {
		return null;
	}
	if (session.expiresAt && session.expiresAt <= Date.now()) {
		deleteCacheEntry(statsSessionCache, statsSessionExpiryTimers, messageId);
		return null;
	}
	refreshCacheEntry(statsSessionCache, statsSessionExpiryTimers, messageId, STATS_SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + STATS_SESSION_CACHE_TTL_MS;
	return session;
}

function storeStatsSession(messageId, session) {
	if (!messageId || !session) {
		return;
	}
	const expiresAt = Date.now() + STATS_SESSION_CACHE_TTL_MS;
	const payload = {
		...session,
		messageId,
		expiresAt,
	};
	setCacheEntry(statsSessionCache, statsSessionExpiryTimers, messageId, payload, STATS_SESSION_CACHE_TTL_MS);
}

function refreshStatsSession(messageId) {
	if (!messageId) {
		return;
	}
	const session = statsSessionCache.get(messageId);
	if (!session) {
		return;
	}
	refreshCacheEntry(statsSessionCache, statsSessionExpiryTimers, messageId, STATS_SESSION_CACHE_TTL_MS);
	session.expiresAt = Date.now() + STATS_SESSION_CACHE_TTL_MS;
}

function computeCanvasLayout({ chartWidth, chartHeight }) {
	const headerFrame = {
		left: LAYOUT.pagePadding,
		top: LAYOUT.pagePadding,
		width: chartWidth,
		height: LAYOUT.headerHeight,
	};

	const statsFrame = {
		left: LAYOUT.pagePadding,
		top: headerFrame.top + headerFrame.height + LAYOUT.sectionGap,
		width: chartWidth,
		height: LAYOUT.statsHeight,
	};

	const chartFrame = {
		left: headerFrame.left + headerFrame.width + LAYOUT.columnGap,
		top: LAYOUT.pagePadding,
		width: chartWidth,
		height: chartHeight,
	};

	return { headerFrame, statsFrame, chartFrame };
}

function drawStatsGrid(ctx, frame, trackColors, gridConfig) {
	if (!frame || !gridConfig?.length) return;

	const columns = gridConfig[0]?.length || 0;
	if (!columns) return;

	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const innerX = frame.left + LAYOUT.statsPadding;
	const innerY = frame.top + LAYOUT.statsPadding;
	const innerWidth = Math.max(frame.width - LAYOUT.statsPadding * 2, 1);
	const innerHeight = Math.max(frame.height - LAYOUT.statsPadding * 2, 1);
	const cellWidth = innerWidth / columns;
	const cellHeight = innerHeight / gridConfig.length;

	const labelFont = `${LAYOUT.statsLabelFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
	const labelLineHeight = LAYOUT.statsLabelFontSize * 1.1;
	const valueFont = `700 ${LAYOUT.statsValueFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
	const subLabelFont = `${LAYOUT.statsSubLabelFontSize}px ${Fonts.FONT_FAMILY_STACK}`;

	const yOffset = (LAYOUT.statsCellPadding + LAYOUT.statsCellAdditionalTopPadding) / 2;

	gridConfig.forEach((row, rowIndex) => {
		row.forEach((cell, colIndex) => {
			const cellTop = innerY + rowIndex * cellHeight;
			const cellCenterX = innerX + colIndex * cellWidth + cellWidth / 2;
			const cellBottom = cellTop + cellHeight - LAYOUT.statsCellPadding;
			const cellTopInner = cellTop + LAYOUT.statsCellPadding;
			const baseValueY = yOffset + cellTop + cellHeight / 2;
			const defaultTextColor = trackColors?.statsTextColor || "#ffffff";
			const defaultValueColor = trackColors?.statsValueColor || defaultTextColor;

			const labelLines = String(cell.label ?? "").split("\n");
			ctx.font = labelFont;
			ctx.fillStyle = defaultTextColor;
			let labelY = yOffset + cellTopInner - (labelLineHeight * (labelLines.length - 1)) + LAYOUT.statsCellAdditionalTopPadding;
			labelLines.forEach(line => {
				ctx.fillText(line, cellCenterX, labelY);
				labelY += labelLineHeight;
			});

			ctx.font = valueFont;
			const valueColor = cell.valueColor || defaultValueColor;
			const valueOutlineColor = cell.valueOutlineColor || null;
			ctx.fillStyle = valueColor;
			let valueY = baseValueY;
			if (typeof cell.valueYOffset === "number") {
				valueY += cell.valueYOffset;
			}
			const minValueY = cellTopInner + LAYOUT.statsLabelFontSize + 10;
			if (valueY < minValueY) {
				valueY = minValueY;
			}
			if (valueOutlineColor) {
				ctx.save();
				ctx.lineWidth = 4;
				ctx.strokeStyle = valueOutlineColor;
				ctx.lineJoin = "round";
				ctx.strokeText(cell.value ?? "-", cellCenterX, valueY);
				ctx.restore();
			}
			ctx.fillText(cell.value ?? "-", cellCenterX, valueY);

			if (cell.subLabel) {
				ctx.font = subLabelFont;
				ctx.fillStyle = defaultTextColor;
				let subY = yOffset + cellBottom - LAYOUT.statsCellAdditionalBottomPadding;
				if (typeof cell.subLabelYOffset === "number") {
					subY += cell.subLabelYOffset;
				}
				const minSubY = cellTopInner + LAYOUT.statsLabelFontSize;
				if (subY < minSubY) {
					subY = minSubY;
				}
				ctx.fillText(cell.subLabel, cellCenterX, subY);
			}
		});
	});

	ctx.restore();
}

function getChartRenderer() {
	if (chartRenderer) {
		return chartRenderer;
	}
	chartRenderer = new ChartJSNodeCanvas({
		width: CHART_DIMENSIONS.width,
		height: CHART_DIMENSIONS.height,
		backgroundColour: "rgba(0,0,0,0)",
		chartCallback: ChartJS => {
			ChartJS.defaults.font.family = Fonts?.FONT_FAMILY_STACK || "Lexend, Arial, sans-serif";
		},
	});
	return chartRenderer;
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
		console.warn(`stats: failed to load image ${descriptor}:`, error);
		return null;
	}
}

async function getRankIcon(tier) {
	if (!tier) {
		return null;
	}
	const filename = PlayerStats.getRankIconFilename(tier);
	if (!filename) {
		console.warn(`no icon found for tier ${tier}, skipping`);
		return null;
	}
	return loadImageResource(`images/ranks/${filename}`, `rank icon ${tier}`);
}

async function getDivisionChart(trackName, trackColors, globals) {
	const divisionEntries = Array.isArray(globals?.divisionData)
		? [...globals.divisionData].reverse()
		: [];
	const chartLabels = divisionEntries.map(entry => entry.tier);
	const chartData = divisionEntries.map(entry => entry.count);
	const peakBarValue = chartData.length ? Math.max(...chartData) : 0;
	const yAxisMax = peakBarValue > 0
		? Math.ceil(peakBarValue / MAX_BAR_HEIGHT_RATIO)
		: undefined;
	const rankImages = await Promise.all(chartLabels.map(tier => getRankIcon(tier)));

	const iconPlugin = {
		id: "xAxisIcons",
		afterDraw(chart, args, options) {
			const pluginOptions = options || {};
			const icons = pluginOptions.icons || [];
			if (!icons.length) {
				return;
			}
			const chartCtx = chart.ctx;
			const { bottom } = chart.chartArea;
			const xScale = chart.scales.x;
			chartCtx.save();
			icons.forEach((img, idx) => {
				if (!img) return;
				const x = xScale.getPixelForTick(idx);
				chartCtx.drawImage(img, x - ICON_SIZE / 2, bottom + ICON_GAP, ICON_SIZE, ICON_SIZE);
			});
			chartCtx.restore();
		},
	};

	let capturedMetrics = null;
	const metricsCapturePlugin = {
		id: "captureBarMetrics",
		afterDatasetsDraw(chart) {
			const meta = chart.getDatasetMeta(0);
			if (!meta?.data?.length) {
				return;
			}
			const centers = meta.data.map(element => element.x);
			const widths = centers.map((center, index) => {
				if (index < centers.length - 1) {
					return centers[index + 1] - center;
				}
				if (centers.length > 1) {
					return center - centers[index - 1];
				}
				return chart.chartArea.right - chart.chartArea.left;
			});
			capturedMetrics = {
				bars: centers.map((center, index) => {
					const barWidth = Math.abs(widths[index] || 0);
					const barTop = meta.data[index]?.y;
					return {
						left: center - barWidth / 2,
						width: barWidth,
						top: barTop,
					};
				}),
				chartArea: { ...chart.chartArea },
			};
		},
	};

	const barColors = [
		"#575757ff",
		"#a9600e",
		"#8d8d8dff",
		"#e9c235",
		"#3fabb8",
		"#426cd3",
		"#c6215f",
		"#c4f2ff",
		"#9170db",
		"#97082e",
	];

	const renderer = getChartRenderer();

	const config = {
		type: "bar",
		data: {
			labels: chartLabels,
			datasets: [{
				data: chartData,
				backgroundColor: barColors.map(color =>
					EmbedEnhancer.randomPattern(color, "#ffffff", 20, [], 0.3),
				),
				fill: true,
				tension: 0.3,
				categoryPercentage: 1,
				barPercentage: 1,
				borderRadius: { topLeft: EDGE_RADIUS / 2, topRight: EDGE_RADIUS / 2 },
				borderSkipped: false,
			}],
		},
		options: {
			plugins: {
				title: {
					display: true,
					text: "mmr distribution",
					font: {
						size: 40,
					},
					color: trackColors.chartTextColor,
				},
				xAxisIcons: {
					icons: rankImages,
				},
				legend: { display: false },
			},
			scales: {
				y: {
					title: {
						display: true,
						text: "player count",
						font: { size: 24 },
						color: trackColors.chartTextColor,
					},
					beginAtZero: true,
					max: yAxisMax,
					grid: { color: trackColors.yGridColor },
					ticks: {
						stepSize: 1000,
						font: { size: 20 },
						color: trackColors.chartTextColor,
						callback(value) {
							if (typeof yAxisMax === "number" && value >= yAxisMax) {
								return "";
							}
							return value;
						},
					},
				},
				x: {
					ticks: { display: false },
					grid: { display: false },
					categoryPercentage: 1,
					barPercentage: 1,
				},
			},
			layout: {
				padding: {
					top: 25,
					right: 25,
					bottom: ICON_SIZE + ICON_GAP * 2,
					left: 25,
				},
			},
		},
		plugins: [iconPlugin, metricsCapturePlugin],
	};

	const chartBuffer = await renderer.renderToBuffer(config);
	const chartImage = await loadImage(chartBuffer);

	return {
		image: chartImage,
		metrics: capturedMetrics,
		labels: chartLabels,
	};
}

async function getPlayerStats(loungeId, serverId, tables, playerDetails = null) {
	try {
		const normalizedLoungeId = String(loungeId);
		const player = playerDetails || await LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId);
		const mmr = player.mmr;
		const rank = player.overallRank;
		const matchesPlayed = PlayerStats.getMatchesPlayed(tables, normalizedLoungeId);
		const winRate = PlayerStats.getWinRate(tables, normalizedLoungeId);
		const avgPlacement = PlayerStats.getAveragePlacement(tables, normalizedLoungeId);
		const avgScore = PlayerStats.getAverageScore(tables, normalizedLoungeId);
		const avgSeed = PlayerStats.getAverageSeed(tables, normalizedLoungeId);
		const bestScore = PlayerStats.getBestScore(tables, normalizedLoungeId);
		const worstScore = PlayerStats.getWorstScore(tables, normalizedLoungeId);
		const partnerAverage = PlayerStats.getPartnerAverage(tables, normalizedLoungeId);
		const playerCount = PlayerStats.getAveragePlayerCount(tables, normalizedLoungeId);

		return {
			mmr,
			rank,
			loungeId: normalizedLoungeId,
			matchesPlayed,
			winRate,
			avgPlacement,
			avgScore,
			avgSeed,
			bestScore,
			worstScore,
			partnerAverage,
			playerCount,
		};
	}
	catch (error) {
		console.error(`Error getting player stats for lounge user ${loungeId}:`, error);
		return null;
	}
}

function drawMMRMarker(ctx, mmr, trackName, {
	chartX,
	chartY,
	chartWidth,
	chartHeight,
	labels,
	metrics,
	iconSize,
	iconGap,
}) {
	const mmrValue = Number(mmr);
	if (!Number.isFinite(mmrValue)) {
		return;
	}

	const tierInfos = Array.isArray(labels)
		? labels.map(label => PlayerStats.getRankThresholdByName(label))
		: [];
	if (!tierInfos.length) {
		return;
	}

	let tierIndex = -1;
	let tierInfo = null;

	for (let i = 0; i < tierInfos.length; i++) {
		const info = tierInfos[i];
		if (!info) continue;
		const withinRange = mmrValue >= info.min && (mmrValue < info.max || !Number.isFinite(info.max));
		if (withinRange) {
			tierIndex = i;
			tierInfo = info;
			break;
		}
	}

	if (tierIndex === -1) {
		const fallbackTier = PlayerStats.getRankThresholdForMmr(mmrValue);
		if (fallbackTier) {
			const matchingIndex = tierInfos.findIndex(info => info?.key === fallbackTier.key);
			if (matchingIndex !== -1) {
				tierIndex = matchingIndex;
				tierInfo = fallbackTier;
			}
			else {
				tierIndex = tierInfos.findIndex(info => info);
				tierInfo = fallbackTier;
			}
		}
	}

	if (tierIndex === -1) {
		tierIndex = tierInfos.length - 1;
		tierInfo = tierInfos[tierIndex] || PlayerStats.getRankThresholds()[0] || { min: 0, max: Infinity };
	}

	if (tierIndex < 0) {
		tierIndex = 0;
	}
	if (tierIndex >= tierInfos.length) {
		tierIndex = tierInfos.length - 1;
	}
	if (!tierInfo) {
		tierInfo = PlayerStats.getRankThresholds()[tierIndex] || { min: 0, max: Infinity };
	}

	const lower = Number.isFinite(tierInfo.min) ? tierInfo.min : 0;
	const upper = tierInfo.max;
	let ratio = 0;
	if (!Number.isFinite(upper)) {
		ratio = Math.min((mmrValue - lower) / 1500, 1);
	}
	else {
		ratio = (mmrValue - lower) / (upper - lower);
	}
	ratio = Math.min(Math.max(ratio, 0), 1);

	let markerX;
	let markerY;
	let barBottomY;
	const radius = 10;

	if (metrics?.bars?.length) {
		const barMetrics = metrics.bars[tierIndex];
		if (!barMetrics) return;
		const { left, width, top } = barMetrics;
		markerX = chartX + left + ratio * width;
		const barTop = Number.isFinite(top) ? chartY + top : chartY + chartHeight * 0.1;
		markerY = barTop + 25 + radius / 2;
		const bottom = metrics.chartArea?.bottom ?? chartHeight;
		barBottomY = chartY + bottom;
	}
	else {
		const tierCount = Math.max(tierInfos.length, 1);
		const barWidth = chartWidth / tierCount;
		const progress = 1 - ratio;
		markerX = chartX + tierIndex * barWidth + progress * barWidth;
		markerY = chartY + chartHeight * 0.15;
		barBottomY = chartY + chartHeight;
	}
	markerY -= (iconSize ?? 0) / 2;

	ctx.save();

	const trackColors = ColorPalettes.statsTrackColors[trackName];
	ctx.strokeStyle = "#ffffff";
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.arc(markerX, markerY, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	const labelText = "you";
	const labelFontSize = 24;
	const labelPaddingX = 12;
	const labelPaddingY = 6;
	const labelGap = 10;
	ctx.font = `${labelFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	const textMetrics = ctx.measureText(labelText);
	const labelWidth = Math.ceil(textMetrics.width + labelPaddingX * 2);
	const labelHeight = Math.ceil(labelFontSize + labelPaddingY * 2);
	const labelBottom = markerY - radius - labelGap;
	const labelLeft = markerX - labelWidth / 2;
	const labelTop = labelBottom - labelHeight;
	EmbedEnhancer.drawRoundedPanel(
		ctx,
		{ left: labelLeft, top: labelTop, width: labelWidth, height: labelHeight },
		trackColors.baseColor,
		12,
	);
	ctx.fillStyle = trackColors.youColor;
	ctx.fillText(labelText, markerX, labelBottom - labelPaddingY);
	ctx.restore();
}

async function renderStats({
	interaction = null,
	target = null,
	loungeId: loungeIdInput,
	serverId,
	queueFilter,
	playerCountFilter,
	timeFilter = "alltime",
	session: sessionOption = null,
	userData: userDataOption = null,
	onProgress = null,
	skipAutoUserAndMembership = false,
} = {}) {
	const reportProgress = async message => {
		if (!onProgress || !message) return;
		try {
			await onProgress(message);
		}
		catch (error) {
			console.warn("stats renderer progress callback failed:", error);
		}
	};

	const normalizedLoungeId = String(target?.loungeId ?? loungeIdInput ?? "").trim();
	if (!normalizedLoungeId) {
		return { success: false, message: "lounge id is required." };
	}
	const fallbackName = `player ${normalizedLoungeId}`;
	const session = sessionOption;
	const useSession = Boolean(session && session.playerDetails && session.allTables && session.trackName);

	let displayName = target?.displayName || target?.loungeName || fallbackName;
	let loungeName = target?.loungeName || displayName || fallbackName;
	let playerDetails = useSession ? session.playerDetails : null;
	let allTables = useSession ? session.allTables : null;
	let favorites = useSession ? session.favorites || {} : null;
	let favoriteCharacterImage = null;
	let favoriteVehicleImage = null;
	let trackName = useSession ? session.trackName : null;
	let globals = useSession ? session.globals || null : null;
	let discordUser = target?.discordUser || (useSession ? session.discordUser : null);
	let storedRecord = null;

	if (!playerDetails) {
		playerDetails = await LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId);
		if (!playerDetails) {
			return { success: false, message: "couldn't find that player in mkw lounge." };
		}
	}

	if (!useSession && !skipAutoUserAndMembership) {
		const result = await AutoUserManager.ensureUserAndMembership({
			interaction,
			target: target || { loungeId: normalizedLoungeId },
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

	displayName = target?.displayName || loungeName || fallbackName;
	loungeName = loungeName || fallbackName;
	if (discordUser && target && !target.discordUser) {
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
		if (storedRecord && storedRecord.favorites) {
			favorites = storedRecord.favorites;
		}
		else {
			if (!userData) {
				userData = await Database.getUserData(normalizedLoungeId);
			}
			favorites = userData?.favorites || {};
		}
	}

	let tipMessage = "";
	try {
		tipMessage = await AutoUserManager.getCustomizeTip({
			interaction,
			target,
			discordUser,
			favorites,
			userData,
			loungeId: normalizedLoungeId,
		});
	}
	catch (error) {
		console.warn("stats renderer tip generation failed:", error);
	}

	if (!trackName) {
		trackName = favorites.track || GameData.getRandomTrack();
	}
	if (!favoriteCharacterImage || !favoriteVehicleImage) {
		const [characterImage, vehicleImage] = await Promise.all([
			favoriteCharacterImage ? Promise.resolve(favoriteCharacterImage) : EmbedEnhancer.loadFavoriteCharacterImage(favorites),
			favoriteVehicleImage ? Promise.resolve(favoriteVehicleImage) : EmbedEnhancer.loadFavoriteVehicleImage(favorites),
		]);
		favoriteCharacterImage = characterImage || favoriteCharacterImage;
		favoriteVehicleImage = vehicleImage || favoriteVehicleImage;
	}

	if (!globals) {
		globals = await LoungeApi.getGlobalStats();
	}

	const playerStats = await getPlayerStats(normalizedLoungeId, serverId, filteredTables, playerDetails, null);
	const mmrRaw = Number(playerStats?.mmr);
	const mmr = Number.isFinite(mmrRaw) ? mmrRaw : 0;
	const mmrDeltaFromTables = PlayerStats.getTotalMmrDeltaFromTables(filteredTables, normalizedLoungeId);
	const mmrDeltaForFilter = timeFilter === "alltime"
		? mmrDeltaFromTables
		: PlayerStats.computeMmrDeltaForFilter({
			playerDetails,
			tableIds: filteredTableIds,
			timeFilter,
			queueFilter,
			playerCountFilter,
		});
	const filtersAreBoth = queueFilter === "both" && playerCountFilter === "both";
	const isAllTimeView = timeFilter === "alltime";
	const isSeasonView = timeFilter === "season";
	const showCurrentMmr = filtersAreBoth && (isAllTimeView || isSeasonView);
	let peakMmr = null;
	if (showCurrentMmr) {
		if (isSeasonView) {
			const seasonPeak = Number(playerDetails?.maxMmr);
			if (Number.isFinite(seasonPeak)) {
				peakMmr = seasonPeak;
			}
		}
		else if (isAllTimeView) {
			const peaks = [];
			const currentSeasonPeak = Number(playerDetails?.maxMmr);
			if (Number.isFinite(currentSeasonPeak)) {
				peaks.push(currentSeasonPeak);
			}
			const maxSeason = Number(LoungeApi.DEFAULT_SEASON);
			if (Number.isFinite(maxSeason) && maxSeason > 0) {
				const seasonIndices = [];
				for (let seasonIndex = 0; seasonIndex < maxSeason; seasonIndex++) {
					seasonIndices.push(seasonIndex);
				}
				if (seasonIndices.length) {
					const seasonResults = await Promise.all(seasonIndices.map(async seasonIndex => {
						try {
							return await LoungeApi.getPlayerByLoungeId(normalizedLoungeId, seasonIndex);
						}
						catch (seasonError) {
							console.warn(`failed to fetch season ${seasonIndex} peak mmr for ${normalizedLoungeId}:`, seasonError);
							return null;
						}
					}));
					seasonResults.forEach(seasonData => {
						const seasonalPeak = Number(seasonData?.maxMmr);
						if (Number.isFinite(seasonalPeak)) {
							peaks.push(seasonalPeak);
						}
					});
				}
			}
			if (peaks.length) {
				peakMmr = Math.max(...peaks);
			}
		}
		if (!Number.isFinite(peakMmr) && Number.isFinite(mmr)) {
			peakMmr = mmr;
		}
	}
	const mmrDisplay = showCurrentMmr ? formatNumber(mmrRaw) : formatSignedNumber(mmrDeltaForFilter);
	const mmrFormatted = formatNumber(mmrRaw);
	let mmrSubLabel = null;
	if (showCurrentMmr) {
		if (Number.isFinite(peakMmr)) {
			mmrSubLabel = `(peak: ${formatNumber(Math.round(peakMmr))})`;
		}
	}
	else if (mmrFormatted !== "-") {
		mmrSubLabel = `(current: ${mmrFormatted})`;
	}
	const averageRoomMmr = PlayerStats.computeAverageRoomMmr(filteredTables);
	const averageRoomMmrDisplay = Number.isFinite(averageRoomMmr) ? formatNumber(Math.round(averageRoomMmr)) : "-";

	const rank = playerStats?.rank ?? "-";
	const percent = globals?.totalPlayers ? Math.ceil(100 * (rank / globals.totalPlayers)) : null;
	const tWR = playerStats?.winRate || null;
	if (tWR && typeof tWR.winRate === "number") {
		tWR.winRate = (tWR.winRate * 100).toFixed(1);
	}
	const aSc = Number.isFinite(playerStats?.avgScore) ? playerStats.avgScore.toFixed(1) : "-";
	const partnerAverage = playerStats?.partnerAverage || null;
	const aSe = Number.isFinite(playerStats?.avgSeed) ? playerStats.avgSeed.toFixed(2) : "-";
	const aP = Number.isFinite(playerStats?.avgPlacement) ? playerStats.avgPlacement.toFixed(2) : "-";
	const matchesPlayedCount = Number(playerStats?.matchesPlayed);
	const hasMatches = Number.isFinite(matchesPlayedCount) && matchesPlayedCount > 0;
	const eP = Number.isFinite(matchesPlayedCount) ? String(matchesPlayedCount) : "-";
	let eventsSubLabel = null;
	const breakdown = PlayerStats.getPlayerCountBreakdown(filteredTables, normalizedLoungeId) || {};
	if (playerCountFilter === "both" && hasMatches) {
		const twelveCount = breakdown["12p"] ?? 0;
		const twentyFourCount = breakdown["24p"] ?? 0;
		if (twelveCount || twentyFourCount) {
			const preferTwelve = twelveCount > twentyFourCount;
			const preferTwentyFour = twentyFourCount > twelveCount;
			const modeLabel = preferTwentyFour ? "24p" : preferTwelve ? "12p" : "12p";
			const modeCount = preferTwentyFour ? twentyFourCount : twelveCount;
			if (modeCount > 0) {
				eventsSubLabel = `(${modeLabel}: ${modeCount === matchesPlayedCount ? "all" : modeCount})`;
			}
		}
	}
	const avgAvg = hasMatches
		? ((82 * (breakdown["12p"] ?? 0) + 72 * (breakdown["24p"] ?? 0)) / matchesPlayedCount)
		: null;
	let avgAvgFixed;
	if (avgAvg) {
		avgAvgFixed = parseFloat(avgAvg.toFixed(Number.isInteger(avgAvg) ? 0 : 1));
		avgAvgFixed = avgAvgFixed.toFixed(Number.isInteger(avgAvgFixed) ? 0 : 1);
	}
	const aScSubLabel = Number.isFinite(avgAvg)
		? (`(room avg: ${avgAvgFixed})`)
		: null;
	const partnerAverageValue = Number.isFinite(partnerAverage?.average)
		? partnerAverage.average.toFixed(1)
		: "-";
	const partnerAverageSubLabel = partnerAverage && parseFloat(partnerAverage.roomAverageFixed) != avgAvg
		? (`(room avg: ${partnerAverage?.roomAverageFixed})`)
		: undefined;
	const pC = Number(playerStats?.playerCount);
	const placementSubLabel = playerCountFilter === "both" && Number.isFinite(pC)
		? (`(out of ${pC.toFixed(Number.isInteger(pC) ? 0 : 1)})`)
		: null;

	await reportProgress("rendering image...");

	const trackColors = ColorPalettes.statsTrackColors[trackName];
	const canvasWidth = 1920;
	const canvasHeight = 1080;
	const canvas = createCanvas(canvasWidth, canvasHeight);
	const ctx = canvas.getContext("2d");

	try {
		const backgroundImage = await loadImageResource(`images/tracks blurred/${trackName}_stats.png`, `${trackName} stats background`);
		if (backgroundImage) {
			ctx.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight);
		}
		else {
			throw new Error("background image not available");
		}
	}
	catch (backgroundError) {
		console.warn(`failed to load background image for ${trackName}:`, backgroundError);
		ctx.fillStyle = trackColors?.baseColor || "#000";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	}

	const avatarSource = discordUser || target?.discordUser || null;
	const avatarUrl = EmbedEnhancer.getPlayerAvatarUrl(avatarSource);
	let avatar = null;
	if (avatarUrl) {
		try {
			avatar = await EmbedEnhancer.loadWebPAsPng(avatarUrl);
		}
		catch (avatarError) {
			console.warn("failed to load avatar image:", avatarError);
		}
	}

	const playerEmoji = EmbedEnhancer.getCountryFlag(playerDetails.countryCode);
	let chartResult = null;
	try {
		chartResult = await getDivisionChart(trackName, trackColors, globals);
	}
	catch (chartError) {
		console.warn("failed to generate division chart:", chartError);
	}
	const chartImage = chartResult?.image || null;
	const chartLabels = chartResult?.labels || [];
	const chartMetrics = chartResult?.metrics || null;

	const { headerFrame, statsFrame, chartFrame } = computeCanvasLayout({ chartWidth: CHART_DIMENSIONS.width, chartHeight: CHART_DIMENSIONS.height });

	EmbedEnhancer.drawRoundedPanel(ctx, headerFrame, trackColors.baseColor, EDGE_RADIUS);
	EmbedEnhancer.drawRoundedPanel(ctx, statsFrame, trackColors.baseColor, EDGE_RADIUS);
	EmbedEnhancer.drawRoundedPanel(ctx, chartFrame, trackColors.baseColor, EDGE_RADIUS);

	const headerTextSize = LAYOUT.headerTitleFontSize;
	const headerEmojiSize = LAYOUT.headerEmojiSize;
	const avatarSize = LAYOUT.headerAvatarSize;
	const headerTextX = headerFrame.left + LAYOUT.headerPaddingLeft + headerEmojiSize + LAYOUT.headerEmojiGap;
	const headerEmojiX = headerFrame.left + LAYOUT.headerPaddingLeft;
	const headerEmojiY = headerFrame.top + (headerFrame.height - headerEmojiSize) / 2;
	const fullTitle = `${displayName}'s stats`;
	const nameOnlyTitle = displayName;
	const timeLabels = {
		alltime: "all time",
		weekly: "past week",
		season: `season ${LoungeApi.DEFAULT_SEASON}`,
	};
	const queueLabels = {
		soloq: "solo queue",
		squads: "squads",
	};
	const subtitleParts = [];
	const timeLabel = timeLabels[timeFilter] || timeFilter;
	if (timeLabel) subtitleParts.push(timeLabel);
	if (queueFilter !== "both" && queueLabels[queueFilter]) {
		subtitleParts.push(queueLabels[queueFilter]);
	}
	if (playerCountFilter !== "both" && playerCountFilter) {
		subtitleParts.push(playerCountFilter);
	}
	const subtitleText = subtitleParts.join(" · ");
	const hasSubtitle = Boolean(subtitleText);
	const subtitleFontSize = LAYOUT.headerSubtitleFontSize;
	const subtitleGap = LAYOUT.headerSubtitleGap;
	const textBlockHeight = headerTextSize + (hasSubtitle ? subtitleGap + subtitleFontSize : 0);
	const textBlockTop = headerFrame.top + (headerFrame.height - textBlockHeight) / 2 + (LAYOUT.headerTextYOffset || 0);
	const titleBaseline = textBlockTop + headerTextSize;
	const subtitleBaseline = hasSubtitle ? titleBaseline + subtitleGap + subtitleFontSize : null;

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
	let headerAvatarOffsetNeeded = false;
	if (headerAssets.length < 2 && avatar) {
		headerAssets.push({
			type: "avatar",
			image: avatar,
			width: avatarSize,
			height: avatarSize,
		});
		headerAvatarOffsetNeeded = true;
	}
	const assetsWidth = headerAssets.reduce((sum, asset) => sum + asset.width, 0);
	const assetsGaps = Math.max(headerAssets.length - 1, 0) * LAYOUT.headerAssetGap;
	const rightReserved = assetsWidth + assetsGaps + LAYOUT.headerPaddingRight;

	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = `${headerTextSize}px ${Fonts.FONT_FAMILY_STACK}`;
	ctx.fillStyle = trackColors.headerColor;

	if (playerEmoji) {
		await EmbedEnhancer.drawEmoji(ctx, playerEmoji, headerEmojiX, headerEmojiY, headerEmojiSize);
	}
	const maxTitleWidth = headerFrame.left + headerFrame.width - rightReserved - headerTextX;
	const titleOptions = {
		font: ctx.font,
		emojiSize: headerTextSize * 0.92,
	};
	const fittedFull = EmbedEnhancer.truncateTextWithEmojis(ctx, fullTitle, Math.max(0, maxTitleWidth), titleOptions);
	const fullFits = fittedFull === fullTitle;
	const fittedNameOnly = fullFits
		? fittedFull
		: EmbedEnhancer.truncateTextWithEmojis(ctx, nameOnlyTitle, Math.max(0, maxTitleWidth), titleOptions);
	const titleToDraw = fullFits
		? fittedFull
		: fittedNameOnly;

	await EmbedEnhancer.drawTextWithEmojis(ctx, titleToDraw, headerTextX, titleBaseline, {
		font: ctx.font,
		fillStyle: ctx.fillStyle,
		emojiSize: headerTextSize * 0.92,
		lineHeight: headerTextSize * 1.2,
	});

	if (hasSubtitle) {
		const subtitleColor = trackColors.headerSubtitleColor || trackColors.statsTextColor || trackColors.headerColor;
		ctx.font = `${subtitleFontSize}px ${Fonts.FONT_FAMILY_STACK}`;
		ctx.fillStyle = subtitleColor;
		ctx.fillText(subtitleText, headerTextX, subtitleBaseline);
	}

	let assetCursor = headerFrame.left + headerFrame.width - LAYOUT.headerPaddingRight + (headerAvatarOffsetNeeded ? LAYOUT.headerAvatarOffset : 0);
	for (let index = headerAssets.length - 1; index >= 0; index--) {
		const asset = headerAssets[index];
		assetCursor -= asset.width;
		const drawX = assetCursor;
		const drawY = headerFrame.top + (headerFrame.height - asset.height) / 2;
		if (asset.type === "avatar") {
			EmbedEnhancer.drawRoundedImage(ctx, asset.image, drawX, drawY, asset.width, asset.height, LAYOUT.headerAvatarRadius);
		}
		else {
			ctx.drawImage(asset.image, drawX, drawY, asset.width, asset.height);
		}
		if (index > 0) {
			assetCursor -= LAYOUT.headerAssetGap;
		}
	}

	const winRateText = tWR?.winRate != null ? `${tWR.winRate}%` : "-";
	const winLossRecord = EmbedEnhancer.formatWinLoss(tWR);
	const gridConfig = [
		[
			{
				label: "mmr",
				value: mmrDisplay,
				subLabel: mmrSubLabel || undefined,
			},
			{ label: "rank", value: rank, subLabel: percent ? `(top ${percent}%)` : undefined },
			{ label: "team\nwin rate", value: winRateText, subLabel: winLossRecord ? `(${winLossRecord})` : undefined },
		],
		[
			{ label: "average\nroom mmr", value: averageRoomMmrDisplay },
			{ label: "average\nscore", value: aSc, subLabel: aScSubLabel || undefined },
			{ label: "partner\naverage", value: partnerAverageValue, subLabel: partnerAverageSubLabel },
		],
		[
			{ label: "average\nseed", value: aSe },
			{ label: "average\nplacement", value: aP, subLabel: placementSubLabel || undefined },
			{ label: "events\nplayed", value: eP, subLabel: eventsSubLabel || undefined },
		],
	];

	drawStatsGrid(ctx, statsFrame, trackColors, gridConfig);

	if (chartImage) {
		EmbedEnhancer.drawRoundedImage(
			ctx,
			chartImage,
			chartFrame.left,
			chartFrame.top,
			chartFrame.width,
			chartFrame.height,
			EDGE_RADIUS,
		);
	}

	drawMMRMarker(ctx, mmr, trackName, {
		chartX: chartFrame.left,
		chartY: chartFrame.top,
		chartWidth: chartFrame.width,
		chartHeight: chartFrame.height,
		labels: chartLabels,
		metrics: chartMetrics,
		iconSize: ICON_SIZE,
		iconGap: ICON_GAP,
	});

	const pngBuffer = canvas.toBuffer("image/png");

	const updatedSession = {
		loungeId: normalizedLoungeId,
		serverId,
		displayName,
		loungeName,
		playerDetails,
		allTables,
		favorites,
		trackName,
		globals,
		discordUser,
		target: {
			loungeId: normalizedLoungeId,
			loungeName,
			displayName,
		},
	};

	return {
		success: true,
		pngBuffer,
		content: `${tipMessage}**link:** [${displayName}'s lounge profile](https://lounge.mkcentral.com/mkworld/PlayerDetails/${normalizedLoungeId})`,
		session: updatedSession,
		userData,
	};
}


function buildStatsCustomId(action, { timeFilter, queueFilter, playerCountFilter, loungeId }) {
	const safeAction = action || "time";
	const safeTime = timeFilter || "alltime";
	const safeQueue = queueFilter || "both";
	const safePlayers = playerCountFilter || "both";
	const safeLounge = loungeId ?? "";
	return ["stats", safeAction, safeTime, safeQueue, safePlayers, safeLounge].join("|");
}

function buildStatsComponentRows({ loungeId, timeFilter, queueFilter, playerCountFilter }) {
	const safeTime = timeFilter || "alltime";
	const safeQueue = queueFilter || "both";
	const safePlayerCount = playerCountFilter || "both";
	const rows = [];

	const timeRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("time", { timeFilter: "alltime", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("all time")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "alltime"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("time", { timeFilter: "weekly", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("past week")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "weekly"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("time", { timeFilter: "season", queueFilter: safeQueue, playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("this season")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeTime === "season"),
		);
	rows.push(timeRow);

	const queueRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "soloq", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("soloq")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "soloq"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "squads", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("squads")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "squads"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("queue", { timeFilter: safeTime, queueFilter: "both", playerCountFilter: safePlayerCount, loungeId }))
				.setLabel("both")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safeQueue === "both"),
		);
	rows.push(queueRow);

	const playerRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "12p", loungeId }))
				.setLabel("12p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "12p"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "24p", loungeId }))
				.setLabel("24p")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "24p"),
			new ButtonBuilder()
				.setCustomId(buildStatsCustomId("players", { timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "both", loungeId }))
				.setLabel("both")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePlayerCount === "both"),
		);
	rows.push(playerRow);

	return rows;
}

function parseStatsInteraction(customId) {
	if (!customId?.startsWith("stats|")) {
		return null;
	}
	const parts = customId.split("|");
	if (parts.length < 6) {
		return null;
	}
	const [, actionRaw, timeRaw, queueRaw, playerRaw, loungeId] = parts;
	const normalizedAction = (actionRaw || "").toLowerCase();
	return {
		action: normalizedAction,
		timeFilter: (timeRaw || "alltime").toLowerCase(),
		queueFilter: (queueRaw || "both").toLowerCase(),
		playerCountFilter: (playerRaw || "both").toLowerCase(),
		loungeId,
	};
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("stats")
		.setDescription("check your (or someone else's) stats.")
		.addStringOption(option =>
			option.setName("player")
				.setDescription("lounge name, id or discord id. leave blank for yourself.")
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
				console.warn("stats global autocomplete error:", error);
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
					files: [],
					components: [],
				});
				return;
			}

			const componentRows = buildStatsComponentRows({
				loungeId: target.loungeId,
				timeFilter,
				queueFilter,
				playerCountFilter,
			});

			const result = await this.generateStats(interaction, target, serverId, queueFilter, playerCountFilter, timeFilter);

			if (!result.success) {
				await interaction.editReply({
					content: result.message || "unable to load stats data.",
					files: [],
					components: componentRows,
					embeds: [],
					allowedMentions: { parse: [] },
				});
				return;
			}

			const replyMessage = await interaction.editReply({
				content: result.content,
				files: result.files,
				components: componentRows,
				embeds: [],
				allowedMentions: { parse: [] },
			});

			if (replyMessage && result.session) {
				storeStatsSession(replyMessage.id, {
					...result.session,
					discordUser: target.discordUser || result.session.discordUser || null,
					filters: currentFilters,
					pendingFilters: null,
					activeRequestToken: null,
				});
			}

		}
		catch (error) {
			console.error("stats command error:", error);

			let errorMessage = "error: something went wrong while calculating stats.";

			if (error.message?.includes("404")) {
				errorMessage = "error: player data not found in mkw lounge.";
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				errorMessage = "error: couldn't connect to the mkw lounge api. please try again later.";
			}
			else if (error.message?.includes("Unknown interaction")) {
				console.error("interaction expired during stats calculation");
				return;
			}

			try {
				await interaction.editReply({ content: errorMessage, embeds: [] });
			}
			catch (editError) {
				console.error("failed to edit reply with error message:", editError);
			}
		}
	},

	// Handle button interactions
	async handleButtonInteraction(interaction) {
		const parsed = parseStatsInteraction(interaction.customId);
		if (!parsed) return false;

		try {
			const { action, timeFilter: rawTime, queueFilter: rawQueue, playerCountFilter: rawPlayers, loungeId } = parsed;

			const messageId = interaction.message?.id || null;
			const cachedSession = messageId ? getStatsSession(messageId) : null;
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
				console.warn(`unknown stats action received: ${action}`);
			}

			const futureFilters = { timeFilter, queueFilter, playerCountFilter };
			if (cachedSession) {
				cachedSession.pendingFilters = futureFilters;
			}

			const components = buildStatsComponentRows({
				loungeId: loungeId || cachedSession?.loungeId,
				timeFilter,
				queueFilter,
				playerCountFilter,
			});

			await interaction.update({ components });

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

			const serverId = interaction.guild.id;
			const target = await resolveTargetPlayer(interaction, {
				loungeId,
			});

			if (target.error) {
				await interaction.editReply({
					content: target.error,
					components,
					embeds: [],
				});
				return true;
			}

			const renderToken = beginStatsRender(messageId);
			if (cachedSession) {
				cachedSession.activeRequestToken = renderToken;
			}

			let result;
			try {
				result = await this.generateStats(
					interaction,
					target,
					serverId,
					queueFilter,
					playerCountFilter,
					timeFilter,
					null,
					{ session: cachedSession, filtersOverride: futureFilters, userData: freshUserData },
				);

				if (isStatsRenderActive(messageId, renderToken)) {
					if (result && result.success) {
						await interaction.editReply({ content: result.content ?? "", files: result.files, components, embeds: [] });
						if (messageId && result.session) {
							storeStatsSession(messageId, {
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
							content: result?.message || "unable to load stats data.",
							components,
							embeds: [],
							files: [],
						});
					}
				}
			}
			finally {
				endStatsRender(messageId, renderToken);
				if (cachedSession) {
					cachedSession.pendingFilters = null;
					cachedSession.activeRequestToken = null;
				}
			}

			return true;
		}
		catch (error) {
			console.error("error in stats button interaction:", error);
			return false;
		}
	},

	// Generate stats data
	async generateStats(interaction, target, serverId, queueFilter, playerCountFilter, timeFilter = "alltime", _serverDataOverride = null, cacheOptions = {}) {
		try {
			const onProgress = async message => {
				if (!interaction || !message) return;
				try {
					await interaction.editReply(message);
				}
				catch (progressError) {
					console.warn("stats progress update failed:", progressError);
				}
			};

			const renderResult = await renderStats({
				interaction,
				target,
				loungeId: target?.loungeId,
				serverId,
				queueFilter,
				playerCountFilter,
				timeFilter,
				session: cacheOptions?.session || null,
				userData: cacheOptions?.userData || null,
				onProgress,
			});

			if (!renderResult?.success) {
				return { success: false, message: renderResult?.message || "unable to load stats data." };
			}

			const attachment = new AttachmentBuilder(renderResult.pngBuffer, { name: "stats.png" });

			return {
				success: true,
				content: renderResult.content,
				files: [attachment],
				session: renderResult.session,
			};
		}
		catch (error) {
			console.error("error generating stats:", error);
			return { success: false, message: "an error occurred while generating stats. please try again later." };
		}
	},

	// exported for site preview rendering
	renderStats,
};

