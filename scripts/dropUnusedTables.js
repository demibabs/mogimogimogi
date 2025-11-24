require("dotenv").config();
const { Pool } = require("pg");

const RELATIONS_TO_DROP = [
	"leaderboard_cache",
	"server_data",
	"streak_cache",
];

const DROP_STATEMENTS = [
	name => `DROP TABLE IF EXISTS ${name} CASCADE;`,
	name => `DROP VIEW IF EXISTS ${name} CASCADE;`,
	name => `DROP MATERIALIZED VIEW IF EXISTS ${name} CASCADE;`,
];

async function run() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error("DATABASE_URL is not set. Aborting.");
		process.exit(1);
	}

	const pool = new Pool({
		connectionString,
		ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
	});

	try {
		for (const rawName of RELATIONS_TO_DROP) {
			const escaped = rawName.replace(/"/g, "\"\"");
			const safeName = `"${escaped}"`;
			for (const buildStatement of DROP_STATEMENTS) {
				const statement = buildStatement(safeName);
				try {
					await pool.query(statement);
					console.log(`Executed: ${statement.trim()}`);
				}
				catch (error) {
					console.error(`Failed on ${statement.trim()}:`, error.message);
				}
			}
		}
	}
	finally {
		await pool.end();
	}
}

run().catch(error => {
	console.error("Unexpected error while dropping tables:", error);
	process.exit(1);
});
