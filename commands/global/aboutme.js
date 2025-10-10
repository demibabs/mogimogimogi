const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("aboutme")
		.setDescription("show bot deployment stats: servers, users, tables."),

	async execute(interaction) {
		await interaction.deferReply();

		// Count servers
		const serversDir = path.join(__dirname, "../../data/servers");
		let serverFiles = [];
		try {
			serverFiles = fs.readdirSync(serversDir).filter(f => f.endsWith(".json"));
		}
		catch (e) {}
		const serverCount = serverFiles.length;

		// Count users and tables
		let userCount = 0;
		let tableCount = 0;
		for (const file of serverFiles) {
			try {
				const data = JSON.parse(fs.readFileSync(path.join(serversDir, file), "utf8"));
				if (data.users) userCount += Object.keys(data.users).length;
				if (data.tables) tableCount += Object.keys(data.tables).length;
			}
			catch (e) {}
		}

		// Count all tables (across all servers)
		const tablesDir = path.join(__dirname, "../../data/tables");
		let allTableFiles = [];
		try {
			allTableFiles = fs.readdirSync(tablesDir).filter(f => f.endsWith(".json"));
		}
		catch (e) {}
		const allTableCount = allTableFiles.length;

		const embed = new EmbedBuilder()
			.setTitle("about me")
			.setColor("Aqua")
			.setDescription("bot for tracking server-wide lounge stats.")
			.addFields(
				{ name: "servers:", value: String(serverCount), inline: true },
				{ name: "users tracked:", value: String(userCount), inline: true },
				{ name: "tables tracked:", value: String(allTableCount), inline: true },
			)
			.setFooter({ text: "by @crashwy (contact me for any issues)" })
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	},
};
