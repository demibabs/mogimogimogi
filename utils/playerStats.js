/**
 * Player statistics utility functions
 * Pure functions that calculate stats from table data without data fetching
 */

const LoungeApi = require("./loungeApi");
const database = require("./database");

class PlayerStats {
	/**
	 * Get individual player rankings from a table, sorted by score
	 * @param {Object} table - Table object from the API
	 * @returns {Array} Array of players with rankings, sorted by score (highest first)
	 */
	static getIndividualPlayerRankings(table) {

		const allPlayers = PlayerStats.getPlayersFromTable(table);

		// Sort by score (highest first)
		allPlayers.sort((a, b) => b.score - a.score);

		// Add individual rankings
		let currentRank = 1;
		let previousScore = null;
		let playersWithSameScore = 0;

		return allPlayers.map((player, index) => {
			// Handle ties - players with same score get same rank
			if (previousScore !== null && player.score < previousScore) {
				currentRank = index + 1;
				playersWithSameScore = 0;
			}
			else if (previousScore !== null && player.score === previousScore) {
				playersWithSameScore++;
			}

			previousScore = player.score;

			return {
				...player,
				individualRank: currentRank,
				isTied: playersWithSameScore > 0,
			};
		});
	}

	static getIndividualPlayerSeeds(table) {
		const allPlayers = PlayerStats.getPlayersFromTable(table);

		allPlayers.sort((a, b) => b.prevMmr - a.prevMmr);

		return allPlayers.map((player, index) => {
			return {
				...player,
				individualSeed: index + 1,
			};
		});
	}

	/**
	 * Get a specific player's individual ranking from a table
	 * @param {Object} table - Table object from the API
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Player object with ranking info, or null if not found
	 */
	static getPlayerRankingInTable(table, playerDiscordId) {
		const rankings = PlayerStats.getIndividualPlayerRankings(table);
		return rankings.find(player =>
			player.playerDiscordId === playerDiscordId,
		) || null;
	}

	/**
	 * Get all players from a table with team information
	 * @param {Object} table - Table object from the API
	 * @returns {Array} Array of all players with team info
	 */
	static getPlayersFromTable(table) {
		if (!table || !table.teams) {
			return [];
		}

		const allPlayers = [];

		table.teams.forEach((team, teamIndex) => {
			team.scores.forEach(player => {
				allPlayers.push({
					...player,
					teamRank: team.rank,
					teamIndex: teamIndex + 1,
				});
			});
		});

		return allPlayers;
	}

	/**
	 * Calculate number of matches played by a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string} playerDiscordId - Discord ID of the player
	 * @returns {number} Number of matches played
	 */
	static getMatchesPlayed(tables, playerDiscordId) {
		let matches = 0;
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					matches++;
					// Found player in this table, move to next table
					break;
				}
			}

		}
		return matches;
	}

	/**
	 * Calculate win rate for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string} playerDiscordId - Discord ID of the player
	 * @returns {number} Win rate (0-1) or -1 if no matches played
	 */
	static getWinRate(tables, playerDiscordId) {
		let wins = 0;
		let losses = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					if (player.delta > 0) {
						wins++;
					}
					else if (player.delta < 0) {
						losses++;
					}
					// Found player in this table, move to next table
					break;
				}
			}

		}

		if (wins + losses === 0) return -1;
		return wins / (wins + losses);
	}

	/**
	 * Calculate average placement for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string} playerDiscordId - Discord ID of the player
	 * @returns {number} Average placement or -1 if no matches played
	 */
	static getAveragePlacement(tables, playerDiscordId) {
		let totalPlacement = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const playerRanking = PlayerStats.getPlayerRankingInTable(table, playerDiscordId);
			if (playerRanking) {
				totalPlacement += playerRanking.individualRank;
				matchesFound++;
			}
		}

		if (matchesFound === 0) return -1;
		return totalPlacement / matchesFound;
	}

	static getAverageScore(tables, playerDiscordId) {
		let totalScore = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;
			const players = PlayerStats.getPlayersFromTable(table);
			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					totalScore += player.score;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalScore / matchesFound;
	}

	static getAverageSeed(tables, playerDiscordId) {
		let totalSeed = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getIndividualPlayerSeeds(table);
			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					totalSeed += player.individualSeed;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalSeed / matchesFound;
	}

	static async checkIfServerTable(userId, table, serverId) {
		const serverData = await database.getServerData(serverId);
		const playersTable = PlayerStats.getPlayersFromTable(table);
		for (const id in serverData.users) {
			for (const player of playersTable) {
				if (id !== userId && id === player.playerDiscordId) {
					return true;
				}
			}
		}
		return false;
	}

	static async getH2HTables(userId1, userId2, serverId) {
		const tables = {};
		const userTables = await database.getUserTables(userId1, serverId);

		for (const userTable of userTables) {
			const table = await database.getTable(userTable.id);
			if (!table) continue;

			const playersTable = PlayerStats.getPlayersFromTable(table);
			for (const player of playersTable) {
				if (player.playerDiscordId == userId2) {
					tables[userTable.id] = table;
				}
			}
		}
		return tables;
	}

	static async getTotalH2H(tables, playerDiscordId, serverId) {
		const serverData = await database.getServerData(serverId);
		const record = {
			wins: 0,
			losses: 0,
			ties: 0,
		};
		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			for (const player of players) {
				if (serverData.users[player.playerDiscordId]) {
					if (PlayerStats.getPlayerRankingInTable(table, playerDiscordId).individualRank < PlayerStats.getPlayerRankingInTable(table, player.playerDiscordId).individualRank) {
						record.wins++;
					}
					else if (PlayerStats.getPlayerRankingInTable(table, playerDiscordId).individualRank > PlayerStats.getPlayerRankingInTable(table, player.playerDiscordId).individualRank) {
						record.losses++;
					}
					else if (playerDiscordId !== player.playerDiscordId) {
						record.ties++;
					}
				}
			}
		}
		return record;
	}

	/**
	 * Get head-to-head record between two specific players across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string} player1DiscordId - Discord ID of the first player
	 * @param {string} player2DiscordId - Discord ID of the second player
	 * @returns {Object} Record object with {wins, losses, ties} from player1's perspective
	 */
	static getH2H(tables, player1DiscordId, player2DiscordId) {
		const record = {
			wins: 0,
			losses: 0,
			ties: 0,
		};

		// Return empty record if same player
		if (player1DiscordId === player2DiscordId) {
			return record;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, player1DiscordId);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, player2DiscordId);

			// Skip table if either player isn't found
			if (!player1Ranking || !player2Ranking) {
				continue;
			}

			// Compare individual rankings (lower rank number = better placement)
			if (player1Ranking.individualRank < player2Ranking.individualRank) {
				record.wins++;
			}
			else if (player1Ranking.individualRank > player2Ranking.individualRank) {
				record.losses++;
			}
			else {
				record.ties++;
			}
		}

		return record;
	}

	/**
	 * Get the biggest score difference where the first player beat the second player
	 * @param {Object} tables - Object containing table data
	 * @param {string} player1DiscordId - Discord ID of the first player
	 * @param {string} player2DiscordId - Discord ID of the second player
	 * @returns {Object|null} Object with {tableId, player1Score, scoreDifference, player1Rank, rankDifference} or null if player1 never beat player2
	 */
	static getBiggestDifference(tables, player1DiscordId, player2DiscordId) {
		let biggestDifference = null;
		let bestResult = null;

		// Return null if same player
		if (player1DiscordId === player2DiscordId) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, player1DiscordId);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, player2DiscordId);

			// Skip table if either player isn't found
			if (!player1Ranking || !player2Ranking) {
				continue;
			}

			// Only consider tables where player1 beat player2 (lower rank = better)
			if (player1Ranking.individualRank >= player2Ranking.individualRank) {
				continue;
			}

			// Calculate differences
			const scoreDifference = player1Ranking.score - player2Ranking.score;
			const rankDifference = player2Ranking.individualRank - player1Ranking.individualRank;

			// Check if this is the biggest score difference
			// Tiebreak by rank difference (bigger rank gap wins tiebreak)
			const isBetter = biggestDifference === null ||
				scoreDifference > biggestDifference ||
				(scoreDifference === biggestDifference && rankDifference > bestResult.rankDifference);

			if (isBetter) {
				biggestDifference = scoreDifference;
				bestResult = {
					tableId: table.id,
					player1Score: player1Ranking.score,
					scoreDifference: scoreDifference,
					player1Rank: player1Ranking.individualRank,
					player2Rank: player2Ranking.individualRank,
					rankDifference: rankDifference,
				};
			}
		}

		return bestResult;
	}

	/**
	 * Get a player's best (highest) score across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getBestScore(tables, playerDiscordId) {
		let bestScore = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
					if (bestScore === null || player.score > bestScore) {
						bestScore = player.score;
						bestResult = {
							score: player.score,
							placement: playerRanking ? playerRanking.individualRank : null,
							tableId: table.id,
						};
					}
					break;
				}
			}
		}

		return bestResult;
	}

	/**
	 * Get a player's worst (lowest) score across all tables
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getWorstScore(tables, playerDiscordId) {
		let worstScore = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			for (const player of players) {
				if (player.playerDiscordId === playerDiscordId) {
					const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
					if (worstScore === null || player.score < worstScore) {
						worstScore = player.score;
						worstResult = {
							score: player.score,
							placement: playerRanking ? playerRanking.individualRank : null,
							tableId: table.id,
						};
					}
					break;
				}
			}
		}

		return worstResult;
	}

	/**
	 * Get a player's biggest overperformance (seed minus ranking, higher is better)
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, overperformance} or null
	 */
	static getBiggestOverperformance(tables, playerDiscordId) {
		let bestOverperformance = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
			const playerSeed = seeds.find(p => p.playerDiscordId === playerDiscordId);

			if (playerRanking && playerSeed) {
				const overperformance = playerSeed.individualSeed - playerRanking.individualRank;

				// Check if this is the best overperformance (higher is better)
				// Tiebreak by score (higher score wins tiebreak)
				const isBetter = bestOverperformance === null ||
					overperformance > bestOverperformance ||
					(overperformance === bestOverperformance && playerRanking.score > bestResult.score);

				if (isBetter) {
					bestOverperformance = overperformance;
					bestResult = {
						tableId: table.id,
						score: playerRanking.score,
						placement: playerRanking.individualRank,
						overperformance: overperformance,
					};
				}
			}
		}

		return bestResult;
	}

	/**
	 * Get a player's biggest underperformance (seed minus ranking, lower is worse)
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, underperformance} or null
	 */
	static getBiggestUnderperformance(tables, playerDiscordId) {
		let worstUnderperformance = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
			const playerSeed = seeds.find(p => p.playerDiscordId === playerDiscordId);

			if (playerRanking && playerSeed) {
				const underperformance = playerSeed.individualSeed - playerRanking.individualRank;

				// Check if this is the worst underperformance (lower/negative is worse)
				// Tiebreak by score (lower score loses tiebreak)
				const isWorse = worstUnderperformance === null ||
					underperformance < worstUnderperformance ||
					(underperformance === worstUnderperformance && playerRanking.score < worstResult.score);

				if (isWorse) {
					worstUnderperformance = underperformance;
					worstResult = {
						tableId: table.id,
						score: playerRanking.score,
						placement: playerRanking.individualRank,
						underperformance: underperformance,
					};
				}
			}
		}

		return worstResult;
	}

	/**
	 * Get when a player carried their team the most (best performance relative to teammates)
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, carryAmount} or null
	 */
	static getBiggestCarry(tables, playerDiscordId) {
		let bestCarry = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => p.playerDiscordId === playerDiscordId);
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				p.playerDiscordId !== playerDiscordId &&
				players.find(player => player.playerDiscordId === p.playerDiscordId)?.teamIndex === targetPlayer.teamIndex,
			);

			// Skip if no teammates (not a team event)
			if (teammates.length === 0) continue;

			// Calculate average teammate score
			const teammateAvgScore = teammates.reduce((sum, teammate) => sum + teammate.score, 0) / teammates.length;
			const carryAmount = playerRanking.score - teammateAvgScore;

			// Check if this is the biggest carry (higher is better)
			// Tiebreak by score (higher score wins tiebreak)
			const isBetter = bestCarry === null ||
				carryAmount > bestCarry ||
				(carryAmount === bestCarry && playerRanking.score > bestResult.score);

			if (isBetter) {
				bestCarry = carryAmount;
				bestResult = {
					tableId: table.id,
					score: playerRanking.score,
					placement: playerRanking.individualRank,
					carryAmount: carryAmount,
				};
			}
		}

		return bestResult;
	}

	/**
	 * Get when a player anchored their team the most (worst performance relative to teammates)
	 * @param {Object} tables - Object containing table data
	 * @param {string} playerDiscordId - Discord ID of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, anchorAmount} or null
	 */
	static getBiggestAnchor(tables, playerDiscordId) {
		let worstAnchor = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerDiscordId === playerDiscordId);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => p.playerDiscordId === playerDiscordId);
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				p.playerDiscordId !== playerDiscordId &&
				players.find(player => player.playerDiscordId === p.playerDiscordId)?.teamIndex === targetPlayer.teamIndex,
			);

			// Skip if no teammates (not a team event)
			if (teammates.length === 0) continue;

			// Calculate average teammate score
			const teammateAvgScore = teammates.reduce((sum, teammate) => sum + teammate.score, 0) / teammates.length;
			const anchorAmount = playerRanking.score - teammateAvgScore;

			// Check if this is the biggest anchor (lower/negative is worse)
			// Tiebreak by score (lower score loses tiebreak)
			const isWorse = worstAnchor === null ||
				anchorAmount < worstAnchor ||
				(anchorAmount === worstAnchor && playerRanking.score < worstResult.score);

			if (isWorse) {
				worstAnchor = anchorAmount;
				worstResult = {
					tableId: table.id,
					score: playerRanking.score,
					placement: playerRanking.individualRank,
					anchorAmount: anchorAmount,
				};
			}
		}

		return worstResult;
	}

	/**
	 * Filter tables to only include those from the past week
	 * @param {Object} tables - Object of tables indexed by tableId
	 * @param {boolean} weeklyOnly - Whether to filter to past week only
	 * @returns {Object} Filtered tables object
	 */
	static filterTablesByWeek(tables, weeklyOnly = false) {
		if (!weeklyOnly) return tables;

		const oneWeekAgo = new Date();
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.createdOn) {
				const tableDate = new Date(table.createdOn);
				if (tableDate >= oneWeekAgo) {
					filtered[tableId] = table;
				}
			}
		}
		return filtered;
	}

	/**
	 * Filter tables to only include those from the current season
	 * @param {Object} tables - Object of tables indexed by tableId
	 * @param {boolean} seasonOnly - Whether to filter to current season only
	 * @param {number} currentSeason - The current season number (defaults to 1)
	 * @returns {Object} Filtered tables object
	 */
	static filterTablesBySeason(tables, seasonOnly = false, currentSeason = 1) {
		if (!seasonOnly) return tables;

		const filtered = {};
		for (const [tableId, table] of Object.entries(tables)) {
			if (table && table.season === currentSeason) {
				filtered[tableId] = table;
			}
		}
		return filtered;
	}

	/**
	 * Calculate win streaks for a player
	 * @param {Object} tables - Object containing table data (tableId -> table)
	 * @param {string} playerDiscordId - Discord ID of the player
	 * @returns {Object} Streak data including current and longest streaks
	 */
	static calculateWinStreaks(tables, playerDiscordId) {
		const playerTables = [];

		// Collect all tables where player participated
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams || !table.createdOn) continue;

			// Find player in this table
			let playerData = null;
			for (const team of table.teams) {
				const player = team.scores.find(p =>
					p.playerDiscordId === playerDiscordId,
				);
				if (player) {
					playerData = {
						...player,
						rank: team.rank,
						date: new Date(table.createdOn),
						tableId: parseInt(tableId),
					};
					break;
				}
			}

			if (playerData) {
				playerTables.push(playerData);
			}
		}

		// Sort by date (oldest first)
		playerTables.sort((a, b) => a.date - b.date);

		if (playerTables.length === 0) {
			return {
				currentWinStreak: 0,
				currentStreakMmrGain: 0,
				longestWinStreak: 0,
				longestStreakMmrGain: 0,
				longestStreakStart: null,
				longestStreakEnd: null,
			};
		}

		let currentStreak = 0;
		let currentStreakMmr = 0;
		let longestStreak = 0;
		let longestStreakMmr = 0;
		let longestStreakStart = null;
		let longestStreakEnd = null;
		let currentStreakStart = null;

		// Track streaks going through tables chronologically
		for (let i = 0; i < playerTables.length; i++) {
			const table = playerTables[i];
			const isWin = table.rank === 1;

			if (isWin) {
				if (currentStreak === 0) {
					currentStreakStart = table.date;
				}
				currentStreak++;
				currentStreakMmr += table.delta || 0;

				// Check if this is our new longest streak
				if (currentStreak > longestStreak) {
					longestStreak = currentStreak;
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
				else if (currentStreak === longestStreak && currentStreakMmr > longestStreakMmr) {
					// Same length but more MMR gained
					longestStreakMmr = currentStreakMmr;
					longestStreakStart = currentStreakStart;
					longestStreakEnd = table.date;
				}
			}
			else {
				// Streak broken
				currentStreak = 0;
				currentStreakMmr = 0;
				currentStreakStart = null;
			}
		}

		return {
			currentWinStreak: currentStreak,
			currentStreakMmrGain: currentStreakMmr,
			longestWinStreak: longestStreak,
			longestStreakMmrGain: longestStreakMmr,
			longestStreakStart: longestStreakStart,
			longestStreakEnd: longestStreakEnd,
		};
	}

	/**
	 * Get comprehensive player statistics including streaks
	 * @param {string} playerDiscordId - Discord ID of the player
	 * @param {string} serverId - Server ID to get tables for
	 * @returns {Promise<Object>} Player statistics including streak data
	 */
	static async getPlayerStats(playerDiscordId, serverId, tables) {
		try {
			// Calculate all stats
			const mMR = await LoungeApi.getCurrentMMR(playerDiscordId);
			const rank = await LoungeApi.getCurrentRank(playerDiscordId);
			const streakData = this.calculateWinStreaks(tables, playerDiscordId);
			const matchesPlayed = this.getMatchesPlayed(tables, playerDiscordId);
			const winRate = this.getWinRate(tables, playerDiscordId);
			const avgPlacement = this.getAveragePlacement(tables, playerDiscordId);
			const avgScore = this.getAverageScore(tables, playerDiscordId);
			const avgSeed = this.getAverageSeed(tables, playerDiscordId);
			const bestScore = this.getBestScore(tables, playerDiscordId);
			const worstScore = this.getWorstScore(tables, playerDiscordId);
			const tH2H = await this.getTotalH2H(tables, playerDiscordId, serverId);

			return {
				mMR,
				rank,
				playerDiscordId,
				matchesPlayed,
				winRate,
				avgPlacement,
				avgScore,
				avgSeed,
				...streakData,
				bestScore,
				worstScore,
				tH2H,
			};
		}
		catch (error) {
			console.error(`Error getting player stats for ${playerDiscordId}:`, error);
			return null;
		}
	}
}

module.exports = PlayerStats;