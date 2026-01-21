# NA Forays Schedule Bot

A Discord bot that displays FFXIV NA datacenter raid schedules (Baldesion Arsenal, Forked Tower, Delubrum Reginae Savage) from participating host servers using Discord's components_v2 containers.

## Features

- **Server-specific configuration** (choose which host servers to display)
- **Automatic updates** every 60 seconds with hash-based change detection
- **Multi-server deployment** support with whitelist/blacklist system
- **Customizable embed colors** per raid type
- **AES-256-GCM encryption** for all configuration data
- **Encrypted state management** for schedule caching
- **Rate limiting** to prevent abuse
- **Health check endpoint** for monitoring
- **Database migrations** for easy updates
- **Comprehensive error handling and logging**

## Requirements

- Node.js 18.0.0 or higher
- Discord.js 14.14.0 or higher
- MariaDB/MySQL database with read access to schedule aggregator table
- Discord Bot Token with appropriate permissions

## Hosted Bot Setup

<details>
<summary>Click to expand Setup instructions</summary>

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

#### Create Bot Tables

Run the schema located in `database/schema.sql` to create the required tables:

```sql
-- Server configurations table
CREATE TABLE IF NOT EXISTS `na_bot_server_configs` (
  `guild_id` VARCHAR(20) NOT NULL,
  `guild_name` VARCHAR(255) DEFAULT NULL,
  `setup_complete` TINYINT(1) DEFAULT 0,
  `auto_update` TINYINT(1) DEFAULT 1,
  -- ... (see database/schema.sql for complete schema)
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Whitelisted guilds table (for private beta)
CREATE TABLE IF NOT EXISTS `na_bot_whitelisted_guilds` (
  `guild_id` VARCHAR(20) NOT NULL,
  -- ... (see database/schema.sql for complete schema)
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Whitelisted host servers table
CREATE TABLE IF NOT EXISTS `na_bot_whitelisted_hosts` (
  `server_name` VARCHAR(100) NOT NULL,
  -- ... (see database/schema.sql for complete schema)
  PRIMARY KEY (`server_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### Source Data Table

The bot requires read access to a table containing posted run aggregator data with the following structure:

- `ID` - Unique identifier
- `Type` - Run type (Fresh, Learning, Reclear, etc.)
- `Start` - Unix timestamp (milliseconds)
- `ServerNameTag` - Server tag
- `ServerID` - Discord server ID
- `RunDC` - Datacenter
- `ServerName` - Host server name
- `referenceLink` - Link to original post
- `SourceMessageID` - Discord message ID
- `EventID` - Event identifier
- `isCancelled` - Boolean flag
- `DRS` - Boolean (1 if DRS run)
- `FT` - Boolean (1 if Forked Tower run)
- `BA` - Implied by DRS=0 and FT=0

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
BOT_OWNER_ID=your_discord_user_id_here
DEV_SERVER_ID=your_dev_discord_server_id_here

# Database Configuration
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password

#Source Database & Table Names
DB_SOURCE_NAME=your_source_db_name_here
DB_TABLE_NAME=your_schedule_table_name_here

# Environment
NODE_ENV=production_or_dev
LOG_LEVEL=info_or_debug
IS_DEV_BOT=true_or_false

#Whitelist Configuration
WHITELIST_ENABLED=true_or_false

# Optional: Health Check Port
HEALTH_PORT=3000

# Encryption (REQUIRED)
ENCRYPTION_KEY=your_64_character_hex_key_here
```

**Important Environment Variables:**

- `DISCORD_TOKEN`: Get from [Discord Developer Portal](https://discord.com/developers/applications)
- `DISCORD_CLIENT_ID`: Same location as bot token
- `BOT_OWNER_ID`: Your Discord user ID (right-click your name with Developer Mode enabled)
- `DB_SOURCE_NAME`: Name of the database containing schedule data
- `DB_TABLE_NAME`: Name of the table with run aggregator data
- `ENCRYPTION_KEY`: **REQUIRED** - 64 hex character (32 byte) encryption key

**Generate Encryption Key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ **Important**: 
- Keep the encryption key secure and backed up
- Never commit the key to version control
- Losing the key means permanent data loss
- Use different keys for development and production

### 4. Whitelist Your Server

For private deployment, add your Discord server to the whitelist if needed:

Set WHITELIST_ENABLED=TRUE in .env

```sql
INSERT INTO na_bot_whitelisted_guilds (guild_id, guild_name, added_by, is_active)
VALUES ('YOUR_SERVER_ID', 'Your Server Name', 'system', 1);
```

To get your server ID: Right-click your server icon with Developer Mode enabled > Copy Server ID

### 5. Deploy Slash Commands

```bash
npm run deploy
```

This registers the `/na-schedule` command with Discord.

### 6. Start the Bot

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

**Health Check:**

If `HEALTH_PORT` is set (default: 3000), the bot exposes a health endpoint:

```bash
curl http://localhost:3000/health
```

Response includes:
- Bot status
- Database connectivity
- Uptime information

</details>

## Commands

- `/na-schedule` - Opens the configuration wizard for first-time setup, or the configuration menu for servers that are already configured (requires Manage Server permission)

## Configuration

After running `/na-schedule` for the first time, follow the wizard to:

1. **Select Raid Types** - Choose which schedules to display (BA, FT, DRS)
2. **Choose Channels** - Select dedicated channels for each raid type, bot checks if it has permissions and responds if not
3. **Select Host Servers** - Pick which host servers' runs to display
4. **Confirm Setup** - Review and confirm your configuration

After initial setup, use `/na-schedule` again to:

- Change enabled host servers
- Toggle auto-updates
- Manually refresh schedules
- Customize container colors
- Reset configuration

## Deployment

<details>
<summary>Click to expand Deployment options</summary>

### Using PM2 (Recommended)

```bash
npm install -g pm2
pm2 start index.js --name "na-schedule-bot"
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/na-schedule-bot.service`:

```ini
[Unit]
Description=NA Forays Schedule Discord Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/NA_ForaysSchedule
ExecStart=/usr/bin/node index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable na-schedule-bot
sudo systemctl start na-schedule-bot
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "index.js"]
```

```bash
docker build -t na-schedule-bot .
docker run -d --env-file .env --name na-schedule-bot na-schedule-bot
```

</details>

## Security

<details>
<summary>Click to expand Security features</summary>

- **AES-256-GCM Encryption**: Guild IDs, names, and configuration encrypted at rest
- **Encrypted State Management**: Schedule cache uses encrypted JSON storage
- **Rate Limiting**: Built-in rate limiting prevents command/interaction spam
- **Input Validation**: All user inputs are validated before database operations
- **Access Control**: Whitelist (beta) and blacklist (production) systems
- **Permissions**: Commands require appropriate Discord permissions (Manage Server)

**Management Tools:**

- `scripts/manage-whitelist.js` - Manage whitelisted servers
- `scripts/manage-blacklist.js` - Manage blacklisted servers
- `scripts/batch-add-whitelist.js` - Bulk whitelist operations
- `scripts/check-encryption.js` - Verify encryption integrity

</details>

## Troubleshooting

<details>
<summary>Click to expand Troubleshooting guide</summary>

### Bot doesn't respond to commands

1. Verify bot token is correct in `.env`
2. Ensure commands were deployed: `npm run deploy`
3. Check bot has required permissions in your server
4. Review logs in `logs/` directory

### Database connection errors

1. Verify database credentials in `.env`
2. Ensure database user has proper permissions
3. Check database server is running and accessible
4. Verify table structure matches schema

### Schedules not updating

1. Check auto-update is enabled in configuration
2. Verify source table has recent data
3. Review logs for errors
4. Manually refresh using the config menu

### "Server not whitelisted" error

1. Add your server ID to `na_bot_whitelisted_guilds` table
2. Ensure `is_active` is set to 1
3. Restart the bot after adding to whitelist

### Encryption errors

1. Verify `ENCRYPTION_KEY` is set in `.env` and is 64 hex characters
2. Run `node scripts/check-encryption.js` to verify encryption is working
3. If migrating from plaintext, run the encryption migration script
4. Check that database columns are expanded (run migrations)

</details>

## Architecture

<details>
<summary>Click to expand Architecture details</summary>

### Data Flow

1. **Schedule Retrieval**: Bot queries source database for upcoming runs
2. **Change Detection**: Hash-based comparison with encrypted state cache
3. **Encryption**: Sensitive data encrypted before database storage
4. **Update Delivery**: Discord schedules updated via components_v2 containers (60s)
5. **State Caching**: Encrypted state saved to prevent duplicate updates

### Encryption Implementation

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Size**: 32 bytes (256 bits)
- **IV**: Random 16 bytes per encryption operation
- **Authentication**: GCM mode provides authentication tag
- **Format**: `IV:AuthTag:EncryptedData` (hex-encoded)

### Components

- **Services**: Schedule management, encryption, timers, health checks
- **Database**: Encrypted storage layer with migration support
- **Commands**: Discord slash command handlers
- **Events**: Discord event listeners
- **Utils**: Encryption, logging, validation, rate limiting

</details>

## License

GNU General Public License v3.0
