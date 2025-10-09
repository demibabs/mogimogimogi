const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const DataManager = require("../../utils/dataManager");
const database = require("../../utils/database");
const LoungeApi = require("../../utils/loungeApi");
const PlayerStats = require("../../utils/playerStats");

const getRandomMessage = function(messages) {
	const randInt = Math.floor(Math.random() * messages.length);
	return messages[randInt];
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName("notables")
		.setDescription("Your worst and best mogis.")
		.addUserOption(option =>
			option.setName("user")
				.setDescription("Yourself if left blank.")
				.setRequired(false))
		.addBooleanOption(option =>
			option.setName("server-only")
				.setDescription("True = include only mogis with other server members."))
		.addBooleanOption(option =>
			option.setName("squads")
				.setDescription("True = sq only, false = soloq only."),
		),

	async execute(interaction) {
		try {
			await interaction.deferReply();
			await interaction.editReply("Loading player data...");

			const discordUser = interaction.options.getUser("user") || interaction.user;
			const serverId = interaction.guild.id;
			const serverOnly = interaction.options.getBoolean("server-only");
			const squads = interaction.options.getBoolean("squads");

			// Validate server data and user
			const serverData = await database.getServerData(serverId);
			const userData = serverData?.users?.[discordUser.id];

			if (!userData) {
				return await interaction.editReply("ERROR: Not a valid user. Use `/setup` to add all server members.");
			}

			// Get user's Lounge account
			const userId = discordUser.id;
			const loungeUser = await LoungeApi.getPlayerByDiscordId(userId);

			if (!loungeUser) {
				return await interaction.editReply("ERROR: Unable to find Lounge account for this user.");
			}

			try {
				await DataManager.updateServerUser(serverId, userId, interaction.client);
			}
			catch (error) {
				console.warn(`Failed to update user data for ${userId}:`, error);
			}

			await interaction.editReply("Loading match history...");

			// Get user's tables
			let userTables = await LoungeApi.getAllPlayerTables(userId, serverId);

			if (!userTables || Object.keys(userTables).length === 0) {
				return await interaction.editReply("No match history found for this user. :('");
			}

			// Filter tables based on options
			if (serverOnly) {
				await interaction.editReply("Filtering server-only matches...");
				const filteredEntries = [];
				for (const [tableId, table] of Object.entries(userTables)) {
					try {
						if (await PlayerStats.checkIfServerTable(userId, table, serverId)) {
							filteredEntries.push([tableId, table]);
						}
					}
					catch (error) {
						console.warn(`Error checking table ${tableId}:`, error);
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
				const filterType = serverOnly ? "server-only " : "";
				const squadType = squads ? "squad " : squads === false ? "soloQ " : "";
				return await interaction.editReply(`No ${filterType}${squadType}matches found for this user. :('`);
			}

			await interaction.editReply("Calculating notables...");

			// Calculate statistics
			const bS = PlayerStats.getBestScore(userTables, loungeUser.name);
			const wS = PlayerStats.getWorstScore(userTables, loungeUser.name);
			const oP = PlayerStats.getBiggestOverperformance(userTables, loungeUser.name);
			const uP = PlayerStats.getBiggestUnderperformance(userTables, loungeUser.name);
			const bC = PlayerStats.getBiggestCarry(userTables, loungeUser.name);
			const bA = PlayerStats.getBiggestAnchor(userTables, loungeUser.name);

			// Validate that statistics were calculated successfully
			if (!bS || !wS || !oP || !uP || !bC || !bA) {
				return await interaction.editReply("Unable to calculate statistics from match data. Something went wrong. :('");
			}
			const goodBSMessages = [
				"Nice!",
				"Excellent work!",
				"Can you do even better?",
				"Skill was on your side that day. (Or luck...)",
				"Typical mogi for the GOAT.",
				"Why can't every mogi be this good?",
				"Cheating?",
				"Luck was on your side that day. (Or skill...)",
				"Isn't this game so good when you win?",
			];
			const badBSMessages = [
				"Great score, but not good enough for 1st :(",
				"Guess someone else was having an even better mogi.",
				"Not first? Shortrat must have been in your room.",
				"Someone had to steal your thunder I guess.",
				"Nice, but I know you have at least 10 more points in you. Maybe 15.",
				"Solid showing.",
			];

			const goodWSMessages = [
				"If you think that mogi sucked, think about whoever you beat.",
				"Your worst ever and you still didn't get last? We take it.",
				"Ouch.",
				"At least you beat somebody!",
				"Hey, losing makes winning feel even better!",
				"Sometimes when you gamble, you lose.",
				"You suck. (JK.)",
			];
			const badWSMessages = [
				"This is the ype of mogi I have when I'm about to promote.",
				"Video games aren't for everyone. Maybe try sports?",
				"Yowch.",
				"At least you beat somebody! Wait, no you didn't.",
				"Thanks for graciously donating your MMR to those other players.",
				"Can't blame any teammates for THIS one.",
				"You suck.",
			];

			const oPMessages = [
				"Against all odds!",
				"They never saw it coming.",
				"They underestimated you, but I knew you were like that.",
				"Great job!",
				"Holy W.",
				"How does he do it?",
				"The up and coming GOAT.",
			];

			const uPMessages = [
				"Well, even Lightning McQueen has lost races.",
				"But you were just unlucky, right?",
				"Oof.",
				"Guess the room was punching above its weight.",
				"Washed?",
				"Yikes.",
				"Everyone was silently judging you.",
				"Not your mogi.",
			];

			const bCMessages = [
				"Someone had to pick up the slack.",
				"Does your back hurt?",
				"You did everything you could.",
				"Impressive!",
				"Did the rest of your team suck or are you just that good?",
				"You're the type of mate we all need.",
				"Holy carry.",
			];

			const bAMessages = [
				"SMH.",
				"Your team needed you, but you vanished.",
				"Someone had to pick up the slack, and it wasn't you.",
				"Ow.",
				"Thank god for teammates.",
				"Bad day?",
			];

			const notablesEmbed = new EmbedBuilder()
				.setColor("Gold")
				.setTitle(`${discordUser.displayName}'s ${serverOnly ? "server " : ""}${
					squads ? "squad " : squads === false ? "soloQ " : ""}notables`)
				.addFields(
					{ name: "Best score:", value: `[In this ${userTables[bS.tableId].numPlayers}p ${
						userTables[bS.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bS.tableId})`
                + ` you scored ${bS.score} ${
                	bS.placement === 1 ? "and" : "but"} were rank ${
                	bS.placement}. ${
                	getRandomMessage(bS.placement === 1 ? goodBSMessages : badBSMessages)}`,
					},
					{ name: "Worst score:", value: `[In this ${userTables[wS.tableId].numPlayers}p ${
						userTables[wS.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${wS.tableId})`
                + ` you scored ${wS.score} and were rank ${
                	wS.placement}. ${
                	getRandomMessage(wS.placement === userTables[wS.tableId].numPlayers ? badWSMessages : goodWSMessages)}`,
					},
					{ name: "Biggest overperformance:", value: `[In this ${userTables[oP.tableId].numPlayers}p ${
						userTables[oP.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${oP.tableId})`
                + ` you were seed ${
                	oP.placement + oP.overperformance} but scored ${
                	oP.score} and managed to get rank ${
                	oP.placement}. ${getRandomMessage(oPMessages)}`,
					},
					{ name: "Biggest underperformance:", value: `[In this ${userTables[uP.tableId].numPlayers}p ${
						userTables[uP.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${uP.tableId})`
                + ` you were seed ${
                	uP.placement + uP.underperformance} but scored ${
                	uP.score} and ended up rank ${
                	uP.placement}. ${getRandomMessage(uPMessages)}`,
					},
					{ name: "Biggest carry:", value: `[In this ${userTables[bC.tableId].numPlayers}p ${
						userTables[bC.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bC.tableId})`
                + ` you were rank ${
                	bC.placement} and scored ${
                	bC.score} while your ${
                	userTables[bC.tableId].format === "2v2" ?
                	"mate scored" : "teammates averaged"} ${
                	bC.score - bC.carryAmount}. `
                + getRandomMessage(bCMessages),
					},
					{ name: "Biggest anchor:", value: `[In this ${userTables[bA.tableId].numPlayers}p ${
						userTables[bA.tableId].format}](https://lounge.mkcentral.com/mkworld/TableDetails/${bA.tableId})`
                + ` you were rank ${
                	bA.placement} and scored ${
                	bA.score} while your ${
                	userTables[bA.tableId].format === "2v2" ?
                	"mate scored" : "teammates averaged"} ${
                	bA.score - bA.anchorAmount}. `
                + getRandomMessage(bAMessages),
					},
				);
			try {
				await interaction.editReply({ content: "", embeds: [notablesEmbed] });
			}
			catch (error) {
				console.error("Failed to send embed:", error);
				await interaction.editReply("ERROR: Something went wrong while sending the results.");
			}
		}
		catch (error) {
			console.error("Notables command error:", error);

			if (error.message?.includes("Unknown interaction")) {
				console.error("Interaction expired during notables calculation");
				return;
			}

			try {
				await interaction.editReply("ERROR: An error occurred while calculating notables. Please try again.");
			}
			catch (editError) {
				console.error("Failed to edit reply:", editError);
			}
		}
	},
};