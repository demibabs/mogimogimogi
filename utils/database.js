const { Pool } = require("pg");
const fs = require("fs").promises;
const path = require("path");

const numericIdPattern = /^\d+$/;

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
		this._legacyMigrationPromise = null;

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

			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS user_tables (
					id SERIAL PRIMARY KEY,
					user_id VARCHAR(20) NOT NULL,
					table_id VARCHAR(20) NOT NULL,
					server_id VARCHAR(20) NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(user_id, table_id, server_id),
					FOREIGN KEY (table_id) REFERENCES tables(table_id) ON DELETE CASCADE
				)
			`);

			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS leaderboard_cache (
					id SERIAL PRIMARY KEY,
					server_id VARCHAR(20) NOT NULL,
					user_id VARCHAR(20) NOT NULL,
					cache_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(server_id, user_id)
				)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_server
				ON leaderboard_cache(server_id)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_updated
				ON leaderboard_cache(updated_at)
			`);

			await this.pool.query(`
				CREATE TABLE IF NOT EXISTS streak_cache (
					id SERIAL PRIMARY KEY,
					server_id VARCHAR(20) NOT NULL,
					user_id VARCHAR(20) NOT NULL,
					cache_data JSONB NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(server_id, user_id)
				)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_streak_cache_server
				ON streak_cache(server_id)
			`);

			await this.pool.query(`
				CREATE INDEX IF NOT EXISTS idx_streak_cache_updated
				ON streak_cache(updated_at)
			`);

			console.log("database initialized successfully");
		}
		catch (error) {
			console.error("database initialization error:", error);
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

	async saveUserData(loungeId, data) {
		const normalizedId = normalizeLoungeId(loungeId);
		const payload = { ...data };
		payload.loungeId = payload.loungeId || normalizedId;
		const existingServers = Array.isArray(payload.servers) ? payload.servers : [];
		payload.servers = Array.from(new Set(existingServers.map(String)));
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

	async getUsersByServer(serverId) {
		if (this.useDatabase) {
			try {
				const result = await this.pool.query(
					`SELECT user_id, data
					 FROM user_data
					 WHERE (data -> 'servers') ? $1`,
					[serverId],
				);
				return result.rows.map(row => ({
					loungeId: row.data?.loungeId || row.user_id,
					...row.data,
				}));
			}
			catch (error) {
				console.error(`database query error for server ${serverId}:`, error);
				return [];
			}
		}

		await this._ensureLegacyMigration();
		return await this._getUsersByServerFromFiles(serverId);
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

	async getServerData(serverId) {
		const users = await this.getUsersByServer(serverId);
		const userMap = {};
		const discordIndex = {};
		let createdAt = null;
		let updatedAt = null;

		for (const user of users) {
			const { loungeId, servers, discordIds = [], ...rest } = user;
			if (!loungeId) continue;
			userMap[loungeId] = {
				loungeId,
				servers,
				discordIds,
				...rest,
			};
			for (const discordId of discordIds) {
				discordIndex[String(discordId)] = loungeId;
			}
			if (user.createdAt && (!createdAt || user.createdAt < createdAt)) {
				createdAt = user.createdAt;
			}
			if (user.updatedAt && (!updatedAt || user.updatedAt > updatedAt)) {
				updatedAt = user.updatedAt;
			}
		}

		return {
			serverId,
			users: userMap,
			discordIndex,
			tables: {},
			createdAt,
			updatedAt,
		};
	}

	async saveServerData(serverId, data) {
		const incomingUsers = data?.users ? Object.entries(data.users) : [];
		const currentUsers = await this.getUsersByServer(serverId);
		const currentIds = new Set(currentUsers.map(user => user.loungeId));

		for (const [loungeId, userInfo] of incomingUsers) {
			const normalizedId = normalizeLoungeId(loungeId);
			const existing = await this.getUserData(normalizedId);
			const base = existing || { servers: [], discordIds: [] };
			const mergedServers = new Set([...(base.servers || []), ...(userInfo.servers || []), serverId]);
			const mergedDiscordIds = new Set([...(base.discordIds || []), ...(userInfo.discordIds || [])]);
			const payload = {
				...base,
				...userInfo,
				loungeId: normalizedId,
				servers: Array.from(mergedServers),
				discordIds: Array.from(mergedDiscordIds),
				createdAt: base?.createdAt || data?.createdAt || new Date().toISOString(),
			};
			await this.saveUserData(normalizedId, payload);
			currentIds.delete(normalizedId);
		}

		for (const orphanId of currentIds) {
			const existing = await this.getUserData(orphanId);
			if (!existing) continue;
			const remainingServers = (existing.servers || []).filter(id => id !== serverId);
			if (remainingServers.length === 0) {
				await this.deleteUserData(orphanId);
			}
			else {
				existing.servers = remainingServers;
				await this.saveUserData(orphanId, existing);
			}
		}

		return true;
	}

	async deleteServerData(serverId) {
		const users = await this.getUsersByServer(serverId);
		for (const user of users) {
			const remainingServers = (user.servers || []).filter(id => id !== serverId);
			if (remainingServers.length === 0) {
				await this.deleteUserData(user.loungeId);
			}
			else {
				await this.saveUserData(user.loungeId, { ...user, servers: remainingServers });
			}
		}
		return true;
	}

	async getAllServerIds() {
		if (this.useDatabase) {
			try {
				const result = await this.pool.query(`
					SELECT DISTINCT jsonb_array_elements_text(data->'servers') AS server_id
					FROM user_data
					WHERE data ? 'servers'
				`);
				return result.rows.map(row => row.server_id).filter(Boolean);
			}
			catch (error) {
				console.error("database query error while listing servers:", error);
				return [];
			}
		}

		await this._ensureLegacyMigration();
		return await this._getAllServerIdsFromFiles();
	}

	// --- Table management ---------------------------------------------------------

	async saveTable(tableId, tableData) {
		if (!this.useDatabase) {
			return await this._saveTableToFile(tableId, tableData);
		}

		try {
			await this.pool.query(
				`INSERT INTO tables (table_id, table_data, updated_at)
				 VALUES ($1, $2, CURRENT_TIMESTAMP)
				 ON CONFLICT (table_id)
				 DO UPDATE SET table_data = $2, updated_at = CURRENT_TIMESTAMP`,
				[tableId, JSON.stringify(tableData)],
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

	async linkUserToTable(loungeId, tableId, serverId) {
		const normalizedId = normalizeLoungeId(loungeId);
		if (!this.useDatabase) {
			return await this._linkUserToTableInFile(normalizedId, tableId, serverId);
		}

		try {
			await this.pool.query(
				`INSERT INTO user_tables (user_id, table_id, server_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (user_id, table_id, server_id) DO NOTHING`,
				[normalizedId, tableId, serverId],
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
				`SELECT t.table_id, ARRAY_AGG(DISTINCT ut.server_id) AS servers
				 FROM user_tables ut
				 JOIN tables t ON t.table_id = ut.table_id
				 WHERE ut.user_id = $1
				 GROUP BY t.table_id`,
				[normalizedId],
			);
			return result.rows.map(row => ({
				id: row.table_id,
				servers: Array.isArray(row.servers) ? row.servers.filter(Boolean).map(String) : [],
			}));
		}
		catch (error) {
			console.error("database user tables query error:", error);
			return [];
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
			const servers = Array.isArray(parsed.servers) ? parsed.servers.map(String) : [];
			return {
				...parsed,
				loungeId: parsed.loungeId || parsed.userId || loungeId,
				servers: Array.from(new Set(servers)),
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

	async _getUsersByServerFromFiles(serverId) {
		try {
			await this._ensureUsersDir();
			const files = await fs.readdir(this.usersDir);
			const matches = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await fs.readFile(path.join(this.usersDir, file), "utf8");
					const data = JSON.parse(raw);
					const servers = Array.isArray(data.servers) ? data.servers.map(String) : [];
					if (servers.includes(serverId)) {
						const loungeId = data.loungeId || data.userId || file.replace(".json", "");
						matches.push({ ...data, loungeId, servers });
					}
				}
				catch (error) {
					console.error(`error parsing user file ${file}:`, error);
				}
			}
			return matches;
		}
		catch (error) {
			console.error(`error listing users for server ${serverId}:`, error);
			return [];
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

	async _getAllServerIdsFromFiles() {
		try {
			await this._ensureUsersDir();
			const files = await fs.readdir(this.usersDir);
			const serverSet = new Set();
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await fs.readFile(path.join(this.usersDir, file), "utf8");
					const data = JSON.parse(raw);
					for (const serverId of data.servers || []) {
						serverSet.add(String(serverId));
					}
				}
				catch (error) {
					console.error(`error reading user file ${file} for servers:`, error);
				}
			}
			return Array.from(serverSet);
		}
		catch (error) {
			console.error("error collecting server ids from files:", error);
			return [];
		}
	}

	async _migrateLegacyServerFiles() {
		await this._ensureUsersDir();
		let files;
		try {
			files = await fs.readdir(this.legacyServersDir);
		}
		catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}

		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const serverId = file.replace(".json", "");
			try {
				const raw = await fs.readFile(path.join(this.legacyServersDir, file), "utf8");
				const legacyData = JSON.parse(raw);
				const legacyUsers = legacyData.users || {};
				for (const [userId, userInfo] of Object.entries(legacyUsers)) {
					const normalizedId = normalizeLoungeId(userId);
					const existing = await this._getUserDataFromFile(normalizedId);
					const servers = new Set([...(existing?.servers || []), serverId]);
					const payload = {
						loungeId: existing?.loungeId || normalizedId,
						legacyDiscordId: userId,
						username: userInfo.username || existing?.username || null,
						loungeName: userInfo.loungeName || existing?.loungeName || null,
						lastUpdated: userInfo.lastUpdated || existing?.lastUpdated || null,
						servers: Array.from(servers),
						discordIds: existing?.discordIds || (userInfo.discordId ? [String(userInfo.discordId)] : []),
						createdAt: existing?.createdAt || legacyData.createdAt || new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};
					await this._saveUserDataToFile(normalizedId, payload);
				}
			}
			catch (error) {
				console.error(`error migrating legacy server file ${file}:`, error);
			}
		}
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
			const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
			await fs.mkdir(relationshipsDir, { recursive: true });
			const relationshipPath = path.join(relationshipsDir, `${serverId}.json`);
			let relationships = {};
			try {
				const data = await fs.readFile(relationshipPath, "utf8");
				relationships = JSON.parse(data) || {};
			}
			catch (readError) {
				if (readError.code !== "ENOENT") {
					console.error("error reading relationships file:", readError);
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
				await fs.writeFile(relationshipPath, JSON.stringify(relationships, null, 2));
			}

			if (serverId !== "global") {
				await this._ensureGlobalTableLink(relationshipsDir, normalizedId, normalizedTableId);
			}
			return true;
		}
		catch (error) {
			console.error(`error linking lounge user ${loungeId} to table ${tableId}:`, error);
			return false;
		}
	}

	async _ensureGlobalTableLink(relationshipsDir, loungeId, tableId) {
		try {
			const normalizedTableId = toTableIdString(tableId);
			if (!normalizedTableId) {
				return false;
			}
			const globalPath = path.join(relationshipsDir, "global.json");
			let globalData = {};
			try {
				const raw = await fs.readFile(globalPath, "utf8");
				globalData = JSON.parse(raw) || {};
			}
			catch (readError) {
				if (readError.code !== "ENOENT") {
					console.error("error reading global user_tables file:", readError);
				}
			}

			const existing = Array.isArray(globalData[loungeId]) ? globalData[loungeId] : [];
			const { list, changed } = mergeTableIds(existing, [normalizedTableId]);
			if (!changed) {
				return false;
			}

			globalData[loungeId] = list;
			await fs.writeFile(globalPath, JSON.stringify(globalData, null, 2));
			return true;
		}
		catch (error) {
			console.error(`error updating global cache for lounge user ${loungeId}:`, error);
			return false;
		}
	}

	async _getUserTablesFromFile(loungeId) {
		const normalizedId = normalizeLoungeId(loungeId);
		const relationshipsDir = path.join(__dirname, "..", "data", "user_tables");
		const tableMap = new Map();

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
			const serverId = file.replace(/\.json$/, "");
			try {
				const raw = await fs.readFile(path.join(relationshipsDir, file), "utf8");
				const relationships = JSON.parse(raw);
				const entries = relationships[normalizedId];
				if (!Array.isArray(entries) || !entries.length) continue;
				for (const tableId of entries) {
					const key = String(tableId);
					if (!tableMap.has(key)) {
						tableMap.set(key, { id: key, servers: new Set() });
					}
					tableMap.get(key).servers.add(serverId);
				}
			}
			catch (error) {
				console.error(`error reading user_tables file ${file}:`, error);
			}
		}

		return Array.from(tableMap.values()).map(entry => ({
			id: entry.id,
			servers: Array.from(entry.servers).map(String),
		}));
	}
}

module.exports = new Database();