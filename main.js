const { startBot, client } = require("./bot/index.js");
const { startSite } = require("./site/server.js");
const ShutdownHandler = require("./bot/utils/shutdownHandler");

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("Received SIGINT in main.js");
	ShutdownHandler.shutdown(client);
});
process.on("SIGTERM", () => {
	console.log("Received SIGTERM in main.js");
	ShutdownHandler.shutdown(client);
});

(async () => {
	// Start the bot
	await startBot();

	// Start the website (passing the client for stats)
	startSite(client);
})();
