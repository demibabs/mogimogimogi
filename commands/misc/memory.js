const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("memory")
		.setDescription("inspect current memory usage (ram)"),

	async execute(interaction) {
		const usage = process.memoryUsage();

		// Helper to format bytes to MB
		const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

		const embed = new EmbedBuilder()
			.setTitle("Memory Usage")
			.setColor("DarkBlue")
			.addFields(
				{ 
					name: "RSS (Total)", 
					value: `${toMB(usage.rss)} MB`, 
					inline: true 
				},
				{ 
					name: "Heap Used (JS)", 
					value: `${toMB(usage.heapUsed)} MB`, 
					inline: true 
				},
				{ 
					name: "External (Native/Canvas)", 
					value: `${toMB(usage.external)} MB`, 
					inline: true 
				},
				{
					name: "Array Buffers",
					value: `${toMB(usage.arrayBuffers)} MB`,
					inline: true
				}
			)
			.setFooter({ text: "External memory usually contains Canvas images." })
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	},
};
