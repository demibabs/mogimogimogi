/**
 * Player statistics utility functions
 * Pure functions that calculate stats from table data without data fetching
 */

const ServerData = require("./serverData");

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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Player object with ranking info, or null if not found
	 */
	static getPlayerRankingInTable(table, playerName) {
		const rankings = PlayerStats.getIndividualPlayerRankings(table);
		return rankings.find(player =>
			player.playerName.toLowerCase() === playerName.toLowerCase(),
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
	 * @param {string} playerName - Name of the player
	 * @returns {number} Number of matches played
	 */
	static getMatchesPlayed(tables, playerName) {
		let matches = 0;
		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (player.playerName === playerName) {
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
	 * @param {string} playerName - Name of the player
	 * @returns {number} Win rate (0-1) or -1 if no matches played
	 */
	static getWinRate(tables, playerName) {
		let wins = 0;
		let losses = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const players = PlayerStats.getPlayersFromTable(table);

			for (const player of players) {
				if (player.playerName === playerName) {
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
	 * @param {string} playerName - Name of the player
	 * @returns {number} Average placement or -1 if no matches played
	 */
	static getAveragePlacement(tables, playerName) {
		let totalPlacement = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;

			const playerRanking = PlayerStats.getPlayerRankingInTable(table, playerName);
			if (playerRanking) {
				totalPlacement += playerRanking.individualRank;
				matchesFound++;
			}
		}

		if (matchesFound === 0) return -1;
		return totalPlacement / matchesFound;
	}

	static getAverageScore(tables, playerName) {
		let totalScore = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			if (!table || !table.teams) continue;
			const players = PlayerStats.getPlayersFromTable(table);
			for (const player of players) {
				if (player.playerName === playerName) {
					totalScore += player.score;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalScore / matchesFound;
	}

	static getAverageSeed(tables, playerName) {
		let totalSeed = 0;
		let matchesFound = 0;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getIndividualPlayerSeeds(table);
			for (const player of players) {
				if (player.playerName === playerName) {
					totalSeed += player.individualSeed;
					matchesFound++;
				}
			}
		}
		if (matchesFound === 0) return -1;
		return totalSeed / matchesFound;
	}

	static async checkIfServerTable(userId, table, serverId) {
		const serverData = await ServerData.getServerData(serverId);
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
		const serverData = await ServerData.getServerData(serverId);
		for (const tableId of serverData.users[userId1].tables) {
			const table = serverData.tables[tableId];
			const playersTable = PlayerStats.getPlayersFromTable(table);
			for (const player of playersTable) {
				if (player.playerDiscordId == userId2) {
					tables[tableId] = table;
				}
			}
		}
		return tables;
	}

	static async getTotalH2H(tables, playerName, serverId) {
		const serverData = await ServerData.getServerData(serverId);
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
					if (PlayerStats.getPlayerRankingInTable(table, playerName).individualRank < PlayerStats.getPlayerRankingInTable(table, player.playerName).individualRank) {
						record.wins++;
					}
					else if (PlayerStats.getPlayerRankingInTable(table, playerName).individualRank > PlayerStats.getPlayerRankingInTable(table, player.playerName).individualRank) {
						record.losses++;
					}
					else if (playerName !== player.playerName) {
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
	 * @param {string} player1Name - Name of the first player
	 * @param {string} player2Name - Name of the second player
	 * @returns {Object} Record object with {wins, losses, ties} from player1's perspective
	 */
	static getH2H(tables, player1Name, player2Name) {
		const record = {
			wins: 0,
			losses: 0,
			ties: 0,
		};

		// Return empty record if same player
		if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
			return record;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, player1Name);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, player2Name);

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
	 * @param {string} player1Name - Name of the first player
	 * @param {string} player2Name - Name of the second player
	 * @returns {Object|null} Object with {tableId, player1Score, scoreDifference, player1Rank, rankDifference} or null if player1 never beat player2
	 */
	static getBiggestDifference(tables, player1Name, player2Name) {
		let biggestDifference = null;
		let bestResult = null;

		// Return null if same player
		if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
			return null;
		}

		for (const tableId in tables) {
			const table = tables[tableId];

			// Get rankings for both players in this table
			const player1Ranking = PlayerStats.getPlayerRankingInTable(table, player1Name);
			const player2Ranking = PlayerStats.getPlayerRankingInTable(table, player2Name);

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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getBestScore(tables, playerName) {
		let bestScore = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			for (const player of players) {
				if (player.playerName === playerName) {
					const playerRanking = rankings.find(p => p.playerName === playerName);
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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {score, placement, tableId} or null if no matches found
	 */
	static getWorstScore(tables, playerName) {
		let worstScore = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			for (const player of players) {
				if (player.playerName === playerName) {
					const playerRanking = rankings.find(p => p.playerName === playerName);
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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, overperformance} or null
	 */
	static getBiggestOverperformance(tables, playerName) {
		let bestOverperformance = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerName === playerName);
			const playerSeed = seeds.find(p => p.playerName === playerName);

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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, underperformance} or null
	 */
	static getBiggestUnderperformance(tables, playerName) {
		let worstUnderperformance = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const seeds = PlayerStats.getIndividualPlayerSeeds(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerName === playerName);
			const playerSeed = seeds.find(p => p.playerName === playerName);

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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, carryAmount} or null
	 */
	static getBiggestCarry(tables, playerName) {
		let bestCarry = null;
		let bestResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerName === playerName);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => p.playerName === playerName);
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				p.playerName !== playerName &&
				players.find(player => player.playerName === p.playerName)?.teamIndex === targetPlayer.teamIndex,
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
	 * @param {string} playerName - Name of the player to find
	 * @returns {Object|null} Object with {tableId, score, placement, anchorAmount} or null
	 */
	static getBiggestAnchor(tables, playerName) {
		let worstAnchor = null;
		let worstResult = null;

		for (const tableId in tables) {
			const table = tables[tableId];
			const players = PlayerStats.getPlayersFromTable(table);
			const rankings = PlayerStats.getIndividualPlayerRankings(table);

			// Find the player in this table
			const playerRanking = rankings.find(p => p.playerName === playerName);
			if (!playerRanking) continue;

			const targetPlayer = players.find(p => p.playerName === playerName);
			if (!targetPlayer) continue;

			// Find teammates (same teamIndex)
			const teammates = rankings.filter(p =>
				p.playerName !== playerName &&
				players.find(player => player.playerName === p.playerName)?.teamIndex === targetPlayer.teamIndex,
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
}

module.exports = PlayerStats;