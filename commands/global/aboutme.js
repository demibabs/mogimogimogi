const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("aboutme")
		.setDescription("show bot deployment stats: servers, users, tables."),

	async execute(interaction) {
		await interaction.deferReply();


		   // Query database for user and table stats
		   let userCount = 0;
		   let tableCount = 0;
		   try {
			   // Users
			   const userRes = await database.pool.query("SELECT COUNT(DISTINCT user_id) FROM user_tables");
			   userCount = parseInt(userRes.rows[0].count);
			   // Tables
			   const tableRes = await database.pool.query("SELECT COUNT(*) FROM tables");
			   tableCount = parseInt(tableRes.rows[0].count);
		   } catch (e) {
			   // fallback to 0s
		   }

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

		   await interaction.editReply({ embeds: [embed] });
	},
};
