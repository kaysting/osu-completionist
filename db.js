require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH) || path.join(__dirname, './storage.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

module.exports = db;