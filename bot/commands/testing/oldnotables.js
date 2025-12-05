const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");
const embedEnhancer = require("../../utils/embedEnhancer");
const AutoUserManager = require("../../utils/autoUserManager");

const getRandomMessage = function(messages) {
	const randInt = Math.floor(Math.random() * messages.length);
	return messages[randInt];
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName("notables-old")
		.setDescription("legacy version of the notables command.")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("yourself if left blank.")
				.setRequired(false))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("true = include only mogis with other server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("true = sq only, false = soloq only."),
		),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("validating user...");

			const discordUser = interaction.options.getUser("user") || interaction.user;
			const serverOnly = interaction.options.getBoolean("server-only") ?? false;
			const squads = interaction.options.getBoolean("squads");
			const serverId = interaction.guildId;

			// Use generateNotables for consistency with button interactions
			const result = await this.generateNotables(interaction, discordUser, serverId, serverOnly, squads, "alltime");

			   if (!result.success) {
				   const embed = new EmbedBuilder()
					   .setColor("Red")
					   .setDescription(result.message || "insufficient data to calculate notables for this player.");
				   return await interaction.editReply({ content: "", embeds: [embed] });
			   }

			// Create action row with three buttons (current one disabled)
			const row = new ActionRowBuilder()
				.addComponents(
					// Current view is disabled
					new ButtonBuilder()
						.setCustomId(`notables_alltime_${discordUser.id}_${serverOnly}_${squads}`)
						.setLabel("all time")
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId(`notables_weekly_${discordUser.id}_${serverOnly}_${squads}`)
						.setLabel("past week")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(`notables_season_${discordUser.id}_${serverOnly}_${squads}`)
						.setLabel("this season")
						.setStyle(ButtonStyle.Secondary),
				);

			await interaction.editReply({
				content: "",
				embeds: [result.embed],
				components: [row],
			});

		}
		catch (error) {
			console.error("notables command error:", error);
			try {
				await interaction.editReply({
					content: "error: something went wrong while calculating notables.",
				});
			}
			catch (editError) {
				console.error("failed to edit reply with error message:", editError);
			}
		}
	},

	// Handle button interactions
	async handleButtonInteraction(interaction) {
		if (!interaction.customId.startsWith("notables_")) return false;

		try {
			await interaction.deferUpdate();

			const parts = interaction.customId.split("_");
			// "weekly", "alltime", or "season"
			const timeFilter = parts[1];
			const userId = parts[2];
			const serverOnly = parts[3] === "true";
			const squads = parts[4] === "null" ? null : parts[4] === "true";

			const serverId = interaction.guild.id;
			const discordUser = await interaction.client.users.fetch(userId);

			// Generate notables based on time filter
			const result = await this.generateNotables(interaction, discordUser, serverId, serverOnly, squads, timeFilter);

			if (result && result.success) {
				// Create action row with three buttons (current one disabled)
				const row = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`notables_alltime_${userId}_${serverOnly}_${squads}`)
							.setLabel("all time")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "alltime"),
						new ButtonBuilder()
							.setCustomId(`notables_weekly_${userId}_${serverOnly}_${squads}`)
							.setLabel("past week")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "weekly"),
						new ButtonBuilder()
							.setCustomId(`notables_season_${userId}_${serverOnly}_${squads}`)
							.setLabel("this season")
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(timeFilter === "season"),
					);

				await interaction.editReply({ content: "", embeds: [result.embed], components: [row] });
			}
			   else {
				   // Handle error case for button interactions
				   const embed = new EmbedBuilder()
					   .setColor("Red")
					   .setDescription(result.message || "unable to load notables data.");
				   await interaction.editReply({ content: "", embeds: [embed] });
			   }

			return true;
		}
		catch (error) {
			console.error("error in notables button interaction:", error);
			return false;
		}
	},

	// Generate notables data (simplified version)
	async generateNotables(interaction, discordUser, serverId, serverOnly, squads, timeFilter = "alltime") {
		try {
			// Validate user exists and add them if they have a lounge account
			const userValidation = await AutoUserManager.validateUserForCommand(discordUser.id, serverId, interaction.client);

			if (!userValidation.success) {
				if (userValidation.needsSetup) {
					return { success: false, message: "this server hasn't been set up yet. run `/setup` first." };
				}
				return { success: false, message: userValidation.message };
			}

			// Get user's Lounge account
			const userId = discordUser.id;
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				return null;
			}

			try {
				await DataManager.updateServerUser(serverId, userId, interaction.client);
			}
			catch (error) {
				console.warn(`failed to update user data for ${userId}:`, error);
			}

			// Get user's tables
			await interaction.editReply("searching for tables...");
			let userTables = await LoungeApi.getAllPlayerTables(userId, serverId);

			if (!userTables || Object.keys(userTables).length === 0) {
				return { success: false, message: "no events found for this player." };
			}

			// Apply time filter using PlayerStats methods
			if (timeFilter === "weekly") {
				userTables = PlayerStats.filterTablesByWeek(userTables, true);
			}
			else if (timeFilter === "season") {
				userTables = PlayerStats.filterTablesBySeason(userTables, true);
			}

			// Filter tables based on options
			if (serverOnly) {
				const filteredEntries = [];
				for (const [tableId, table] of Object.entries(userTables)) {
					try {
						if (await PlayerStats.checkIfServerTable(userId, table, serverId)) {
							filteredEntries.push([tableId, table]);
						}
					}
					catch (error) {
						console.warn(`error checking table ${tableId}:`, error);
					}
				}
				userTables = Object.fromEntries(filteredEntries);
			}

			if (squads) {
				userTables = Object.fromEntries(
					Object.entries(userTables).filter(([tableId, table]) =>
						table.tier === "SQ"),
				);
			}

			if (squads === false) {
				userTables = Object.fromEntries(
					Object.entries(userTables).filter(([tableId, table]) =>
						table.tier !== "SQ"),
				);
			}

			// Check if any tables remain after filtering
			if (Object.keys(userTables).length === 0) {
				return { success: false, message: "no events found matching the specified filters." };
			}

			// Calculate statistics
			await interaction.editReply("filtering...");
			const bS = PlayerStats.getBestScore(userTables, userId);
			const wS = PlayerStats.getWorstScore(userTables, userId);
			const oP = PlayerStats.getBiggestOverperformance(userTables, userId);
			const uP = PlayerStats.getBiggestUnderperformance(userTables, userId);
			const bC = PlayerStats.getBiggestCarry(userTables, userId);
			const bA = PlayerStats.getBiggestAnchor(userTables, userId);

			// Validate that statistics were calculated successfully
			if (!bS || !wS || !oP || !uP || !bC || !bA) {
				return { success: false, message: "insufficient data to calculate notables for this player." };
			}

			// Messages for random selection
			const goodBSMessages = [
				"nice!",
				"excellent work!",
				"can you do even better?",
				"skill was on your side that day. (or luck...)",
				"typical mogi for the goat.",
				"why can't every mogi be this good?",
				"cheating?",
				"luck was on your side that day. (or skill...)",
				"isn't this game so good when you win?",
			];
			const badBSMessages = [
				"great score, but not good enough for 1st :(",
				"guess someone else was having an even better mogi.",
				"not first? shortrat must have been in your room.",
				"someone had to steal your thunder i guess.",
				"nice, but i know you have at least 10 more points in you. maybe 15.",
				"solid showing.",
			];

			const goodWSMessages = [
				"if you think that mogi sucked, think about whoever you beat.",
				"your worst ever and you still didn't get last? We take it.",
				"ouch.",
				"at least you beat somebody!",
				"hey, losing makes winning feel even better!",
				"sometimes when you gamble, you lose.",
				"you suck. (jk.)",
			];
			const badWSMessages = [
				"this is the type of mogi i have when i'm about to promote.",
				"video games aren't for everyone. maybe try sports?",
				"yowch.",
				"at least you beat somebody! wait, no you didn't.",
				"thanks for graciously donating your mmr to those other players.",
				"can't blame any teammates for that one.",
				"you suck.",
			];

			const oPMessages = [
				"against all odds!",
				"they never saw it coming.",
				"they underestimated you, but i knew you were like that.",
				"great job!",
				"holy w.",
				"how does he do it?",
				"the up and coming goat.",
			];

			const uPMessages = [
				"well, even lightning mcqueen has lost races before.",
				"but you were just unlucky, right?",
				"oof.",
				"guess the room was punching above its weight.",
				"washed?",
				"yikes.",
				"everyone was silently judging you.",
				"not your mogi.",
			];

			const bCMessages = [
				"someone had to pick up the slack.",
				"does your back hurt?",
				"you did everything you could.",
				"impressive!",
				"did the rest of your team suck or are you just that good?",
				"you're the type of mate we all need.",
				"holy carry.",
			];

			const bAMessages = [
				"smh.",
				"your team needed you, but you vanished.",
				"someone had to pick up the slack, and it wasn't you.",
				"ow.",
				"thank god for teammates.",
				"bad day?",
			];

			const playerNameWithFlag = embedEnhancer.formatPlayerNameWithFlag(discordUser.displayName, loungeUser.countryCode);

			// Create time-aware title
			const timePrefix = timeFilter === "weekly" ? "weekly " : timeFilter === "season" ? "season " : "";

			const notablesEmbed = new EmbedBuilder()
				.setColor("Gold")
				.setTitle(`${playerNameWithFlag}'s ${serverOnly ? "server " : ""}${
					squads ? "squad " : squads === false ? "soloQ " : ""}${timePrefix}notables`)
				.setTimestamp()
				.addFields(
					{ name: "best score:", value: `[in this ${userTables[bS.tableId].numPlayers}p ${
						userTables[bS.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bS.tableId})`
                + ` you scored **${bS.score}** ${
                	bS.placement === 1 ? "and" : "but"} were rank **${
                	bS.placement}**. ${
                	getRandomMessage(bS.placement === 1 ? goodBSMessages : badBSMessages)}`,
					},
					{ name: "worst score:", value: `[in this ${userTables[wS.tableId].numPlayers}p ${
						userTables[wS.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${wS.tableId})`
                + ` you scored **${wS.score}** and were rank **${
                	wS.placement}**. ${
                	getRandomMessage(wS.placement === userTables[wS.tableId].numPlayers ? badWSMessages : goodWSMessages)}`,
					},
					{ name: "biggest overperformance:", value: `[in this ${userTables[oP.tableId].numPlayers}p ${
						userTables[oP.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${oP.tableId})`
                + ` you were seed **${
                	oP.placement + oP.overperformance}** but scored **${
                	oP.score}** and managed to get rank **${
                	oP.placement}**. ${getRandomMessage(oPMessages)}`,
					},
					{ name: "biggest underperformance:", value: `[in this ${userTables[uP.tableId].numPlayers}p ${
						userTables[uP.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${uP.tableId})`
                + ` you were seed **${
                	uP.placement + uP.underperformance}** but scored **${
                	uP.score}** and ended up rank **${
                	uP.placement}**. ${getRandomMessage(uPMessages)}`,
					},
					{ name: "biggest carry:", value: `[in this ${userTables[bC.tableId].numPlayers}p ${
						userTables[bC.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bC.tableId})`
                + ` you were rank **${
                	bC.placement}** and scored **${
                	bC.score}** while your ${
                	userTables[bC.tableId].format === "2v2" ?
                	"mate scored" : "teammates averaged"} **${
                	bC.score - bC.carryAmount}**. `
                + getRandomMessage(bCMessages),
					},
					{ name: "biggest anchor:", value: `[in this ${userTables[bA.tableId].numPlayers}p ${
						userTables[bA.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bA.tableId})`
                + ` you were rank **${
                	bA.placement}** and scored **${
                	bA.score}** while your ${
                	userTables[bA.tableId].format === "2v2" ?
                	"mate scored" : "teammates averaged"} **${
                	bA.score - bA.anchorAmount}**. `
                + getRandomMessage(bAMessages),
					},
				);

			// Add player avatar as thumbnail
			const avatarUrl = embedEnhancer.getPlayerAvatarUrl(discordUser);
			if (avatarUrl) {
				notablesEmbed.setThumbnail(avatarUrl);
			}

			// Add time-aware footer
			const eventCount = Object.keys(userTables).length;
			let footerText = `your most notable moments from ${eventCount} event${eventCount !== 1 ? "s" : ""}`;
			if (timeFilter === "weekly") {
				footerText += " (past 7 days)";
			}
			else if (timeFilter === "season") {
				footerText += " (current season)";
			}
			notablesEmbed.setFooter({ text: footerText });

			return { success: true, embed: notablesEmbed };
		}
		catch (error) {
			console.error("error generating notables:", error);
			return { success: false, message: "an error occurred while generating notables. please try again later." };
		}
	},
};