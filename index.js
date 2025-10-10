const fs = require("node:fs");
const path = require("node:path");
const { Client, Events, GatewayIntentBits, Collection, MessageFlags, REST, ActivityType } = require("discord.js");

// Load environment variables
require("dotenv").config();

// Parse command line arguments
const args = process.argv.slice(2);

// Check if using development bot
const useDev = args.includes("--dev");
const token = useDev ? process.env.DEV_DISCORD_TOKEN : process.env.DISCORD_TOKEN;

console.log(`Starting ${useDev ? "DEVELOPMENT" : "PRODUCTION"} bot...`);

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

client.once(Events.ClientReady, readyClient => {
	client.user.setActivity({
		name: "your matches...",
		type: ActivityType.Watching,
	});
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
	console.log(`Received interaction: ${interaction.type}`);
	
	// Handle slash commands
	if (interaction.isChatInputCommand()) {
		console.log(`Chat input command: ${interaction.commandName}`);

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

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
		console.log(`Button interaction: ${interaction.customId}`);
		
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