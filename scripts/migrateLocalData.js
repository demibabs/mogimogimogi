#!/usr/bin/env node
/**
 * Normalize legacy local data files (users, tables, relationships) to the current layout.
 * By default it rewrites the JSON files in-place (useful for local/testing bots).
 * If DATABASE_URL is set, the rewritten records are also persisted through the
 * Database abstraction so production storage stays in sync.
 */
const path = require("path");
const fs = require("fs/promises");

const Database = require("../utils/database");
const LoungeApi = require("../utils/loungeApi");

function createLogger(baseLogger = console) {
	return {
		log: (...args) => typeof baseLogger?.log === "function" ? baseLogger.log(...args) : console.log(...args),
		warn: (...args) => typeof baseLogger?.warn === "function" ? baseLogger.warn(...args) : console.warn(...args),
		error: (...args) => typeof baseLogger?.error === "function" ? baseLogger.error(...args) : console.error(...args),
	};
}

async function readJsonFiles(logger, dir, filter = () => true) {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const results = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			if (!filter(entry.name)) continue;
			const filePath = path.join(dir, entry.name);
			try {
				const raw = await fs.readFile(filePath, "utf8");
				results.push({ name: entry.name, data: JSON.parse(raw) });
			}
			catch (error) {
				logger.warn(`Failed to read ${filePath}: ${error.message}`);
			}
		}
		return results;
	}
	catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

async function buildDiscordToLoungeMap(logger) {
	const tablesDir = path.join(__dirname, "..", "data", "tables");
	const tableFiles = await readJsonFiles(logger, tablesDir);
	const map = new Map();

	for (const tableFile of tableFiles) {
		const table = tableFile.data;
		if (!table?.teams) continue;
		for (const team of table.teams) {
			const scores = Array.isArray(team?.scores) ? team.scores : [];
			for (const player of scores) {
				if (!player) continue;
				const discordId = player.playerDiscordId;
				const loungeId = player.playerId ?? player.id;
				if (!discordId || loungeId === undefined || loungeId === null) continue;
				const normalizedDiscord = String(discordId);
				const normalizedLounge = String(loungeId);
				if (!map.has(normalizedDiscord)) {
					map.set(normalizedDiscord, normalizedLounge);
				}
			}
		}
	}

	return map;
}

async function resolveLoungeId(logger, discordId, userRecord, discordToLounge) {
	if (!discordId) return null;
	const normalizedDiscord = String(discordId);
	if (discordToLounge.has(normalizedDiscord)) {
		return discordToLounge.get(normalizedDiscord);
	}

	const candidate = userRecord?.loungeId;
	if (candidate && String(candidate) !== normalizedDiscord) {
		const normalized = String(candidate);
		discordToLounge.set(normalizedDiscord, normalized);
		return normalized;
	}

	try {
		const player = await LoungeApi.getPlayerByDiscordId(normalizedDiscord);
		if (player?.id !== undefined && player?.id !== null) {
			const normalized = String(player.id);
			discordToLounge.set(normalizedDiscord, normalized);
			return normalized;
		}
	}
	catch (error) {
		logger.warn(`Lookup failed for ${normalizedDiscord}: ${error.message ?? error}`);
	}

	discordToLounge.set(normalizedDiscord, normalizedDiscord);
	return normalizedDiscord;
}

function mergeUserRecords(target, source) {
	const uniqueStrings = (...collections) => {
		const set = new Set();
		for (const collection of collections) {
			for (const value of collection || []) {
				if (value === null || value === undefined) continue;
				set.add(String(value));
			}
		}
		return Array.from(set);
	};

	target.discordIds = uniqueStrings(target.discordIds, source.discordIds);
	target.servers = uniqueStrings(target.servers, source.servers);

	const chooseLatest = field => {
		const existing = target[field];
		const incoming = source[field];
		if (!existing) {
			target[field] = incoming;
			return;
		}
		if (!incoming) return;
		if (new Date(incoming) > new Date(existing)) {
			target[field] = incoming;
		}
	};

	chooseLatest("lastUpdated");
	chooseLatest("updatedAt");

	const chooseEarliest = field => {
		const existing = target[field];
		const incoming = source[field];
		if (!existing) {
			target[field] = incoming;
			return;
		}
		if (!incoming) return;
		if (new Date(incoming) < new Date(existing)) {
			target[field] = incoming;
		}
	};

	chooseEarliest("createdAt");

	if (!target.username && source.username) target.username = source.username;
	if (!target.loungeName && source.loungeName) target.loungeName = source.loungeName;
	if (!target.favorites && source.favorites) target.favorites = source.favorites;

	if (!target.userId && source.userId) {
		target.userId = source.userId;
	}

	const protectedKeys = new Set([
		"discordIds",
		"servers",
		"lastUpdated",
		"updatedAt",
		"createdAt",
		"username",
		"loungeName",
		"favorites",
		"userId",
		"loungeId",
	]);

	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null) continue;
		if (protectedKeys.has(key)) continue;
		if (target[key] === undefined || target[key] === null) {
			target[key] = value;
		}
	}
}

async function migrateUsers(logger, discordToLounge, usingDatabase) {
	const usersDir = path.join(__dirname, "..", "data", "users");
	const legacyServersDir = path.join(__dirname, "..", "data", "servers");
	const allUsers = await readJsonFiles(logger, usersDir);
	const legacyServers = await readJsonFiles(logger, legacyServersDir);
	const aggregated = new Map();

	const ingestRecord = async (discordId, record) => {
		if (!discordId) return;
		const data = record ? { ...record } : {};
		const loungeId = await resolveLoungeId(logger, discordId, data, discordToLounge);
		const discordSet = new Set((data.discordIds || []).map(String));
		discordSet.add(String(discordId));
		if (data.userId) {
			discordSet.add(String(data.userId));
		}
		const serverSet = new Set((data.servers || []).map(String));

		const normalizedRecord = {
			...data,
			loungeId,
			discordIds: Array.from(discordSet),
			servers: Array.from(serverSet),
		};
		if (!normalizedRecord.userId && normalizedRecord.discordIds.length) {
			normalizedRecord.userId = normalizedRecord.discordIds[0];
		}

		let existing = aggregated.get(loungeId);
		if (!existing) {
			existing = JSON.parse(JSON.stringify(normalizedRecord));
			aggregated.set(loungeId, existing);
		}
		else {
			mergeUserRecords(existing, normalizedRecord);
		}

		for (const id of discordSet) {
			discordToLounge.set(id, loungeId);
		}
	};

	for (const userFile of allUsers) {
		const discordId = userFile.name.replace(/\.json$/, "");
		await ingestRecord(discordId, userFile.data);
	}

	for (const serverFile of legacyServers) {
		const serverId = serverFile.name.replace(/\.json$/, "");
		const serverUsers = serverFile.data?.users || {};
		for (const [userKey, payload] of Object.entries(serverUsers)) {
			const mergedPayload = {
				...payload,
				servers: Array.from(new Set([...(payload.servers || []), serverId].map(String))),
			};
			await ingestRecord(userKey, mergedPayload);
		}
	}

	await fs.mkdir(usersDir, { recursive: true });
	const existingFiles = await fs.readdir(usersDir);
	for (const file of existingFiles) {
		if (!file.endsWith(".json")) continue;
		await fs.unlink(path.join(usersDir, file)).catch(error => {
			if (error.code !== "ENOENT") {
				logger.warn(`Failed to delete ${file}: ${error.message}`);
			}
		});
	}

	let migrated = 0;
	for (const [loungeId, record] of aggregated) {
		record.loungeId = loungeId;
		record.discordIds = Array.from(new Set((record.discordIds || []).map(String)));
		record.servers = Array.from(new Set((record.servers || []).map(String)));
		if (!record.userId && record.discordIds.length) {
			record.userId = record.discordIds[0];
		}
		const filePath = path.join(usersDir, `${loungeId}.json`);
		await fs.writeFile(filePath, JSON.stringify(record, null, 2));
		if (usingDatabase) {
			const ok = await Database.saveUserData(loungeId, record);
			if (!ok) {
				logger.warn(`Failed to persist user ${loungeId} to database.`);
			}
		}
		migrated++;
	}

	logger.log(`Migrated ${migrated} user records.`);
	return migrated;
}

async function migrateTables(logger) {
	const tablesDir = path.join(__dirname, "..", "data", "tables");
	const tableFiles = await readJsonFiles(logger, tablesDir);
	let migrated = 0;
	for (const tableFile of tableFiles) {
		const tableId = tableFile.name.replace(/\.json$/, "");
		const ok = await Database.saveTable(tableId, tableFile.data);
		if (ok) migrated++;
	}
	logger.log(`Migrated ${migrated} tables.`);
	return migrated;
}

async function migrateUserTableLinks(logger, discordToLounge, usingDatabase) {
	const linksDir = path.join(__dirname, "..", "data", "user_tables");
	const linkFiles = await readJsonFiles(logger, linksDir);
	let migratedGroups = 0;

	for (const linkFile of linkFiles) {
		const serverId = linkFile.name.replace(/\.json$/, "");
		const relationships = linkFile.data || {};
		const normalized = {};

		for (const [discordId, tableIds] of Object.entries(relationships)) {
			const loungeId = await resolveLoungeId(logger, discordId, null, discordToLounge);
			if (!normalized[loungeId]) {
				normalized[loungeId] = new Set();
			}
			for (const tableId of tableIds || []) {
				const normalizedTableId = String(tableId);
				normalized[loungeId].add(normalizedTableId);
				if (usingDatabase) {
					await Database.linkUserToTable(loungeId, normalizedTableId, serverId);
				}
			}
		}

		const serialized = {};
		for (const [loungeId, tableSet] of Object.entries(normalized)) {
			serialized[loungeId] = Array.from(tableSet).sort();
		}

		await fs.writeFile(path.join(linksDir, linkFile.name), JSON.stringify(serialized, null, 2));
		migratedGroups += Object.keys(serialized).length;
	}

	logger.log(`Migrated ${migratedGroups} user-table link groups.`);
	return migratedGroups;
}

async function migrateData(options = {}) {
	const logger = createLogger(options.logger || console);
	const usingDatabase = options.useDatabase ?? Boolean(process.env.DATABASE_URL);

	if (!usingDatabase) {
		logger.warn("DATABASE_URL not set; running migration against local JSON storage.");
	}

	const discordToLounge = await buildDiscordToLoungeMap(logger);

	logger.log(`Starting migration in ${usingDatabase ? "database" : "local"} mode...`);
	const usersMigrated = await migrateUsers(logger, discordToLounge, usingDatabase);
	const tablesMigrated = await migrateTables(logger);
	const linkGroupsMigrated = await migrateUserTableLinks(logger, discordToLounge, usingDatabase);
	logger.log("Migration complete.");

	return {
		mode: usingDatabase ? "database" : "local",
		usersMigrated,
		tablesMigrated,
		linkGroupsMigrated,
	};
}

async function main() {
	const summary = await migrateData();
	console.log(`Summary: ${summary.usersMigrated} users, ${summary.tablesMigrated} tables, ${summary.linkGroupsMigrated} link groups.`);
}

if (require.main === module) {
	main().catch(error => {
		console.error("Migration failed:", error);
		process.exitCode = 1;
	});
}

module.exports = {
	migrateData,
};
