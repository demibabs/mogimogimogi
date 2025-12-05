const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");

const GLOBAL_COMMANDS = [
	{ name: "/stats", description: "lounge stats card" },
	{ name: "/notables", description: "best and worst performances" },
	{ name: "/rank-stats", description: "stats broken down by the ranks of your opponents" },
	{ name: "/customize", description: "edit the appearance of the above commands" },
	{ name: "/head-to-head", description: "two players compared across shared mogis" },
	{ name: "/leaderboard", description: "server MMR leaderboard" },
	{ name: "/setup", description: "fetches + saves server members' lounge data so that the other commands work" },
	{ name: "/about-me", description: "this lol" },
];

module.exports = {
	data: new SlashCommandBuilder()
		.setName("about-me")
		.setDescription("see all commands + bot deployment data."),

	async execute(interaction) {
		await interaction.deferReply();


		   // Query database for table stats
		   let userCount = 0;
		   let tableCount = 0;
		   try {
			   // Tables
			   await interaction.editReply("tabulating tables...");
			   if (database.useDatabase && database.pool) {
				   const tableRes = await database.pool.query("SELECT COUNT(*) FROM tables");
				   tableCount = parseInt(tableRes.rows[0].count, 10);
			   }

			   await interaction.editReply("counting users...");
			   if (database.useDatabase && database.pool) {
				   const userRes = await database.pool.query("SELECT COUNT(*) FROM user_data");
				   userCount = parseInt(userRes.rows[0].count, 10);
			   }
			   else {
				   const userIds = await database.getAllUserIds();
				   userCount = userIds.length;
			   }
		   }
		catch (e) {
			   // fallback to 0s
		   }
		   await interaction.editReply("tallying servers...");
		   // Get server count directly from Discord client
		   const serverCount = interaction.client.guilds.cache.size;

		   const commandSummary = GLOBAL_COMMANDS
			   .map(entry => `• ${entry.name} – ${entry.description}`)
			   .join("\n");

		   const embed = new EmbedBuilder()
			   .setTitle("about me")
			   .setColor("Aqua")
			   .setDescription("detailed mario kart world lounge stats bot.")
			  .addFields(
				{ name: "commands", value: commandSummary, inline: false },
				  { name: "servers:", value: String(serverCount), inline: true },
				  { name: "users tracked:", value: String(userCount), inline: true },
				  { name: "tables tracked:", value: String(tableCount), inline: true },
			  )
			   .setFooter({ text: "by @crashwy (contact me for any issues)" })
			   .setTimestamp();

		   await interaction.editReply({ content: "", embeds: [embed] });
	},
};
