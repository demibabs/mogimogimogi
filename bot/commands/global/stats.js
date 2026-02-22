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
let dualChartRenderer = null;

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

			const valueText = cell.value ?? "-";
			let valueX = cellCenterX;

			if (cell.icon) {
				const iconSize = LAYOUT.statsValueFontSize * 0.85;
				const iconGap = 10;
				const textMetrics = ctx.measureText(valueText);
				const totalWidth = iconSize + iconGap + textMetrics.width;
				const startX = cellCenterX - totalWidth / 2;

				ctx.drawImage(cell.icon, startX, valueY - iconSize / 2, iconSize, iconSize);
				valueX = startX + iconSize + iconGap + textMetrics.width / 2;
			}

			if (valueOutlineColor) {
				ctx.save();
				ctx.lineWidth = 4;
				ctx.strokeStyle = valueOutlineColor;
				ctx.lineJoin = "round";
				ctx.strokeText(valueText, valueX, valueY);
				ctx.restore();
			}
			ctx.fillText(valueText, valueX, valueY);

			if (cell.subLabel || cell.subLabelPrefix) {
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

				const subText = cell.subLabel || "";
				const subPrefix = cell.subLabelPrefix || "";
				const subX = cellCenterX;

				if (cell.subLabelIcon) {
					const subIconSize = LAYOUT.statsSubLabelFontSize * 1.1;
					const subIconGap = 4;
					const subPrefixMetrics = ctx.measureText(subPrefix);
					const subTextMetrics = ctx.measureText(subText);
					const totalSubWidth = subPrefixMetrics.width + subIconSize + subIconGap + subTextMetrics.width;
					const startX = cellCenterX - totalSubWidth / 2;

					if (subPrefix) {
						ctx.fillText(subPrefix, startX + subPrefixMetrics.width / 2, subY);
					}

					const iconX = startX + subPrefixMetrics.width;
					ctx.drawImage(cell.subLabelIcon, iconX, subY - subIconSize / 2, subIconSize, subIconSize);

					const textX = iconX + subIconSize + subIconGap + subTextMetrics.width / 2;
					ctx.fillText(subText, textX, subY);
				}
				else {
					ctx.fillText(subPrefix + subText, subX, subY);
				}
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

function getDualChartRenderer() {
	if (dualChartRenderer) {
		return dualChartRenderer;
	}
	const heightPerChart = Math.floor(CHART_DIMENSIONS.height / 2);
	dualChartRenderer = new ChartJSNodeCanvas({
		width: CHART_DIMENSIONS.width,
		height: heightPerChart,
		backgroundColour: "rgba(0,0,0,0)",
		chartCallback: ChartJS => {
			ChartJS.defaults.font.family = Fonts?.FONT_FAMILY_STACK || "Lexend, Arial, sans-serif";
		},
	});
	return dualChartRenderer;
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
	return loadImageResource(`bot/images/ranks/${filename}`, `rank icon ${tier}`);
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

async function getMmrHistoryChart(trackName, trackColors, playerDetails, allTables, loungeId, timeFilter, playerCountFilter = null, extraDetails = null, queueFilter = "both") {
	// Helper to get points for a specific mode
	const getModeData = (targetMode) => {
		const tablesList = Object.values(allTables).sort((a, b) => new Date(a.createdOn) - new Date(b.createdOn));
		const relevantTables = tablesList.filter(t => {
			const isQueueFilterActive = queueFilter === "soloq" || queueFilter === "squads";
			const isAllTimeFilter = timeFilter === "alltime";
			// If queue filter is active OR alltime filter is active, allow Season < 2
			// Otherwise (e.g. standard Season/Weekly filter with no queue filter), enforce Season >= 2
			if (!isQueueFilterActive && !isAllTimeFilter && t.season < 2) return false;
			const tableMode = (t.numPlayers > 12) ? "mkworld24p" : "mkworld12p";
			if (tableMode !== targetMode) return false;

			// Apply time filter
			if (timeFilter === "season" && String(t.season) !== String(LoungeApi.DEFAULT_SEASON)) return false;
			if (timeFilter === "weekly") {
				const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
				if (new Date(t.createdOn).getTime() < oneWeekAgo) return false;
			}

			// Apply queue filter
			if (queueFilter === "soloq" || queueFilter === "squads") {
				const isSquads = t.tier === "SQ";
				if (queueFilter === "soloq" && isSquads) return false;
				if (queueFilter === "squads" && !isSquads) return false;
			}

			return true;
		});

		if (relevantTables.length === 0) return null;

		const historyPoints = [];
		let matchCount = 0;
		const isHybridMode = timeFilter === "alltime" && queueFilter === "both";
		const useDeltaMode = (queueFilter === "soloq" || queueFilter === "squads");

		if (isHybridMode) {
			// Hybrid Strategy:
			// 1. Tables before S2: Calculate as cumulative deltas, relative to S2 Start
			// 2. Tables S2+: Use absolute MMR values
			// 3. Continuity: Pre-S2 deltas must end at S2 start value.
			//    So we trace S2 start, then walk backwards for Pre-S2.

			const season2StartTableIndex = relevantTables.findIndex(t => t.season >= 2);

			// If no Season 2+ data, just default to delta mode (or absolute if it works)
			// But user asked for specific behavior.
			// If we ONLY have pre-S2 data, we can't anchor to S2.
			// In that case, maybe just show it as 0-based delta? Or absolute if available?
			// Let's assume we want to anchor to the first available S2 MMR if exists.

			if (season2StartTableIndex === -1) {
				// No Season 2 data found. Just show pure delta mode for everything (pre-S2 style).
				let currentDelta = 0;
				historyPoints.push({ x: 0, y: 0 });
				relevantTables.forEach((table) => {
					const s = PlayerStats.getPlayerRankingInTable(table, loungeId);
					if (s && Number.isFinite(s.newMmr) && Number.isFinite(s.prevMmr)) {
						matchCount++;
						const delta = s.newMmr - s.prevMmr;
						currentDelta += delta;
						historyPoints.push({ x: matchCount, y: currentDelta });
					}
				});
			}
			else {
				// We have Season 2 data.
				// S2 Start Value = prevMmr of the first S2 table.
				const s2FirstTable = relevantTables[season2StartTableIndex];
				const s2FirstScore = PlayerStats.getPlayerRankingInTable(s2FirstTable, loungeId);
				const s2StartMmr = (s2FirstScore && Number.isFinite(s2FirstScore.prevMmr)) ? s2FirstScore.prevMmr : 0; // Default 0 if missing

				// Process Pre-S2 tables (Backwards from S2 start or Forwards then shift?)
				// Let's go simple: Calculate cumulative delta for Pre-S2 tables starting at 0.
				// Then find the final value. Shift all points so final value == s2StartMmr.

				const preS2Tables = relevantTables.slice(0, season2StartTableIndex);
				const s2Tables = relevantTables.slice(season2StartTableIndex);

				// Step 1: Calculate pre-S2 relative offsets
				let runningPreDelta = 0;
				// We need intermediate points.
				// Point 0 is "Start of history".
				const prePointsRel = [{ x: 0, delta: 0 }];

				let tempMatchCount = 0;
				preS2Tables.forEach(table => {
					const s = PlayerStats.getPlayerRankingInTable(table, loungeId);
					if (s && Number.isFinite(s.newMmr) && Number.isFinite(s.prevMmr)) {
						tempMatchCount++;
						const delta = s.newMmr - s.prevMmr;
						runningPreDelta += delta;
						prePointsRel.push({ x: tempMatchCount, delta: runningPreDelta });
					}
				});

				// Step 2: Shift Pre-S2 points to align end with s2StartMmr
				// Final pre-S2 point is at `runningPreDelta`. This should map to `s2StartMmr`.
				// so: shiftedY = originalY + (s2StartMmr - runningPreDelta)
				const shiftAmount = s2StartMmr - runningPreDelta;

				prePointsRel.forEach(p => {
					historyPoints.push({ x: p.x, y: p.delta + shiftAmount, isProjected: true });
					// isProjected flag to know this is the "delta" part
				});

				matchCount = tempMatchCount;

				// Step 3: Add S2+ points (Absolute)
				// Note: historyPoints already has an entry for the end of Pre-S2 (which matches start of S2).
				// However, the S2 loop will add the result of the first S2 match.
				// The "Start of S2" is technically the last point of Pre-S2.
				// But visual continuity: standard logic adds point for NewMmr.
				// It usually adds a "Start" point (0, prevMmr) IF it's the very first thing.
				// Here, the last pre-S2 point IS the start point for S2. So we don't add strictly "(0, prevMmr)" again.

				s2Tables.forEach(table => {
					const scoreEntry = PlayerStats.getPlayerRankingInTable(table, loungeId);
					if (scoreEntry && Number.isFinite(scoreEntry.newMmr)) {
						matchCount++;
						historyPoints.push({ x: matchCount, y: scoreEntry.newMmr, isProjected: false });
					}
				});
			}

		}
		else if (useDeltaMode) {
			// DELTA MODE: Start at 0, cumulative sum of deltas
			let currentDelta = 0;
			historyPoints.push({ x: 0, y: 0 }); // Start at 0

			relevantTables.forEach((table) => {
				const scoreEntry = PlayerStats.getPlayerRankingInTable(table, loungeId);
				// In Queue Filter modes, we strictly use deltas.
				if (scoreEntry && Number.isFinite(scoreEntry.newMmr) && Number.isFinite(scoreEntry.prevMmr)) {
					matchCount++;
					const delta = scoreEntry.newMmr - scoreEntry.prevMmr;
					currentDelta += delta;
					historyPoints.push({ x: matchCount, y: currentDelta });
				}
			});
		}
		else {
			// STANDARD MODE: Absolute MMR
			const firstTable = relevantTables[0];
			const firstScoreEntry = PlayerStats.getPlayerRankingInTable(firstTable, loungeId);

			if (firstScoreEntry && Number.isFinite(firstScoreEntry.prevMmr)) {
				historyPoints.push({ x: 0, y: firstScoreEntry.prevMmr });
			}

			relevantTables.forEach((table) => {
				const scoreEntry = PlayerStats.getPlayerRankingInTable(table, loungeId);
				if (scoreEntry && Number.isFinite(scoreEntry.newMmr)) {
					matchCount++;
					historyPoints.push({ x: matchCount, y: scoreEntry.newMmr });
				}
			});
		}

		if (historyPoints.length === 0) return null;

		// Calculate transition index for hybrid mode
		// It's the index where isProjected flips from true to false
		let transitionIndex = -1;
		if (isHybridMode) {
			// Find the last point that is projected (end of pre-S2)
			for (let i = historyPoints.length - 1; i >= 0; i--) {
				if (historyPoints[i].isProjected) {
					transitionIndex = i;
					break;
				}
			}
		}

		return { historyPoints, matchCount, transitionIndex, isHybridMode };
	};

	let dualMode = false;
	let data12p = getModeData("mkworld12p");
	let data24p = null;

	let selectedData = null;
	if (playerCountFilter === "both" && extraDetails) {
		const result12p = getModeData("mkworld12p");
		const result24p = getModeData("mkworld24p");
		if (result12p && result24p) {
			dualMode = true;
			data12p = result12p;
			data24p = result24p;
		}
		else if (result12p) {
			selectedData = result12p;
			playerDetails = extraDetails.details12p || playerDetails;
		}
		else if (result24p) {
			selectedData = result24p;
			playerDetails = extraDetails.details24p || playerDetails;
		}
	}
	else {
		const targetMode = (playerCountFilter === "24p") ? "mkworld24p" : "mkworld12p";
		selectedData = getModeData(targetMode);
	}

	/* Removed old filtering logic to use getModeData later */

	// Helper to set alpha for hex colors
	const setHexAlpha = (hex, alpha) => {
		if (!hex || !hex.startsWith("#")) return `rgba(255, 255, 255, ${alpha})`;
		let r, g, b;
		if (hex.length === 4) {
			r = parseInt(hex[1] + hex[1], 16);
			g = parseInt(hex[2] + hex[2], 16);
			b = parseInt(hex[3] + hex[3], 16);
		}
		else {
			r = parseInt(hex.slice(1, 3), 16);
			g = parseInt(hex.slice(3, 5), 16);
			b = parseInt(hex.slice(5, 7), 16);
		}
		if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255, 255, 255, ${alpha})`;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	};

	const darkenHex = (hex, amount) => {
		if (!hex || !hex.startsWith("#")) return hex;
		let r, g, b;
		if (hex.length === 4) {
			r = parseInt(hex[1] + hex[1], 16);
			g = parseInt(hex[2] + hex[2], 16);
			b = parseInt(hex[3] + hex[3], 16);
		}
		else {
			r = parseInt(hex.slice(1, 3), 16);
			g = parseInt(hex.slice(3, 5), 16);
			b = parseInt(hex.slice(5, 7), 16);
		}

		r = Math.max(0, Math.floor(r * (1 - amount)));
		g = Math.max(0, Math.floor(g * (1 - amount)));
		b = Math.max(0, Math.floor(b * (1 - amount)));

		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
	};

	const createConfig = (dataPoints, matchCount, gameMode, titleText, transitionIndex = -1, isHybrid = false) => {
		const mmrValues = dataPoints.map(p => p.y);
		const minMmr = Math.min(...mmrValues);
		const maxMmr = Math.max(...mmrValues);
		const padding = (maxMmr - minMmr) * 0.1 || 100;
		// Round range to nice numbers
		const yMin = Math.floor((minMmr - padding) / 100) * 100;
		const yMax = Math.ceil((maxMmr + padding) / 100) * 100;
		const is24p = gameMode === "mkworld24p";

		// Calculate Y-axis step size
		// Minimum step of 100. Max 5 ticks means we categorize range into 4 intervals.
		// So approx step = range / 4.
		const yRange = yMax - yMin;
		let stepSize = Math.max(100, Math.ceil(yRange / 4));

		// Round stepSize to nearest 100 for cleaner labels
		stepSize = Math.ceil(stepSize / 100) * 100;

		// Split datasets if hybrid
		const datasets = [];
		// The baseline used for calculating the offset of the Left Axis (Delta)
		// We want the Left Axis 0 to correspond to the Start of the Data? Or the End of Pre-S2?
		// Typically Delta charts start at 0.
		// In our shifted data, the "Start of Pre-S2" (which was visually 0 before shift) is at y = shiftAmount.
		// So if we want the Left Axis to show 0 at the start of the chart, we need to subtract `shiftAmount` from the tick values.
		// Let's recover the shift amount.
		// We know: shiftedY = originalDelta + shiftAmount.
		// We want: label = shiftedY - shiftAmount.
		// shiftAmount = s2StartMmr - finalPreDelta.
		// But we don't have shiftAmount easily here.
		// Let's calculate it from the first point?
		// preS2Points[0] is (0, shiftAmount) because originalDelta at 0 is 0.
		// So shiftAmount = preS2Points[0].y

		let matchShiftAmount = 0;
		const gradientCache = new Map();

		if (isHybrid && transitionIndex >= 0) {
			const preS2Points = dataPoints.slice(0, transitionIndex + 1);
			const s2Points = dataPoints.slice(transitionIndex);

			// Calculate offset (Left Y-Axis 0 = Start of Chart)
			if (preS2Points.length > 0) {
				matchShiftAmount = preS2Points[0].y;
			}

			// We need the baseline Y value for the pre-S2 delta coloring (Gradient).
			// The gradient should be Green above 0 and Red below 0 (relative to the start).
			// Since our "0" line is at y = matchShiftAmount:
			const overflowBaseline = matchShiftAmount;

			datasets.push({
				label: "Pre-Season 2",
				data: preS2Points,
				// Delta Color Logic
				// Map datasets to specific axes
				yAxisID: "y", // Left Axis (Delta)
				borderColor: (context) => {
					const chart = context.chart;
					const { ctx, chartArea, scales } = chart;
					if (!chartArea) return null;
					const yScale = scales.y;

					// The "Zero" line for coloring is at matchShiftAmount
					const pixelZero = yScale.getPixelForValue(overflowBaseline);
					const pixelTop = chartArea.top;
					const pixelBottom = chartArea.bottom;

					const gradient = ctx.createLinearGradient(0, pixelTop, 0, pixelBottom);

					// Calculate stop for the baseline
					let stopZero = (pixelZero - pixelTop) / (pixelBottom - pixelTop);
					stopZero = Math.max(0, Math.min(1, stopZero));

					// Darken amounts for border
					const green = darkenHex(ColorPalettes.statsPalette.valuePositiveColor, 0.5);
					const red = darkenHex(ColorPalettes.statsPalette.valueNegativeColor, 0.5);

					gradient.addColorStop(0, green);
					gradient.addColorStop(stopZero, green);
					gradient.addColorStop(stopZero, red);
					gradient.addColorStop(1, red);

					return gradient;
				},
				backgroundColor: (context) => {
					// Area fill for Delta with Pattern (using getGradient helper)
					// Force useDeltaChart logic inside getGradient by relying on valid filters or shared logic?
					// Actually getGradient checks closure variables.
					// But we also need to pass the baseline.
					return getGradient(context, 0.75, 0, true, overflowBaseline);
				},
				borderWidth: 4,
				pointRadius: 0,
				// Fill to the calculated baseline for visual continuity
				fill: { value: overflowBaseline },
				tension: 0.1,
				order: 2,
			});

			// Find lowest MMR in S2 dataset for fill boundary
			let s2MinVal = overflowBaseline;
			if (s2Points.length > 0) {
				const minPoint = s2Points.reduce((min, p) => p.y < min ? p.y : min, Infinity);
				if (minPoint !== Infinity) s2MinVal = minPoint;
			}

			datasets.push({
				label: "Season 2+",
				data: s2Points,
				yAxisID: "y",
				// Rank Color Logic
				borderColor: (context) => {
					return getRankGradient(context, 1.0, 0.5, false, is24p, scales => scales.y, true, s2MinVal);
				},
				backgroundColor: (context) => {
					return getRankGradient(context, 0.75, 0, true, is24p, scales => scales.y, true, s2MinVal);
				},
				borderWidth: 4,
				pointRadius: 0,
				fill: { value: overflowBaseline },
				tension: 0.1,
				order: 1, // Draw on top
			});


		}
		else {
			// Standard single dataset
			datasets.push({
				data: dataPoints,
				borderColor: (ctx) => getGradient(ctx, 1.0, 0.5, false),
				backgroundColor: (ctx) => getGradient(ctx, 0.75, 0, true),
				borderWidth: 4,
				pointRadius: 0,
				pointHitRadius: 10,
				fill: (queueFilter === "soloq" || queueFilter === "squads" || timeFilter === "alltime") ? "origin" : "start",
				tension: 0.1,
			});
		}

		// Extracted Rank Gradient Logic
		const getRankGradient = (context, opacity, darkenAmount, applyPattern, is24pMode, getScale, limitToMin = false, minVal = 0) => {
			const chart = context.chart;
			const { ctx, chartArea, scales } = chart;
			if (!chartArea) return null;

			// Cache key generation
			const cacheKey = `rank-${opacity}-${darkenAmount}-${applyPattern}-${is24pMode}-${limitToMin}-${minVal}-${chartArea.width}-${chartArea.height}`;
			if (gradientCache.has(cacheKey)) {
				return gradientCache.get(cacheKey);
			}

			const yScale = getScale ? getScale(scales) : scales.y;
			const rankMode = is24pMode ? "24p" : "12p";
			const tiers = PlayerStats.getRankThresholds(rankMode);
			const rankColors = ColorPalettes.rankColorMap;

			const patternCanvas = createCanvas(Math.ceil(chartArea.width), Math.ceil(chartArea.height));
			const pCtx = patternCanvas.getContext("2d");
			const gradient = pCtx.createLinearGradient(0, patternCanvas.height, 0, 0);

			// Find tier index for minVal
			let minTierIndex = -1;
			if (limitToMin) {
				minTierIndex = tiers.findIndex(t => {
					const max = Number.isFinite(t.max) ? t.max : Infinity;
					return minVal >= t.min && minVal < max;
				});
				// If not found (e.g. abnormally low), just use 0 (Iron)
				if (minTierIndex === -1 && minVal < tiers[0].min) minTierIndex = 0;
			}

			tiers.forEach((tier, index) => {
				let effectiveTier = tier;
				// If we want to extend the lowest rank color downwards:
				// If current tier is below the minTierIndex, use minTierIndex's color.
				if (limitToMin && minTierIndex !== -1 && index < minTierIndex) {
					effectiveTier = tiers[minTierIndex];
				}

				const label = effectiveTier.label.charAt(0).toUpperCase() + effectiveTier.label.slice(1);
				let colorHex = rankColors[label] || "#888888";

				const valStart = tier.min;
				const yScaleMax = yScale.max;
				const valEnd = Number.isFinite(tier.max) ? tier.max : (yScaleMax * 1.5);

				if (valStart >= yScaleMax) return;

				if (darkenAmount > 0) colorHex = darkenHex(colorHex, darkenAmount);
				const color = setHexAlpha(colorHex, opacity);

				const pixelStart = yScale.getPixelForValue(valStart);
				const pixelEnd = yScale.getPixelForValue(valEnd);
				const chartHeight = chartArea.bottom - chartArea.top;

				let stopStart = (chartArea.bottom - pixelStart) / chartHeight;
				let stopEnd = (chartArea.bottom - pixelEnd) / chartHeight;

				stopStart = Math.max(0, Math.min(1, stopStart));
				stopEnd = Math.max(0, Math.min(1, stopEnd));

				if (stopStart === stopEnd) return;

				gradient.addColorStop(stopStart, color);
				gradient.addColorStop(stopEnd, color);
			});

			// ... (Rest of filling)
			pCtx.fillStyle = gradient;
			pCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

			if (applyPattern) {
				const patternStyle = EmbedEnhancer.randomPattern("rgba(0,0,0,0)", "rgba(255,255,255,0.3)", 20, [], 0.3);
				pCtx.fillStyle = patternStyle;
				pCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
			}

			const fullCanvas = createCanvas(ctx.canvas.width, ctx.canvas.height);
			const fCtx = fullCanvas.getContext("2d");
			fCtx.drawImage(patternCanvas, chartArea.left, chartArea.top);

			const result = ctx.createPattern(fullCanvas, "no-repeat");
			gradientCache.set(cacheKey, result);
			return result;
		};

		const getGradient = (context, opacity = 1.0, darkenAmount = 0, applyPattern = true, baselineVal = 0) => {
			// This is the original function, mostly used for the 'Standard' non-hybrid case
			// ... (Original logic)
			const chart = context.chart;
			const { ctx, chartArea, scales } = chart;
			if (!chartArea) return null;
			const yScale = scales.y;

			const useDeltaChart = (queueFilter === "soloq" || queueFilter === "squads" || timeFilter === "alltime");

			if (useDeltaChart) {
				// Cache key generation for Delta
				const cacheKey = `delta-${opacity}-${darkenAmount}-${applyPattern}-${baselineVal}-${chartArea.width}-${chartArea.height}`;
				if (gradientCache.has(cacheKey)) {
					return gradientCache.get(cacheKey);
				}

				// (Delta Logic)
				const pixelZero = yScale.getPixelForValue(baselineVal);
				const pixelTop = chartArea.top;
				const pixelBottom = chartArea.bottom;
				const chartHeight = pixelBottom - pixelTop;
				let stopZero = (pixelZero - pixelTop) / chartHeight;
				stopZero = Math.max(0, Math.min(1, stopZero));

				let green, red;
				if (darkenAmount > 0) {
					green = darkenHex(ColorPalettes.statsPalette.valuePositiveColor, darkenAmount);
					red = darkenHex(ColorPalettes.statsPalette.valueNegativeColor, darkenAmount);
					// If opacity is involved, we might need to apply it too, but darkenHex returns hex.
					// setHexAlpha works on hex.
					green = setHexAlpha(green, opacity);
					red = setHexAlpha(red, opacity);
				}
				else {
					green = setHexAlpha(ColorPalettes.statsPalette.valuePositiveColor, opacity);
					red = setHexAlpha(ColorPalettes.statsPalette.valueNegativeColor, opacity);
				}

				if (applyPattern) {
					// Pattern logic for Delta
					const patternCanvas = createCanvas(Math.ceil(chartArea.width), Math.ceil(chartArea.height));
					const pCtx = patternCanvas.getContext("2d");

					// Gradient coordinates must be relative to the patternCanvas (0 to height)
					const gradient = pCtx.createLinearGradient(0, 0, 0, patternCanvas.height);
					gradient.addColorStop(0, green);
					gradient.addColorStop(stopZero, green);
					gradient.addColorStop(stopZero, red);
					gradient.addColorStop(1, red);

					pCtx.fillStyle = gradient;
					pCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

					const patternStyle = EmbedEnhancer.randomPattern("rgba(0,0,0,0)", "rgba(255,255,255,0.3)", 20, [], 0.3);
					pCtx.fillStyle = patternStyle;
					pCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

					const fullCanvas = createCanvas(ctx.canvas.width, ctx.canvas.height);
					const fCtx = fullCanvas.getContext("2d");
					fCtx.drawImage(patternCanvas, chartArea.left, chartArea.top);

					const result = ctx.createPattern(fullCanvas, "no-repeat");
					gradientCache.set(cacheKey, result);
					return result;
				}

				const gradient = ctx.createLinearGradient(0, pixelTop, 0, pixelBottom);

				gradient.addColorStop(0, green);
				gradient.addColorStop(stopZero, green);
				gradient.addColorStop(stopZero, red);
				gradient.addColorStop(1, red);
				gradientCache.set(cacheKey, gradient);
				return gradient;
			}
			// Use rank gradient helper
			return getRankGradient(context, opacity, darkenAmount, applyPattern, is24p, null);
		};

		return {
			type: "line",
			data: {
				datasets: datasets,
			},
			options: {
				plugins: {
					title: {
						display: true,
						text: titleText,
						font: { size: 40 },
						color: trackColors.chartTextColor,
					},
					legend: { display: false },
					xAxisIcons: { icons: [] },
				},
				scales: {
					y: {
						type: "linear",
						display: true,
						position: "left",
						title: {
							display: true,
							text: isHybrid ? "mmr (delta)" : "mmr",
							font: { size: 24 },
							color: trackColors.chartTextColor,
						},
						min: yMin,
						max: yMax,
						grid: { color: trackColors.yGridColor },
						ticks: {
							font: { size: 20 },
							color: trackColors.chartTextColor,
							stepSize: stepSize,
							autoSkip: true,
							maxTicksLimit: 6, // 5 evenly spaced + min/max might overflow slightly, but aim for small number
							callback: (value) => {
								if (isHybrid) {
									// Round to nearest 100
									const delta = Math.round((value - matchShiftAmount) / 100) * 100;
									const sign = delta > 0 ? "+" : "";
									return sign + delta;
								}
								// Round to nearest 100
								const roundedValue = Math.round(value / 100) * 100;
								if ((queueFilter === "soloq" || queueFilter === "squads" || timeFilter === "alltime") && roundedValue > 0) {
									return "+" + roundedValue;
								}
								return roundedValue;
							},
						},
					},
					// Optional Right Axis for Hybrid mode logic?
					y1: {
						type: "linear",
						display: isHybrid && transitionIndex >= 0,
						position: "right",
						min: yMin,
						max: yMax,
						grid: { drawOnChartArea: false },
						ticks: {
							font: { size: 20 },
							color: trackColors.chartTextColor,
							stepSize: stepSize,
							maxTicksLimit: 6,
							callback: (value) => Math.round(value / 100) * 100,
						},
					},
					x: {
						type: "linear",
						title: {
							display: true,
							text: "events played",
							font: { size: 24 },
							color: trackColors.chartTextColor,
						},
						grid: { display: false },
						ticks: {
							font: { size: 20 },
							color: trackColors.chartTextColor,
							// Reintroduce manual step size to control label density
							stepSize: Math.max(1, Math.ceil(matchCount / 10)),
							callback: (value) => Math.round(value),
							maxRotation: 0,
							autoSkip: false, // Disable autoSkip to force all generated ticks to show
							// If labels overlap, they overlap, but we ensure they exist. Only 10 points anyway.
						},
						min: 0,
						max: matchCount,
						afterBuildTicks: (axis) => {
							// Manually generate evenly spaced ticks
							const step = Math.ceil(matchCount / 10);
							const ticks = [];
							for (let v = 0; v < matchCount; v += step) {
								ticks.push({ value: v, major: true });
							}

							// Conditional check: if the last generated tick is too close to the end, remove it.
							if (ticks.length > 0) {
								const lastGenerated = ticks[ticks.length - 1].value;
								const diff = matchCount - lastGenerated;
								// "skip the second to last label if the difference ... is less than 1/2 the step distance"
								if (diff < (step * 0.5)) {
									ticks.pop();
								}
							}

							// Always add the final matchCount tick
							ticks.push({ value: matchCount, major: true });

							axis.ticks = ticks;
						},
					},
				},
				layout: {
					padding: { top: 25, right: 35, bottom: 25, left: 25 },

				},
			},
			plugins: [{
				id: 'verticalLine',
				afterDraw: (chart) => {
					if (!isHybrid || transitionIndex < 0 || !dataPoints[transitionIndex]) return;
					
					const xValue = dataPoints[transitionIndex].x;
					const { ctx, chartArea, scales } = chart;
					const xAxis = scales.x;
					
					// Calculate pixel position
					const xPixel = xAxis.getPixelForValue(xValue);
					
					// Ensure line is within chart area
					if (xPixel < chartArea.left || xPixel > chartArea.right) return;

					ctx.save();
					ctx.beginPath();
					ctx.setLineDash([5, 5]); // Dotted pattern
					ctx.lineWidth = 2;
					// Use a slightly transparent version of the text color or just text color
					ctx.strokeStyle = trackColors.chartTextColor || '#FFFFFF'; 
					ctx.moveTo(xPixel, chartArea.top);
					ctx.lineTo(xPixel, chartArea.bottom);
					ctx.stroke();
					ctx.restore();
				}
			}],
		};
	};

	if (dualMode) {
		const heightPerChart = Math.floor(CHART_DIMENSIONS.height / 2);

		const dualRenderer = getDualChartRenderer();

		const config12p = createConfig(data12p.historyPoints, data12p.matchCount, "mkworld12p", "mmr history (12p)", data12p.transitionIndex, data12p.isHybridMode);
		const buf12p = await dualRenderer.renderToBuffer(config12p);

		const config24p = createConfig(data24p.historyPoints, data24p.matchCount, "mkworld24p", "mmr history (24p)", data24p.transitionIndex, data24p.isHybridMode);
		const buf24p = await dualRenderer.renderToBuffer(config24p);

		const combinedCanvas = createCanvas(CHART_DIMENSIONS.width, CHART_DIMENSIONS.height);
		const ctx = combinedCanvas.getContext("2d");

		const img12p = await loadImage(buf12p);
		const img24p = await loadImage(buf24p);

		ctx.drawImage(img12p, 0, 0);
		ctx.drawImage(img24p, 0, heightPerChart);

		return {
			image: combinedCanvas,
			metrics: null,
			labels: [],
		};

	}
	else {
		// Single Mode
		let data = selectedData;
		let targetMode = "mkworld12p";

		if (!data) {
			const is24p = (playerCountFilter === "24p") || (playerDetails && playerDetails.gameMode === "mkworld24p");
			targetMode = is24p ? "mkworld24p" : "mkworld12p";
			data = getModeData(targetMode);
		}
		else {
			// If selectedData was set, we need to know which mode it corresponds to.
			// Since we don't store the mode in the data object, we must infer it from the logic that set selectedData.
			// Logic:
			// if (result12p) -> selectedData = result12p -> mode is 12p
			// else if (result24p) -> selectedData = result24p -> mode is 24p
			// We can check playerDetails.gameMode if we updated it correctly.

			const is24p = playerDetails && playerDetails.gameMode === "mkworld24p";
			targetMode = is24p ? "mkworld24p" : "mkworld12p";
		}

		if (!data) return null;

		const renderer = getChartRenderer();

		const modeLabel = targetMode === "mkworld24p" ? "24p" : "12p";
		const config = createConfig(data.historyPoints, data.matchCount, targetMode, `mmr history (${modeLabel})`, data.transitionIndex, data.isHybridMode);
		const chartBuffer = await renderer.renderToBuffer(config);
		const chartImage = await loadImage(chartBuffer);

		return {
			image: chartImage,
			metrics: null,
			labels: [],
		};
	}
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
	gameMode = "mkworld12p",
}) {
	const mmrValue = Number(mmr);
	if (!Number.isFinite(mmrValue)) {
		return;
	}

	const tierInfos = Array.isArray(labels)
		? labels.map(label => PlayerStats.getRankThresholdByName(label, gameMode))
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
		const fallbackTier = PlayerStats.getRankThresholdForMmr(mmrValue, gameMode);
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

	// Invalidate playerDetails if it doesn't match the specific requested mode
	if (playerDetails && playerCountFilter && playerCountFilter !== "both") {
		const expectedMode = playerCountFilter.includes("24p") ? "mkworld24p" : "mkworld12p";
		if (playerDetails.gameMode !== expectedMode) {
			playerDetails = null;
		}
	}
	else if (playerDetails && playerCountFilter === "both" && session && session.filters && session.filters.playerCountFilter !== "both") {
		// If switching back to "both" from a specific filter, invalidate to allow smart selection logic to run again
		playerDetails = null;
	}

	let allTables = useSession ? session.allTables : null;
	let favorites = useSession ? session.favorites || {} : null;
	let favoriteCharacterImage = null;
	let favoriteVehicleImage = null;
	let trackName = useSession ? session.trackName : null;
	let globals = useSession ? session.globals || null : null;
	let discordUser = target?.discordUser || (useSession ? session.discordUser : null);
	let storedRecord = null;

	if (!playerDetails) {
		let gameMode = "mkworld12p";
		let details = null;

		if (playerCountFilter && playerCountFilter !== "both") {
			// Specific mode requested
			gameMode = playerCountFilter.includes("24p") ? "mkworld24p" : "mkworld12p";
			details = await LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, gameMode);
		}
		else {
			// "both" or unspecified -> fetch both and compare
			const [details12p, details24p] = await Promise.all([
				LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, "mkworld12p"),
				LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, undefined, "mkworld24p"),
			]);

			if (!details12p && !details24p) {
				return { success: false, message: "couldn't find that player in mkw lounge." };
			}

			if (details12p && !details24p) {
				details = details12p;
				gameMode = "mkworld12p";
			}
			else if (!details12p && details24p) {
				details = details24p;
				gameMode = "mkworld24p";
			}
			else {
				// Both exist, compare MMR
				const mmr12p = details12p.mmr || 0;
				const mmr24p = details24p.mmr || 0;
				if (mmr24p > mmr12p) {
					details = details24p;
					details.alternateDetails = details12p;
					details.alternateGameMode = "mkworld12p";
					gameMode = "mkworld24p";
				}
				else {
					details = details12p;
					details.alternateDetails = details24p;
					details.alternateGameMode = "mkworld24p";
					gameMode = "mkworld12p";
				}
			}
		}

		if (!details) {
			return { success: false, message: "couldn't find that player in mkw lounge." };
		}
		playerDetails = details;
		// Inject the gameMode so getAllPlayerTables can use it
		playerDetails.gameMode = gameMode;
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
		const globalStatsGameMode = playerDetails?.gameMode || "mkworld12p";
		globals = await LoungeApi.getGlobalStats(undefined, globalStatsGameMode);
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

	// Determine what to show based on filters
	// If playerCountFilter is "both" (or unspecified), we show current MMR + Peak/GameMode label
	// If playerCountFilter is specific, we calculate Peak for that mode (Season 2+)

	const isSpecificPlayerCount = playerCountFilter === "12p" || playerCountFilter === "24p" || playerCountFilter === "mkworld12p" || playerCountFilter === "mkworld24p";
	const isAllTimeOrSeason = timeFilter === "alltime" || timeFilter === "season";
	const isQueueAny = queueFilter === "both" || !queueFilter;
	const filtersAreBoth = queueFilter === "both" && playerCountFilter === "both";

	// Show current MMR if filters are both+alltime/season OR specific count+queue any+alltime/season
	const showCurrentMmr = (isSpecificPlayerCount && isQueueAny && isAllTimeOrSeason) || (filtersAreBoth && isAllTimeOrSeason);

	let peakMmr = null;
	const targetGameMode = (playerCountFilter && playerCountFilter.includes("24p")) ? "mkworld24p" : "mkworld12p";

	// Calculate Peak MMR if we are showing current MMR and filters support it
	if (showCurrentMmr) {
		const peaks = [];
		const currentSeasonPeak = Number(playerDetails?.maxMmr);
		if (Number.isFinite(currentSeasonPeak)) {
			peaks.push(currentSeasonPeak);
		}

		if (isSpecificPlayerCount && isAllTimeOrSeason) {
			// Search history for peak in this specific mode, starting from Season 2
			// Season 0 and 1 are ignored as requested
			const startSeason = 2;
			const currentSeason = Number(LoungeApi.DEFAULT_SEASON) || 15; // Fallback if constant missing
			const mode = playerCountFilter.includes("24p") ? "mkworld24p" : "mkworld12p";

			const pastSeasons = [];
			for (let s = startSeason; s < currentSeason; s++) {
				pastSeasons.push(s);
			}

			if (pastSeasons.length > 0) {
				const seasonResults = await Promise.all(pastSeasons.map(async s => {
					try {
						return await LoungeApi.getPlayerDetailsByLoungeId(normalizedLoungeId, s, mode);
					}
					catch (e) {
						console.warn(`failed to fetch season ${s} details for ${normalizedLoungeId}:`, e);
						return null;
					}
				}));

				seasonResults.forEach(seasonData => {
					const sPeak = Number(seasonData?.maxMmr);
					if (Number.isFinite(sPeak)) {
						peaks.push(sPeak);
					}
				});
			}
		}

		if (peaks.length > 0) {
			peakMmr = Math.max(...peaks);
		}

		// Fallback to current MMR if peak logic failed but current exists
		if (!Number.isFinite(peakMmr) && Number.isFinite(mmr)) {
			peakMmr = mmr;
		}
	}

	const mmrDisplay = showCurrentMmr && Number.isFinite(mmr) ? formatNumber(Math.round(mmr)) : formatSignedNumber(mmrDeltaForFilter);
	const mmrFormatted = formatNumber(mmrRaw);

	let mmrSubLabel = null;
	let mmrSubLabelPrefix = null;

	if (showCurrentMmr) {
		if (isSpecificPlayerCount) {
			// Case: Specific Mode - Show Peak MMR (Season 2+)
			if (Number.isFinite(peakMmr)) {
				mmrSubLabelPrefix = "(peak: ";
				mmrSubLabel = `${formatNumber(Math.round(peakMmr))})`;
			}
		}
		else {
			// Case: Both Modes - Show "12p" or "24p"
			// The current MMR displayed comes from `playerDetails.gameMode` (logic added previously)
			const mode = playerDetails?.gameMode === "mkworld24p" ? "24p" : "12p";
			mmrSubLabelPrefix = "";
			mmrSubLabel = `(${mode})`;
		}
	}
	else if (mmrFormatted !== "-") {
		// Not showing current MMR (e.g. standard view showing delta) -> sublabel is current MMR
		mmrSubLabelPrefix = "(current: ";
		mmrSubLabel = `${mmrFormatted})`;
	}


	let mmrIcon = null;
	let mmrIconFilename = null;
	if (showCurrentMmr) {
		const rankGameMode = playerDetails?.gameMode || "mkworld12p";
		const iconFilename = PlayerStats.getRankIconFilenameForMmr(mmr, rankGameMode);
		if (iconFilename) {
			mmrIconFilename = iconFilename;
			mmrIcon = await loadImageResource(`bot/images/ranks/${iconFilename}`, "mmr rank icon");
		}
	}

	let mmrSubLabelIcon = null;
	const subLabelMmrValue = showCurrentMmr ? peakMmr : mmr;

	// Only show sublabel rank icon if we are showing peak MMR (when specific player count filter is active)
	// OR if we are showing current MMR in the sublabel (when showCurrentMmr is false)
	const shouldShowSubLabelIcon = (showCurrentMmr && isSpecificPlayerCount) || (!showCurrentMmr);

	if (shouldShowSubLabelIcon && Number.isFinite(subLabelMmrValue)) {
		const subRankGameMode = playerDetails?.gameMode || "mkworld12p";
		const subIconFilename = PlayerStats.getRankIconFilenameForMmr(subLabelMmrValue, subRankGameMode);
		if (subIconFilename && subIconFilename !== mmrIconFilename) {
			mmrSubLabelIcon = await loadImageResource(`bot/images/ranks/${subIconFilename}`, "mmr sublabel icon");
		}
	}

	const averageRoomMmr = PlayerStats.computeAverageRoomMmr(filteredTables);
	const averageRoomMmrDisplay = Number.isFinite(averageRoomMmr) ? formatNumber(Math.round(averageRoomMmr)) : "-";

	let rank = playerStats?.rank ?? "-";
	let percent = globals?.totalPlayers ? Math.ceil(100 * (rank / globals.totalPlayers)) : null;

	if (percent !== null && percent >= 100) {
		rank = "n/a";
		percent = null; // Hide percentile if rank is N/A
	}

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
		const backgroundImage = await loadImageResource(`bot/images/tracks blurred/${trackName}_stats.png`, `${trackName} stats background`);
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
	let isHistoryChart = false;
	try {
		if (isSpecificPlayerCount || !playerCountFilter || playerCountFilter === "both") {
			let extraDetails = null;
			if (!playerCountFilter || playerCountFilter === "both") {
				// Construct details for both 12p and 24p.
				// Note: playerDetails holds the primary mode, and .alternateDetails holds the secondary if available.
				// If alternateDetails is missing, we will just have the primary.
				const primaryMode = playerDetails.gameMode || "mkworld12p";
				const alternateMode = primaryMode === "mkworld12p" ? "mkworld24p" : "mkworld12p";

				extraDetails = {
					details12p: primaryMode === "mkworld12p" ? playerDetails : playerDetails.alternateDetails,
					details24p: primaryMode === "mkworld24p" ? playerDetails : playerDetails.alternateDetails,
				};

				// Ensure we have objects even if null, though getMmrHistoryChart checks for existence
			}
			chartResult = await getMmrHistoryChart(trackName, trackColors, playerDetails, allTables, normalizedLoungeId, timeFilter, playerCountFilter || "both", extraDetails, queueFilter);
			if (chartResult) {
				isHistoryChart = true;
			}
		}

		if (!chartResult) {
			chartResult = await getDivisionChart(trackName, trackColors, globals);
		}
	}
	catch (chartError) {
		console.warn("failed to generate chart:", chartError);
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

	let topStatsRow = [
		{
			label: "mmr",
			value: mmrDisplay,
			subLabel: mmrSubLabel || undefined,
			subLabelPrefix: mmrSubLabelPrefix || undefined,
			icon: mmrIcon,
			subLabelIcon: mmrSubLabelIcon,
		},
		{ label: "rank", value: rank, subLabel: percent ? `(top ${percent}%)` : undefined },
		{ label: "team\nwin rate", value: winRateText, subLabel: winLossRecord ? `(${winLossRecord})` : undefined },
	];

	if ((playerCountFilter === "both" || !playerCountFilter) && playerDetails?.alternateDetails) {
		const is12pPrimary = playerDetails.gameMode === "mkworld12p";
		const details12p = is12pPrimary ? playerDetails : playerDetails.alternateDetails;
		const details24p = is12pPrimary ? playerDetails.alternateDetails : playerDetails;

		const getModeCell = async (details, modeName) => {
			const mmrVal = Number(details?.mmr);
			const hasMmr = Number.isFinite(mmrVal);
			const modeFilter = modeName === "mkworld12p" ? "12p" : "24p";
			const modeTables = PlayerStats.filterTablesByControls(filteredTables, { playerCountFilter: modeFilter });
			const modeTableIds = Object.keys(modeTables);
			const seasonModeTables = PlayerStats.filterTablesByControls(allTables, {
				timeFilter: "season",
				playerCountFilter: modeFilter,
			});
			const noSeasonEventsForMode = Object.keys(seasonModeTables).length === 0;

			const delta = timeFilter === "alltime"
				? PlayerStats.getTotalMmrDeltaFromTables(modeTables, normalizedLoungeId)
				: PlayerStats.computeMmrDeltaForFilter({
					playerDetails: details,
					mmrChanges: details?.mmrChanges,
					tableIds: modeTableIds,
					timeFilter,
					queueFilter,
					playerCountFilter: modeFilter,
				});

			let value, subLabel, subPrefix;
			let cellIcon = null;
			let subIcon = null;
			const iconFilename = hasMmr ? PlayerStats.getRankIconFilenameForMmr(mmrVal, modeName) : null;

			if (showCurrentMmr) {
				value = hasMmr ? formatNumber(Math.round(mmrVal)) : "-";
				if (noSeasonEventsForMode) {
					subLabel = "(rank: n/a)";
				}
				else {
					subLabel = details.overallRank ? `(rank: ${details.overallRank})` : undefined;
				}
				if (iconFilename) {
					cellIcon = await loadImageResource(`bot/images/ranks/${iconFilename}`, `${modeName} rank icon`);
				}
			}
			else {
				value = formatSignedNumber(delta);
				subLabel = hasMmr ? `${formatNumber(Math.round(mmrVal))})` : "-";
				subPrefix = "(current: ";
				if (iconFilename) {
					subIcon = await loadImageResource(`bot/images/ranks/${iconFilename}`, `${modeName} rank icon`);
				}
			}

			return {
				label: `${modeFilter} mmr`,
				value,
				subLabel,
				subLabelPrefix: subPrefix,
				icon: cellIcon,
				subLabelIcon: subIcon,
			};
		};

		topStatsRow = [
			await getModeCell(details12p, "mkworld12p"),
			await getModeCell(details24p, "mkworld24p"),
			{ label: "team\nwin rate", value: winRateText, subLabel: winLossRecord ? `(${winLossRecord})` : undefined },
		];
	}

	const gridConfig = [
		topStatsRow,
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

	if (!isHistoryChart) {
		drawMMRMarker(ctx, mmr, trackName, {
			chartX: chartFrame.left,
			chartY: chartFrame.top,
			chartWidth: chartFrame.width,
			chartHeight: chartFrame.height,
			labels: chartLabels,
			metrics: chartMetrics,
			iconSize: ICON_SIZE,
			iconGap: ICON_GAP,
			gameMode: playerDetails?.gameMode || "mkworld12p",
		});
	}

	const pngBuffer = canvas.toBuffer("image/png");

	// Remove potentially large history arrays from session cache
	const leanPlayerDetails = playerDetails ? { ...playerDetails } : null;
	if (leanPlayerDetails) {
		delete leanPlayerDetails.mmrChanges;
		delete leanPlayerDetails.seasonData; // If not needed for other things
	}

	const updatedSession = {
		loungeId: normalizedLoungeId,
		serverId,
		displayName,
		loungeName,
		playerDetails: leanPlayerDetails,
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
		.addStringOption(option => // line 1424
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

			const serverId = interaction.guild?.id || "DM";
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

