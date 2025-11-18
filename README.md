# mogimogimogi

> Discord slash-command bot for Mario Kart World Lounge stats and server insights. This repository documents the single production instance that powers the public bot.

## Table of Contents
- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Command Catalog](#command-catalog)
- [Architecture](#architecture)
  - [Runtime Flow](#runtime-flow)
  - [Rendering Pipeline](#rendering-pipeline)
  - [Storage & Caching](#storage--caching)
- [Tech Stack](#tech-stack)
- [Directory Map](#directory-map)
- [Operational Notes](#operational-notes)
- [Future Work](#future-work)
- [License](#license)

## Overview
mogimogimogi is a Discord bot designed to provide competitive Mario Kart World players with detailed stats, synthesized into customizable player cards. All functionality is exposed through Discord slash commands and backed by a custom data pipeline that blends live Lounge API data with cached Discord server context.

## Core Capabilities
- **Stats Cards**: `/stats` renders 1920×1080 canvases combining player MMR, streaks, track-specific palettes, avatars, and queue filters.
- **Highlights & Storytelling**: `/notables` shows best/worst events along with biggest carries and anchors.
- **Comparative Insights**: `/head-to-head` calculates win/loss records against specific opponents, including biggest victories and losses.
- **Usage Metrics**: `/about-me` exposes live deployment stats plus a rundown of the available commands.
- **Customization**: `/customize` lets users save favorite characters, vehicles and tracks to personalize their stats cards.
- **Autonomous User Syncing**: AutoUserManager keeps the cached lounge records, Discord IDs, and avatars aligned without manual intervention.

## Command Catalog
| Command | Focus |
|---------|-------|
| `/stats [player]` | Full stat card with filters for time range, queue, and player count. |
| `/notables` | Highlight + lowlight reel of a player's best and worst events. |
| `/head-to-head <player1> <player2>` | Shows players' win/loss records across shared events. |
| `/leaderboard` | Displays a server-wide MMR leaderboard. |
| `/about-me` | Deployment info and command help. |
| `/customize` | Capture favorite characters, vehicles, flags, and other preferences. |
| `/setup` | Internal onboarding helper for wiring the bot to a new guild. |

## Architecture
### Runtime Flow
1. **Slash command entry** (`commands/global/*`): validates the requester, resolves lounge IDs, and builds filter state.
2. **Data hydration** (`utils/loungeApi`, `utils/dataManager`): merges Lounge API responses with cached Discord metadata.
3. **Computation** (`utils/playerStats`): derives averages, partner scores, per-queue filters, etc.
4. **Rendering** (`utils/embedEnhancer`, `utils/colorPalettes`, `images/`): composes canvases, fonts, gradients, emoji glyphs, and charts.
5. **Response lifecycle**: edits the original interaction reply with the generated attachment plus interactive components.

### Rendering Pipeline
- **Canvas** (`canvas` package) draws the background, rounded panels, avatars, partner assets, and grid typography.
- **Chart Layer** (`chartjs-node-canvas`) renders the division histogram and exposes bar metrics for the "you are here" marker.
- **Emoji Glyphs**: Emojis are embedded as Twemoji PNGs to show up in labels and names.
- **Asset Packs**: Track backgrounds and rank icons live under `images/`; color palettes come from `utils/colorPalettes.js` with per-track gradients, accent values, and text colors.

### Storage & Caching
- **Primary Store**: PostgreSQL (`tables`, `user_data`, `user_tables`, plus cache tables for leaderboards/streaks).
- **File Fallback**: When `DATABASE_URL` is absent (local dev), the same schema is mirrored in `data/` JSON files.
- **In-Memory Caches**: Division chart renderings, image assets, and stats sessions stay hot for faster rerenders and button interactions.
- **Auto Migration Tools**: `scripts/migrateLocalData.js` handles legacy server JSON to the new user-centric format.

## Tech Stack
- **Runtime**: Node.js 18+, Discord.js v14 REST/WebSocket adapters.
- **Rendering**: `canvas`, `chart.js`, `chartjs-node-canvas`, `stackblur-canvas`, custom font registration.
- **Data**: PostgreSQL via `pg`, optional JSON persistence, bespoke Lounge API client with rate limiting and caching.
- **Utilities**: `twemoji`, `patternomaly` for randomized chart fills, `sharp` for image conversions.
- **Tooling**: ESLint (flat config) + npm scripts for linting, deploy, and start commands.

## Directory Map
```
commands/          Slash-command handlers (global + utility scopes)
data/              JSON persistence layer when running without PostgreSQL
fonts/             Bundled Lexend + emoji fonts registered at startup
images/            Track backgrounds, rank icons, avatars, miscellaneous art
scripts/           Maintenance helpers (migrations, data sync)
utils/             Shared helpers (database, lounge API, player stats, renderers)
deploy.js          Command registration entry point
index.js           Bot bootstrap (Discord client + health endpoint)
```

## License
Distributed under the ISC license. See `LICENSE` for the full text.
