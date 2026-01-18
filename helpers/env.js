require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');

const env = {};

// Database
env.DB_PATH = path.resolve(process.env.DB_PATH || path.resolve(__dirname, '../storage.db'));
env.DB_BACKUPS_DIR = path.resolve(process.env.DB_BACKUPS_DIR || path.resolve(__dirname, '../backups'));
env.DB_BACKUP_INTERVAL_HOURS = Number(process.env.DB_BACKUP_INTERVAL_HOURS || 6);
env.DB_KEEP_BACKUPS_COUNT = Number(process.env.DB_KEEP_BACKUPS_COUNT || 12);

// Webserver
env.WEBSERVER_PORT = Number(process.env.WEBSERVER_PORT || 8080);
env.JWT_SECRET = process.env.JWT_SECRET;
env.SESSION_SECRET = process.env.SESSION_SECRET;
env.HOST = process.env.HOST || `localhost:${env.WEBSERVER_PORT}`;
env.HTTPS = process.env.HTTPS !== 'false';

// Webserver rate limits
env.CLIENT_RATE_LIMIT_LIMIT = Number(process.env.CLIENT_RATE_LIMIT_LIMIT || 150);
env.CLIENT_RATE_LIMIT_WINDOW_SECS = Number(process.env.CLIENT_RATE_LIMIT_WINDOW_SECS || 300);
env.API_RATE_LIMIT_LIMIT = Number(process.env.API_RATE_LIMIT_LIMIT || 60);
env.API_RATE_LIMIT_WINDOW_SECS = Number(process.env.API_RATE_LIMIT_WINDOW_SECS || 60);

// osu
env.OSU_CLIENT_ID = process.env.OSU_CLIENT_ID;
env.OSU_CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;
env.OSU_AUTH_REDIRECT_URI = process.env.OSU_AUTH_REDIRECT_URI || `${env.HTTPS ? 'https' : 'http'}://${env.HOST}/auth/callback`;

// Time remaining estimation constants
// These are determined through testing
env.SCORES_PER_MINUTE = Number(process.env.SCORES_PER_MINUTE || 700);
env.SCORES_PER_MINUTE_FULL = Number(process.env.SCORES_PER_MINUTE_FULL || 3350);

// Discord
env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
env.DISCORD_BOT_CLIENT_ID = process.env.DISCORD_BOT_CLIENT_ID;
env.MAP_FEED_DISCORD_CHANNEL_ID = process.env.MAP_FEED_DISCORD_CHANNEL_ID;
env.USER_FEED_DISCORD_CHANNEL_ID = process.env.USER_FEED_DISCORD_CHANNEL_ID;
env.PASS_FEED_DISCORD_CHANNEL_ID = process.env.PASS_FEED_DISCORD_CHANNEL_ID;
env.ERROR_LOGS_DISCORD_CHANNEL_ID = process.env.ERROR_LOGS_DISCORD_CHANNEL_ID;

// Check db existence
if (!fs.existsSync(env.DB_PATH)) {
    throw new Error(`Database file not found at path: ${env.DB_PATH}`);
}

// Validate required env vars
const requiredVars = ['OSU_CLIENT_ID', 'OSU_CLIENT_SECRET', 'OSU_AUTH_REDIRECT_URI', 'JWT_SECRET', 'SESSION_SECRET'];
for (const v of requiredVars) {
    if (!env[v]) {
        throw new Error(`Missing required environment variable: ${v}`);
    }
}

// Validate positive integer vars
const mustBePositiveInts = ['WEBSERVER_PORT', 'CLIENT_RATE_LIMIT_LIMIT', 'CLIENT_RATE_LIMIT_WINDOW_SECS', 'API_RATE_LIMIT_LIMIT', 'API_RATE_LIMIT_WINDOW_SECS', 'DB_BACKUP_INTERVAL_HOURS', 'DB_KEEP_BACKUPS_COUNT'];
for (const v of mustBePositiveInts) {
    if (isNaN(env[v]) || env[v] <= 0 || !Number.isInteger(env[v])) {
        throw new Error(`Environment variable ${v} must be a positive integer.`);
    }
}

module.exports = env;