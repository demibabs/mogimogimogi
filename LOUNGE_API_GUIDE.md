# Mario Kart World Lounge API Integration

## 🎉 **SETUP COMPLETE!**

Your Discord bot now has full Mario Kart World Lounge API integration.

## 📋 **Available Commands**

### `/api-test`
Tests the connection to the Mario Kart World Lounge API and provides detailed status information.

### `/player [name] [user] [season]`
Search for player information from the Mario Kart World Lounge database.
- **name**: Player name to search for
- **user**: Discord user to search for (by Discord ID)  
- **season**: Season number (optional, defaults to current season)

**Examples**:
- `/player name:PlayerName`
- `/player user:@SomeUser`
- `/player name:PlayerName season:1`

### `/table <table_id>`
Get detailed information about a specific race table from Mario Kart World.
- **table_id**: The table ID to look up (required)

**Example**: `/table table_id:12345`

## 🔧 **API Configuration**

### Base URL
```
https://lounge.mkcentral.com/api
```

### Game Parameter
All API calls now include `game: "mkworld"` to specify Mario Kart World data.

### Authentication
Most endpoints work without authentication (marked as `[AllowAnonymous]` in the API). If you need access to authenticated endpoints, you can add credentials to `utils/loungeApi.js`:

```javascript
const AUTH_CONFIG = {
    username: "your_username",
    password: "your_password",
};
```

### Key Endpoints Used
- `/api/player?name={name}&season={season}&game=mkworld`
- `/api/player?discordId={discordId}&season={season}&game=mkworld`
- `/api/player?mkcId={mkcId}&season={season}&game=mkworld`
- `/api/player/details?name={name}&season={season}&game=mkworld`
- `/api/table?tableId={id}`
- `/api/penalty/list?name={name}&isStrike=true&game=mkworld`

## 📁 **File Structure**

```
commands/utility/
├── api-test.js     - API connection testing
├── player.js       - Player lookup command
├── table.js        - Table lookup command
└── ...

utils/
└── loungeApi.js    - Main API utility library
```

## 🚀 **Usage Guide**

1. **Start your Discord bot**:
   ```bash
   node index.js
   ```

2. **Test the API connection**:
   Use `/api-test` in Discord to verify everything is working

3. **Search for players**:
   - `/player name:PlayerName` - Search by name
   - `/player user:@DiscordUser` - Search by Discord user

4. **Get race information**:
   - `/table table_id:12345` - Get table details

## 🔍 **Troubleshooting**

### "Player not found"
- Check the spelling of the player name
- Try different seasons using the `season` parameter
- Verify the player is registered in Mario Kart Lounge

### "API Connection Failed"
- Run `/api-test` to get detailed error information
- Check if https://www.mk8dx-lounge.com is accessible
- Wait a few minutes and try again (might be temporary)

### Authentication Issues
- Most commands work without authentication
- If you get 401/403 errors, you may need API credentials
- Contact Mario Kart Lounge staff for API access if needed

## 📊 **Data Sources**

This implementation is based on the working Python bot **StatsBot-150cc-Lounge** which successfully uses the same API endpoints. The JavaScript version provides the same functionality with proper error handling and Discord integration.

## 🎯 **Next Steps**

- Test the commands in your Discord server
- Customize the embed colors and formatting if desired
- Add more advanced features like leaderboards or statistics
- Set up authentication if you need access to admin endpoints

## 🔗 **Related Links**

- Mario Kart Lounge: https://www.mk8dx-lounge.com
- API Documentation: https://www.mk8dx-lounge.com/swagger (if available)
- Original Python Bot: StatsBot-150cc-Lounge repository