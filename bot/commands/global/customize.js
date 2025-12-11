const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const AutoUserManager = require("../../utils/autoUserManager");
const DataManager = require("../../utils/dataManager");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const { trackAbbreviationsToNames } = require("../../utils/gameData");

const assetsRoot = path.join(__dirname, "..", "..", "images");
const tracksDir = resolveAssetDirectory(["tracks blurred", "tracks"]);
const vehiclesDir = path.join(assetsRoot, "vehicles");
const mainsDir = path.join(assetsRoot, "characters", "mains");
const npcsDir = path.join(assetsRoot, "characters", "npcs");

const MAIN_BASE_NAMES = [
	"baby daisy",
	"baby luigi",
	"baby mario",
	"baby peach",
	"baby rosalina",
	"birdo",
	"boo",
	"bowser",
	"bowser jr",
	"daisy",
	"donkey kong",
	"hammer bro",
	"koopa troopa",
	"lakitu",
	"luigi",
	"mario",
	"pauline",
	"peach",
	"rosalina",
	"shy guy",
	"toad",
	"toadette",
	"waluigi",
	"wario",
	"yoshi",
];

const trackOptions = buildTrackOptions();

const vehicleOptions = buildVehicleOptions();
const vehicleMap = new Map(vehicleOptions.map(option => [option.value, option]));

const characterOptions = buildCharacterOptions();
const characterMap = new Map(characterOptions.map(option => [option.value, option]));

const CLEAR_VALUE = "none";
const CLEAR_SUGGESTION = { name: CLEAR_VALUE, value: CLEAR_VALUE };

function resolveAssetDirectory(names) {
	if (!Array.isArray(names) || !names.length) {
		return assetsRoot;
	}
	for (const relative of names) {
		const candidate = path.join(assetsRoot, relative);
		try {
			const stats = fs.statSync(candidate);
			if (stats.isDirectory()) {
				return candidate;
			}
		}
		catch (error) {
			// ignore missing candidates
		}
	}
	return path.join(assetsRoot, names[names.length - 1]);
}

function buildAutocompleteSuggestions(options, query) {
	const normalizedQuery = (query || "").toLowerCase();
	const results = [];
	if (!normalizedQuery || CLEAR_VALUE.includes(normalizedQuery)) {
		results.push(CLEAR_SUGGESTION);
	}
	for (const option of options) {
		const nameMatch = option.name?.toLowerCase().includes(normalizedQuery);
		const valueMatch = option.value?.toLowerCase().includes(normalizedQuery);
		if (nameMatch || valueMatch) {
			results.push({ name: option.name, value: option.value });
		}
		if (results.length >= 25) {
			break;
		}
	}
	const unique = [];
	const seen = new Set();
	for (const entry of results) {
		if (seen.has(entry.value)) {
			continue;
		}
		seen.add(entry.value);
		unique.push(entry);
		if (unique.length >= 25) {
			break;
		}
	}
	return unique;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("customize")
		.setDescription("set the track and combo that appear when you use /stats, /rank-stats and /notables.")
		.addStringOption(option =>
			option
				.setName("track")
				.setDescription("choose your favorite track.")
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option
				.setName("character")
				.setDescription("select your main char.")
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option
				.setName("vehicle")
				.setDescription("choose your main vehicle.")
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focused = interaction.options.getFocused(true);
		const query = focused.value.toLowerCase();

		if (focused.name === "track") {
			const suggestions = buildAutocompleteSuggestions(trackOptions, query);
			await interaction.respond(suggestions);
			return;
		}

		if (focused.name === "vehicle") {
			const suggestions = buildAutocompleteSuggestions(vehicleOptions, query);
			await interaction.respond(suggestions);
			return;
		}

		if (focused.name === "character") {
			const suggestions = buildAutocompleteSuggestions(characterOptions, query);
			await interaction.respond(suggestions);
			return;
		}

		await interaction.respond([]);
	},

	async execute(interaction) {
		await interaction.deferReply();

		if (!interaction.inGuild()) {
			await interaction.editReply("this command can only be used inside a server.");
			return;
		}

		const trackValue = interaction.options.getString("track")?.toLowerCase() ?? null;
		const vehicleValue = interaction.options.getString("vehicle")?.toLowerCase() ?? null;
		const characterValue = interaction.options.getString("character")?.toLowerCase() ?? null;

		if (!trackValue && !vehicleValue && !characterValue) {
			await interaction.editReply("tell me what to update! choose at least one of track, character, or vehicle.");
			return;
		}

		const trackChoice = resolveTrackInput(trackValue);
		if (trackValue && !trackChoice && trackValue !== CLEAR_VALUE) {
			await interaction.editReply("i couldn't find that track. try using the provided options.");
			return;
		}

		const vehicleChoice = resolveVehicleInput(vehicleValue);
		if (vehicleValue && !vehicleChoice && vehicleValue !== CLEAR_VALUE) {
			await interaction.editReply("i couldn't find that vehicle. try using the provided options.");
			return;
		}

		const characterChoice = resolveCharacterInput(characterValue);
		if (characterValue && !characterChoice && characterValue !== CLEAR_VALUE) {
			await interaction.editReply("i couldn't find that character. try using the provided options.");
			return;
		}

		const userId = interaction.user.id;
		const serverId = interaction.guild.id;

		let selectedCostume = null;
		let promptedForCostume = false;
		if (characterChoice?.type === "main" && characterChoice.costumes.length > 1) {
			promptedForCostume = true;
			const selectId = `customize:${interaction.id}:${userId}`;
			const row = new ActionRowBuilder().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(selectId)
					.setPlaceholder(`choose a costume for ${characterChoice.name}`)
					.addOptions(characterChoice.costumes.map(costume => ({
						label: costume,
						value: costume,
					}))),
			);

			const promptMessage = await interaction.editReply({
				content: `pick a costume for ${characterChoice.name}.`,
				components: [row],
			});

			try {
				const costumeSelection = await promptMessage.awaitMessageComponent({
					filter: component => component.customId === selectId && component.user.id === userId,
					time: 60_000,
				});
				selectedCostume = costumeSelection.values[0];
				await costumeSelection.update({ content: "saving your preferences...", components: [] });
			}
			catch (error) {
				selectedCostume = "default";
				await interaction.editReply({ content: "costume selection timed out. defaulting to 'default' costume...", components: [] });
			}
		}
		else if (characterChoice?.type === "main" && characterChoice.costumes.length === 1) {
			selectedCostume = characterChoice.costumes[0];
		}

		if (!promptedForCostume) {
			await interaction.editReply("saving your preferences...");
		}

		let loungeId = null;
		let loungeName = null;

		// Try to find user in cache first
		const cachedUser = await database.getUserByDiscordId(userId);
		if (cachedUser) {
			loungeId = cachedUser.loungeId;
			loungeName = cachedUser.loungeName;
		}

		if (!loungeId) {
			try {
				const loungeProfile = await LoungeApi.getPlayerByDiscordId(userId);
				if (!loungeProfile?.id) {
					await interaction.editReply("i couldn't find a lounge profile linked to your discord.");
					return;
				}
				loungeId = String(loungeProfile.id);
				loungeName = loungeProfile.name ?? null;
			}
			catch (error) {
				console.error("customize failed to load lounge profile:", error);
				await interaction.editReply("something went wrong while looking up your lounge profile. please try again later.");
				return;
			}
		}

		let ensureResult = null;
		const target = {
			loungeId,
			loungeName,
			displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
			discordUser: interaction.user,
		};

		try {
			ensureResult = await AutoUserManager.ensureUserAndMembership({
				interaction,
				target,
				serverId,
				serverData: null,
				loungeId,
				loungeName,
			});
		}
		catch (error) {
			console.error("customize ensureUserRecord error:", error);
		}

		let storedUser = null;
		if (!ensureResult?.userRecord && loungeId) {
			try {
				storedUser = await database.getUserData(loungeId);
			}
			catch (error) {
				console.warn(`failed to load stored user ${loungeId}:`, error);
			}
		}

		const baseUser = ensureResult?.userRecord || storedUser || {
			loungeId,
			discordIds: [],
			favorites: {},
		};

		const discordIds = new Set((baseUser.discordIds || []).map(String));
		discordIds.add(userId);
		const existingFavorites = { ...(baseUser?.favorites || {}) };

		const summaryLines = [];

		if (trackValue) {
			if (trackValue === CLEAR_VALUE) {
				delete existingFavorites.track;
				summaryLines.push("track: cleared");
			}
			else if (trackChoice) {
				existingFavorites.track = trackChoice.value;
				summaryLines.push(`track: **${trackChoice.name}**`);
			}
		}

		if (vehicleValue) {
			if (vehicleValue === CLEAR_VALUE) {
				delete existingFavorites.vehicle;
				summaryLines.push("vehicle: cleared");
			}
			else if (vehicleChoice) {
				existingFavorites.vehicle = vehicleChoice.name.toLowerCase();
				summaryLines.push(`vehicle: **${vehicleChoice.name}**`);
			}
		}

		if (characterValue) {
			if (characterValue === CLEAR_VALUE) {
				delete existingFavorites.character;
				summaryLines.push("character: cleared");
			}
			else if (characterChoice) {
				const favoriteCharacter = {
					name: characterChoice.name.toLowerCase(),
				};
				if (selectedCostume) {
					favoriteCharacter.costume = selectedCostume.toLowerCase();
				}
				existingFavorites.character = favoriteCharacter;

				let characterLabel = characterChoice.name;
				if (selectedCostume) {
					characterLabel = `${characterLabel} (${selectedCostume})`;
				}
				summaryLines.push(`character: **${characterLabel}**`);
			}
		}

		const updatedUser = {
			...baseUser,
			loungeId,
			userId,
			loungeName: baseUser.loungeName || ensureResult?.loungeProfile?.name || null,
			discordIds: Array.from(discordIds),
			favorites: existingFavorites,
		};

		// Remove legacy servers array if present
		delete updatedUser.servers;

		try {
			await database.saveUserData(loungeId, updatedUser);
		}
		catch (error) {
			await interaction.editReply("something went wrong while saving your favorites. please try again.");
			return;
		}

		const responseLines = summaryLines.length ? summaryLines : ["no changes were needed."];

		await interaction.editReply({
			content: `saved your favorites!\n${responseLines.join("\n")}`,
			components: [],
		});
	},
};

function resolveTrackInput(input) {
	if (!input) return null;
	const normalized = input.toLowerCase();
	return trackOptions.find(option => option.value.toLowerCase() === normalized
		|| option.name.toLowerCase() === normalized)
		|| null;
}

function resolveVehicleInput(input) {
	if (!input) return null;
	const slug = slugify(input);
	return vehicleMap.get(input)
		|| vehicleMap.get(slug)
		|| vehicleOptions.find(option => option.name.toLowerCase() === input.toLowerCase())
		|| null;
}

function resolveCharacterInput(input) {
	if (!input) return null;
	const slug = slugify(input);
	return characterMap.get(input)
		|| characterMap.get(slug)
		|| characterOptions.find(option => option.name.toLowerCase() === input.toLowerCase())
		|| null;
}

function buildTrackOptions() {
	return safeReadDir(tracksDir)
		.filter(file => file.toLowerCase().endsWith(".png"))
		.map(file => file.replace(/\.png$/i, ""))
		.filter(name => name.toLowerCase().endsWith("_stats"))
		.map(name => name.replace(/_stats$/i, ""))
		.map(abbreviation => ({
			name: trackAbbreviationsToNames[abbreviation] || abbreviation.toLowerCase(),
			value: abbreviation,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function buildVehicleOptions() {
	return safeReadDir(vehiclesDir)
		.filter(file => file.toLowerCase().endsWith(".png"))
		.map(file => file.replace(/\.png$/i, ""))
		.map(name => {
			const display = name.replace(/_/g, " ").toLowerCase();
			return {
				name: display,
				value: slugify(name),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

function buildCharacterOptions() {
	const mains = new Map();
	const mainFiles = safeReadDir(mainsDir)
		.filter(file => file.toLowerCase().endsWith(".png"))
		.map(file => file.replace(/\.png$/i, ""));

	for (const base of MAIN_BASE_NAMES) {
		const lowerBase = base.toLowerCase();
		const prefix = `${lowerBase} `;
		const slug = slugify(base);
		const displayName = lowerBase;
		const costumeSet = new Set();

		for (const entry of mainFiles) {
			const lowerEntry = entry.toLowerCase();
			if (lowerEntry === lowerBase) {
				costumeSet.add("default");
				continue;
			}
			if (lowerEntry.startsWith(prefix)) {
				const rawCostume = entry.slice(prefix.length).trim();
				const normalized = rawCostume.replace(/[_\s]+/g, " ").toLowerCase();
				costumeSet.add(normalized || "default");
			}
		}

		if (costumeSet.size === 0) {
			costumeSet.add("default");
		}

		const costumes = Array.from(costumeSet).sort((a, b) => {
			if (a === "default") return -1;
			if (b === "default") return 1;
			return a.localeCompare(b);
		});

		mains.set(slug, {
			name: displayName,
			value: slug,
			type: "main",
			costumes,
		});
	}

	const characters = Array.from(mains.values());

	for (const entry of safeReadDir(npcsDir)) {
		if (!entry.toLowerCase().endsWith(".png")) continue;
		const base = entry.replace(/\.png$/i, "");
		const slug = slugify(base);
		characters.push({
			name: base.replace(/_/g, " ").toLowerCase(),
			value: slug,
			type: "npc",
			costumes: [],
		});
	}

	return characters.sort((a, b) => a.name.localeCompare(b.name));
}

function slugify(input) {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function safeReadDir(dir) {
	try {
		return fs.readdirSync(dir);
	}
	catch (error) {
		return [];
	}
}