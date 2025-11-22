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

const cleanStringClip = (input, maxLength, padDirection = 'right') => {
    const str = input == null ? '' : String(input);
    const len = Math.max(0, Math.floor(Number(maxLength) || 0));
    const dir = String(padDirection || 'right').toLowerCase();

    if (len === 0) return '';

    if (str.length > len) {
        // If there's room for an ellipsis, reserve 3 chars for "..."
        if (len > 3) return str.slice(0, len - 3) + '...';
        // Not enough room for ellipsis — just truncate
        return str.slice(0, len);
    }

    // Pad with spaces to reach max length
    const pad = len - str.length;
    if (pad <= 0) return str;

    if (dir === 'left' || dir === 'start') {
        return ' '.repeat(pad) + str;
    }

    if (dir === 'both' || dir === 'center') {
        const left = Math.floor(pad / 2);
        const right = pad - left;
        return ' '.repeat(left) + str + ' '.repeat(right);
    }

    // default to right padding
    return str + ' '.repeat(pad);
};

async function main() {
    const startTime = Date.now();

    // Get args
    const args = parseArgs();
    const includeLoved = args.includeLoved || args.loved || false;
    const includeConverts = args.includeConverts || args.converts || false;
    const mode = args.mode || 'osu';
    const page = parseInt(args.page) || 1;
    const limit = parseInt(args.limit) || 50;
    const inputUser = args.user;

    // If a user was provided, show their stats
    // Otherwise, show a paginated leaderboard

    if (inputUser) {

        // Get user from database
        const user = db.prepare(`SELECT * FROM users WHERE name = ? OR id = ?`).get(inputUser, inputUser);
        if (!user) {
            console.error('User not found in the database.');
            process.exit(1);
        }

        // Get total number of beatmaps and number of completed beatmaps
        const totalCount = db.prepare(
            `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
        ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;
        const completedCount = db.prepare(
            `SELECT count FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND user_id = ?`
        ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, user.id).count;

        // Get user rank
        const totalUsers = db.prepare(
            `SELECT COUNT(*) AS total FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > 0`
        ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).total;
        const rank = db.prepare(
            `SELECT COUNT(*) + 1 AS rank FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > ?`
        ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, completedCount).rank;

        // Display the results
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`\nCompletion stats for ${user.name} (ID: ${user.id}) (took ${duration}ms)\n`);
        console.log(`Mode: ${mode}   Loved maps: ${includeLoved ? 'yes' : 'no'}   Converts: ${includeConverts ? 'yes' : 'no'}\n`);
        console.log(`Completed maps: ${completedCount} / ${totalCount}`);
        const percentage = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(2) : '0.00';
        console.log(`Percent complete: ${percentage}%\n`);
        console.log(`Rank: #${rank} (of ${totalUsers} players)\n`);

    } else {

        // Get users
        const offset = (page - 1) * limit;
        const entries = db.prepare(
            `SELECT u.id, u.name, us.count FROM users u
         JOIN user_stats us ON u.id = us.user_id
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.count DESC
         LIMIT ? OFFSET ?`
        ).all(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, limit, offset);

        // Get total number of beatmaps
        const totalMapCount = db.prepare(
            `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
        ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;

        // Display leaderboard
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`\nCompletionist leaderboard (Page ${page}) (took ${duration}ms)\n`);
        console.log(`Mode: ${mode}   Loved maps: ${includeLoved ? 'yes' : 'no'}   Converts: ${includeConverts ? 'yes' : 'no'}\n`);

        console.log(` ${cleanStringClip('Rank', 6, 'left')}   ${cleanStringClip('User', 20)}   ${cleanStringClip('Completed maps', 28)}`);
        console.log('-'.repeat(54));
        for (const entry of entries) {
            const rank = offset + entries.indexOf(entry) + 1;
            const percent = totalMapCount > 0 ? ((entry.count / totalMapCount) * 100).toFixed(2) : '0.00';
            console.log(` ${cleanStringClip('#' + rank, 6, 'left')}   ${cleanStringClip(entry.name, 20)}   ${cleanStringClip(`${percent}% (${entry.count}/${totalMapCount})`, 28)}`);
        }
        console.log();

    }

}

main();