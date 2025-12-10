const { client } = require("./bot/index.js");
const LoungeApi = require("./bot/utils/loungeApi.js");

async function test() {
    console.log("Starting test...");
    const loungeId = "34653"; // Baby Daisy
    try {
        console.log(`Fetching player for ${loungeId}...`);
        const details = await LoungeApi.getPlayerByLoungeId(loungeId);
        console.log("Player Data:", details);

        if (details && details.discordId) {
            console.log(`Fetching Discord user ${details.discordId}...`);
            // We need to login to fetch user
            await client.login(process.env.DISCORD_TOKEN);
            const user = await client.users.fetch(details.discordId);
            console.log("User:", user.username);
        } else {
            console.log("No discordId found.");
        }
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

test();
