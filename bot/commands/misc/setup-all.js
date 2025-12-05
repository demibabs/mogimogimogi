const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require("discord.js");
const DataManager = require("../../utils/dataManager");
const LoungeApi = require("../../utils/loungeApi");
const database = require("../../utils/database");

const MAX_DESCRIPTION_LENGTH = 4096;
const SESSION_IDLE_MS = 120_000;
const paginationSessions = new Map();

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
				const members = guild.members.cache;

				// We no longer track server-specific user lists, so we don't remove stale entries.
				// We just ensure all current members are cached globally.

				for (const [userId, member] of members) {
					if (member.user.bot) continue;
					considered++;
					try {
						// Check if already cached globally to avoid API spam
						const cached = await database.getUserByDiscordId(userId);
						if (cached) continue;

						const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);
						if (!loungeUser) continue;

						const ok = await DataManager.updateServerUser(guildId, userId, client, loungeUser);
						if (ok) {
							added++;
							totalAdded++;
						}
					}
					catch (err) {
						console.warn(`Failed add attempt for ${userId} in guild ${guildId}:`, err.message);
					}
				}
				perGuildSummary.push(`• ${guild.name}: scanned ${considered} members, cached ${added} new users`);
				try {
					await database.markServerSetupComplete(guildId, {
						initiatedBy: initiatorId,
						totalMembers: members.size,
						detectedLoungers: added, // This is now just "newly cached"
						addedUsers: added,
						removedUsers: 0,
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

		const header = `Setup-all complete. Cached ${totalAdded} new users across ${guilds.size} guild(s).`;
		const pages = buildSummaryPages(header, perGuildSummary);
		const sessionKey = interaction.id;
		const initialPayload = buildSummaryPayload(pages, 0, sessionKey);
		const replyMessage = await interaction.editReply(initialPayload);

		if (pages.length > 1 && replyMessage) {
			registerPaginationSession(sessionKey, {
				command: "setup-all",
				ownerId: interaction.user.id,
				pages,
				pageIndex: 0,
				message: replyMessage,
			});
		}
	},

	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("setupall:")) {
			return false;
		}

		const parts = interaction.customId.split(":");
		if (parts.length !== 3) {
			return false;
		}

		const [, sessionKey, direction] = parts;
		const session = paginationSessions.get(sessionKey);
		if (!session) {
			await interaction.reply({
				content: "This pagination session has expired.",
				ephemeral: true,
			});
			return true;
		}

		if (interaction.user.id !== session.ownerId) {
			await interaction.reply({
				content: "Only the command invoker can use these buttons.",
				ephemeral: true,
			});
			return true;
		}

		const totalPages = session.pages.length;
		let updated = false;
		if (direction === "prev" && session.pageIndex > 0) {
			session.pageIndex -= 1;
			updated = true;
		}
		else if (direction === "next" && session.pageIndex < totalPages - 1) {
			session.pageIndex += 1;
			updated = true;
		}

		if (!updated) {
			await interaction.deferUpdate();
			return true;
		}

		resetSessionTimer(sessionKey);
		await interaction.update(buildSummaryPayload(session.pages, session.pageIndex, sessionKey));
		return true;
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

function buildSummaryPayload(pages, pageIndex, sessionKey) {
	const totalPages = pages.length;
	return {
		embeds: [buildSummaryEmbed(pages[pageIndex], pageIndex, totalPages)],
		components: totalPages > 1 ? [buildNavRow(pageIndex, totalPages, sessionKey)] : [],
	};
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

function buildNavRow(pageIndex, totalPages, sessionKey) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`setupall:${sessionKey}:prev`)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("< Prev")
			.setDisabled(pageIndex === 0),
		new ButtonBuilder()
			.setCustomId(`setupall:${sessionKey}:next`)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("Next >")
			.setDisabled(pageIndex >= totalPages - 1),
	);
}

function registerPaginationSession(sessionKey, sessionData) {
	if (!sessionKey || !sessionData) return;
	const existing = paginationSessions.get(sessionKey);
	if (existing?.timeout) {
		clearTimeout(existing.timeout);
	}
	sessionData.timeout = null;
	paginationSessions.set(sessionKey, sessionData);
	resetSessionTimer(sessionKey);
}

function resetSessionTimer(sessionKey) {
	const session = paginationSessions.get(sessionKey);
	if (!session) return;
	if (session.timeout) {
		clearTimeout(session.timeout);
	}
	session.timeout = setTimeout(() => {
		cleanupPaginationSession(sessionKey).catch(error => {
			console.warn("setup-all: failed to cleanup pagination session:", error);
		});
	}, SESSION_IDLE_MS);
}

async function cleanupPaginationSession(sessionKey) {
	const session = paginationSessions.get(sessionKey);
	if (!session) return;
	if (session.timeout) {
		clearTimeout(session.timeout);
	}
	paginationSessions.delete(sessionKey);
	try {
		await session.message.edit({ components: [] });
	}
	catch (error) {
		console.warn("setup-all: failed to remove pagination components:", error);
	}
}
