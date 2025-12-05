const { startBot, client } = require("./bot/index.js");
const { startSite } = require("./site/server.js");

(async () => {
	// Start the bot
	await startBot();

	// Start the website (passing the client for stats)
	startSite(client);
})();
