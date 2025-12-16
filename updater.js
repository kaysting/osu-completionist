const FETCH_ALL_MAPS = false;
const REPLACE_EXISTING_MAPS = false;
const QUEUE_ALL_USERS = false;

require('dotenv').config();
const fs = require('fs');
const cp = require('child_process');
const dayjs = require('dayjs');
const db = require('./db');
const osu = require('./osu');

const dbHelpers = require('./helpers/dbHelpers');
const { log, sleep } = require('./utils');
const { queueUser, updateUserProfile, saveMapset } = require('./helpers/updaterHelpers');
const path = require('path');
const dbPath = require('path').join(__dirname, process.env.DB_PATH || './storage.db');

// Function to update beatmap stats and totals in the database
const updateBeatmapStats = () => {
    try {
        for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
            for (const includesLoved of [1, 0]) {
                for (const includesConverts of [1, 0]) {
                    const where = [];
                    where.push(`mode = '${mode}'`);
                    if (includesLoved) {
                        where.push(`status IN ('ranked', 'approved', 'loved')`);
                    } else {
                        where.push(`status IN ('ranked', 'approved')`);
                    }
                    if (!includesConverts) {
                        where.push(`is_convert = 0`);
                    }
                    const stats = db.prepare(
                        `SELECT COUNT(*) AS count, SUM(duration_secs) AS total_duration
                                FROM beatmaps
                                WHERE ${where.join(' AND ')}`
                    ).get();
                    db.prepare(`INSERT OR REPLACE INTO beatmap_stats (mode, includes_loved, includes_converts, count, time_total_secs) VALUES (?, ?, ?, ?, ?)`).run(
                        mode, includesLoved, includesConverts, stats.count, stats.total_duration
                    );
                    // Update yearly stats
                    const oldestYear = 2007;
                    for (let year = oldestYear; year <= new Date().getFullYear(); year++) {
                        const tsStart = new Date(year, 0, 1).getTime();
                        const tsEnd = new Date(year + 1, 0, 1).getTime();
                        const yearlyCount = db.prepare(
                            `SELECT COUNT(*) AS total FROM beatmaps b
                             INNER JOIN beatmapsets s ON b.mapset_id = s.id
                             WHERE b.mode = ?
                             AND ${includesLoved ? `b.status IN ('ranked', 'approved', 'loved')` : `b.status IN  ('ranked', 'approved')`}
                             ${includesConverts ? '' : 'AND b.is_convert = 0'}
                             AND s.time_ranked >= ? AND s.time_ranked < ?`
                        ).get(mode, tsStart, tsEnd).total;
                        if (yearlyCount == 0) continue;
                        db.prepare(`INSERT OR REPLACE INTO beatmap_stats_yearly (year, mode, includes_loved, includes_converts, count) VALUES (?, ?, ?, ?, ?)`).run(
                            year, mode, includesLoved, includesConverts, yearlyCount
                        );
                    }
                }
            }
        }
        log('Updated beatmap stats');
    } catch (error) {
        log('Error while updating beatmap stats:', error);
    }
};

// Function to fetch new beatmaps(ets)
const fetchNewMapData = async () => {
    try {
        log(`Checking for new beatmaps...`);
        // Loop to get unsaved recent beatmapsets
        let cursor;
        while (true) {
            // Fetch mapsets
            const data = await osu.searchBeatmapsets({
                cursor_string: cursor,
                nsfw: true
            });
            // Extract data
            cursor = data.cursor_string;
            const mapsets = data.beatmapsets;
            // Loop through mapsets
            let foundExistingMapset = false;
            let countNewlySaved = 0;
            for (const mapset of mapsets) {
                // Check if this mapset is already saved
                const existingMapset = db.prepare(`SELECT 1 FROM beatmapsets WHERE id = ? LIMIT 1`).get(mapset.id);
                // Break out of loop if saved and not force-fetching all maps
                // Otherwise skip this map and continue loop
                if (existingMapset && !FETCH_ALL_MAPS) {
                    foundExistingMapset = true;
                    break;
                } else if (existingMapset && !REPLACE_EXISTING_MAPS) {
                    continue;
                }
                // Fetch full mapset and save
                await saveMapset(mapset.id, true);
                countNewlySaved++;
            }
            // Log counts
            if (countNewlySaved > 0 || FETCH_ALL_MAPS) {
                const countSavedMapsets = db.prepare(`SELECT COUNT(*) AS count FROM beatmapsets`).get().count;
                const countSavedMaps = db.prepare(`SELECT COUNT(*) AS count FROM beatmaps`).get().count;
                log(`Now storing data for ${countSavedMapsets} beatmapsets and ${countSavedMaps} beatmaps`);
            }
            // We're done if no more mapsets, or we found an existing one above
            if (!cursor || mapsets.length === 0 || foundExistingMapset) {
                break;
            }
            await sleep(200);
        }
        // Update beatmap status
        updateBeatmapStats();
        log('Beatmap database is up to date');
    } catch (error) {
        log('Error while updating stored beatmap data:', error);
        await sleep(5000);
    }
    // Wait an hour and then run again
    setTimeout(fetchNewMapData, 1000 * 60 * 60);
};

// Function to log a user's current pass count
const logUserPassCount = (userId) => {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    const passCount = db.prepare(
        `SELECT COUNT(*) AS count
                     FROM user_passes
                     WHERE user_id = ?`
    ).get(user.id).count;
    log(`Now storing ${passCount} map passes for ${user.name}`);
};

// Function to update user stats and totals in the database
const updateUserStats = async (userId) => {
    try {
        // Loop through modes and inclusion options
        const userEntry = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
            for (const includesLoved of [1, 0]) {
                for (const includesConverts of [1, 0]) {
                    // Build where clause
                    const where = [];
                    where.push(`user_id = ${userId}`);
                    where.push(`mode = '${mode}'`);
                    if (includesLoved) {
                        where.push(`status IN ('ranked', 'approved', 'loved')`);
                    } else {
                        where.push(`status IN ('ranked', 'approved')`);
                    }
                    if (!includesConverts) {
                        where.push(`is_convert = 0`);
                    }
                    // Get and save stats
                    const passCount = db.prepare(
                        `SELECT COUNT(*) AS count
                                FROM user_passes
                                WHERE ${where.join(' AND ')}`
                    ).get().count;
                    const timeSpent = db.prepare(
                        `SELECT SUM(b.duration_secs) AS secs FROM user_passes up
                        JOIN beatmaps b ON up.map_id = b.id
                        WHERE up.user_id = ?
                        AND up.mode = ?
                        AND ${includesLoved ? `up.status IN ('ranked', 'approved', 'loved')` : `up.status IN ('ranked', 'approved')`}
                        ${includesConverts ? '' : 'AND b.is_convert = 0'}`
                    ).get(userId, mode)?.secs || 0;
                    db.prepare(`INSERT OR REPLACE INTO user_stats (user_id, mode, includes_loved, includes_converts, count, time_spent_secs) VALUES (?, ?, ?, ?, ?, ?)`).run(
                        userId, mode, includesLoved, includesConverts, passCount, timeSpent
                    );
                    // Group and count passes by year
                    const stats = db.prepare(`
                        SELECT 
                            CAST(strftime('%Y', s.time_ranked / 1000, 'unixepoch') AS INTEGER) as year,
                            COUNT(*) as count
                        FROM user_passes up
                        INNER JOIN beatmaps b ON up.map_id = b.id
                        INNER JOIN beatmapsets s ON b.mapset_id = s.id
                        WHERE up.user_id = ?
                        AND b.mode = ?
                        AND ${includesLoved ? "b.status IN ('ranked', 'approved', 'loved')" : "b.status IN ('ranked', 'approved')"}
                        ${includesConverts ? '' : 'AND b.is_convert = 0'}
                        GROUP BY year
                    `).all(userId, mode);
                    // Create yearly insert statement
                    const yearlyStmt = db.prepare(`
                        INSERT OR REPLACE INTO user_stats_yearly 
                        (user_id, mode, includes_loved, includes_converts, year, count) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `);
                    // Transaction insert
                    const updateStats = db.transaction((rows) => {
                        const countsByYear = new Map(rows.map(r => [r.year, r.count]));
                        const oldestYear = 2007;
                        const newestYear = new Date().getFullYear();
                        for (let year = newestYear; year >= oldestYear; year--) {
                            const count = countsByYear.get(year) || 0;
                            if (count == 0) continue;
                            yearlyStmt.run(userId, mode, includesLoved, includesConverts, year, count);
                        }
                    });
                    updateStats(stats);
                }
            }
        }
        log('Updated user stats for', userEntry?.name || userId);
        return true;
    } catch (error) {
        log('Error while updating user stats:', error);
        return false;
    }
};

let isRecentsUpdateRunning = false;
let isMostPlayedUpdateRunning = false;

// Function to update a user's completion data by fetching
// all of their most played maps and then checking passes
// on each unique mapset that they've played
const importUser = async (userId) => {
    const userEntry = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    try {
        if (isMostPlayedUpdateRunning) {
            return;
        }
        isMostPlayedUpdateRunning = true;
        let totalNewPasses = 0;
        const user = await osu.getUser(userId);
        log(`Starting pass import for ${userEntry.name} using ${user.beatmap_playcounts_count} most played maps`);
        const totalMostPlayed = user.beatmap_playcounts_count;
        let mostPlayedOffset = 0;
        const uniqueMapsetIds = [];
        // Outer loop to fetch passes
        while (true) {
            // Inner loop to fetch mapset IDs from most played maps
            const mapsetIds = [];
            while (true) {
                // Fetch most played maps
                let res = null;
                try {
                    res = await osu.getUserBeatmaps(userId, 'most_played', {
                        limit: 100, offset: mostPlayedOffset
                    });
                    await sleep(1000);
                } catch (error) {
                    if (error.status == 429) {
                        // Wait for rate limit to clear
                        await sleep(15000);
                        continue;
                    }
                    console.log(`Error while fetching most played maps for ${userEntry.name}:`, error);
                    await sleep(5000);
                    continue;
                }
                if (res.length == 0) break;
                // Collect unique mapset IDs
                let countNewMapsets = 0;
                for (const entry of res) {
                    const mapsetId = entry.beatmapset.id;
                    const status = entry.beatmapset.status;
                    const validStatuses = ['ranked', 'approved', 'loved'];
                    if (!uniqueMapsetIds.includes(mapsetId) && validStatuses.includes(status)) {
                        uniqueMapsetIds.push(mapsetId);
                        mapsetIds.push(mapsetId);
                        countNewMapsets++;
                    }
                    mostPlayedOffset++;
                    if (mapsetIds.length == 50) break;
                }
                if (mapsetIds.length == 50) break;
            }
            if (mapsetIds.length == 0) break;
            // Fetch passes for mapsets
            let maps = [];
            while (true) {
                try {
                    const res = await osu.getUserBeatmapsPassed(user.id, {
                        beatmapset_ids: mapsetIds,
                        exclude_converts: false,
                        no_diff_reduction: false
                    });
                    maps = res.beatmaps_passed;
                    break;
                } catch (error) {
                    if (error.status == 429) {
                        // Wait for rate limit to clear
                        await sleep(5000);
                    } else {
                        throw error;
                    }
                }
            }
            // Save new passes
            const transaction = db.transaction((maps) => {
                let newCount = 0;
                for (const map of maps) {
                    // Skip if we already have this pass saved or if map is not ranked
                    const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                        user.id, map.id, map.mode
                    );
                    const isRanked = ['ranked', 'loved', 'approved'].includes(map.status);
                    if (existingPass || !isRanked) continue;
                    // Save the pass
                    db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, mapset_id, map_id, mode, status, is_convert, time_passed) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                        user.id, map.beatmapset_id, map.id, map.mode, map.status, map.convert ? 1 : 0, Date.now()
                    );
                    newCount++;
                }
                // Update task info
                const percentage = (mostPlayedOffset / totalMostPlayed * 100).toFixed(2);
                db.prepare(`
                        UPDATE user_update_tasks
                        SET count_new_passes = count_new_passes + ?, percent_complete = ?
                        WHERE user_id = ?
                    `).run(newCount, percentage, user.id);
                // Log
                totalNewPasses += maps.length;
                log(`[Importing ${percentage}%] Saved ${newCount} new passes for ${userEntry.name}`);
            });
            transaction(maps);
        }
        // Update user entry
        db.prepare(`UPDATE users SET last_score_update = ? WHERE id = ?`).run(Date.now(), user.id);
        // Remove task entry
        db.prepare(`DELETE FROM user_update_tasks WHERE user_id = ?`).run(userEntry.id);
        // Log
        log(`Completed import of ${totalNewPasses} passes for ${userEntry.name}`);
        // Update user stats
        await updateUserStats(userId);
        // Queue user again to fetch recents and catch any missed passes
        await queueUser(userId);
    } catch (error) {
        log(`Error while importing user ${userEntry.name}:`, error);
    }
    isMostPlayedUpdateRunning = false;
};

// Function to update a user's completion data by fetching
// their recent scores only. This is only reliable if their recents were
// fetched less than 24 hours ago
const updateUserFromRecents = async (userId) => {
    try {
        if (isRecentsUpdateRunning) {
            return;
        }
        isRecentsUpdateRunning = true;
        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        log(`Starting recent score update for ${user.name}`);
        // Fetch all available recent scores for all game modes
        const updateTime = Date.now();
        let limit = 100;
        let offset = 0;
        let mode = 'osu';
        const scores = [];
        while (true) {
            // Fetch scores
            let fetchedScores = [];
            try {
                fetchedScores = await osu.getUserScores(userId, 'recent', {
                    mode, limit, offset, include_fails: false, legacy_only: false
                });
            } catch (error) {
                fetchedScores = [];
                if (error.status != 404) {
                    throw error;
                }
            }
            let newCount = 0;
            // Loop through scores and only keep new ones
            for (const score of fetchedScores) {
                const existingPass = db.prepare(`SELECT * FROM user_passes WHERE user_id = ? AND mapset_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                    user.id, score.beatmapset.id, score.beatmap.id, score.beatmap.mode
                );
                const isRanked = ['ranked', 'loved', 'approved'].includes(score.beatmap.status);
                if (!existingPass && isRanked) {
                    scores.push(score);
                    newCount++;
                }
            }
            if (newCount > 0)
                log(`Found ${newCount} new ${mode} map passes for ${user.name}`);
            // Update new score count
            db.prepare(`UPDATE user_update_tasks SET count_new_passes = count_new_passes + ? WHERE user_id = ?`).run(newCount, user.id);
            // Update ruleset when we reach the end of a set of scores
            if (fetchedScores.length == 0 || fetchedScores.length < limit) {
                offset = 0;
                if (mode == 'osu') mode = 'taiko';
                else if (mode == 'taiko') mode = 'fruits';
                else if (mode == 'fruits') mode = 'mania';
                else break;
            } else {
                offset += fetchedScores.length;
            }
        }
        // Write new scores to database
        const transaction = db.transaction((scores) => {
            for (const score of scores) {
                db.prepare(
                    `INSERT OR IGNORE INTO user_passes
                        (user_id, mapset_id, map_id, mode, status, is_convert, time_passed)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    user.id, score.beatmapset.id, score.beatmap.id, score.beatmap.mode,
                    score.beatmap.status, score.beatmap.convert ? 1 : 0,
                    new Date(score.ended_at || score.created_at || Date.now()).getTime()
                );
            }
            db.prepare(`UPDATE users SET last_score_update = ? WHERE id = ?`).run(updateTime, user.id);
            db.prepare(`DELETE FROM user_update_tasks WHERE user_id = ?`).run(user.id);
            log(`Completed recent score update for ${user.name}`);
        });
        transaction(scores);
        // Log counts
        logUserPassCount(userId);
        // Update user stats
        await updateUserStats(userId);
    } catch (error) {
        log('Error while updating user recent scores:', error);
        await sleep(5000);
    }
    isRecentsUpdateRunning = false;
};

// Function to get scores set recently globally and save new passes
// from users who we are tracking
// THIS RUNS RECURSIVELY
const globalRecentCursors = {
    osu: null,
    taiko: null,
    fruits: null,
    mania: null
};
const savePassesFromGlobalRecents = async () => {
    try {
        // Loop for each game mode
        for (const ruleset of ['osu', 'taiko', 'fruits', 'mania']) {
            // Fetch global recent scores
            const cursor_string = globalRecentCursors[ruleset];
            const res = await osu.getScores({ ruleset, cursor_string });
            globalRecentCursors[ruleset] = res.cursor_string;
            // If no cursor (first fetch), don't process scores
            if (!cursor_string) continue;
            // Loop through scores
            for (const score of res.scores) {
                // Skip failed scores
                if (!score.passed) continue;
                // Get user from db and skip if not found
                const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(score.user_id);
                if (!user) continue;
                // Get map and diff info from db and skip if not found
                const map = db.prepare(
                    `SELECT diff.status, mapset.id AS mapset_id
                    FROM beatmaps diff
                    JOIN beatmapsets mapset ON diff.mapset_id = mapset.id
                    WHERE diff.id = ? AND diff.mode = ?`
                ).get(score.beatmap_id, ruleset);
                if (!map) {
                    log(`Skipping processing global recent score for ${user.name} on untracked map ID ${score.beatmap_id}`);
                    continue;
                }
                // Skip if map is unranked
                const isRanked = ['ranked', 'loved', 'approved'].includes(map.status);
                if (!isRanked) continue;
                // Check for existing pass and skip if found
                const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND mapset_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                    user.id, map.mapset_id, score.beatmap_id, ruleset
                );
                if (existingPass) continue;
                // Save the pass and log
                db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, mapset_id, map_id, mode, status, is_convert, time_passed) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                    user.id, map.mapset_id, score.beatmap_id, ruleset, map.status, map.convert ? 1 : 0, new Date(score.ended_at || score.created_at || Date.now()).getTime()
                );
                log(`Found and saved a new ${ruleset} map pass for ${user.name}`);
                // Log counts
                logUserPassCount(user.id);
                // Update user stats
                await updateUserStats(user.id);
            }
            // Wait a second for rate limiting
            await sleep(2000);
        }
    } catch (error) {
        if (error.status == 429) {
            // Wait for rate limit to clear
            await sleep(10000);
        }
        log('Error while updating users from global recents:', error);
    }
    // Wait and check again
    setTimeout(savePassesFromGlobalRecents, 1000 * 15);
};

// Function that starts scheduled user update tasks
// If it's been less than 24 hours since last user pass update,
// only update using their recent scores. Otherwise, scrape their
// whole map pass history.
// THIS RUNS RECURSIVELY
const startQueuedUserUpdates = async () => {
    try {
        const tasks = db.prepare(`SELECT * FROM user_update_tasks ORDER BY time_queued ASC`).all();
        for (const task of tasks) {
            const userEntry = db.prepare(`SELECT * FROM users WHERE id = ?`).get(task.user_id);
            if (!userEntry) {
                await updateUserProfile(task.user_id);
            }
            const msSinceLastUpdate = Date.now() - (userEntry?.last_score_update || 0);
            if (msSinceLastUpdate < 1000 * 60 * 60 * 24) {
                updateUserFromRecents(task.user_id);
            } else {
                importUser(task.user_id);
            }
        }
    } catch (error) {
        log('Error while initializing user update tasks:', error);
        await sleep(5000);
    }
    setTimeout(startQueuedUserUpdates, 1000);
};

// Function to check the current play counts of all users
// and compare them to saved values. If values have changed,
// queue the user for updates. If their play counts haven't changed,
// mark them as up to date as-is.
// THIS RUNS RECURSIVELY
const queueActiveUsers = async () => {
    try {
        let countInactiveUsers = 0;
        let countQueuedUsers = 0;
        let offset = 0;
        let limit = 50;
        log('Checking for active users to queue for updates...');
        while (true) {
            // Select batch of users
            const userEntries = db.prepare(
                `SELECT id, last_score_update FROM users
                LIMIT ? OFFSET ?`
            ).all(limit, offset);
            if (userEntries.length === 0) break;
            const userIdToEntry = {};
            for (const entry of userEntries) {
                userIdToEntry[entry.id] = entry;
            }
            offset += limit;
            // Fetch user data in bulk
            const res = await osu.getUsers({ ids: userEntries.map(e => e.id) });
            // Loop through users
            for (const user of res.users) {
                const userEntry = userIdToEntry[user.id];
                let shouldQueue = QUEUE_ALL_USERS || false;
                // Queue if never updated before
                if (!userEntry.last_score_update) {
                    shouldQueue = true;
                }
                // Check fetched stats to see if play counts changed
                for (const mode in user.statistics_rulesets) {
                    const stats = user.statistics_rulesets[mode];
                    const currentCount = stats.play_count;
                    const storedCount = db.prepare(
                        `SELECT count FROM user_play_counts
                         WHERE user_id = ? AND mode = ?`
                    ).get(user.id, mode)?.count || 0;
                    if (currentCount !== storedCount) {
                        shouldQueue = true;
                        break;
                    }
                }
                if (shouldQueue) {
                    // Queue user for update if they aren't already queued
                    await queueUser(user.id);
                    countQueuedUsers++;
                } else {
                    // Mark user as up to date
                    db.prepare(`UPDATE users SET last_score_update = ? WHERE id = ?`).run(Date.now(), user.id);
                    countInactiveUsers++;
                }
            }
        }
        // Log inactive user count
        log(`Queued ${countQueuedUsers} active users for updates and skipped ${countInactiveUsers} inactive users`);
    } catch (error) {
        log('Error while queuing active users for update:', error);
        await sleep(5000);
    }
    // Run again in an hour
    setTimeout(queueActiveUsers, 1000 * 60 * 60);
};

// Function to save stat history for all users
// THIS RUNS RECURSIVELY
const saveUserHistory = async () => {
    try {
        const hhmm = dayjs().format('HHmm');
        if (hhmm !== '0000') {
            return setTimeout(saveUserHistory, 1000);
        }
        log('Starting daily user history save...');
        const stmt = db.prepare(
            `INSERT OR REPLACE INTO user_stats_history
                (user_id, mode, includes_loved, includes_converts,
                time, count, time_spent_secs, percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        let offset = 0;
        while (true) {
            const userIds = db.prepare(`SELECT id FROM users LIMIT ? OFFSET ?`)
                .all(50, offset).map(e => e.id);
            if (userIds.length === 0) break;
            offset += userIds.length;
            let countEntries = 0;
            let countUsers = 0;
            const transaction = db.transaction((userIds) => {
                for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
                    for (const includesLoved of [1, 0]) {
                        for (const includesConverts of [1, 0]) {
                            const bulkStats = dbHelpers.getBulkUserCompletionStats(userIds, mode, includesLoved, includesConverts);
                            for (const entry of bulkStats) {
                                const userId = entry.id;
                                const stats = entry.stats;
                                stmt.run(
                                    userId, mode, includesLoved, includesConverts, Date.now(), stats.count_completed, stats.time_spent_secs, stats.percentage_completed
                                );
                                countEntries++;
                            }
                        }
                    }
                }
                countUsers += userIds.length;
            });
            transaction(userIds);
            log(`Saved ${countEntries} history entries for ${countUsers} users`);
            await sleep(100);
        }
        log('Completed daily user history save');
        await sleep(1000 * 60);
    } catch (error) {
        log('Error while saving user history:', error);
    }
    setTimeout(saveUserHistory, 1000);
};

const backupDatabase = async () => {
    try {
        const backupsDir = process.env.DB_BACKUPS_DIR || path.join(__dirname, 'backups');
        const backupIntervalHours = process.env.DB_BACKUP_INTERVAL_HOURS || 6;
        const keepBackupsCount = process.env.DB_KEEP_BACKUPS_COUNT || 12;
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir);
        }
        // Get existing backups sorted by modification time
        const files = fs.readdirSync(backupsDir)
            .map(file => ({
                name: file,
                path: require('path').join(backupsDir, file),
                mtime: fs.statSync(require('path').join(backupsDir, file)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime);
        // Check if backup is needed
        const lastBackupTime = files.length > 0 ? files[0].mtime : 0;
        const needsBackup = Date.now() - lastBackupTime > (backupIntervalHours * 60 * 60 * 1000);
        if (needsBackup) {
            const backupFile = path.join(backupsDir, `${dayjs().format('YYYYMMDD-HHmmss')}.sql`);
            log(`Backing up database to ${backupFile}...`);
            cp.execSync(`sqlite3 "${dbPath}" .dump > "${backupFile}"`);
            log(`Backup complete`);
            const filesToDelete = files.slice(keepBackupsCount - 1);
            for (const file of filesToDelete) {
                fs.unlinkSync(file.path);
                log(`Deleted old backup: ${file.path}`);
            }
        }
    } catch (error) {
        log('Error while backing up database:', error);
    }
    setTimeout(backupDatabase, 1000 * 60 * 60);
};

async function main() {

    // Get osu API token
    log('Authenticating with osu API...');
    await osu.getToken();

    // Start update processes
    // Stagger function calls to prevent fetching API token too rapidly
    log(`Starting update processes...`);
    fetchNewMapData();
    startQueuedUserUpdates();
    savePassesFromGlobalRecents();
    queueActiveUsers();
    saveUserHistory();
    backupDatabase();

}

main();