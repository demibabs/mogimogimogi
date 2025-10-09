const { SlashCommandBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("reload")
		.setDescription("reloads a command or all commands.")
		.addStringOption((option) => option.setName("command").setDescription("The command to reload, or 'all' to reload everything.").setRequired(true)),
	async execute(interaction) {
		const commandName = interaction.options.getString("command", true).toLowerCase();

		// Handle reload all commands
		if (commandName === "all") {
			await interaction.deferReply();

			const commandsPath = path.join(__dirname, "..");
			let reloadedCount = 0;
			let failedCount = 0;
			const failedCommands = [];

			const reloadAllCommands = (dir) => {
				const items = fs.readdirSync(dir);
				for (const item of items) {
					const fullPath = path.join(dir, item);
					if (fs.statSync(fullPath).isDirectory()) {
						reloadAllCommands(fullPath);
					}
					else if (item.endsWith(".js")) {
						try {
							// Clear from cache
							delete require.cache[require.resolve(fullPath)];

							// Reload the command
							const newCommand = require(fullPath);
							if ("data" in newCommand && "execute" in newCommand) {
								interaction.client.commands.set(newCommand.data.name, newCommand);
								reloadedCount++;
							}
						}
						catch (error) {
							console.error(`Failed to reload ${item}:`, error);
							failedCommands.push(item);
							failedCount++;
						}
					}
				}
			};

			reloadAllCommands(commandsPath);

			let message = `Successfully reloaded ${reloadedCount} commands! :)`;
			if (failedCount > 0) {
				message += `\nFailed to reload ${failedCount} commands: ${failedCommands.join(", ")} :(`;
			}

			return await interaction.editReply(message);
		}

		// Handle single command reload
		const command = interaction.client.commands.get(commandName);

		if (!command) {
			return interaction.reply(`There is no command with name \`${commandName}\`!`);
		}

		// Find the command file in all subdirectories
		const commandsPath = path.join(__dirname, "..");
		let commandFilePath = null;

		const searchForCommand = (dir) => {
			const items = fs.readdirSync(dir);
			for (const item of items) {
				const fullPath = path.join(dir, item);
				if (fs.statSync(fullPath).isDirectory()) {
					searchForCommand(fullPath);
				}
				else if (item === `${commandName}.js`) {
					commandFilePath = fullPath;
					return;
				}
			}
		};

		searchForCommand(commandsPath);

		if (!commandFilePath) {
			return interaction.reply(`Could not find command file for \`${commandName}\`!`);
		}

		delete require.cache[require.resolve(commandFilePath)];

		try {
			const newCommand = require(commandFilePath);
			interaction.client.commands.set(newCommand.data.name, newCommand);
			await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
		}
		catch (error) {
			console.error(error);
			await interaction.reply(
				`There was an error while reloading a command \`${command.data.name}\`:\n\`${error.message}\``,
			);
		}
	},
};
