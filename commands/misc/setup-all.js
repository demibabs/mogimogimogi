const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");

const MAX_DESCRIPTION_LENGTH = 4096;
const NAV_IDS = {
	prev: "setupall_prev",
	next: "setupall_next",
};
const COLLECTOR_IDLE_MS = 120_000;

module.exports = {
	data: new SlashCommandBuilder()
		.setName("setup-all")
		.setDescription("Run setup across all servers: adds every member with a Lounge account."),

	async execute(interaction) {
		// Restrict to bot owner / privileged users if desired: ephemeral + simple guard
		await interaction.deferReply();
		await interaction.editReply("Starting multi-server setup...");

		const client = interaction.client;
		const initiatorId = interaction.user?.id || null;
		const guilds = client.guilds.cache;
		if (!guilds.size) {
			return interaction.editReply("No guilds found.");
		}

		let totalAdded = 0;
		let processedGuilds = 0;
		const perGuildSummary = [];

		for (const [guildId, guild] of guilds) {
			processedGuilds++;
			let added = 0;
			let considered = 0;
			try {
				await interaction.editReply(`Processing guild ${processedGuilds}/${guilds.size}: ${guild.name}`);
				const members = await guild.members.fetch();
				for (const [userId, member] of members) {
					if (member.user.bot) continue;
					considered++;
					try {
						const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
						if (!loungeUser) continue;
						// Add server user if not already associated
						const serverData = await database.getServerData(guildId);
						const already = Object.values(serverData.users || {}).some(u => (u.discordIds || []).includes(String(userId)));
						if (already) continue;
						const ok = await DataManager.addServerUser(guildId, userId, client);
						if (ok) {
							added++;
							totalAdded++;
						}
					}
					catch (err) {
						console.warn(`Failed add attempt for ${userId} in guild ${guildId}:`, err.message);
					}
				}
				perGuildSummary.push(`• ${guild.name}: added ${added} user(s) out of ${considered} member(s)`);
				try {
					await database.markServerSetupComplete(guildId, {
						initiatedBy: initiatorId,
						totalMembers: members.size,
						detectedLoungers: added,
						addedUsers: added,
						source: "setup-all",
					});
				}
				catch (stateError) {
					console.warn(`setup-all: failed to store setup metadata for ${guildId}:`, stateError);
				}
			}
			catch (error) {
				console.error(`Setup-all error for guild ${guildId}:`, error);
				perGuildSummary.push(`• ${guild.name}: error (${error.message})`);
			}
		}

		const header = `Setup-all complete. Added ${totalAdded} users across ${guilds.size} guild(s).`;
		const pages = buildSummaryPages(header, perGuildSummary);
		let pageIndex = 0;
		const totalPages = pages.length;
		const buildPayload = () => ({
			embeds: [buildSummaryEmbed(pages[pageIndex], pageIndex, totalPages)],
			components: totalPages > 1 ? [buildNavRow(pageIndex, totalPages)] : [],
		});

		await interaction.editReply(buildPayload());
		let replyMessage = null;
		try {
			replyMessage = await interaction.fetchReply();
		}
		catch (error) {
			console.warn("setup-all: failed to fetch reply message:", error);
		}

		if (totalPages > 1 && replyMessage) {
			const collector = replyMessage.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: COLLECTOR_IDLE_MS,
				filter: buttonInteraction =>
					buttonInteraction.user.id === interaction.user.id &&
					Object.values(NAV_IDS).includes(buttonInteraction.customId),
			});

			collector.on("collect", async buttonInteraction => {
				if (buttonInteraction.customId === NAV_IDS.prev && pageIndex > 0) {
					pageIndex -= 1;
				}
				else if (buttonInteraction.customId === NAV_IDS.next && pageIndex < totalPages - 1) {
					pageIndex += 1;
				}
				await buttonInteraction.update(buildPayload());
			});

			collector.on("end", async () => {
				try {
					await replyMessage.edit({ components: [] });
				}
				catch (error) {
					console.warn("setup-all: failed to clear buttons:", error);
				}
			});
		}
	},
};

function buildSummaryPages(header, entries) {
	const pages = [];
	const normalizedEntries = Array.isArray(entries) && entries.length
		? entries
		: ["No guilds processed."];
	let current = header;
	const availableForEntry = Math.max(1, MAX_DESCRIPTION_LENGTH - header.length - 2);

	for (const entry of normalizedEntries) {
		const candidate = `${current}\n\n${entry}`;
		if (candidate.length <= MAX_DESCRIPTION_LENGTH) {
			current = candidate;
			continue;
		}

		if (current !== header) {
			pages.push(current);
			current = header;
		}

		if (entry.length <= availableForEntry) {
			current = `${header}\n\n${entry}`;
			continue;
		}

		for (const chunk of chunkString(entry, availableForEntry)) {
			pages.push(`${header}\n\n${chunk}`);
		}
		current = header;
	}

	if (current.length && (current !== header || !pages.length)) {
		pages.push(current);
	}

	return pages.length ? pages : [header];
}

function chunkString(text, size) {
	if (size <= 0) return [text];
	const chunks = [];
	for (let index = 0; index < text.length; index += size) {
		chunks.push(text.slice(index, index + size));
	}
	return chunks;
}

function buildSummaryEmbed(description, pageIndex, totalPages) {
	const embed = new EmbedBuilder()
		.setTitle("Setup-all Summary")
		.setColor("Aqua")
		.setDescription(description.slice(0, MAX_DESCRIPTION_LENGTH))
		.setTimestamp();
	const footerText = totalPages > 1
		? `Page ${pageIndex + 1}/${totalPages}`
		: "/setup-all";
	return embed.setFooter({ text: footerText });
}

function buildNavRow(pageIndex, totalPages) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(NAV_IDS.prev)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("< Prev")
			.setDisabled(pageIndex === 0),
		new ButtonBuilder()
			.setCustomId(NAV_IDS.next)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("Next >")
			.setDisabled(pageIndex >= totalPages - 1),
	);
}
