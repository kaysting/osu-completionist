const env = require('./env');
const Database = require('better-sqlite3');
const utils = require('./utils');

utils.log(`Using database ${env.DB_PATH}`);
const db = new Database(env.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 15000');
db.pragma('synchronous = NORMAL');

module.exports = db;