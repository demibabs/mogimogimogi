#!/usr/bin/env node
/**
 * Destructive migration script.
 * Drops and recreates all database tables via database.purgeAll(), then enumerates
 * every guild the bot is in and re-adds all non-bot members using DataManager.addServerUser.
 * Safety guard: requires MIGRATE_FORCE=1 env or --force CLI flag.
 */
const database = require("../utils/database");
const DataManager = require("../utils/dataManager");
const { Client, GatewayIntentBits } = require("discord.js");

async function destructiveReinit({ logger = console, useDatabase = Boolean(process.env.DATABASE_URL) } = {}) {
	if (!useDatabase) {
		logger.error("DATABASE_URL not set; cannot perform destructive migration.");
		return { success: false, reason: "no_database" };
	}

	const force = process.env.MIGRATE_FORCE === "1" || process.argv.includes("--force");
	if (!force) {
		logger.error("Refusing to run destructive migration without MIGRATE_FORCE=1 or --force flag.");
		return { success: false, reason: "not_forced" };
	}

	const token = process.env.DISCORD_TOKEN || process.env.DEV_DISCORD_TOKEN;
	if (!token) {
		logger.error("Missing DISCORD_TOKEN/DEV_DISCORD_TOKEN for guild enumeration.");
		return { success: false, reason: "no_token" };
	}

	const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

	await new Promise((resolve, reject) => {
		client.once("ready", resolve);
		client.once("error", reject);
		client.login(token).catch(reject);
	});

	logger.log("Discord client ready. Purging database...");
	const purgeOk = await database.purgeAll();
	if (!purgeOk) {
		logger.error("Database purge failed.");
		await client.destroy();
		return { success: false, reason: "purge_failed" };
	}

	const guilds = client.guilds.cache;
	logger.log(`Found ${guilds.size} guild(s). Reinitializing users...`);
	const results = [];

	for (const [guildId, guild] of guilds) {
		logger.log(`Processing guild ${guildId} (${guild.name})`);
		let added = 0;
		try {
			const members = await guild.members.fetch();
			for (const [userId, member] of members) {
				if (member.user.bot) continue;
				const ok = await DataManager.addServerUser(guildId, userId, client);
				if (ok) added++;
			}
			logger.log(`Guild ${guildId}: added ${added} users.`);
			results.push({ guildId, added });
		}
		catch (error) {
			logger.error(`Guild ${guildId} setup error: ${error.message}`);
			results.push({ guildId, added, error: error.message });
		}
	}

	await client.destroy();
	logger.log("Destructive migration complete.");
	return { success: true, results };
}

async function main() {
	const summary = await destructiveReinit();
	if (!summary.success) {
		console.error("Migration failed:", summary.reason);
		process.exitCode = 1;
		return;
	}
	for (const r of summary.results) {
		console.log(`Guild ${r.guildId}: added ${r.added}${r.error ? ` (error: ${r.error})` : ""}`);
	}
}

if (require.main === module) {
	main().catch(error => {
		console.error("Migration script fatal error:", error);
		process.exitCode = 1;
	});
}

module.exports = { destructiveReinit };
