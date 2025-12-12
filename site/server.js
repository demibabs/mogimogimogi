const express = require("express");
const path = require("path");
const fs = require("fs");
const database = require("../bot/utils/database");
const LoungeApi = require("../bot/utils/loungeApi");
const { trackAbbreviationsToNames } = require("../bot/utils/gameData");
const StatsCommand = require("../bot/commands/global/stats");
const NotablesCommand = require("../bot/commands/global/notables");
const RankStatsCommand = require("../bot/commands/global/rank-stats");
const HeadToHeadCommand = require("../bot/commands/global/head-to-head");

const PREVIEW_SESSION_TTL_MS = 10 * 60 * 1000;
const previewSessionCache = new Map();
const previewNotablesCache = new Map();
const previewRankStatsCache = new Map();
const previewHeadToHeadCache = new Map();

const IMAGES_ROOT = path.join(__dirname, "public/images");
const TRACK_THUMBNAILS_DIR = path.join(IMAGES_ROOT, "tracks");
const CHARACTER_MAIN_DIR = path.join(IMAGES_ROOT, "characters", "mains");
const CHARACTER_NPC_DIR = path.join(IMAGES_ROOT, "characters", "npcs");
const VEHICLE_DIR = path.join(IMAGES_ROOT, "vehicles");

const characterDefaultImageMap = buildCharacterDefaultMap();
const characterBaseNames = Object.keys(characterDefaultImageMap).sort((a, b) => b.length - a.length);

function buildCharacterDefaultMap() {
	const map = {};
	const loadDir = (dir, subpath) => {
		try {
			const files = fs.readdirSync(dir);
			for (const file of files) {
				const ext = path.extname(file).toLowerCase();
				if (ext !== ".webp") continue;
				const stem = path.basename(file, ext).toLowerCase();
				const base = stem.endsWith(" default") ? stem.slice(0, -8) : stem;
				// Prefer explicit defaults; otherwise first seen wins per base
				if (stem.endsWith(" default") || !map[base]) {
					map[base] = path.join(subpath, file);
				}
			}
		}
		catch (error) {
			console.error(`failed to build character map from ${dir}:`, error);
		}
	};

	loadDir(CHARACTER_MAIN_DIR, "characters/mains");
	loadDir(CHARACTER_NPC_DIR, "characters/npcs");
	return map;
}

function normalizeCharacterKey(rawName) {
	if (!rawName) return null;
	const value = rawName.toLowerCase().replace(/\s+/g, " ").trim();
	if (!value) return null;
	for (const base of characterBaseNames) {
		if (value === base || value.startsWith(`${base} `)) {
	 return base;
		}
	}
	return value;
}

function getCharacterImagePath(key) {
	const file = characterDefaultImageMap[key];
	if (!file) return null;
	// file already contains subpath (mains or npcs)
	return `/images/${encodeURIComponent(file).replace(/%2F/g, "/")}`;
}

function normalizeVehicleKey(rawName) {
	if (!rawName) return null;
	const value = rawName.toLowerCase().replace(/\s+/g, " ").trim();
	if (!value) return null;
	if (value.includes("mach rocket")) return "mach rocket";
	if (value.includes("rob-hog") || value.includes("rob hog")) return "rob hog";
	return value;
}

function getVehicleImagePath(key) {
	if (!key) return null;
	if (key === "mach rocket") return "/images/vehicles/mach%20rocket%20red.webp";
	if (key === "rob hog") return "/images/vehicles/rob%20hog%20red.webp";
	const file = `${key}.webp`;
	const full = path.join(VEHICLE_DIR, file);
	if (fs.existsSync(full)) {
		return `/images/vehicles/${encodeURIComponent(file)}`;
	}
	return null;
}

function normalizeTrackKey(rawAbbr) {
	if (!rawAbbr) return null;
	const trimmed = String(rawAbbr).trim();
	if (!trimmed) return null;
	if (trackAbbreviationsToNames[trimmed]) return trimmed;
	const upper = trimmed.toUpperCase();
	return trackAbbreviationsToNames[upper] ? upper : null;
}

function getTrackImagePath(abbr) {
	if (!abbr) return null;
	const webpPath = path.join(TRACK_THUMBNAILS_DIR, `${abbr}.webp`);
	if (fs.existsSync(webpPath)) return `/images/tracks/${abbr}.webp`;
	return null;
}

function titleCaseWords(value) {
	if (!value) return "";
	return value.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function buildTopFive(counts, resolveName, resolveImage) {
	return Object.entries(counts)
		.filter(([, count]) => count > 0)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 5)
		.map(([key], index) => ({
	 rank: index + 1,
	 name: resolveName(key),
	 image: resolveImage(key),
		}));
}

function startSite(client) {
	const app = express();
	const PORT = process.env.PORT || 3000;

	async function fetchDiscordUser(loungeId) {
		if (!client) {
			console.warn("fetchDiscordUser: client is not available");
			return null;
		}
		if (!loungeId) return null;
		try {
			const details = await LoungeApi.getPlayerByLoungeId(loungeId);
			// console.log(`fetchDiscordUser: details for ${loungeId}:`, details ? "found" : "null", details?.discordId);
			if (details && details.discordId) {
				const user = await client.users.fetch(details.discordId).catch(err => {
					console.error(`fetchDiscordUser: failed to fetch user ${details.discordId}:`, err.message);
					return null;
				});
				return user;
			}
			else {
				console.warn(`fetchDiscordUser: no discordId found for loungeId ${loungeId}`);
			}
		}
		catch (e) {
			console.error(`Failed to fetch discord user for loungeId ${loungeId}:`, e);
		}
		return null;
	}

	// Serve static assets (fonts) before public so missing files fall through correctly
	app.use("/fonts", express.static(path.join(__dirname, "../fonts")));

	// Serve public directory with explicit CSS mime type handling
	app.use(express.static(path.join(__dirname, "public"), {
		setHeaders: (res, filePath) => {
			if (filePath.endsWith(".css")) {
				res.setHeader("Content-Type", "text/css");
			}
		},
	}));

	// Clean URLs for terms and privacy
	app.get("/terms", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "terms", "index.html"));
	});

	app.get("/privacy", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "privacy", "index.html"));
	});

	app.get("/commands", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "commands", "index.html"));
	});

	app.get("/about", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "about", "index.html"));
	});

	// API route for stats
	app.get("/api/stats", async (req, res) => {
		try {
			const dbStats = await database.getGlobalStats();
			const serverCount = client?.guilds?.cache?.size || 0;

			res.json({
				users: dbStats.userCount,
				tables: dbStats.tableCount,
				servers: serverCount,
			});
		}
		catch (error) {
			console.error("Error fetching stats:", error);
			res.status(500).json({ error: "Failed to fetch stats" });
		}
	});

	app.get("/api/global-favorites", async (req, res) => {
		try {
			const allUserData = await database.getAllUserData();
			const characterCounts = {};
			const trackCounts = {};
			const vehicleCounts = {};
			let usersWithFavorites = 0;

			for (const user of allUserData) {
				const favorites = user?.favorites;
				if (!favorites) continue;
				usersWithFavorites++;

				const characterKey = normalizeCharacterKey(favorites.character?.name);
				if (characterKey) {
					characterCounts[characterKey] = (characterCounts[characterKey] || 0) + 1;
				}

				const trackKey = normalizeTrackKey(favorites.track);
				if (trackKey) {
					trackCounts[trackKey] = (trackCounts[trackKey] || 0) + 1;
				}

				const vehicleKey = normalizeVehicleKey(favorites.vehicle);
				if (vehicleKey) {
					vehicleCounts[vehicleKey] = (vehicleCounts[vehicleKey] || 0) + 1;
				}
			}

			const response = {
				tracks: buildTopFive(
					trackCounts,
					abbr => trackAbbreviationsToNames[abbr] || abbr,
					abbr => getTrackImagePath(abbr),
				),
				characters: buildTopFive(
					characterCounts,
					key => titleCaseWords(key),
					key => getCharacterImagePath(key),
				),
				vehicles: buildTopFive(
					vehicleCounts,
					key => titleCaseWords(key),
					key => getVehicleImagePath(key),
				),
				totalUsers: usersWithFavorites,
			};

			res.json(response);
		}
		catch (error) {
			console.error("Error building global favorites:", error);
			res.status(500).json({ error: "Failed to fetch favorites" });
		}
	});

	app.get("/api/command-stats", async (req, res) => {
		const allowedTimes = new Set(["alltime", "weekly", "season"]);
		const allowedQueues = new Set(["soloq", "squads", "both"]);
		const allowedPlayers = new Set(["12p", "24p", "both"]);
		const loungeId = "34653";

		const timeFilter = allowedTimes.has(String(req.query.time).toLowerCase()) ? String(req.query.time).toLowerCase() : "alltime";
		const queueFilter = allowedQueues.has(String(req.query.queue).toLowerCase()) ? String(req.query.queue).toLowerCase() : "both";
		const playerCountFilter = allowedPlayers.has(String(req.query.players).toLowerCase()) ? String(req.query.players).toLowerCase() : "both";

		const now = Date.now();
		const cached = previewSessionCache.get(loungeId);
		const session = cached && cached.expiresAt > now ? cached.session : null;
		const userData = cached && cached.expiresAt > now ? cached.userData : null;

		const discordUser = await fetchDiscordUser(loungeId);
		const displayName = discordUser ? (discordUser.globalName || discordUser.username) : "baby daisy";

		try {
			const renderResult = await StatsCommand.renderStats({
				interaction: null,
				target: { loungeId, displayName, discordUser },
				loungeId,
				serverId: null,
				queueFilter,
				playerCountFilter,
				timeFilter,
				session,
				userData,
				skipAutoUserAndMembership: true,
			});

			if (!renderResult?.success || !renderResult.pngBuffer) {
				return res.status(400).json({ error: renderResult?.message || "unable to render stats" });
			}

			previewSessionCache.set(loungeId, {
				session: renderResult.session || session || null,
				userData: renderResult.userData || userData || null,
				expiresAt: now + PREVIEW_SESSION_TTL_MS,
			});

			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			return res.send(renderResult.pngBuffer);
		}
		catch (error) {
			console.error("command-stats render error:", error);
			return res.status(500).json({ error: "failed to render stats" });
		}
	});

	app.get("/api/command-notables", async (req, res) => {
		const allowedTimes = new Set(["alltime", "weekly", "season"]);
		const allowedQueues = new Set(["soloq", "squads", "both"]);
		const allowedPlayers = new Set(["12p", "24p", "both"]);
		const loungeId = "45856";

		const timeFilter = allowedTimes.has(String(req.query.time).toLowerCase()) ? String(req.query.time).toLowerCase() : "alltime";
		const queueFilter = allowedQueues.has(String(req.query.queue).toLowerCase()) ? String(req.query.queue).toLowerCase() : "both";
		const playerCountFilter = allowedPlayers.has(String(req.query.players).toLowerCase()) ? String(req.query.players).toLowerCase() : "both";

		const now = Date.now();
		const cached = previewNotablesCache.get(loungeId);
		const session = cached && cached.expiresAt > now ? cached.session : null;
		const userData = cached && cached.expiresAt > now ? cached.userData : null;

		const discordUser = await fetchDiscordUser(loungeId);
		const displayName = discordUser ? (discordUser.globalName || discordUser.username) : "spike";

		try {
			const result = await NotablesCommand.generateNotables(
				null,
				{ loungeId, displayName, discordUser },
				null,
				queueFilter,
				playerCountFilter,
				timeFilter,
				null,
				{ session, userData, skipAutoUserAndMembership: true },
			);

			const attachment = result?.files?.[0];
			const pngBuffer = attachment?.attachment || attachment?.data || null;

			if (!result?.success || !pngBuffer) {
				return res.status(400).json({ error: result?.message || "unable to render notables" });
			}

			previewNotablesCache.set(loungeId, {
				session: result.session || session || null,
				userData: result.userData || userData || null,
				expiresAt: now + PREVIEW_SESSION_TTL_MS,
			});

			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			return res.send(pngBuffer);
		}
		catch (error) {
			console.error("command-notables render error:", error);
			return res.status(500).json({ error: "failed to render notables" });
		}
	});

	app.get("/api/command-rank-stats", async (req, res) => {
		const allowedTimes = new Set(["alltime", "weekly", "season"]);
		const allowedQueues = new Set(["soloq", "squads", "both"]);
		const allowedPlayers = new Set(["12p", "24p", "both"]);
		const loungeId = "42834";

		const timeFilter = allowedTimes.has(String(req.query.time).toLowerCase()) ? String(req.query.time).toLowerCase() : "alltime";
		const queueFilter = allowedQueues.has(String(req.query.queue).toLowerCase()) ? String(req.query.queue).toLowerCase() : "both";
		const playerCountFilter = allowedPlayers.has(String(req.query.players).toLowerCase()) ? String(req.query.players).toLowerCase() : "both";

		const now = Date.now();
		const cached = previewRankStatsCache.get(loungeId);
		const session = cached && cached.expiresAt > now ? cached.session : null;
		const userData = cached && cached.expiresAt > now ? cached.userData : null;

		const discordUser = await fetchDiscordUser(loungeId);
		const displayName = discordUser ? (discordUser.globalName || discordUser.username) : "nabbit";

		try {
			const result = await RankStatsCommand.generateRankStats(null, { loungeId, displayName, discordUser }, null, null, {
				session,
				filters: { timeFilter, queueFilter, playerCountFilter },
				userData,
				skipAutoUserAndMembership: true,
			});

			const attachment = result?.attachment || (Array.isArray(result?.files) ? result.files[0] : null);
			const pngBuffer = attachment?.attachment || attachment?.data || null;

			if (!result?.success || !pngBuffer) {
				return res.status(400).json({ error: result?.message || "unable to render rank-stats" });
			}

			previewRankStatsCache.set(loungeId, {
				session: result.session || session || null,
				userData: result.userData || userData || null,
				expiresAt: now + PREVIEW_SESSION_TTL_MS,
			});

			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			return res.send(pngBuffer);
		}
		catch (error) {
			console.error("command-rank-stats render error:", error);
			return res.status(500).json({ error: "failed to render rank-stats" });
		}
	});

	app.get("/api/command-head-to-head", async (req, res) => {
		const allowedTimes = new Set(["alltime", "weekly", "season"]);
		const allowedQueues = new Set(["soloq", "squads", "both"]);
		const allowedPlayers = new Set(["12p", "24p", "both"]);
		const loungeIdLeft = "27536"; // Bowser
		const loungeIdRight = "56207"; // Wario

		const timeFilter = allowedTimes.has(String(req.query.time).toLowerCase()) ? String(req.query.time).toLowerCase() : "alltime";
		const queueFilter = allowedQueues.has(String(req.query.queue).toLowerCase()) ? String(req.query.queue).toLowerCase() : "both";
		const playerCountFilter = allowedPlayers.has(String(req.query.players).toLowerCase()) ? String(req.query.players).toLowerCase() : "both";

		const now = Date.now();
		const cacheKey = `${loungeIdLeft}-${loungeIdRight}`;
		const cached = previewHeadToHeadCache.get(cacheKey);
		const session = cached && cached.expiresAt > now ? cached.session : null;

		const discordUserLeft = await fetchDiscordUser(loungeIdLeft);
		const displayNameLeft = discordUserLeft ? (discordUserLeft.globalName || discordUserLeft.username) : "bowser";

		const discordUserRight = await fetchDiscordUser(loungeIdRight);
		const displayNameRight = discordUserRight ? (discordUserRight.globalName || discordUserRight.username) : "wario";

		const interactionStub = {
			guildId: null,
			editReply: async () => null,
		};

		try {
			const result = await HeadToHeadCommand.generateHeadToHead(
				interactionStub,
				{
					playerLeft: { loungeId: loungeIdLeft, displayName: displayNameLeft, discordUser: discordUserLeft },
					playerRight: { loungeId: loungeIdRight, displayName: displayNameRight, discordUser: discordUserRight },
					filters: { timeFilter, queueFilter, playerCountFilter },
					session,
				},
			);

			const attachment = result?.files?.[0];
			const pngBuffer = attachment?.attachment || attachment?.data || null;

			if (!result?.success || !pngBuffer) {
				return res.status(400).json({ error: result?.message || "unable to render head-to-head" });
			}

			previewHeadToHeadCache.set(cacheKey, {
				session: result.session || session || null,
				expiresAt: now + PREVIEW_SESSION_TTL_MS,
			});

			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			return res.send(pngBuffer);
		}
		catch (error) {
			console.error("command-head-to-head render error:", error);
			return res.status(500).json({ error: "failed to render head-to-head" });
		}
	});

	app.get("/health", (req, res) => {
		res.json({
			status: "healthy",
			bot: client?.user ? "online" : "offline",
			guilds: client?.guilds?.cache?.size || 0,
		});
	});

	app.listen(PORT, () => {
		console.log(`Website running on port ${PORT}`);
	});
}

module.exports = { startSite };
