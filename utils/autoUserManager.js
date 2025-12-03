/**
 * Auto User Manager
 * Handles automatic user detection and addition to server data
 */

const DataManager = require("./dataManager");
const LoungeApi = require("./loungeApi");
const database = require("./database");

class AutoUserManager {
	static async ensureServerReady(serverId) {
		try {
			const [serverDataRaw, setupState] = await Promise.all([
				database.getServerData(serverId),
				database.getServerSetupState(serverId),
			]);
			const serverData = serverDataRaw || { users: {}, discordIndex: {} };
			const hasStoredUsers = Object.keys(serverData.users || {}).length > 0;
			const setupCompleted = Boolean(setupState?.completed);
			if (!hasStoredUsers && !setupCompleted) {
				return {
					success: false,
					needsSetup: true,
					message: "this server hasn't been set up yet. please run `/setup` first.",
				};
			}
			return {
				success: true,
				serverData,
				setupState,
			};
		}
		catch (error) {
			console.error(`Error validating server readiness for ${serverId}:`, error);
			return {
				success: false,
				message: "unable to check this server's setup status right now.",
				needsSetup: false,
			};
		}
	}

	/**
	 * Check if user exists in server data, and auto-add them if they have a lounge account
	 * @param {string} userId - Discord user ID
	 * @param {string} serverId - Discord server ID
	 * @param {Object} client - Discord client
	 * @returns {Promise<Object>} Result with success status and message
	 */
	static async ensureUserExists(userId, serverId, client) {
		try {
	       const readiness = await this.ensureServerReady(serverId);
	       if (!readiness.success) {
	       	return readiness;
	       }
	       const serverData = readiness.serverData || { users: {}, discordIndex: {} };

	       // Check if user already exists in server data
	       if (serverData.discordIndex && serverData.discordIndex[userId]) {
		       return {
			       success: true,
			       message: "user already exists in server data",
		       };
	       }

	       // User doesn't exist - check if they have a lounge account
	       console.log(`user ${userId} not found in server ${serverId}, checking for lounge account...`);

	       const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

	       if (!loungeUser) {
		       return {
			       success: false,
			       needsSetup: false,
			       message: "you don't have a mario kart world lounge account linked to your discord.",
		       };
	       }

	       // User has a lounge account - add them automatically
	       console.log(`found lounge account for ${userId} (${loungeUser.name}), adding to server...`);

	       await DataManager.addServerUser(serverId, userId, client);

	       console.log(`successfully added user ${userId} (${loungeUser.name}) to server ${serverId}`);

	       return {
		       success: true,
		       wasAdded: true,
		       message: `automatically added you to the server! welcome, ${loungeUser.name}! 🎉`,
	       };

		}
		catch (error) {
			console.error(`error ensuring user exists: ${userId} in server ${serverId}:`, error);

			// Handle specific error cases
			if (error.message?.includes("404")) {
				return {
					success: false,
					needsSetup: false,
					message: "couldn't find your lounge account.",
				};
			}
			else if (error.message?.includes("fetch") || error.message?.includes("ENOTFOUND")) {
				return {
					success: false,
					needsSetup: false,
					message: "couldn't connect to the mkw lounge api. please try again later.",
				};
			}

			return {
				success: false,
				needsSetup: false,
				message: "an error occurred while checking your account. please try again.",
			};
		}
	}

	static async handleGuildMemberAdd(member) {
		const serverId = member?.guild?.id;
		const userId = member?.user?.id || member?.id;
		if (!serverId || !userId) {
			return;
		}
		try {
			const result = await this.ensureUserExists(userId, serverId, member.client);
			if (!result.success && !result.needsSetup) {
				console.log(`member ${userId} joined ${serverId} but was not added: ${result.message}`);
			}
		}
		catch (error) {
			console.error(`failed to auto-add member ${userId} in server ${serverId}:`, error);
		}
	}

	static async handleGuildMemberRemove(member) {
		const serverId = member?.guild?.id;
		const userId = member?.user?.id || member?.id;
		if (!serverId || !userId) {
			return;
		}
		try {
			const removed = await DataManager.removeServerUser(serverId, { discordId: userId });
			if (!removed) {
				console.log(`member ${userId} left ${serverId}, no stored server data to update`);
			}
		}
		catch (error) {
			console.error(`failed to remove member ${userId} from server ${serverId}:`, error);
		}
	}

	static async ensureUserAndMembership({
		interaction,
		target,
		serverId,
		serverData,
		loungeId,
		loungeName,
		displayName,
		discordUser,
		storedRecord,
		fallbackName,
		playerDetails = null,
	}) {
		const normalizedLoungeId = String(loungeId);
		const ensureResult = await DataManager.ensureUserRecord({
			loungeId: normalizedLoungeId,
			loungeName,
			serverId,
			client: interaction.client,
			guild: interaction.guild ?? null,
			loungeProfileOverride: playerDetails,
		});

		if (ensureResult?.userRecord) {
			if (!storedRecord && ensureResult.userRecord.servers?.includes(serverId)) {
				storedRecord = ensureResult.userRecord;
				if (serverData) {
					serverData.users = {
						...serverData.users,
						[normalizedLoungeId]: ensureResult.userRecord,
					};
				}
			}
			else if (storedRecord && ensureResult.userRecord.servers?.includes(serverId)) {
				storedRecord = ensureResult.userRecord;
				if (serverData) {
					serverData.users[normalizedLoungeId] = ensureResult.userRecord;
				}
			}
			if (!target.loungeName && ensureResult.userRecord.loungeName) {
				target.loungeName = ensureResult.userRecord.loungeName;
			}
			if (!target.displayName && ensureResult.userRecord.username) {
				target.displayName = ensureResult.userRecord.username;
			}
			if (!loungeName && ensureResult.userRecord.loungeName) {
				loungeName = ensureResult.userRecord.loungeName;
			}
		}

		if (ensureResult?.discordUser && !discordUser) {
			discordUser = ensureResult.discordUser;
			const discordName = ensureResult.discordUser.displayName || ensureResult.discordUser.username;
			if (discordName) {
				target.displayName = discordName;
			}
		}
		if (ensureResult?.loungeProfile?.name && (!loungeName || loungeName === fallbackName)) {
			loungeName = ensureResult.loungeProfile.name;
		}
		displayName = target.displayName || loungeName || fallbackName;
		loungeName = loungeName || fallbackName;

		const candidateDiscordIds = new Set([
			discordUser?.id,
			...(storedRecord?.discordIds || []),
		]);
		if (ensureResult?.guildMember && ensureResult.discordId) {
			candidateDiscordIds.add(ensureResult.discordId);
		}

		const membershipCache = new Map();
		const guild = interaction.guild ?? null;
		const isKnownServerMember = (discordId, record) => {
			if (!discordId) return false;
			if (!record) return false;
			if (!record.servers?.includes(serverId)) return false;
			if (!record.discordIds?.includes(discordId)) return false;
			return true;
		};
		const ensureGuildMembership = async discordId => {
			if (!guild || !discordId) return false;
			const key = String(discordId);
			if (membershipCache.has(key)) {
				return membershipCache.get(key);
			}
			if (guild.members.cache.has(key)) {
				membershipCache.set(key, true);
				return true;
			}
			try {
				const member = await guild.members.fetch({ user: key, cache: true, force: false });
				const result = Boolean(member);
				membershipCache.set(key, result);
				return result;
			}
			catch (error) {
				if (error.code === 10007 || error.status === 404) {
					membershipCache.set(key, false);
					return false;
				}
				console.warn(`failed guild membership check for ${key}:`, error);
				membershipCache.set(key, false);
				return false;
			}
		};

		for (const candidateId of candidateDiscordIds) {
			const normalizedId = candidateId ? String(candidateId) : null;
			if (!normalizedId) continue;

			let isMember = isKnownServerMember(normalizedId, storedRecord);
			if (!isMember) {
				isMember = await ensureGuildMembership(normalizedId);
			}
			if (!isMember) continue;

			try {
				const updated = await DataManager.updateServerUser(serverId, normalizedId, interaction.client, playerDetails);
				if (updated) {
					break;
				}
			}
			catch (error) {
				console.warn(`failed to update user ${normalizedId}:`, error);
			}
		}

		return {
			serverData,
			target,
			loungeName,
			displayName,
			discordUser,
			storedRecord,
		};
	}
}

module.exports = AutoUserManager;
