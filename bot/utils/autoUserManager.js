/**
 * Auto User Manager
 * Handles automatic user detection and addition to server data
 */

const DataManager = require("./dataManager");
const LoungeApi = require("./loungeApi");
const database = require("./database");

class AutoUserManager {
	static async ensureServerReady(serverId) {
		// Temporary bypass for setup requirement
		return {
			success: true,
			serverData: null,
			setupState: { completed: true },
		};
		/*
		const state = await database.getServerSetupState(serverId);
		if (state?.completed) {
			return {
				success: true,
				serverData: null,
				setupState: state,
			};
		}
		return {
			success: false,
			message: "this server hasn't been set up yet. please run </setup:1446020866356940867> to enable commands.",
		};
		*/
	}

	/**
	 * Check if user exists in server data, and auto-add them if they have a lounge account
	 * @param {string} userId - Discord user ID
	 * @param {string} serverId - Discord server ID
	 * @param {Object} client - Discord client
	 * @returns {Promise<Object>} Result with success status and message
	 */
	static async ensureUserExists(userId, serverId, client) {
		// No longer needed as we don't store server data
		return { success: true };
	}

	static async handleGuildMemberAdd(member) {
		try {
			const serverId = member.guild.id;
			const userId = member.user.id;
			const client = member.client;

			// Check if server is set up
			const setupState = await database.getServerSetupState(serverId);
			if (!setupState?.completed) {
				return; // Don't auto-add if server isn't set up
			}

			// console.log(`Auto-adding new member ${userId} to server ${serverId}`);
			await DataManager.updateServerUser(serverId, userId, client);
		}
		catch (error) {
			console.error("Error in handleGuildMemberAdd:", error);
		}
	}

	static async handleGuildMemberRemove(member) {
		// No longer needed
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
		// This function was used to sync local DB with API.
		// Now we just ensure the user record exists in the global user_data table if needed (for favorites etc).

		const normalizedLoungeId = String(loungeId);

		// We still want to ensure the user record exists for favorites/settings
		// But we don't care about server membership in the DB anymore.

		// If we have playerDetails, we can update the global user record
		if (playerDetails) {
			try {
				const existing = await database.getUserData(normalizedLoungeId);
				const payload = {
					...(existing || {}),
					loungeId: normalizedLoungeId,
					loungeName: playerDetails.name || existing?.loungeName,
					countryCode: playerDetails.countryCode || existing?.countryCode,
					discordIds: existing?.discordIds || [],
				};

				if (discordUser) {
					const dId = String(discordUser.id);
					if (!payload.discordIds.includes(dId)) {
						payload.discordIds.push(dId);
					}
				}

				await database.saveUserData(normalizedLoungeId, payload);
			}
			catch (e) {
				console.warn("failed to update user data in ensureUserAndMembership", e);
			}
		}

		return {
			serverData: null,
			target,
			loungeName: loungeName || fallbackName,
			displayName: displayName || fallbackName,
			discordUser,
			storedRecord: null,
		};
	}

	static async getCustomizeTip({ interaction, target, discordUser, favorites, userData, loungeId }) {
		// Only show tip on slash commands, not button interactions
		if (!interaction.isChatInputCommand()) return "";

		let tipMessage = "";
		const isSelf = interaction.user.id === (target.discordUser?.id || discordUser?.id);

		// Check if user has ANY favorites set (track, character, or vehicle)
		const hasAnyFavorites = favorites && (favorites.track || favorites.character || favorites.vehicle);

		if (isSelf && !hasAnyFavorites) {
			if (!userData) {
				try {
					userData = await database.getUserData(loungeId);
				}
				catch (e) {
					console.warn("failed to fetch user data for tip", e);
				}
			}

			if (userData && !userData.customizeTipShown) {
				tipMessage = "**note:** you can use </customize:1446020866356940861> to set the track in the bg (and add your favorite character and vehicle too!).\n\n";
				userData.customizeTipShown = true;
				console.log(`Customize tip shown to ${discordUser.id}`);
				try {
					await database.saveUserData(loungeId, userData);
				}
				catch (e) {
					console.warn("failed to save tip flag", e);
				}
			}
		}
		return tipMessage;
	}
}

module.exports = AutoUserManager;
