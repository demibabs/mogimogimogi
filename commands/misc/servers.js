const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require("discord.js");
const database = require("../../utils/database");

const MAX_DESCRIPTION_LENGTH = 4096;
const SESSION_IDLE_MS = 120_000;
const paginationSessions = new Map();

module.exports = {
	data: new SlashCommandBuilder()
		.setName("servers")
		.setDescription("List all deployed servers with member counts (testing only)."),

	async execute(interaction) {
		await interaction.deferReply();

		const guilds = interaction.client.guilds.cache;

		// Build server info list using serverData.users for tracked users
		const serverInfos = await Promise.all(guilds.map(async guild => {
			// Tracked users count is no longer available as we don't store server data
			return `**${guild.name}**\nTotal Members: ${guild.memberCount}`;
		}));

		const pages = paginateServerInfos(serverInfos);
		const sessionKey = interaction.id;
		const totalPages = pages.length;
		const initialPayload = buildServersPayload(pages, 0, sessionKey);
		const replyMessage = await interaction.editReply(initialPayload);

		if (totalPages > 1 && replyMessage) {
			registerPaginationSession(sessionKey, {
				command: "servers",
				ownerId: interaction.user.id,
				pages,
				pageIndex: 0,
				message: replyMessage,
			});
		}
	},

	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("servers:")) {
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
		await interaction.update(buildServersPayload(session.pages, session.pageIndex, sessionKey));
		return true;
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

function buildServersPayload(pages, pageIndex, sessionKey) {
	const totalPages = pages.length;
	return {
		embeds: [buildServersEmbed(pages[pageIndex], pageIndex, totalPages)],
		components: totalPages > 1 ? [buildNavRow(pageIndex, totalPages, sessionKey)] : [],
	};
}

function buildNavRow(pageIndex, totalPages, sessionKey) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`servers:${sessionKey}:prev`)
			.setLabel("< Prev")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(pageIndex === 0),
		new ButtonBuilder()
			.setCustomId(`servers:${sessionKey}:next`)
			.setLabel("Next >")
			.setStyle(ButtonStyle.Secondary)
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
			console.warn("failed to cleanup pagination session:", error);
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
		console.warn("failed to remove pagination components:", error);
	}
}
