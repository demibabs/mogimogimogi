/**
 * Utility functions for enhancing embeds with player information
 */

/**
 * Convert country code to flag emoji
 * @param {string} countryCode - Two-letter country code (e.g., 'US', 'CA', 'GB')
 * @returns {string} Flag emoji or empty string if invalid
 */
function getCountryFlag(countryCode) {
	if (!countryCode || countryCode.length !== 2) {
		return "";
	}

	// Convert country code to regional indicator symbols (flag emojis)
	const codePoints = countryCode
		.toUpperCase()
		.split("")
		.map(char => 127397 + char.charCodeAt(0));

	return String.fromCodePoint(...codePoints);
}

/**
 * Format player name with country flag
 * @param {string} playerName - Player's name
 * @param {string} countryCode - Player's country code
 * @returns {string} Formatted name with flag
 */
function formatPlayerNameWithFlag(playerName, countryCode) {
	const flag = getCountryFlag(countryCode);
	return flag ? `${flag} ${playerName}` : playerName;
}

/**
 * Get player avatar URL from Discord user
 * @param {Object} discordUser - Discord user object
 * @returns {string|null} Avatar URL or null if not available
 */
function getPlayerAvatarUrl(discordUser) {
	if (!discordUser) return null;

	// Get Discord avatar URL
	return discordUser.displayAvatarURL({ dynamic: true, size: 256 });
}

/**
 * Enhance embed with player information (avatar and country flag in title/author)
 * @param {EmbedBuilder} embed - Discord embed builder
 * @param {Object} loungeUser - Player data from lounge API
 * @param {string} originalTitle - Original embed title
 * @returns {EmbedBuilder} Enhanced embed
 */
function enhanceEmbedWithPlayerInfo(embed, loungeUser, originalTitle) {
	const flag = getCountryFlag(loungeUser?.countryCode);
	const avatarUrl = getPlayerAvatarUrl(loungeUser);

	// Add flag to title if available
	const enhancedTitle = flag ? `${flag} ${originalTitle}` : originalTitle;
	embed.setTitle(enhancedTitle);

	// Set thumbnail to player avatar if available
	if (avatarUrl) {
		embed.setThumbnail(avatarUrl);
	}

	return embed;
}

module.exports = {
	getCountryFlag,
	formatPlayerNameWithFlag,
	getPlayerAvatarUrl,
	enhanceEmbedWithPlayerInfo,
};