/**
 * Script to create the streak_cache table in the database
 * Run this once to add the missing table
 */

const database = require("./utils/database");

async function createStreakTable() {
	try {
		console.log("Creating streak_cache table...");
		
		// Streak cache table for persistent streak cache across deploys
		await database.pool.query(`
			CREATE TABLE IF NOT EXISTS streak_cache (
				id SERIAL PRIMARY KEY,
				server_id VARCHAR(20) NOT NULL,
				user_id VARCHAR(20) NOT NULL,
				cache_data JSONB NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(server_id, user_id)
			)
		`);

		// Index for faster streak cache lookups
		await database.pool.query(`
			CREATE INDEX IF NOT EXISTS idx_streak_cache_server 
			ON streak_cache(server_id)
		`);

		await database.pool.query(`
			CREATE INDEX IF NOT EXISTS idx_streak_cache_updated 
			ON streak_cache(updated_at)
		`);

		console.log("✅ streak_cache table created successfully!");
		
		// Close the database connection
		if (database.pool) {
			await database.pool.end();
		}
		
		process.exit(0);
	}
	catch (error) {
		console.error("❌ Error creating streak_cache table:", error);
		process.exit(1);
	}
}

createStreakTable();