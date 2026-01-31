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
const allowMigrationsIn = ['apps/web/index.js'];
if (!allowMigrationsIn.includes(env.ENTRYPOINT)) {
    utils.log(`Database migrations aren't allowed from ${env.ENTRYPOINT}.`);
} else if (fs.existsSync(migrationsDir)) {
    try {
        utils.log(`Applying database migrations from ${migrationsDir}...`);
        // Get list of migration files
        const fileNames = fs
            .readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();
        // Create misc table if needed
        db.prepare(`CREATE TABLE IF NOT EXISTS misc (key TEXT PRIMARY KEY, value TEXT);`).run();
        // Check if we have a saved last applied migration
        const latestAppliedMigration =
            db.prepare(`SELECT value FROM misc WHERE key = 'latest_applied_migration'`).get()?.value || '';
        if (!latestAppliedMigration) {
            // Assume all migrations have been applied up to the latest one or a placeholder value
            const latestMigration = fileNames[fileNames.length - 1] || '0000.sql';
            db.prepare(`INSERT OR REPLACE INTO misc (key, value) VALUES ('latest_applied_migration', ?);`).run(
                latestMigration
            );
            utils.log(
                `No saved database migration state found, assuming all migrations through ${latestMigration} have been applied.`
            );
        } else {
            // Process pending migrations inside transaction
            db.transaction(() => {
                for (const fileName of fileNames) {
                    // Skip migrations with names "less than" the latest applied migration
                    if (fileName <= latestAppliedMigration) continue;
                    utils.log(`Applying database migration: ${fileName}`);
                    // Read and apply migration SQL
                    const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
                    db.exec(sql);
                    // Update latest applied migration immediately to prevent reapplication on failure
                    db.prepare(`UPDATE misc SET value = ? WHERE key = 'latest_applied_migration'`).run(fileName);
                }
            })();
        }
    } catch (error) {
        utils.logError(`Failed to apply database migrations:`, error);
        process.exit(1);
    }
} else {
    utils.log(`Database migrations directory doesn't exist: ${migrationsDir}`);
}

// Generate secrets if not set
const secretNames = ['trusted_socket_secret', 'session_secret', 'jwt_secret'];
for (const name of secretNames) {
    const secret = db.prepare('SELECT value FROM misc WHERE key = ?').get(name)?.value;
    if (!secret) {
        const secret = env[name.toUpperCase()] || utils.generateSecretKey(32);
        db.prepare('INSERT INTO misc (key, value) VALUES (?, ?)').run(name, secret);
        utils.log(`Generated and stored new secret: ${name}`);
    }
}

module.exports = db;
