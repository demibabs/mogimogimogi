const GLOBAL_COMMAND_NAMES = [
	"about-me",
	"customize",
	"head-to-head",
	"leaderboard",
	"notables",
	"rank-stats",
	"setup",
	"stats",
];

const GLOBAL_COMMAND_SET = new Set(GLOBAL_COMMAND_NAMES);

const BUTTON_PREFIX_ALIASES = {
	stats: "stats",
	notables: "notables",
	rankstats: "rank-stats",
	leaderboard: "leaderboard",
	h2h: "head-to-head",
};

function normalizeCommandName(rawName) {
	return typeof rawName === "string" ? rawName.trim().toLowerCase() : null;
}

function isGlobalCommand(commandName) {
	return GLOBAL_COMMAND_SET.has(normalizeCommandName(commandName));
}

function resolveCommandFromButtonId(customId) {
	if (typeof customId !== "string" || !customId.length) {
		return null;
	}
	const prefix = customId.split("|")[0] || customId;
	const normalizedPrefix = normalizeCommandName(prefix);
	if (!normalizedPrefix) {
		return null;
	}
	const mapped = BUTTON_PREFIX_ALIASES[normalizedPrefix] || normalizedPrefix;
	return isGlobalCommand(mapped) ? mapped : null;
}

module.exports = {
	GLOBAL_COMMAND_NAMES,
	BUTTON_PREFIX_ALIASES,
	isGlobalCommand,
	resolveCommandFromButtonId,
	normalizeCommandName,
};
