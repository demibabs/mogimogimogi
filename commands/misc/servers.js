const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require("discord.js");
const database = require("../../utils/database");

const MAX_DESCRIPTION_LENGTH = 4096;
const NAV_IDS = {
	prev: "servers_prev",
	next: "servers_next",
};
const COLLECTOR_IDLE_MS = 120_000;

module.exports = {
	data: new SlashCommandBuilder()
		.setName("servers")
		.setDescription("List all deployed servers with member counts (testing only)."),

	async execute(interaction) {
		await interaction.deferReply();

		const guilds = interaction.client.guilds.cache;

		// Build server info list using serverData.users for tracked users
		const serverInfos = await Promise.all(guilds.map(async guild => {
			let trackedCount = 0;
			try {
				const serverData = await database.getServerData(guild.id);
				trackedCount = serverData && serverData.users ? Object.keys(serverData.users).length : 0;
			}
			catch (e) {
				trackedCount = 0;
			}
			return `**${guild.name}**\nTracked Users: ${trackedCount}\nTotal Members: ${guild.memberCount}`;
		}));

		const pages = paginateServerInfos(serverInfos);
		let pageIndex = 0;
		const totalPages = pages.length;
		const buildPayload = () => ({
			embeds: [buildServersEmbed(pages[pageIndex], pageIndex, totalPages)],
			components: totalPages > 1 ? [buildNavRow(pageIndex, totalPages)] : [],
		});

		await interaction.editReply(buildPayload());
		let replyMessage = null;
		try {
			replyMessage = await interaction.fetchReply();
		}
		catch (error) {
			console.warn("failed to fetch reply message for pagination:", error);
		}

		if (totalPages > 1 && replyMessage && replyMessage.channel) {
			const collector = replyMessage.channel.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: COLLECTOR_IDLE_MS,
				filter: buttonInteraction =>
					buttonInteraction.message.id === replyMessage.id &&
					Object.values(NAV_IDS).includes(buttonInteraction.customId),
			});

			collector.on("collect", async buttonInteraction => {
				if (buttonInteraction.user.id !== interaction.user.id) {
					await buttonInteraction.reply({
						content: "Only the command invoker can use these buttons.",
						ephemeral: true,
					});
					return;
				}

				if (buttonInteraction.customId === NAV_IDS.prev && pageIndex > 0) {
					pageIndex -= 1;
				}
				else if (buttonInteraction.customId === NAV_IDS.next && pageIndex < totalPages - 1) {
					pageIndex += 1;
				}
				else {
					await buttonInteraction.deferUpdate();
					return;
				}

				await buttonInteraction.update(buildPayload());
			});

			collector.on("end", async () => {
				try {
					await replyMessage.edit({ components: [] });
				}
				catch (err) {
					console.warn("failed to clear pagination buttons:", err);
				}
			});
		}
	},
};

function paginateServerInfos(entries) {
	const sanitizedEntries = [];
	for (const entry of entries || []) {
		if (!entry) continue;
		if (entry.length <= MAX_DESCRIPTION_LENGTH) {
			sanitizedEntries.push(entry);
			continue;
		}
		for (const chunk of chunkString(entry, MAX_DESCRIPTION_LENGTH)) {
			sanitizedEntries.push(chunk);
		}
	}

	if (!sanitizedEntries.length) {
		return ["No servers found."];
	}

	const pages = [];
	let currentPage = "";
	for (const entry of sanitizedEntries) {
		if (!currentPage.length) {
			currentPage = entry;
			continue;
		}
		const candidate = `${currentPage}\n\n${entry}`;
		if (candidate.length > MAX_DESCRIPTION_LENGTH) {
			pages.push(currentPage);
			currentPage = entry;
		}
		else {
			currentPage = candidate;
		}
	}

	if (currentPage.length) {
		pages.push(currentPage);
	}

	return pages.length ? pages : ["No servers found."];
}

function chunkString(value, size) {
	const chunks = [];
	for (let index = 0; index < value.length; index += size) {
		chunks.push(value.slice(index, index + size));
	}
	return chunks;
}

function buildServersEmbed(description, pageIndex, totalPages) {
	const embed = new EmbedBuilder()
		.setTitle("Deployed Servers (Testing)")
		.setColor("Aqua")
		.setDescription(description || "No servers found.")
		.setTimestamp();

	const footerText = totalPages > 1
		? `Page ${pageIndex + 1}/${totalPages} • /servers (testing only)`
		: "/servers (testing only)";
	return embed.setFooter({ text: footerText });
}

function buildNavRow(pageIndex, totalPages) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(NAV_IDS.prev)
			.setLabel("< Prev")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(pageIndex === 0),
		new ButtonBuilder()
			.setCustomId(NAV_IDS.next)
			.setLabel("Next >")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(pageIndex >= totalPages - 1),
	);
}
