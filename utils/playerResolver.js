const Database = require("./database");
const LoungeApi = require("./loungeApi");

async function resolveTargetPlayer(interaction, {
	rawInput = null,
	loungeId = null,
	defaultToInvoker = false,
	serverData: serverDataOverride = null,
} = {}) {
	const serverId = interaction.guildId;
	const serverData = serverDataOverride || await Database.getServerData(serverId);
	const invokingUser = interaction.user;
	const trimmedInput = typeof rawInput === "string" ? rawInput.trim() : "";
	let targetLoungeId = loungeId != null ? String(loungeId).trim() : null;
	let loungeName = null;
	let discordUser = null;
	let displayName = null;

	if (targetLoungeId && !targetLoungeId.length) {
		targetLoungeId = null;
	}

	if (!targetLoungeId && trimmedInput) {
		if (/^\d+$/.test(trimmedInput)) {
			targetLoungeId = trimmedInput;
		}
	}

	if (!targetLoungeId && trimmedInput) {
		const lower = trimmedInput.toLowerCase();
		const matched = Object.values(serverData?.users || {}).find(user =>
			user?.loungeName && user.loungeName.toLowerCase() === lower,
		);
		if (matched) {
			targetLoungeId = String(matched.loungeId ?? matched.id ?? matched);
			loungeName = matched.loungeName || loungeName;
		}
	}

	if (!targetLoungeId && trimmedInput) {
		try {
			const lookup = await LoungeApi.getPlayer(trimmedInput);
			if (lookup?.id) {
				targetLoungeId = String(lookup.id);
				loungeName = lookup.name ?? loungeName;
			}
		}
		catch (error) {
			console.warn(`lounge player lookup for "${trimmedInput}" failed:`, error);
		}
	}

	if (!targetLoungeId && defaultToInvoker) {
		const mappedId = serverData?.discordIndex?.[String(invokingUser.id)];
		if (mappedId) {
			targetLoungeId = String(mappedId);
			const stored = serverData?.users?.[targetLoungeId];
			if (stored?.loungeName) {
				loungeName = stored.loungeName;
			}
		}
		if (!targetLoungeId) {
			try {
				const loungeUser = await LoungeApi.getPlayerByDiscordId(invokingUser.id);
				if (loungeUser?.id) {
					targetLoungeId = String(loungeUser.id);
					loungeName = loungeUser.name ?? loungeName;
				}
			}
			catch (error) {
				console.warn(`failed to resolve lounge profile for ${invokingUser.id}:`, error);
			}
		}
		discordUser = invokingUser;
		displayName = invokingUser.displayName;
	}

	if (!targetLoungeId) {
		if (trimmedInput) {
			return { error: `couldn't find lounge player "${trimmedInput}".` };
		}
		return { error: "couldn't determine which player to show." };
	}

	const storedRecord = serverData?.users?.[String(targetLoungeId)];
	if (!loungeName && storedRecord?.loungeName) {
		loungeName = storedRecord.loungeName;
	}

	if (!discordUser && storedRecord?.discordIds?.length) {
		for (const discordId of storedRecord.discordIds) {
			try {
				const fetched = await interaction.client.users.fetch(discordId);
				if (fetched) {
					discordUser = fetched;
					displayName = fetched.displayName;
					break;
				}
			}
			catch (error) {
				console.warn(`failed to fetch linked discord user ${discordId} for lounge ${targetLoungeId}:`, error);
			}
		}
	}

	if (!loungeName) {
		try {
			const player = await LoungeApi.getPlayerByLoungeId(targetLoungeId);
			if (player?.name) {
				loungeName = player.name;
			}
		}
		catch (error) {
			console.warn(`failed to load lounge player ${targetLoungeId}:`, error);
		}
	}

	if (!loungeName) {
		loungeName = `player ${targetLoungeId}`;
	}
	if (!displayName) {
		displayName = loungeName;
	}

	return {
		loungeId: String(targetLoungeId),
		loungeName,
		discordUser,
		displayName,
	};
}

module.exports = resolveTargetPlayer;
