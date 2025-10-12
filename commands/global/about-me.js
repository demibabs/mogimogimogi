const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("about-me")
		.setDescription("show bot deployment stats: servers, users, tables."),

	async execute(interaction) {
		await interaction.deferReply();


		   // Query database for table stats
		   let userCount = 0;
		   let tableCount = 0;
		   try {
			   // Tables
			   await interaction.editReply("tabulating tables...");
			   const tableRes = await database.pool.query("SELECT COUNT(*) FROM tables");
			   tableCount = parseInt(tableRes.rows[0].count);

			   // Get all server IDs
			   await interaction.editReply("counting users...");
			   const serverIds = await database.getAllServerIds();
			   const uniqueUserIds = new Set();
			   for (const serverId of serverIds) {
				   try {
					   const serverData = await database.getServerData(serverId);
					   if (serverData && serverData.users) {
						   for (const userId of Object.keys(serverData.users)) {
							   uniqueUserIds.add(userId);
						   }
					   }
				   }
				catch (e) {}
			   }
			   userCount = uniqueUserIds.size;
		   }
		catch (e) {
			   // fallback to 0s
		   }
		   await interaction.editReply("tallying servers...");
		   // Get server count directly from Discord client
		   const serverCount = interaction.client.guilds.cache.size;

		   const embed = new EmbedBuilder()
			   .setTitle("about me")
			   .setColor("Aqua")
			   .setDescription("bot for tracking server-wide lounge stats.")
			  .addFields(
				  { name: "servers:", value: String(serverCount), inline: true },
				  { name: "users tracked:", value: String(userCount), inline: true },
				  { name: "tables tracked:", value: String(tableCount), inline: true },
			  )
			   .setFooter({ text: "by @crashwy (contact me for any issues)" })
			   .setTimestamp();

		   await interaction.editReply({ content: "", embeds: [embed] });
	},
};
