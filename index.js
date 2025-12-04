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
		GatewayIntentBits.GuildMembers,
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

function updatePresence() {
	const serverCount = client.guilds.cache.size;
	client.user.setActivity({
		name: true ? "commands disabled temporarily (maintainance)" : `/head-to-head • ${serverCount} servers`,
		type: ActivityType.Custom,
	});
}

client.once(Events.ClientReady, readyClient => {
	updatePresence();
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.GuildCreate, () => updatePresence());
client.on(Events.GuildDelete, () => updatePresence());

client.on(Events.GuildMemberAdd, async member => {
	try {
		await AutoUserManager.handleGuildMemberAdd(member);
	}
	catch (error) {
		console.error("guildMemberAdd handler failed:", error);
	}
});

client.on(Events.GuildMemberRemove, async member => {
	try {
		await AutoUserManager.handleGuildMemberRemove(member);
	}
	catch (error) {
		console.error("guildMemberRemove handler failed:", error);
	}
});

client.on(Events.InteractionCreate, async interaction => {
	console.log(`Received interaction: ${interaction.type}`);

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
		const guildName = interaction.guild?.name || "DM";
		const displayName = interaction.member?.displayName || interaction.user?.globalName || "unknown";
		console.log(`Chat input command: ${interaction.commandName} | user: ${displayName} (${interaction.user?.id || "?"}) | guild: ${guildName}`);

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
		const guildName = interaction.guild?.name || "DM";
		const displayName = interaction.member?.displayName || interaction.user?.globalName || "unknown";
		console.log(`Button interaction: ${interaction.customId} | user: ${displayName} (${interaction.user?.id || "?"}) | guild: ${guildName}`);

		await trackButtonInteractionUsage(interaction);

		// Check if any command can handle this button interaction
		let handled = false;
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
});

// Simple web server for health checks (Railway requirement)
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
	res.json({
		status: "Bot is running!",
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	});
});

app.get("/health", (req, res) => {
	res.json({
		status: "healthy",
		bot: client.user ? "online" : "offline",
		guilds: client.guilds.cache.size,
	});
});

app.listen(PORT, () => {
	console.log(`Health check server running on port ${PORT}`);
});

client.login(token);