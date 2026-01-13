require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');

const env = {

    // Database
    DB_PATH: process.env.DB_PATH || path.resolve(__dirname, '../storage.db'),
    DB_BACKUPS_DIR: process.env.DB_BACKUPS_DIR || path.resolve(__dirname, '../backups'),
    DB_BACKUP_INTERVAL_HOURS: Number(process.env.DB_BACKUP_INTERVAL_HOURS || 6),
    DB_KEEP_BACKUPS_COUNT: Number(process.env.DB_KEEP_BACKUPS_COUNT || 12),

    // osu
    OSU_CLIENT_ID: process.env.OSU_CLIENT_ID,
    OSU_CLIENT_SECRET: process.env.OSU_CLIENT_SECRET,
    OSU_AUTH_REDIRECT_URI: process.env.OSU_AUTH_REDIRECT_URI,

    // Webserver
    WEBSERVER_PORT: Number(process.env.WEBSERVER_PORT || 8080),
    JWT_SECRET: process.env.JWT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    HOSTNAME: process.env.HOSTNAME || 'localhost:8080',

    // Webserver rate limits
    CLIENT_RATE_LIMIT_LIMIT: Number(process.env.CLIENT_RATE_LIMIT_LIMIT || 100),
    CLIENT_RATE_LIMIT_WINDOW_SECS: Number(process.env.CLIENT_RATE_LIMIT_WINDOW_SECS || 300),
    API_RATE_LIMIT_LIMIT: Number(process.env.API_RATE_LIMIT_LIMIT || 60),
    API_RATE_LIMIT_WINDOW_SECS: Number(process.env.API_RATE_LIMIT_WINDOW_SECS || 60),

    // Discord
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_BOT_CLIENT_ID: process.env.DISCORD_BOT_CLIENT_ID,
    MAP_FEED_DISCORD_WEBHOOK_URL: process.env.MAP_FEED_DISCORD_WEBHOOK_URL,
    USER_FEED_DISCORD_WEBHOOK_URL: process.env.USER_FEED_DISCORD_WEBHOOK_URL,
    PASS_FEED_DISCORD_WEBHOOK_URL: process.env.PASS_FEED_DISCORD_WEBHOOK_URL,
    ERROR_LOGS_DISCORD_WEBHOOK_URL: process.env.ERROR_LOGS_DISCORD_WEBHOOK_URL,

};

// Validate
if (!fs.existsSync(env.DB_PATH)) {
    throw new Error(`Database file not found at path: ${env.DB_PATH}`);
}
const requiredVars = ['OSU_CLIENT_ID', 'OSU_CLIENT_SECRET', 'OSU_AUTH_REDIRECT_URI', 'JWT_SECRET', 'SESSION_SECRET'];
for (const v of requiredVars) {
    if (!env[v]) {
        throw new Error(`Missing required environment variable: ${v}`);
    }
}

module.exports = env;