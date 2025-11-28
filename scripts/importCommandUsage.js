const fs = require("fs/promises");
const path = require("path");
const database = require("../utils/database");
const {
	GLOBAL_COMMAND_NAMES,
	resolveCommandFromButtonId,
	normalizeCommandName,
} = require("../utils/globalCommands");

const OWNER_USER_ID = "437813284981309441";
const DEFAULT_LOG_PATH = path.join(__dirname, "..", "data", "logs.1764301754808.json");

function parseArgs(argv) {
	const options = { file: null };
	for (const arg of argv) {
		if (arg.startsWith("--file=")) {
			options.file = arg.slice("--file=".length);
		}
		else if (!options.file && !arg.startsWith("--")) {
			options.file = arg;
		}
	}
	return options;
}

function extractUserId(message) {
	const match = message.match(/\((\d{5,})\)/);
	return match ? match[1] : null;
}

function extractSlashCommandName(message) {
	const match = message.match(/^Chat input command:\s*([^|]+)/i);
	return match ? normalizeCommandName(match[1]) : null;
}

function extractButtonCustomId(message) {
	const match = message.match(/^Button interaction:\s*([^|]+)/i);
	return match ? match[1].trim() : null;
}

function shouldCountUser(userId) {
	return typeof userId === "string" && userId.length > 0 && userId !== OWNER_USER_ID;
}

function incrementUsage(usageMap, commandName, type) {
	const normalized = normalizeCommandName(commandName);
	if (!normalized || !usageMap.has(normalized)) {
		return;
	}
	const entry = usageMap.get(normalized);
	if (type === "button") {
		entry.button += 1;
	}
	else {
		entry.slash += 1;
	}
}

async function main() {
	if (!database.useDatabase) {
		console.error("DATABASE_URL must be set to import command usage.");
		process.exit(1);
	}

	const args = parseArgs(process.argv.slice(2));
	const logPath = args.file ? path.resolve(args.file) : DEFAULT_LOG_PATH;

	let payload;
	try {
		const raw = await fs.readFile(logPath, "utf8");
		payload = JSON.parse(raw);
	}
	catch (error) {
		console.error(`Failed to read or parse log file at ${logPath}:`, error);
		process.exit(1);
	}

	if (!Array.isArray(payload)) {
		console.error("Log file must contain a JSON array of log entries.");
		process.exit(1);
	}

	const usageMap = new Map(GLOBAL_COMMAND_NAMES.map(name => [name, { slash: 0, button: 0 }]));

	for (const entry of payload) {
		const message = entry?.message;
		if (typeof message !== "string" || message.length === 0) {
			continue;
		}
		const userId = extractUserId(message);
		if (!shouldCountUser(userId)) {
			continue;
		}

		if (message.startsWith("Chat input command:")) {
			const commandName = extractSlashCommandName(message);
			if (commandName) {
				incrementUsage(usageMap, commandName, "slash");
			}
			continue;
		}

		if (message.startsWith("Button interaction:")) {
			const customId = extractButtonCustomId(message);
			const resolvedCommand = resolveCommandFromButtonId(customId);
			if (resolvedCommand) {
				incrementUsage(usageMap, resolvedCommand, "button");
			}
		}
	}

	for (const [commandName, counts] of usageMap.entries()) {
		await database.upsertCommandUsageTotals(commandName, counts.slash, counts.button);
	}

	console.log("Imported command usage totals:");
	for (const [commandName, counts] of usageMap.entries()) {
		console.log(`- ${commandName}: slash=${counts.slash}, buttons=${counts.button}`);
	}

	if (database.pool && typeof database.pool.end === "function") {
		await database.pool.end();
	}
}

main().catch(async error => {
	console.error("Command usage import failed:", error);
	if (database.pool && typeof database.pool.end === "function") {
		await database.pool.end();
	}
	process.exit(1);
});
