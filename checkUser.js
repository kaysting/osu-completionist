const db = require('./db');
const config = require('./config.json');

/**
 * Parses command line arguments from process.argv into a camelCased key-value object.
 * * Supports:
 * - --flag (Boolean true)
 * - --key=value
 * - --key value
 * - -k value (Short aliases)
 * - --long-flag-name -> longFlagName (CamelCase conversion)
 * * @returns {Object} The parsed arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};

    // Helper to convert kebab-case to camelCase
    const toCamelCase = (str) => {
        return str.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        let key;
        let value;

        // Handle --key=value
        if (arg.startsWith('--') && arg.includes('=')) {
            const parts = arg.split('=');
            const rawKey = parts[0].slice(2); // remove --
            key = toCamelCase(rawKey);

            value = parts.slice(1).join('='); // join back in case value has =
            parsed[key] = value;
            continue;
        }

        // Handle --key or -k
        if (arg.startsWith('-')) {
            // Remove leading - or --
            const rawKey = arg.replace(/^-+/, '');
            key = toCamelCase(rawKey);

            // Check next argument to see if it's a value or another flag
            const nextArg = args[i + 1];

            if (nextArg && !nextArg.startsWith('-')) {
                value = nextArg;
                i++; // Skip next arg since we consumed it
            } else {
                value = true; // It's a boolean flag
            }

            parsed[key] = value;
        }
    }

    return parsed;
}

async function main() {
    const args = parseArgs();
    if (!args.user) {
        console.error('Please provide a user name or ID with the --user flag.');
        process.exit(1);
    }
    const inputUser = args.user;
    const user = db.prepare(`SELECT * FROM users WHERE name = ? OR id = ?`).get(inputUser, inputUser);
    if (!user) {
        console.error('User not found in the database.');
        process.exit(1);
    }
    const includeLoved = args.includeLoved || args.loved || false;
    const includeConverts = args.includeConverts || args.converts || false;
    const mode = args.mode || 'osu';
    const totalCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;
    const completedCount = db.prepare(
        `SELECT count FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND user_id = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, user.id).count;
    console.log(`\nCompletion stats for user ${user.name} (ID: ${user.id})\n`);
    console.log(`Mode: ${mode}`);
    console.log(`Including loved maps: ${includeLoved ? 'true' : 'false'}`);
    console.log(`Including converted maps: ${includeConverts ? 'true' : 'false'}`);
    console.log(`Completed Beatmaps: ${completedCount} / ${totalCount}`);
    const percentage = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(2) : '0.00';
    console.log(`Completion Percentage: ${percentage}%\n`);
}

main();