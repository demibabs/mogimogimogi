const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const database = require("../../utils/database");
const { trackAbbreviationsToNames } = require("../../utils/gameData");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("global-favorites")
		.setDescription("Show the most popular characters, tracks, and vehicles."),

	async execute(interaction) {
		await interaction.deferReply();

		const allUserData = await database.getAllUserData();

		const characterCounts = {};
		const trackCounts = {};
		const vehicleCounts = {};
		let usersWithFavorites = 0;

		for (const user of allUserData) {
			const favorites = user.favorites;
			if (!favorites) continue;

			let hasFavorite = false;

			// Character
			if (favorites.character && favorites.character.name) {
				const charName = favorites.character.name.toLowerCase();
				characterCounts[charName] = (characterCounts[charName] || 0) + 1;
				hasFavorite = true;
			}

			// Track
			if (favorites.track) {
				// Track is stored as abbreviation
				const trackAbbr = favorites.track;
				trackCounts[trackAbbr] = (trackCounts[trackAbbr] || 0) + 1;
				hasFavorite = true;
			}

			// Vehicle
			if (favorites.vehicle) {
				let vehicleName = favorites.vehicle.toLowerCase();
				// Normalization
				if (vehicleName.includes("mach rocket")) {
					vehicleName = "mach rocket";
				}
				else if (vehicleName.includes("rob-hog") || vehicleName.includes("rob hog")) {
					vehicleName = "rob-hog";
				}
				vehicleCounts[vehicleName] = (vehicleCounts[vehicleName] || 0) + 1;
				hasFavorite = true;
			}

			if (hasFavorite) {
				usersWithFavorites++;
			}
		}

		const getAllRanked = (counts, nameMap = null) => {
			return Object.entries(counts)
				.sort(([, a], [, b]) => b - a)
				.map(([key, count], index) => {
					const name = nameMap ? (nameMap[key] || key) : key;
					return `${index + 1}. **${name}** (${count})`;
				})
				.join("\n") || "No data yet.";
		};

		const rankedCharacters = getAllRanked(characterCounts);
		const rankedTracks = getAllRanked(trackCounts, trackAbbreviationsToNames);
		const rankedVehicles = getAllRanked(vehicleCounts);

		const embed = new EmbedBuilder()
			.setTitle("Global Favorites")
			.setDescription(`Most popular choices across ${usersWithFavorites} users with set favorites.`)
			.setColor("Gold")
			.addFields(
				{ name: "Characters", value: rankedCharacters, inline: true },
				{ name: "Tracks", value: rankedTracks, inline: true },
				{ name: "Vehicles", value: rankedVehicles, inline: true },
			)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	},
};
