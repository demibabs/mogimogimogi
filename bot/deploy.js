const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// Load environment variables
require("dotenv").config();

// Parse command line arguments
const args = process.argv.slice(2);

// Check if using development bot
const useDev = args.includes("--dev");
const clientID = useDev ? process.env.DEV_APP_ID : process.env.APP_ID;
const token = useDev ? process.env.DEV_DISCORD_TOKEN : process.env.DISCORD_TOKEN;
const guildID = process.env.GUILD_ID;

console.log(`Using ${useDev ? "DEVELOPMENT" : "PRODUCTION"} bot configuration`);

const rest = new REST().setToken(token);
const shouldClear = args.includes("--clear");
const shouldClearGuild = args.includes("--clear-guild");
const shouldClearAll = args.includes("--clear-all");
const deployAll = args.includes("--all");
const deployGlobal = args.includes("--global");
const specificCommand = args.find(arg => !arg.startsWith("--"));

// Function to load all commands
function loadAllCommands(commandsDir = "commands") {
	const commands = [];
	const foldersPath = path.join(__dirname, commandsDir);

	// Check if directory exists
	if (!fs.existsSync(foldersPath)) {
		console.log(`[WARNING] Commands directory "${commandsDir}" does not exist.`);
		return commands;
	}

	const commandFolders = fs.readdirSync(foldersPath);

	for (const folder of commandFolders) {
		const commandsPath = path.join(foldersPath, folder);

		// Skip if not a directory
		if (!fs.statSync(commandsPath).isDirectory()) continue;

		const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command = require(filePath);

			if ("data" in command && "execute" in command) {
				commands.push(command.data.toJSON());
			}
			else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
	}
	return commands;
}

// Function to load global commands only
function loadGlobalCommands() {
	const commands = [];
	const globalPath = path.join(__dirname, "commands", "global");

	// Check if global directory exists
	if (!fs.existsSync(globalPath)) {
		console.log("[WARNING] Global commands directory does not exist.");
		return commands;
	}

	const commandFiles = fs.readdirSync(globalPath).filter(file => file.endsWith(".js"));
	for (const file of commandFiles) {
		const filePath = path.join(globalPath, file);
		const command = require(filePath);

		if ("data" in command && "execute" in command) {
			commands.push(command.data.toJSON());
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
	return commands;
}

// Function to load specific command
function loadSpecificCommand(commandName) {
	const foldersPath = path.join(__dirname, "commands");
	const commandFolders = fs.readdirSync(foldersPath);

	for (const folder of commandFolders) {
		const commandsPath = path.join(foldersPath, folder);
		const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command = require(filePath);

			if ("data" in command && "execute" in command && command.data.name === commandName) {
				return [command.data.toJSON()];
			}
		}
	}
	return null;
}

(async () => {
	try {
		let commands = [];
		let isGlobal = false;
		let deploymentType = "";

		if (shouldClearAll) {
			// Clear both global and guild commands
			console.log("Started clearing all commands (global and test server)...");

			// Clear global commands
			await rest.put(Routes.applicationCommands(clientID), { body: [] });
			console.log("✓ Cleared global commands");

			// Clear guild commands
			await rest.put(Routes.applicationGuildCommands(clientID, guildID), { body: [] });
			console.log("✓ Cleared test server commands");

			console.log("Successfully cleared all commands!");
			return;
		}
		else if (shouldClear) {
			// Clear global commands only
			commands = [];
			isGlobal = true;
			deploymentType = "clearing global";
			console.log("Started deleting global application commands.");
		}
		else if (shouldClearGuild) {
			// Clear guild commands only
			commands = [];
			isGlobal = false;
			deploymentType = "clearing test server";
			console.log("Started deleting test server application commands.");
		}
		else if (specificCommand) {
			// Deploy specific command globally
			commands = loadSpecificCommand(specificCommand);
			if (!commands) {
				console.error(`Command "${specificCommand}" not found!`);
				process.exit(1);
			}
			isGlobal = true;
			deploymentType = `globally deploying "${specificCommand}"`;
			console.log(`Started deploying command "${specificCommand}" globally.`);
		}
		else if (deployGlobal) {
			// Deploy global commands globally
			commands = loadGlobalCommands();
			isGlobal = true;
			deploymentType = "globally deploying global commands";
			console.log(`Started deploying ${commands.length} global commands globally.`);
		}
		else if (deployAll) {
			// Deploy all commands globally
			commands = loadAllCommands();
			isGlobal = true;
			deploymentType = "globally deploying all";
			console.log(`Started deploying ${commands.length} commands globally.`);
		}
		else {
			// Default: Deploy all commands to test server only
			commands = loadAllCommands();
			isGlobal = false;
			deploymentType = "deploying to test server";
			console.log(`Started deploying ${commands.length} commands to test server (${guildID}).`);
		}

		// Choose the appropriate route
		const route = isGlobal
			? Routes.applicationCommands(clientID)
			: Routes.applicationGuildCommands(clientID, guildID);

		const data = await rest.put(route, { body: commands });

		if (shouldClear) {
			console.log("Successfully deleted global application commands.");
		}
		else if (shouldClearGuild) {
			console.log("Successfully deleted test server application commands.");
		}
		else if (specificCommand) {
			console.log(`Successfully deployed command "${specificCommand}" globally.`);
		}
		else if (deployGlobal) {
			console.log(`Successfully deployed ${data.length} global commands globally.`);
		}
		else if (deployAll) {
			console.log(`Successfully deployed ${data.length} commands globally.`);
		}
		else {
			console.log(`Successfully deployed ${data.length} commands to test server.`);
		}

		// Show usage help
		if (!shouldClear && !shouldClearGuild && !specificCommand && !deployGlobal && !deployAll) {
			console.log("\nUsage options:");
			console.log("  node deploy                 - Deploy all commands to test server");
			console.log("  node deploy <command>       - Deploy specific command globally");
			console.log("  node deploy --global        - Deploy commands/global globally");
			console.log("  node deploy --all           - Deploy all commands globally");
			console.log("  node deploy --clear         - Clear global commands only");
			console.log("  node deploy --clear-guild   - Clear test server commands only");
			console.log("  node deploy --clear-all     - Clear both global and test server commands");
			console.log("\nBot configuration:");
			console.log("  Add --dev to any command    - Use development bot instead of production");
		}
	}
	catch (error) {
		console.error(error);
	}
})();