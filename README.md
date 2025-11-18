# mogimogimogi

> Discord slash-command bot for Mario Kart World Lounge stats, player insights, and automation.

## Table of Contents
- [Overview](#overview)
- [Highlights](#highlights)
- [Slash Commands](#slash-commands)
- [Tech Stack](#tech-stack)
- [Project Layout](#project-layout)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Deployment](#deployment)
- [Data & Assets](#data--assets)
- [Linting & Tooling](#linting--tooling)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Overview
mogimogimogi keeps Discord servers in sync with Mario Kart World Lounge (MKW Lounge) by rendering high-signal stat cards, surfacing standout performances, and tracking player activity. The bot runs entirely on slash commands and can be deployed with either a managed PostgreSQL database or local JSON storage for quick prototypes.

## Highlights
- Rich `/stats` cards rendered with Canvas + Chart.js (MMR chart, avatars, favorite assets, win/loss breakdowns)
- `/notables` highlight reels for top scores, carries, anchors, and streaks
- `/head-to-head` breakdowns and lounge-aware auto-complete
- Automatic user syncing, lounge profile lookups, and emoji-safe text rendering
- Dual storage model: PostgreSQL in production, JSON files in development
- Asset pipeline for track backgrounds, Twemoji glyphs, custom fonts, and rank icons

## Slash Commands
| Command | Description |
|---------|-------------|
| `/setup` | Walk through initial server setup and link the bot to your guild |
| `/stats [player]` | Render the interactive stats card for yourself or any lounge player |
| `/notables` | Generate highlight columns showing best/worst performances |
| `/head-to-head <player1> <player2>` | Compare two players with records, deltas, and key events |
| `/leaderboard` | Display per-server or global standings (filters available) |
| `/about-me` | Show deployment health (servers, tracked users, tables) |
| `/customize` | Store favorite characters, vehicles, and other cosmetic choices |

## Tech Stack
- Node.js 18+ with Discord.js v14 slash-command router
- Canvas, Chart.js, and Twemoji for server-side image rendering
- PostgreSQL via `pg`, with automatic JSON fallbacks under `data/`
- Lightweight utilities for Lounge API access, auto user management, and color palettes

## Project Layout
```
mogibot/
├─ commands/           # Slash command implementations
│  ├─ global/          # User-facing commands (stats, notables, etc.)
│  └─ utility/         # Maintenance and helper commands
├─ data/               # JSON fallback storage (users, tables, user_tables)
├─ images/             # Track backgrounds, rank icons, misc art
├─ fonts/              # Lexend + emoji fonts registered at runtime
├─ scripts/            # One-off maintenance scripts (e.g., migrateLocalData)
├─ utils/              # Core helpers (database, lounge API, player stats, rendering)
├─ deploy.js           # Slash-command registration
├─ index.js            # Bot entry point (REST adapter + Discord client)
└─ package.json        # Dependencies and npm scripts
```

## Getting Started

### Prerequisites
- Node.js 18.x (or newer) and npm
- Discord application with a bot user and the `applications.commands` + `bot` scopes
- Access to MK World Lounge API (public endpoints are sufficient)
- Optional: PostgreSQL database (Railway, Supabase, RDS, etc.) if you want persistent storage

### Installation
```bash
git clone https://github.com/demibabs/mogimogimogi.git
cd mogimogimogi
npm install
```

### Configuration
Create a `.env` file at the repo root and provide the tokens/IDs you need:

```
DISCORD_TOKEN=prod-bot-token
DEV_DISCORD_TOKEN=dev-bot-token
APP_ID=prod-application-id
DEV_APP_ID=dev-application-id
GUILD_ID=dev-guild-id-for-command-registration
DATABASE_URL=postgres://user:pass@host:5432/dbname
PORT=3000
NODE_ENV=development
```

Environment variable reference:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | yes | Production bot token used by `node index` |
| `DEV_DISCORD_TOKEN` | no | Dev/testing token consumed by `node index --dev` |
| `APP_ID` | yes | Application ID for slash-command deploys |
| `DEV_APP_ID` | no | Dev application ID for `node deploy --dev` |
| `GUILD_ID` | yes for dev | Guild to register commands during development (global deploy ignores this) |
| `DATABASE_URL` | no | PostgreSQL connection string; when unset the bot stores data under `data/` |
| `PORT` | no | Port for the tiny health server (defaults to 3000) |
| `NODE_ENV` | no | Controls SSL requirements when connecting to PostgreSQL |

> The repository falls back to JSON on disk (`data/users`, `data/tables`, `data/user_tables`) whenever `DATABASE_URL` is not provided. This is perfect for local testing and unit experiments.

## Running the Bot
Deploy commands first, then launch the bot:

```bash
# Register commands globally (may take up to an hour to propagate)
node deploy --global

# Register commands to a single dev guild
node deploy --dev

# Start production bot
node index

# Start development bot with dev tokens/IDs
node index --dev
```

## Deployment
mogimogimogi runs anywhere Node 18+ is available:

1. Provision hosting (Railway, Fly.io, Render, Docker, etc.).
2. Provide the environment variables above (Railway will auto-populate `DATABASE_URL`).
3. Make sure the process runs `node index` (or `npm start`).
4. Keep the accompanying PostgreSQL instance (or local JSON volume) persistent across restarts.

The included `deploy.js` script can be run from CI to re-register commands during release pipelines.

## Data & Assets
- Local JSON storage lives under `data/` and mirrors the PostgreSQL schema (`user_data`, `tables`, `user_tables`).
- Track backgrounds, rank icons, and badges reside in `images/`. When you add new tracks, drop the assets there.
- Fonts (Lexend, emoji fallbacks) are loaded from `fonts/`. Add new variants here and register them in `utils/fonts.js`.
- `scripts/migrateLocalData.js` can import/export JSON files or seed a database as needed.

## Linting & Tooling
- Run `npx eslint .` (or the scoped command) before opening a PR.
- `node deploy` and `node index` double as smoke tests because they exercise command registration and login.
- Use `npm start` as a shorthand for `node index.js` in production environments.

## Troubleshooting
- **Commands missing**: ensure you ran `node deploy --global` or `node deploy --dev` with the correct tokens/IDs.
- **Database errors**: verify `DATABASE_URL` and, in production, set `NODE_ENV=production` so SSL is required only when needed.
- **Blank stat images**: missing assets in `images/tracks` or fonts in `fonts/` will be logged. Re-run the bot after syncing assets.
- **Rate limits**: Lounge API requests are cached aggressively; still, avoid spamming `/stats` by batching requests via the built-in UI buttons.

## License
Distributed under the ISC license. See `LICENSE` for the full text.
