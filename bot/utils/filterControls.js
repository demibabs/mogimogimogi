const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function buildStandardFilterRows({
	buildCustomId,
	customIdParams = {},
	timeFilter,
	queueFilter,
	playerCountFilter,
	defaultTime = "alltime",
	defaultQueue = "both",
	defaultPlayers = "both",
} = {}) {
	const safeTime = timeFilter || defaultTime;
	const safeQueue = queueFilter || defaultQueue;
	const safePlayers = playerCountFilter || defaultPlayers;

	const timeRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { ...customIdParams, timeFilter: "alltime", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("all time")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "alltime"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { ...customIdParams, timeFilter: "weekly", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("past week")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "weekly"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("time", { ...customIdParams, timeFilter: "season", queueFilter: safeQueue, playerCountFilter: safePlayers }))
			.setLabel("this season")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeTime === "season"),
	);

	const queueRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { ...customIdParams, timeFilter: safeTime, queueFilter: "soloq", playerCountFilter: safePlayers }))
			.setLabel("soloq")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "soloq"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { ...customIdParams, timeFilter: safeTime, queueFilter: "squads", playerCountFilter: safePlayers }))
			.setLabel("squads")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "squads"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("queue", { ...customIdParams, timeFilter: safeTime, queueFilter: "both", playerCountFilter: safePlayers }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safeQueue === "both"),
	);

	const playerRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { ...customIdParams, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "12p" }))
			.setLabel("12p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "12p"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { ...customIdParams, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "24p" }))
			.setLabel("24p")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "24p"),
		new ButtonBuilder()
			.setCustomId(buildCustomId("players", { ...customIdParams, timeFilter: safeTime, queueFilter: safeQueue, playerCountFilter: "both" }))
			.setLabel("both")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(safePlayers === "both"),
	);

	return [timeRow, queueRow, playerRow];
}

function parseStandardFilterCustomId({
	customId,
	prefix,
	defaults = {},
	loungeIdFields = ["loungeId"],
	normalizeFilters = null,
} = {}) {
	if (!customId || !prefix || !customId.startsWith(`${prefix}|`)) {
		return null;
	}
	const parts = customId.split("|");
	const minLength = 5 + loungeIdFields.length;
	if (parts.length < minLength) {
		return null;
	}
	const actionRaw = parts[1];
	const timeRaw = parts[2];
	const queueRaw = parts[3];
	const playersRaw = parts[4];
	const action = (actionRaw || defaults.action || "").toLowerCase();

	const baseFilters = {
		timeFilter: timeRaw,
		queueFilter: queueRaw,
		playerCountFilter: playersRaw,
	};
	const normalizedFilters = typeof normalizeFilters === "function"
		? normalizeFilters(baseFilters)
		: {
			timeFilter: (timeRaw || defaults.timeFilter || "alltime").toLowerCase(),
			queueFilter: (queueRaw || defaults.queueFilter || "both").toLowerCase(),
			playerCountFilter: (playersRaw || defaults.playerCountFilter || "both").toLowerCase(),
		};

	const loungeValues = {};
	for (let index = 0; index < loungeIdFields.length; index += 1) {
		const key = loungeIdFields[index];
		const rawValue = parts[5 + index];
		loungeValues[key] = rawValue ? rawValue : null;
	}

	return {
		action,
		...normalizedFilters,
		...loungeValues,
	};
}

module.exports = {
	buildStandardFilterRows,
	parseStandardFilterCustomId,
};
