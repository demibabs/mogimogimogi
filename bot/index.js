const fs = require("node:fs");
const path = require("node:path");
const database = require("./utils/database");
const AutoUserManager = require("./utils/autoUserManager");
const { resolveCommandFromButtonId, isGlobalCommand, normalizeCommandName } = require("./utils/globalCommands");
const { Client, Events, GatewayIntentBits, Collection, MessageFlags, REST, ActivityType } = require("discord.js");

// Load environment variables
require("dotenv").config();

// Register custom fonts (Lexend) for canvas rendering before any drawing occurs
try {
	const Fonts = require("./utils/fonts");
	if (typeof Fonts?.init === "function") {
		Fonts.init();
	}
}
catch (e) {
	console.warn("Font registration skipped:", e?.message || e);
}

// Parse command line arguments
const args = process.argv.slice(2);

// Check if using development bot
const useDev = args.includes("--dev");
const token = useDev ? process.env.DEV_DISCORD_TOKEN : process.env.DISCORD_TOKEN;

console.log(`Starting ${useDev ? "DEVELOPMENT" : "PRODUCTION"} bot...`);

const OWNER_USER_ID = "437813284981309441";

function shouldTrackUsage(userId) {
	return typeof userId === "string" && userId.length > 0 && userId !== OWNER_USER_ID;
}

async function trackSlashCommandUsage(interaction, commandName) {
	if (!shouldTrackUsage(interaction.user?.id)) {
		return;
	}
	const normalizedName = normalizeCommandName(commandName);
	if (!normalizedName || !isGlobalCommand(normalizedName)) {
		return;
	}
	await database.recordCommandUsage(normalizedName, "slash");
}

async function trackButtonInteractionUsage(interaction) {
	if (!shouldTrackUsage(interaction.user?.id)) {
		return;
	}
	const resolvedCommandName = resolveCommandFromButtonId(interaction.customId);
	if (!resolvedCommandName) {
		return;
	}
	await database.recordCommandUsage(resolvedCommandName, "button");
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		// GatewayIntentBits.GuildMembers,
	],
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);

		if ("data" in command && "execute" in command) {
			client.commands.set(command.data.name, command);
			console.log(`Loaded command: ${command.data.name}`);
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const statusCommands = ["/stats", "/rank-stats", "/notables", "/head-to-head"];
let currentStatusIndex = 0;

function updatePresence() {
	const serverCount = client.guilds.cache.size;
	const command = statusCommands[currentStatusIndex];
	client.user.setActivity({
		name: `${command} • ${serverCount} servers`,
		type: ActivityType.Custom,
	});
	currentStatusIndex = (currentStatusIndex + 1) % statusCommands.length;
}

client.once(Events.ClientReady, async readyClient => {
	updatePresence();
	setInterval(updatePresence, 5000);
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);

	// Cache all members on startup
	/*
	console.log("Caching guild members...");
	for (const guild of client.guilds.cache.values()) {
		try {
			await guild.members.fetch();
			// console.log(`Cached members for guild: ${guild.name}`);
		}
		catch (error) {
			console.warn(`Failed to cache members for guild ${guild.id}:`, error);
		}
	}
	console.log("Member caching complete.");
	*/
});

client.on(Events.GuildCreate, async (guild) => {
	updatePresence();
	console.log(`Joined new guild: ${guild.id}.`);
	// try {
	// 	console.log(`Joined new guild: ${guild.id}. Caching members...`);
	// 	await guild.members.fetch();
	// 	console.log(`Cached members for ${guild.id}`);
	// }
	// catch (error) {
	// 	console.warn(`Failed to cache members for new guild ${guild.id}:`, error);
	// }
});
client.on(Events.GuildDelete, () => updatePresence());

// client.on(Events.GuildMemberAdd, async member => {
// 	try {
// 		// Ensure member is cached
// 		await member.fetch().catch((e) => console.warn("Failed to fetch member on join:", e));
// 		await AutoUserManager.handleGuildMemberAdd(member);
// 	}
// 	catch (error) {
// 		console.error("guildMemberAdd handler failed:", error);
// 	}
// });


client.on(Events.InteractionCreate, async interaction => {
	// if (interaction.user?.id !== OWNER_USER_ID) {
	// 	console.log(`Received interaction: ${interaction.type}`);
	// }

	if (interaction.isAutocomplete()) {
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command || typeof command.autocomplete !== "function") {
			console.warn(`No autocomplete handler for ${interaction.commandName}`);
			return;
		}

		try {
			await command.autocomplete(interaction);
		}
		catch (error) {
			console.error(`Error in autocomplete handler for ${interaction.commandName}:`, error);
		}
		return;
	}

	// Handle slash commands
	if (interaction.isChatInputCommand()) {
		const guildId = interaction.guild?.id || "DM";
		const userId = interaction.user?.id || "?";
		if (userId !== OWNER_USER_ID) {
			console.log(`Chat input command: ${interaction.toString()} | user: ${userId} | guild: ${guildId}`);
		}

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		await trackSlashCommandUsage(interaction, command.data?.name);

		try {
			await command.execute(interaction);
		}
		catch (error) {
			console.error(error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: "There was an error while executing this command!", flags: MessageFlags.Ephemeral });
			}
			else {
				await interaction.reply({ content: "There was an error while executing this command!", flags: MessageFlags.Ephemeral });
			}
		}
	}
	// Handle button interactions
	else if (interaction.isButton()) {
		const guildId = interaction.guild?.id || "DM";
		const userId = interaction.user?.id || "?";
		if (userId !== OWNER_USER_ID) {
			console.log(`Button interaction: ${interaction.customId} | user: ${userId} | guild: ${guildId}`);
		}

		await trackButtonInteractionUsage(interaction);

		// Check if any command can handle this button interaction
		let handled = false;
		try {
			for (const command of interaction.client.commands.values()) {
				if (command.handleButtonInteraction && typeof command.handleButtonInteraction === "function") {
					try {
						const result = await command.handleButtonInteraction(interaction);
						if (result) {
							handled = true;
							break;
						}
					}
					catch (error) {
						console.error(`Error in button handler for ${command.data.name}:`, error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({
								content: "There was an error while handling this button interaction!",
								flags: MessageFlags.Ephemeral,
							});
						}
						handled = true;
						break;
					}
				}
			}

			if (!handled) {
				console.warn(`No handler found for button interaction: ${interaction.customId}`);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: "This button interaction is no longer available.",
						flags: MessageFlags.Ephemeral,
					});
				}
			}
		}
		catch (error) {
			console.error("Unexpected error in button interaction handling:", error);
		}
	}
});

async function startBot() {
	try {
		await client.login(token);
	}
	catch (error) {
		console.error("Failed to login:", error);
		process.exit(1);
	}
}

// Handle graceful shutdown
// process.on("SIGINT", () => ShutdownHandler.shutdown(client));
// process.on("SIGTERM", () => ShutdownHandler.shutdown(client));

module.exports = { startBot, client };