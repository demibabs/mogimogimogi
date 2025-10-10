/**
 * Script to clear corrupted streak cache data from the database
 * Run this to clean up the corrupted JSON data
 */

const database = require("./utils/database");

async function clearCorruptedStreakCache() {
	try {
		console.log("Clearing all streak cache data...");
		
		// Clear all streak cache data
		await database.pool.query("DELETE FROM streak_cache");
		
		console.log("✅ All streak cache data cleared!");
		console.log("The streak cache will rebuild automatically when users run /streaks");
		
		// Close the database connection
		if (database.pool) {
			await database.pool.end();
		}
		
		process.exit(0);
	}
	catch (error) {
		console.error("❌ Error clearing streak cache data:", error);
		process.exit(1);
	}
}

clearCorruptedStreakCache();