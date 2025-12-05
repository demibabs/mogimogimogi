const express = require("express");
const path = require("path");
const database = require("../bot/utils/database");

function startSite(client) {
	const app = express();
	const PORT = process.env.PORT || 3000;

	// Serve static files from public directory
	app.use(express.static(path.join(__dirname, "public")));

	// API route for stats
	app.get("/api/stats", async (req, res) => {
		try {
			const dbStats = await database.getGlobalStats();
			const serverCount = client?.guilds?.cache?.size || 0;
			
			res.json({
				users: dbStats.userCount,
				tables: dbStats.tableCount,
				servers: serverCount
			});
		} catch (error) {
			console.error("Error fetching stats:", error);
			res.status(500).json({ error: "Failed to fetch stats" });
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
