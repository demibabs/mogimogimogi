/**
 * Auto User Manager
 * Handles automatic user detection and addition to server data
 */

const DataManager = require("./dataManager");
const LoungeApi = require("./loungeApi");
const database = require("./database");

class AutoUserManager {
	/**
	 * Check if user exists in server data, and auto-add them if they have a lounge account
	 * @param {string} userId - Discord user ID
	 * @param {string} serverId - Discord server ID
	 * @param {Object} client - Discord client
	 * @returns {Promise<Object>} Result with success status and message
	 */
	static async ensureUserExists(userId, serverId, client) {
		try {
	       // First check if server has any data at all
	       const serverData = await database.getServerData(serverId);
	       if (!serverData || !serverData.users || Object.keys(serverData.users).length === 0) {
		       return {
			       success: false,
			       needsSetup: true,
			       message: "this server hasn't been set up yet. please ask an admin to run `/setup` first.",
		       };
	       }

	       // Check if user already exists in server data
	       if (serverData.users[userId]) {
		       return {
			       success: true,
			       message: "user already exists in server data",
		       };
	       }

	       // User doesn't exist - check if they have a lounge account
	       console.log(`User ${userId} not found in server ${serverId}, checking for lounge account...`);

	       const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

	       if (!loungeUser) {
		       return {
			       success: false,
			       needsSetup: false,
			       message: "you don't have a mario kart world lounge account linked to your discord.",
		       };
	       }

	       // User has a lounge account - add them automatically
	       console.log(`Found lounge account for ${userId} (${loungeUser.name}), adding to server...`);

	       await DataManager.addServerUser(serverId, userId, client);

	       console.log(`Successfully added user ${userId} (${loungeUser.name}) to server ${serverId}`);

	       return {
		       success: true,
		       wasAdded: true,
		       message: `automatically added you to the server! welcome, ${loungeUser.name}! 🎉`,
	       };

		}
		catch (error) {
			console.error(`Error ensuring user exists: ${userId} in server ${serverId}:`, error);

			// Handle specific error cases
			if (error.message?.includes("404")) {
				return {
					success: false,
					needsSetup: false,
					message: "couldn't find your lounge account. please make sure your discord is linked at https://www.mariokartcentral.com/mkw/lounge/",
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

	/**
	 * Helper method specifically for command validation
	 * Returns a consistent object format for command usage
	 * @param {string} userId - Discord user ID
	 * @param {string} serverId - Discord server ID
	 * @param {Object} client - Discord client
	 * @returns {Promise<Object>} Object with success boolean and message if error
	 */
	static async validateUserForCommand(userId, serverId, client) {
		const result = await this.ensureUserExists(userId, serverId, client);

		if (result.success) {
			return { success: true };
		}

		return {
			success: false,
			message: result.message,
			needsSetup: result.needsSetup || false,
		};
	}
}

module.exports = AutoUserManager;