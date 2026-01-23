const fs = require('fs');
const env = require('#env');
const Database = require('better-sqlite3');
const utils = require('#utils');
const path = require('path');

// Open database
utils.log(`Using database ${env.DB_PATH}`);
const db = new Database(env.DB_PATH);

// Set pragmas
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 15000');
db.pragma('synchronous = NORMAL');

// Initialize with schema if needed
const schemaFile = path.join(__dirname, 'schema.sql');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all();
if (fs.existsSync(schemaFile) && !tables.find(t => t.name === 'users')) {
    utils.log('Initializing database from schema.sql...');
    const schema = fs.readFileSync(schemaFile, 'utf8');
    db.transaction(() => {
        db.exec(schema);
    })();
}

// Perform migrations
const migrationsDir = path.join(__dirname, 'migrations');
if (fs.existsSync(migrationsDir) && env.ENTRYPOINT === 'apps/web/index.js') {
    try {
        const fileNames = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        db.prepare(`CREATE TABLE IF NOT EXISTS misc (key TEXT PRIMARY KEY, value TEXT);`).run();
        const latestAppliedMigration = db.prepare(`SELECT value FROM misc WHERE key = 'latest_applied_migration'`).get()?.value || '';
        if (!latestAppliedMigration) {
            const latestMigration = fileNames[fileNames.length - 1] || '0000.sql';
            db.prepare(`INSERT OR REPLACE INTO misc (key, value) VALUES ('latest_applied_migration', ?);`)
                .run(latestMigration);
            utils.log(`No saved database migration state found, assuming all migrations through ${latestMigration} have been applied.`);
        } else {
            db.transaction(() => {
                for (const fileName of fileNames) {
                    if (fileName <= latestAppliedMigration) continue;
                    utils.log(`Applying database migration ${fileName}...`);
                    const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
                    db.exec(sql);
                    db.prepare(`UPDATE misc SET value = ? WHERE key = 'latest_applied_migration'`).run(fileName);
                }
            })();
        }
    } catch (error) {
        utils.logError(`Failed to apply database migrations:`, error);
        process.exit(1);
    }
}

module.exports = db;