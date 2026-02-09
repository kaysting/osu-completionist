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

// Function to apply migrations
const applyMigrations = () => {
    // Make sure migrations dir exists
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        utils.logError(`Database migrations directory doesn't exist: ${migrationsDir}`);
        return;
    }

    try {
        // Get list of migration files
        const fileNames = fs
            .readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        // Get the last applied migration
        // If an error is thrown here, we can assume the misc table doesn't exist,
        // indicating that the db needs a full init (run through all migrations) anyway
        let latestAppliedMigration = '';
        try {
            latestAppliedMigration =
                db.prepare(`SELECT value FROM misc WHERE key = 'latest_applied_migration'`).get()?.value || '';
        } catch (error) {}

        // Get pending migration files
        const pendingMigrations = fileNames.filter(f => f > latestAppliedMigration);
        if (pendingMigrations.length == 0) {
            utils.log(`No new database migrations found`);
            return;
        }
        utils.log(`Applying ${pendingMigrations.length} pending database migrations from ${migrationsDir}...`);

        // Process pending migrations inside transaction
        db.transaction(() => {
            for (const fileName of pendingMigrations) {
                // Read and apply migration SQL
                utils.log(`Applying database migration ${fileName}...`);
                const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
                db.exec(sql);

                // Update latest applied migration immediately to prevent reapplication on failure after this
                db.prepare(`INSERT OR REPLACE INTO misc (key, value) VALUES ('latest_applied_migration', ?)`).run(
                    fileName
                );
            }
        })();
    } catch (error) {
        utils.logError(`Failed to apply database migrations:`, error);
        process.exit(1);
    }
};

// Apply migrations if we don't have a critical table
// or if we're running from a script that allows it
const allowMigrationsIn = ['apps/web/index.js'];
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all();
if (!tables.find(t => t.name === 'misc') || allowMigrationsIn.includes(env.ENTRYPOINT)) {
    applyMigrations();
} else {
    utils.log(`Not applying database migrations.`);
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
