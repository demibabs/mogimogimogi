const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("servers")
		.setDescription("List all deployed servers with member counts (testing only)."),

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		// Fetch all guilds the bot is in
		const guilds = interaction.client.guilds.cache;

		// Fetch all user_tables entries
		let userTableRows = [];
		try {
			const userRes = await database.pool.query("SELECT user_id, server_id FROM user_tables");
			userTableRows = userRes.rows;
		} catch (e) {
			await interaction.editReply("Failed to fetch user data from database.");
			return;
		}

		// Map: server_id -> Set of user_ids
		const dbMembersByServer = {};
		for (const row of userTableRows) {
			if (!dbMembersByServer[row.server_id]) dbMembersByServer[row.server_id] = new Set();
			dbMembersByServer[row.server_id].add(row.user_id);
		}

		// Build server info list
		const serverInfos = guilds.map(guild => {
			const dbCount = dbMembersByServer[guild.id]?.size || 0;
			return `**${guild.name}**\nMembers in DB: ${dbCount}\nTotal Members: ${guild.memberCount}`;
		});

		const embed = new EmbedBuilder()
			.setTitle("Deployed Servers (Testing)")
			.setColor("Aqua")
			.setDescription(serverInfos.join("\n\n") || "No servers found.")
			.setFooter({ text: "/servers (testing only)" })
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	},
};
