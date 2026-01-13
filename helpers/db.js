const env = require('./env');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(env.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

module.exports = db;