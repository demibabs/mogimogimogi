const LoungeApi = require("./loungeApi");
const Database = require("./database");

async function resolveTargetPlayer(interaction, {
	rawInput = null,
	loungeId = null,
	defaultToInvoker = false,
} = {}) {
	const invokingUser = interaction.user;
	const trimmedInput = typeof rawInput === "string" ? rawInput.trim() : "";
	let targetLoungeId = loungeId != null ? String(loungeId).trim() : null;
	let loungeName = null;
	let discordUser = null;
	let displayName = null;

	if (targetLoungeId && !targetLoungeId.length) {
		targetLoungeId = null;
	}

	// 1. If we have a raw input, try to resolve it
	if (!targetLoungeId && trimmedInput) {
		// A. Is it a numeric ID?
		if (/^\d+$/.test(trimmedInput)) {
			// Could be a Lounge ID or a Discord ID.
			// Let's assume Lounge ID first if it's short, or check both?
			// Actually, Lounge IDs are usually short (e.g. 1234), Discord IDs are long (18 chars).
			if (trimmedInput.length > 10) {
				// Likely a Discord ID
				try {
					const cachedUser = await Database.getUserByDiscordId(trimmedInput);
					if (cachedUser?.loungeId) {
						targetLoungeId = cachedUser.loungeId;
						loungeName = cachedUser.loungeName;
					}
					else {
						const byDiscord = await LoungeApi.getPlayerByDiscordId(trimmedInput);
						if (byDiscord?.id) {
							targetLoungeId = String(byDiscord.id);
							loungeName = byDiscord.name;
							await Database.saveUserData(targetLoungeId, {
								loungeName: byDiscord.name,
								discordIds: [trimmedInput],
								countryCode: byDiscord.countryCode,
							});
						}
					}

					if (targetLoungeId) {
						// Try to fetch the Discord user to get their display name
						try {
							discordUser = await interaction.client.users.fetch(trimmedInput);
							displayName = discordUser.globalName || discordUser.username;
						}
						catch (e) { /* ignore */ }
					}
				}
				catch (e) { /* ignore */ }
			}
			else {
				// Likely a Lounge ID
				targetLoungeId = trimmedInput;
			}
		}

		// B. Is it a mention? <@123456789>
		if (!targetLoungeId) {
			const mentionMatch = trimmedInput.match(/^<@!?(\d+)>$/);
			if (mentionMatch) {
				const discordId = mentionMatch[1];
				try {
					const cachedUser = await Database.getUserByDiscordId(discordId);
					if (cachedUser?.loungeId) {
						targetLoungeId = cachedUser.loungeId;
						loungeName = cachedUser.loungeName;
					}
					else {
						const byDiscord = await LoungeApi.getPlayerByDiscordId(discordId);
						if (byDiscord?.id) {
							targetLoungeId = String(byDiscord.id);
							loungeName = byDiscord.name;
							await Database.saveUserData(targetLoungeId, {
								loungeName: byDiscord.name,
								discordIds: [discordId],
								countryCode: byDiscord.countryCode,
							});
						}
					}

					if (targetLoungeId) {
						try {
							discordUser = await interaction.client.users.fetch(discordId);
							displayName = discordUser.globalName || discordUser.username;
						}
						catch (e) { /* ignore */ }
					}
				}
				catch (e) { /* ignore */ }
			}
		}

		// C. Try searching by Lounge Name
		if (!targetLoungeId) {
			try {
				const lookup = await LoungeApi.getPlayer(trimmedInput);
				if (lookup?.id) {
					targetLoungeId = String(lookup.id);
					loungeName = lookup.name;
					if (lookup.discordId) {
						try {
							discordUser = await interaction.client.users.fetch(lookup.discordId);
							displayName = discordUser.globalName || discordUser.username;
						}
						catch (e) { /* ignore */ }
					}
				}
			}
			catch (error) {
				// console.warn(`lounge player lookup for "${trimmedInput}" failed:`, error);
			}
		}
	}

	// 2. If no target yet, and we should default to invoker
	if (!targetLoungeId && defaultToInvoker) {
		try {
			// Try cache first
			const cachedUser = await Database.getUserByDiscordId(invokingUser.id);
			if (cachedUser?.loungeId) {
				targetLoungeId = cachedUser.loungeId;
				loungeName = cachedUser.loungeName;
			}
			else {
				const loungeUser = await LoungeApi.getPlayerByDiscordId(invokingUser.id);
				if (loungeUser?.id) {
					targetLoungeId = String(loungeUser.id);
					loungeName = loungeUser.name;
					// Cache this result for future use
					await Database.saveUserData(targetLoungeId, {
						loungeName: loungeUser.name,
						discordIds: [invokingUser.id],
						countryCode: loungeUser.countryCode,
					});
				}
			}
		}
		catch (error) {
			// console.warn(`failed to resolve lounge profile for ${invokingUser.id}:`, error);
		}
		discordUser = invokingUser;
		displayName = invokingUser.globalName || invokingUser.username;
	}

	if (!targetLoungeId) {
		if (trimmedInput) {
			return { error: `couldn't find lounge player "${trimmedInput}".` };
		}
		return { error: "couldn't determine which player to show. try linking your discord to your lounge account." };
	}

	// 3. Final hydration if we have an ID but no name
	if (!loungeName || !discordUser) {
		try {
			// Try to find Discord ID from our DB first
			let storedDiscordId = null;
			try {
				const userData = await Database.getUserData(targetLoungeId);
				if (userData?.discordIds?.length) {
					storedDiscordId = userData.discordIds[0];
				}
				if (userData?.loungeName && !loungeName) {
					loungeName = userData.loungeName;
				}
			}
			catch (e) { /* ignore */ }

			// If not in DB, check API
			if (!loungeName || !storedDiscordId) {
				const player = await LoungeApi.getPlayerByLoungeId(targetLoungeId);
				if (player) {
					if (player.name && !loungeName) {
						loungeName = player.name;
					}
					if (player.discordId && !storedDiscordId) {
						storedDiscordId = String(player.discordId);
					}
				}
			}

			// If we found a Discord ID, fetch the user
			if (storedDiscordId && !discordUser) {
				try {
					discordUser = await interaction.client.users.fetch(storedDiscordId);
					displayName = discordUser.globalName || discordUser.username;
				}
				catch (e) { /* ignore */ }
			}
		}
		catch (error) {
			// console.warn(`failed to load lounge player ${targetLoungeId}:`, error);
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
