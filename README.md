# mogimogimogi

A Discord bot for Mario Kart World Lounge statistics and player management.

## Features

- **Player Statistics**: View detailed player stats and rankings
- **Head-to-Head Comparisons**: Compare two players with win/loss records and biggest victories
- **Notable Performances**: Display standout race results and achievements
- **Server Setup**: Easy bot configuration for Discord servers
- **Persistent Data**: PostgreSQL database storage for reliable data persistence

## Commands

- `/setup` - Configure the bot for your server
- `/stats <player>` - View player statistics and rankings
- `/head-to-head <player1> <player2>` - Compare two players head-to-head
- `/notables` - Display notable race performances

## Setup

### Prerequisites

- Node.js 18.x or higher
- Discord bot token
- Mario Kart Central Lounge API access

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/demibabs/mogimogimogi.git
   cd mogimogimogi
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in your Discord bot credentials in `.env`

4. Deploy commands:
   ```bash
   # For production
   node deploy --global
   
   # For development
   node deploy --dev
   ```

5. Start the bot:
   ```bash
   # Production bot
   node index
   
   # Development bot
   node index --dev
   ```

## Deployment

This bot is configured for deployment on [Railway](https://railway.app):

1. Connect your GitHub repository to Railway
2. Add a PostgreSQL database to your Railway project
3. Set environment variables in Railway:
   - `DISCORD_TOKEN`
   - `APP_ID`
   - `GUILD_ID`
4. Deploy automatically via GitHub integration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `APP_ID` | Your Discord application ID |
| `GUILD_ID` | Your Discord server ID |
| `DEV_DISCORD_TOKEN` | Development bot token (optional) |
| `DEV_APP_ID` | Development application ID (optional) |
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway) |

## Development

### Dual Bot Setup

For testing without interfering with production:

- Production: `node index` and `node deploy`
- Development: `node index --dev` and `node deploy --dev`

### Database

- **Production**: Uses PostgreSQL database on Railway
- **Development**: Falls back to local JSON file storage

## License

Feel free to use this project if you want!
