const { Pool } = require("pg");
const fs = require("fs").promises;
const path = require("path");
const { normalizeCommandName } = require("./globalCommands");

const numericIdPattern = /^\d+$/;

const USER_TABLES_TABLE_DEFINITION = `
	id SERIAL PRIMARY KEY,
	user_id VARCHAR(20) NOT NULL,
	table_id VARCHAR(20) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(user_id, table_id),
	FOREIGN KEY (table_id) REFERENCES tables(table_id) ON DELETE CASCADE
`;

function buildUserTablesCreateStatement(includeIfNotExists = true) {
	const clause = includeIfNotExists ? "IF NOT EXISTS " : "";
	return `
		CREATE TABLE ${clause}user_tables (
			${USER_TABLES_TABLE_DEFINITION}
		)
	`;
}

function normalizeLoungeId(loungeId) {
	if (loungeId === null || loungeId === undefined) {
		throw new Error("loungeId is required");
	}

	if (typeof loungeId === "string") {
		const trimmed = loungeId.trim();
		if (!trimmed) {
			throw new Error("loungeId cannot be empty");
		}
		return trimmed;
	}

	if (typeof loungeId === "number") {
		if (!Number.isFinite(loungeId)) {
			throw new Error("loungeId must be a finite number");
		}
		return String(Math.trunc(loungeId));
	}

	return String(loungeId);
}

function toTableIdString(tableId) {
	if (tableId === null || tableId === undefined) {
		return null;
	}
	const value = String(tableId).trim();
	return value.length ? value : null;
}

function mergeTableIds(existingEntries, incomingIds) {
	const currentList = Array.isArray(existingEntries) ? existingEntries.slice() : [];
	const seen = new Set(currentList.map(value => toTableIdString(value)));
	let changed = false;
	const preferNumeric = currentList.length === 0 || currentList.every(entry => {
		const value = typeof entry === "number" ? entry.toString(10) : String(entry);
		return numericIdPattern.test(value);
	});

	for (const incoming of incomingIds || []) {
		const normalized = toTableIdString(incoming);
		if (!normalized) continue;
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);

		if (preferNumeric && numericIdPattern.test(normalized)) {
			currentList.push(Number.parseInt(normalized, 10));
		}
		else if (numericIdPattern.test(normalized) && currentList.every(entry => typeof entry === "number")) {
			currentList.push(Number.parseInt(normalized, 10));
		}
		else {
			currentList.push(normalized);
		}
		changed = true;
	}

	return {
		list: currentList,
		changed,
	};
}

class Database {
	constructor() {
		this.useDatabase = !!process.env.DATABASE_URL;
		this.usersDir = path.join(__dirname, "..", "data", "users");
		this.legacyServersDir = path.join(__dirname, "..", "data", "servers");
		this.serverStatePath = path.join(__dirname, "..", "data", "server_state.json");
		this._legacyMigrationPromise = null;
		this._userTablesFileMigrationPromise = null;

		if (this.useDatabase) {
			this.pool = new Pool({
				connectionString: process.env.DATABASE_URL,
				ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
			});
			this.initializeDatabase();
		}
	}

	async initializeDatabase() {
		if (!this.useDatabase) return;

		try {
			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS user_data (
					user_id VARCHAR(20) PRIMARY KEY,
					data JSONB NOT NULL,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS tables (
					table_id VARCHAR(20) PRIMARY KEY,
					table_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			await this.pool.query(buildUserTablesCreateStatement(true));
			await this._ensureUserTablesSchema();

			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS command_usage (
					command_name VARCHAR(50) PRIMARY KEY,
					slash_count INTEGER NOT NULL DEFAULT 0,
					button_count INTEGER NOT NULL DEFAULT 0,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			console.log("database initialized successfully");
		}
		catch (error) {
			console.error("database initialization error:", error);
		}
	}

	async getGlobalStats() {
		if (!this.useDatabase) {
			return { tableCount: 0, userCount: 0 };
		}
		try {
			const tableRes = await this.pool.query("SELECT COUNT(*) FROM tables");
			const userRes = await this.pool.query("SELECT COUNT(DISTINCT user_id) FROM user_tables");
			return {
				tableCount: parseInt(tableRes.rows[0].count, 10),
				userCount: parseInt(userRes.rows[0].count, 10)
			};
		} catch (error) {
			console.error("failed to get global stats:", error);
			return { tableCount: 0, userCount: 0 };
		}
	}

	/**
	 * Purge all persisted data (destructive!). Requires useDatabase=true.
	 * Drops and recreates tables to ensure a clean slate.
	 */
	async purgeAll() {
		if (!this.useDatabase) {
			console.warn("purgeAll called but DATABASE_URL not set; skipping.");
			return false;
		}
		try {
			// Drop in reverse dependency order
			await this.pool.query("DROP TABLE IF EXISTS user_tables");
			await this.pool.query("DROP TABLE IF EXISTS tables");
			await this.pool.query("DROP TABLE IF EXISTS user_data");
			// Recreate schema
			await this.initializeDatabase();
			console.log("database purged and reinitialized");
			return true;
		}
		catch (error) {
			console.error("purgeAll error:", error);
			return false;
		}
	}

	// --- User-centric data access -------------------------------------------------

	async getUserData(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		if (this.useDatabase) {
			try {
				const result = await this.pool.query(
					"SELECT data FROM user_data WHERE user_id = $1",
					[normalizedId],
				);
				if (result.rows.length === 0) return null;
				const record = result.rows[0].data || {};
				return {
					loungeId: record.loungeId || normalizedId,
					...record,
				};
			}
			catch (error) {
				console.error(`database read error for lounge user ${normalizedId}:`, error);
				throw error;
			}
		}

		await this._ensureLegacyMigration();
		return await this._getUserDataFromFile(normalizedId);
	}

	async getUserByDiscordId(discordId) {
		const normalizedDiscordId = String(discordId);
		if (this.useDatabase) {
			try {
				const result = await this.pool.query(
					`SELECT user_id, data
					 FROM user_data
					 WHERE (data -> 'discordIds') ? $1`,
					[normalizedDiscordId],
				);
				if (result.rows.length === 0) return null;
				const record = result.rows[0].data || {};
				return {
					loungeId: record.loungeId || result.rows[0].user_id,
					...record,
				};
			}
			catch (error) {
				console.error(`database read error for discord user ${normalizedDiscordId}:`, error);
				return null;
			}
		}

		// File-based fallback (slow, but functional for dev)
		await this._ensureLegacyMigration();
		const allIds = await this._getAllUserIdsFromFiles();
		for (const id of allIds) {
			const data = await this._getUserDataFromFile(id);
			if (data && Array.isArray(data.discordIds) && data.discordIds.includes(normalizedDiscordId)) {
				return data;
			}
		}
		return null;
	}

	async saveUserData(loungeId, data) {
		const normalizedId = normalizeLoungeId(loungeId);
		const payload = { ...data };
		payload.loungeId = payload.loungeId || normalizedId;
		const discordIds = Array.isArray(payload.discordIds) ? payload.discordIds.map(String) : [];
		payload.discordIds = Array.from(new Set(discordIds));
		payload.createdAt = payload.createdAt || new Date().toISOString();
		payload.updatedAt = new Date().toISOString();

		if (this.useDatabase) {
			try {
				await this.pool.query(
					`INSERT INTO user_data (user_id, data, updated_at)
					 VALUES ($1, $2, CURRENT_TIMESTAMP)
					 ON CONFLICT (user_id)
					 DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP`,
					[normalizedId, JSON.stringify(payload)],
				);
				return true;
			}
			catch (error) {
				console.error(`database write error for lounge user ${normalizedId}:`, error);
				return false;
			}
		}

		await this._ensureLegacyMigration();
		return await this._saveUserDataToFile(normalizedId, payload);
	}

	async deleteUserData(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		if (this.useDatabase) {
			try {
				await this.pool.query("DELETE FROM user_data WHERE user_id = $1", [normalizedId]);
				return true;
			}
			catch (error) {
				console.error(`database delete error for lounge user ${normalizedId}:`, error);
				return false;
			}
		}

		await this._ensureLegacyMigration();
		return await this._deleteUserDataFile(normalizedId);
	}

	async getAllUserIds() {
		if (this.useDatabase) {
			try {
				const result = await this.pool.query("SELECT user_id, data FROM user_data");
				return result.rows.map(row => row.data?.loungeId || row.user_id);
			}
			catch (error) {
				console.error("database query error while listing user ids:", error);
				return [];
			}
		}

		await this._ensureLegacyMigration();
		return await this._getAllUserIdsFromFiles();
	}

	// --- Server-level views (derived from user data) -------------------------------

	async getServerSetupState(serverId) {
		if (!serverId) {
			return null;
		}
		const normalizedId = String(serverId);
		if (this.useDatabase) {
			try {
				const result = await this.pool.query(
					"SELECT state FROM server_state WHERE server_id = $1",
					[normalizedId],
				);
				if (!result.rows.length) {
					return null;
				}
				return result.rows[0].state || null;
			}
			catch (error) {
				console.error(`database server_state read error for server ${normalizedId}:`, error);
				return null;
			}
		}

		const stateMap = await this._readServerStateMap();
		return stateMap[normalizedId] || null;
	}

	async markServerSetupComplete(serverId, metadata = {}) {
		if (!serverId) {
			throw new Error("serverId is required to mark setup complete");
		}
		const normalizedId = String(serverId);
		const existing = await this.getServerSetupState(normalizedId);
		const timestamp = new Date().toISOString();
		const payload = {
			...(existing || {}),
			...metadata,
			serverId: normalizedId,
			completed: true,
			lastSetupAt: timestamp,
		};
		if (!payload.firstSetupAt) {
			payload.firstSetupAt = timestamp;
		}

		if (this.useDatabase) {
			try {
				await this.pool.query(
					`INSERT INTO server_state (server_id, state, updated_at)
					 VALUES ($1, $2, CURRENT_TIMESTAMP)
					 ON CONFLICT (server_id)
					 DO UPDATE SET state = $2, updated_at = CURRENT_TIMESTAMP`,
					[normalizedId, JSON.stringify(payload)],
				);
				return payload;
			}
			catch (error) {
				console.error(`database server_state write error for server ${normalizedId}:`, error);
				return payload;
			}
		}

		const stateMap = await this._readServerStateMap();
		stateMap[normalizedId] = payload;
		await this._writeServerStateMap(stateMap);
		return payload;
	}

	// --- Table management ---------------------------------------------------------

	async saveTable(tableId, tableData) {
		const normalizedTableId = toTableIdString(tableId);
		if (!normalizedTableId) {
			return false;
		}

		if (!this.useDatabase) {
			return await this._saveTableToFile(normalizedTableId, tableData);
		}

		try {
			await this.pool.query(
				`INSERT INTO tables (table_id, table_data, updated_at)
				 VALUES ($1, $2, CURRENT_TIMESTAMP)
				 ON CONFLICT (table_id)
				 DO UPDATE SET table_data = $2, updated_at = CURRENT_TIMESTAMP`,
				[normalizedTableId, JSON.stringify(tableData)],
			);
			return true;
		}
		catch (error) {
			console.error("database table save error:", error);
			return false;
		}
	}

	async getTable(tableId) {
		if (!this.useDatabase) {
			return await this._getTableFromFile(tableId);
		}

		try {
			const result = await this.pool.query(
				"SELECT table_data FROM tables WHERE table_id = $1",
				[tableId],
			);
			if (result.rows.length === 0) return null;
			return result.rows[0].table_data;
		}
		catch (error) {
			console.error("database table read error:", error);
			return null;
		}
	}

	async linkUserToTable(loungeId, tableId, serverId = null) {
		const normalizedId = normalizeLoungeId(loungeId);
		const normalizedTableId = toTableIdString(tableId);
		if (!normalizedTableId) {
			return false;
		}
		if (!this.useDatabase) {
			return await this._linkUserToTableInFile(normalizedId, normalizedTableId, serverId || "global");
		}

		try {
			await this.pool.query(
				`INSERT INTO user_tables (user_id, table_id)
				 VALUES ($1, $2)
				 ON CONFLICT (user_id, table_id) DO NOTHING`,
				[normalizedId, normalizedTableId],
			);
			return true;
		}
		catch (error) {
			console.error("database user-table link error:", error);
			return false;
		}
	}

	async getUserTables(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		if (!this.useDatabase) {
			return await this._getUserTablesFromFile(normalizedId);
		}

		try {
			const result = await this.pool.query(
				`SELECT ut.table_id
				 FROM user_tables ut
				 WHERE ut.user_id = $1
				 ORDER BY ut.created_at DESC`,
				[normalizedId],
			);
			return result.rows.map(row => ({ id: row.table_id }));
		}
		catch (error) {
			console.error("database user tables query error:", error);
			return [];
		}
	}

	// --- Command usage analytics -------------------------------------------------

	async recordCommandUsage(commandName, interactionType = "slash") {
		if (!this.useDatabase) {
			return false;
		}
		const normalizedName = normalizeCommandName(commandName);
		if (!normalizedName) {
			return false;
		}
		const isButton = interactionType === "button";
		const slashIncrement = isButton ? 0 : 1;
		const buttonIncrement = isButton ? 1 : 0;
		const targetColumn = isButton ? "button_count" : "slash_count";
		try {
			await this.pool.query(
				`INSERT INTO command_usage (command_name, slash_count, button_count)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (command_name)
				 DO UPDATE SET ${targetColumn} = command_usage.${targetColumn} + 1, updated_at = CURRENT_TIMESTAMP`,
				[normalizedName, slashIncrement, buttonIncrement],
			);
			return true;
		}
		catch (error) {
			console.error("command usage update error:", error);
			return false;
		}
	}

	async getCommandUsageStats(limit = 25) {
		if (!this.useDatabase) {
			return [];
		}
		const safeLimit = Number.isFinite(limit)
			? Math.min(Math.max(Math.floor(limit), 1), 100)
			: 25;
		try {
			const result = await this.pool.query(
				`SELECT command_name, slash_count, button_count, updated_at
				 FROM command_usage
				 ORDER BY slash_count DESC, button_count DESC, command_name ASC
				 LIMIT $1`,
				[safeLimit],
			);
			return result.rows;
		}
		catch (error) {
			console.error("command usage stats query error:", error);
			return [];
		}
	}

	async upsertCommandUsageTotals(commandName, slashCount = 0, buttonCount = 0) {
		if (!this.useDatabase) {
			return false;
		}
		const normalizedName = normalizeCommandName(commandName);
		if (!normalizedName) {
			return false;
		}
		const safeSlash = Math.max(0, Number.isFinite(slashCount) ? Math.floor(slashCount) : 0);
		const safeButton = Math.max(0, Number.isFinite(buttonCount) ? Math.floor(buttonCount) : 0);
		try {
			await this.pool.query(
				`INSERT INTO command_usage (command_name, slash_count, button_count)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (command_name)
				 DO UPDATE SET slash_count = $2, button_count = $3, updated_at = CURRENT_TIMESTAMP`,
				[normalizedName, safeSlash, safeButton],
			);
			return true;
		}
		catch (error) {
			console.error("command usage totals upsert failed:", error);
			return false;
		}
	}

	// --- File helpers -------------------------------------------------------------

	async _ensureUsersDir() {
		try {
			await fs.mkdir(this.usersDir, { recursive: true });
		}
		catch (error) {
			console.error("error creating users directory:", error);
		}
	}

	async _ensureUserTablesSchema() {
		if (!this.useDatabase) {
			return;
		}
		try {
			const legacyColumnResult = await this.pool.query(`
				SELECT 1
				FROM information_schema.columns
				WHERE table_name = 'user_tables'
					AND column_name = 'server_id'
				LIMIT 1
			`);
			if (!legacyColumnResult.rowCount) {
				return;
			}

			console.log("migrating user_tables to global schema...");
			await this.pool.query("ALTER TABLE user_tables RENAME TO user_tables_legacy");
			await this.pool.query(buildUserTablesCreateStatement(false));
			await this.pool.query(`
				INSERT INTO user_tables (user_id, table_id, created_at)
				SELECT user_id, table_id, MIN(created_at)
				FROM user_tables_legacy
				GROUP BY user_id, table_id
				ON CONFLICT (user_id, table_id) DO NOTHING
			`);
			await this.pool.query("DROP TABLE user_tables_legacy");
		}
		catch (error) {
			console.error("failed to migrate user_tables schema:", error);
		}
	}

	async _ensureUserTablesFileMigration() {
		if (this.useDatabase) {
			return;
		}
		if (!this._userTablesFileMigrationPromise) {
			this._userTablesFileMigrationPromise = this._migrateUserTableFiles().catch(error => {
				console.error("user_tables file migration failed:", error);
			});
		}
		await this._userTablesFileMigrationPromise;
	}

	async _migrateUserTableFiles() {
		const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
		let files;
		try {
			files = await fs.readdir(relationshipsDir);
		}
		catch (error) {
			if (error.code === "ENOENT") {
				return;
			}
			throw error;
		}

		const globalPath = path.join(relationshipsDir, "global.json");
		let globalData = {};
		try {
			const raw = await fs.readFile(globalPath, "utf8");
			globalData = JSON.parse(raw) || {};
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error("error reading global user_tables file:", error);
			}
		}

		let changed = false;
		for (const file of files) {
			if (!file.endsWith(".json") || file === "global.json") {
				continue;
			}
			const filePath = path.join(relationshipsDir, file);
			try {
				const raw = await fs.readFile(filePath, "utf8");
				const legacyData = JSON.parse(raw) || {};
				for (const [userId, tableIds] of Object.entries(legacyData)) {
					let normalizedId;
					try {
						normalizedId = normalizeLoungeId(userId);
					}
					catch (error) {
						continue;
					}
					const { list, changed: updated } = mergeTableIds(globalData[normalizedId], tableIds);
					if (updated) {
						globalData[normalizedId] = list;
						changed = true;
					}
				}
			}
			catch (error) {
				console.error(`error migrating user_tables file ${file}:`, error);
			}
			try {
				await fs.unlink(filePath);
			}
			catch (error) {
				if (error.code !== "ENOENT") {
					console.error(`error deleting legacy user_tables file ${file}:`, error);
				}
			}
		}

		if (changed) {
			await fs.mkdir(relationshipsDir, { recursive: true });
			await fs.writeFile(globalPath, JSON.stringify(globalData, null, 2));
		}
	}


	async _ensureLegacyMigration() {
		if (this.useDatabase) return;
		if (!this._legacyMigrationPromise) {
			this._legacyMigrationPromise = this._migrateLegacyServerFiles()
				.catch(error => {
					console.error("legacy data migration failed:", error);
				})
				.finally(() => {
					if (!this._legacyMigrationPromise) return;
				});
		}
		await this._legacyMigrationPromise;
	}

	async _readServerStateMap() {
		try {
			const raw = await fs.readFile(this.serverStatePath, "utf8");
			return JSON.parse(raw) || {};
		}
		catch (error) {
			if (error.code === "ENOENT") {
				return {};
			}
			console.error("error reading server_state cache:", error);
			return {};
		}
	}

	async _writeServerStateMap(stateMap) {
		try {
			await fs.mkdir(path.dirname(this.serverStatePath), { recursive: true });
			await fs.writeFile(this.serverStatePath, JSON.stringify(stateMap, null, 2));
		}
		catch (error) {
			console.error("error writing server_state cache:", error);
		}
	}

	_getUserDataPath(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		return path.join(this.usersDir, `${normalizedId}.json`);
	}

	async _getUserDataFromFile(loungeId) {
		try {
			await this._ensureUsersDir();
			const filePath = this._getUserDataPath(loungeId);
			const data = await fs.readFile(filePath, "utf8");
			const parsed = JSON.parse(data);
			return {
				...parsed,
				loungeId: parsed.loungeId || parsed.userId || loungeId,
			};
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error(`error reading lounge user file ${loungeId}:`, error);
			}
			return null;
		}
	}

	async _saveUserDataToFile(loungeId, data) {
		try {
			await this._ensureUsersDir();
			const filePath = this._getUserDataPath(loungeId);
			await fs.writeFile(filePath, JSON.stringify(data, null, 2));
			return true;
		}
		catch (error) {
			console.error(`error saving lounge user file ${loungeId}:`, error);
			return false;
		}
	}

	async _deleteUserDataFile(loungeId) {
		try {
			const filePath = this._getUserDataPath(loungeId);
			await fs.unlink(filePath);
			return true;
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error(`error deleting lounge user file ${loungeId}:`, error);
			}
			return false;
		}
	}

	async _getAllUserIdsFromFiles() {
		try {
			await this._ensureUsersDir();
			const files = await fs.readdir(this.usersDir);
			const ids = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await fs.readFile(path.join(this.usersDir, file), "utf8");
					const data = JSON.parse(raw);
					ids.push(data.loungeId || data.userId || file.replace(".json", ""));
				}
				catch (error) {
					console.error(`error reading user file ${file} for id list:`, error);
				}
			}
			return ids;
		}
		catch (error) {
			console.error("error listing user ids from files:", error);
			return [];
		}
	}

	async _migrateLegacyServerFiles() {
		// No-op: legacy server files are no longer supported
		return Promise.resolve();
	}

	// --- Legacy relationships for file storage -----------------------------------

	async _saveTableToFile(tableId, tableData) {
		try {
			const tablesDir = path.join(__dirname, "..", "data", "tables");
			await fs.mkdir(tablesDir, { recursive: true });
			const tablePath = path.join(tablesDir, `${tableId}.json`);
			await fs.writeFile(tablePath, JSON.stringify(tableData, null, 2));
			return true;
		}
		catch (error) {
			console.error(`error saving table ${tableId} to file:`, error);
			return false;
		}
	}

	async _getTableFromFile(tableId) {
		try {
			const tablePath = path.join(__dirname, "..", "data", "tables", `${tableId}.json`);
			const data = await fs.readFile(tablePath, "utf8");
			return JSON.parse(data);
		}
		catch (error) {
			if (error.code !== "ENOENT") {
				console.error(`error reading table ${tableId} from file:`, error);
			}
			return null;
		}
	}

	async rememberGlobalUserTables(loungeId, tableIds) {
		const normalizedId = normalizeLoungeId(loungeId);
		const orderedUniqueIds = [];
		const seen = new Set();
		for (const rawId of tableIds || []) {
			const normalized = toTableIdString(rawId);
			if (!normalized || seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			orderedUniqueIds.push(normalized);
		}

		if (!orderedUniqueIds.length) {
			return false;
		}

		if (this.useDatabase) {
			let recorded = false;
			for (const tableId of orderedUniqueIds) {
				try {
					await this.linkUserToTable(normalizedId, tableId, "global");
					recorded = true;
				}
				catch (error) {
					console.error(`database global link error for ${normalizedId}/${tableId}:`, error);
				}
			}
			return recorded;
		}

		try {
			await this._ensureUserTablesFileMigration();
			const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
			await fs.mkdir(relationshipsDir, { recursive: true });
			const globalPath = path.join(relationshipsDir, "global.json");
			let globalData = {};
			try {
				const existingRaw = await fs.readFile(globalPath, "utf8");
				globalData = JSON.parse(existingRaw) || {};
			}
			catch (readError) {
				if (readError.code !== "ENOENT") {
					console.error("error reading global user_tables file:", readError);
				}
			}

			const existingEntries = Array.isArray(globalData[normalizedId]) ? globalData[normalizedId] : [];
			const { list, changed } = mergeTableIds(existingEntries, orderedUniqueIds);
			if (!changed) {
				return false;
			}

			globalData[normalizedId] = list;
			await fs.writeFile(globalPath, JSON.stringify(globalData, null, 2));
			return true;
		}
		catch (error) {
			console.error(`error remembering global tables for lounge user ${normalizedId}:`, error);
			return false;
		}
	}

	async _linkUserToTableInFile(loungeId, tableId, serverId) {
		try {
			await this._ensureUserTablesFileMigration();
			const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
			await fs.mkdir(relationshipsDir, { recursive: true });
			const globalPath = path.join(relationshipsDir, "global.json");
			let relationships = {};
			try {
				const data = await fs.readFile(globalPath, "utf8");
				relationships = JSON.parse(data) || {};
			}
			catch (readError) {
				if (readError.code !== "ENOENT") {
					console.error("error reading global user_tables file:", readError);
				}
			}

			const normalizedId = normalizeLoungeId(loungeId);
			const normalizedTableId = toTableIdString(tableId);
			if (!normalizedTableId) {
				return false;
			}
			const existingEntries = Array.isArray(relationships[normalizedId]) ? relationships[normalizedId] : [];
			const { list, changed } = mergeTableIds(existingEntries, [normalizedTableId]);
			relationships[normalizedId] = list;

			if (changed) {
				await fs.writeFile(globalPath, JSON.stringify(relationships, null, 2));
			}
			return true;
		}
		catch (error) {
			console.error(`error linking lounge user ${loungeId} to table ${tableId}:`, error);
			return false;
		}
	}

	async _getUserTablesFromFile(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
		const tableMap = new Map();
		await this._ensureUserTablesFileMigration();

		let files = [];
		try {
			files = await fs.readdir(relationshipsDir);
		}
		catch (error) {
			if (error.code === "ENOENT") {
				return [];
			}
			console.error("error listing user_tables directory:", error);
			return [];
		}

		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			try {
				const raw = await fs.readFile(path.join(relationshipsDir, file), "utf8");
				const relationships = JSON.parse(raw);
				const entries = relationships[normalizedId];
				if (!Array.isArray(entries) || !entries.length) continue;
				for (const tableId of entries) {
					const key = String(tableId);
					tableMap.set(key, true);
				}
			}
			catch (error) {
				console.error(`error reading user_tables file ${file}:`, error);
			}
		}

		return Array.from(tableMap.keys()).map(id => ({ id }));
	}
}

module.exports = new Database();