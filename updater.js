require('dotenv').config();
const db = require('./db');
const osuApi = require('osu-api-v2-js');
const { log, getOsuApiInstance, sleep } = require('./utils');
const osuApiInstance = getOsuApiInstance();

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
                    const count = db.prepare(
                        `SELECT COUNT(*) AS count
                                FROM beatmaps
                                WHERE ${where.join(' AND ')}`
                    ).get().count;
                    db.prepare(`INSERT OR REPLACE INTO beatmap_stats (mode, includes_loved, includes_converts, count) VALUES (?, ?, ?, ?)`).run(
                        mode, includesLoved, includesConverts, count
                    );
                }
            }
        }
        log('Updated beatmap stats');
    } catch (error) {
        log('Error while updating beatmap stats:', error);
    }
};

// Function to fetch new beatmaps(ets)
const FETCH_ALL_MAPS = false;
const updateSavedMaps = async () => {
    try {
        // Initialize API
        const osu = await osuApiInstance;
        // Create data saving transaction function
        const insertMapset = db.prepare(`INSERT OR REPLACE INTO beatmapsets (id, status, title, artist, time_ranked) VALUES (?, ?, ?, ?, ?)`);
        const insertBeatmap = db.prepare(`INSERT OR REPLACE INTO beatmaps (id, mapset_id, mode, status, name, stars, is_convert) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        let didUpdateStorage = false;
        const save = db.transaction((mapset) => {
            // Save mapset
            insertMapset.run(mapset.id, mapset.status, mapset.title, mapset.artist, mapset.ranked_date?.getTime() || mapset.submitted_date?.getTime());
            // Loop through maps and converts and save
            for (const map of [...mapset.beatmaps, ...(mapset.converts || [])]) {
                insertBeatmap.run(map.id, mapset.id, map.mode, map.status, map.version, map.difficulty_rating, map.convert ? 1 : 0);
                //log(`Stored beatmap: [${map.mode}] ${mapset.artist} - ${mapset.title} [${map.version}] (ID: ${map.id})`);
            }
            didUpdateStorage = true;
        });
        // Loop until no more maps are found
        let cursor;
        while (true) {
            // Fetch mapsets
            const data = await osu.searchBeatmapsets({
                cursor_string: cursor,
                sort: {
                    by: 'ranked',
                    in: 'desc'
                },
                hide_explicit_content: false
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
                } else if (existingMapset) {
                    continue;
                }
                // Fetch full mapset again to get converts
                const mapsetFull = await osu.getBeatmapset(mapset.id);
                // Save mapset and its maps
                save(mapsetFull);
                countNewlySaved++;
            }
            // Log counts
            if (countNewlySaved > 0) {
                const countSavedMapsets = db.prepare(`SELECT COUNT(*) AS count FROM beatmapsets`).get().count;
                const countSavedMaps = db.prepare(`SELECT COUNT(*) AS count FROM beatmaps`).get().count;
                log(`Now storing data for ${countSavedMapsets} beatmapsets and ${countSavedMaps} beatmaps`);
            }
            // We're done if no more mapsets, or we found an existing one above
            if (!cursor || mapsets.length === 0 || foundExistingMapset) {
                log('Beatmap database is up to date!');
                break;
            }
        }
        // Update beatmap status
        if (true || didUpdateStorage) {
            updateBeatmapStats();
        }
    } catch (error) {
        log('Error while updating stored beatmap data:', error);
    }
    // Wait an hour and then run again
    setTimeout(updateSavedMaps, 1000 * 60 * 60);
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
        const userEntry = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
            for (const includesLoved of [1, 0]) {
                for (const includesConverts of [1, 0]) {
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
                    const count = db.prepare(
                        `SELECT COUNT(*) AS count
                                FROM user_passes
                                WHERE ${where.join(' AND ')}`
                    ).get().count;
                    db.prepare(`INSERT OR REPLACE INTO user_stats (user_id, mode, includes_loved, includes_converts, count) VALUES (?, ?, ?, ?, ?)`).run(
                        userId, mode, includesLoved, includesConverts, count
                    );
                }
            }
        }
        log('Updated user stats for', userEntry?.name || userId);
    } catch (error) {
        log('Error while updating user stats:', error);
    }
};

// Function to fetch a user's profile and update their stored data
// Returns the fetched user data
const updateUserProfile = async (userId, userObj) => {
    try {
        const osu = await osuApiInstance;
        const user = userObj || await osu.getUser(userId);
        // Check if a user entry already exists
        const existingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
        if (existingUser) {
            // Update user profile data
            db.prepare(
                `UPDATE users
                SET name = ?,
                    avatar_url = ?,
                    banner_url = ?
                WHERE id = ?`
            ).run(user.username, user.avatar_url, user.cover.url, user.id);
            log(`Updated stored user data for ${user.username}`);
        } else {
            // Create new user entry
            db.prepare(
                `INSERT INTO users (id, name, avatar_url, banner_url)
                VALUES (?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url);
            log(`Stored user data for ${user.username}`);
        }
        // Create/update user play counts
        for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
            const stats = user.statistics_rulesets[mode];
            db.prepare(
                `INSERT OR REPLACE INTO user_play_counts (user_id, mode, count)
                 VALUES (?, ?, ?)`
            ).run(user.id, mode, stats?.play_count || 0);
        }
        return user;
    } catch (error) {
        log('Error while fetching/updating user profile:', error);
        return null;
    }
};

let isAllPassesUpdateRunning = false;
let isRecentsUpdateRunning = false;

// Function to update a user's completion data by sequentially fetching
// their passes for all maps
const updateUserFromAllPasses = async (userId) => {
    try {
        if (isAllPassesUpdateRunning) {
            return;
        }
        isAllPassesUpdateRunning = true;
        const osu = await osuApiInstance;
        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        const countMapsetsTotal = db.prepare(`SELECT COUNT(*) AS count FROM beatmapsets`).get().count;
        while (true) {
            const task = db.prepare(`SELECT * FROM user_update_tasks WHERE user_id = ?`).get(user.id);
            // Get batch of mapset IDs
            const mapsetIds = db.prepare(
                `SELECT id FROM beatmapsets
                     WHERE id > ?
                     ORDER BY id ASC
                     LIMIT 50`
            ).all(task.last_mapset_id).map(row => row.id);
            if (mapsetIds.length === 0) {
                // All done updating this user
                db.prepare(`UPDATE users SET last_score_update = ? WHERE id = ?`).run(Date.now(), user.id);
                db.prepare(`DELETE FROM user_update_tasks WHERE user_id = ?`).run(user.id);
                log(`Completed full pass history update for ${user.name}`);
                break;
            }
            // Calculate progress
            const countMapsetsRemaining = countMapsetsTotal - mapsetIds.length - db.prepare(
                `SELECT COUNT(*) AS count FROM beatmapsets WHERE id <= ?`
            ).get(task.last_mapset_id).count;
            const percentage = ((countMapsetsTotal - countMapsetsRemaining) / countMapsetsTotal * 100);
            // Log
            log(`[${percentage.toFixed(2)}%] Fetching passed maps for ${user.name}...`);
            // Fetch passed maps for each mapset
            // This is FAR from an ideal approach but we work with what we've got
            let maps = [];
            while (true) {
                try {
                    maps = await osu.getUserPassedBeatmaps(
                        user.id, mapsetIds,
                        { converts: true, no_diff_reduction: false }
                    );
                    break;
                } catch (error) {
                    if (error.status_code == 429) {
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
                // Log
                if (newCount > 0)
                    log(`[${percentage.toFixed(2)}%] Found ${newCount} new map passes for ${user.name}`);
                // Update task info
                db.prepare(`
                        UPDATE user_update_tasks
                        SET count_new_passes = count_new_passes + ?,
                            last_mapset_id = ?, percent_complete = ?
                        WHERE user_id = ?
                    `).run(newCount, mapsetIds.pop(), percentage, user.id);
            });
            transaction(maps);
            await sleep(1500);
            // Log pass count
            logUserPassCount(userId);
        }
        // Update user stats
        await updateUserStats(userId);
    } catch (error) {
        log('Error while updating user with full pass history:', error);
    }
    isAllPassesUpdateRunning = false;
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
        const osu = await osuApiInstance;
        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        log(`Fetching recent scores for ${user.name}`);
        // Fetch all available recent scores for all game modes
        const updateTime = Date.now();
        let limit = 100;
        let offset = 0;
        let ruleset = 'osu';
        const scores = [];
        while (true) {
            // Fetch scores
            let fetchedScores = [];
            try {
                fetchedScores = await osu.getUserScores(
                    user, 'recent', osuApi.Ruleset[ruleset],
                    { fails: false, lazer: true },
                    { limit, offset }
                );
            } catch (error) {
                fetchedScores = [];
                if (error.status_code != 404) {
                    throw error;
                }
            }
            let newCount = 0;
            // Loop through scores and only keep new ones
            for (const score of fetchedScores) {
                const existingPass = db.prepare(`SELECT * FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                    user.id, score.beatmap.id, score.beatmap.mode
                );
                const isRanked = ['ranked', 'loved', 'approved'].includes(score.beatmap.status);
                if (!existingPass && isRanked) {
                    scores.push(score);
                    newCount++;
                }
            }
            if (newCount > 0)
                log(`Found ${newCount} new ${ruleset} map passes for ${user.name}`);
            // Update new score count
            db.prepare(`UPDATE user_update_tasks SET count_new_passes = count_new_passes + ? WHERE user_id = ?`).run(newCount, user.id);
            // Update ruleset when we reach the end of a set of scores
            if (fetchedScores.length == 0 || fetchedScores.length < limit) {
                offset = 0;
                if (ruleset == 'osu') ruleset = 'taiko';
                else if (ruleset == 'taiko') ruleset = 'fruits';
                else if (ruleset == 'fruits') ruleset = 'mania';
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
                    user.id, score.beatmapset.id, score.beatmap.id,
                    score.beatmap.mode, score.beatmap.status,
                    score.beatmap.convert ? 1 : 0,
                    score.ended_at?.getTime() || Date.now()
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
const updateUsersFromGlobalRecents = async () => {
    try {
        const osu = await osuApiInstance;
        // Loop for each game mode
        for (const ruleset of ['osu', 'taiko', 'fruits', 'mania']) {
            // Fetch global recent scores
            const cursor = globalRecentCursors[ruleset];
            const res = await osu.getScores({ ruleset, cursor });
            globalRecentCursors[ruleset] = res.cursor;
            // If no cursor (first fetch), don't process scores
            if (!cursor) continue;
            // Loop through scores
            for (const score of res.scores) {
                // Skip failed scores
                if (!score.passed) continue;
                // Get user from db and skip if not found
                const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(score.user_id);
                if (!user) continue;
                // Get map and diff info from db and skip if not found
                const map = db.prepare(
                    `SELECT diff.status
                 FROM beatmaps diff
                 JOIN beatmapsets mapset ON diff.mapset_id = mapset.id
                 WHERE diff.id = ? AND diff.mode = ?`
                ).get(score.beatmap_id, ruleset);
                if (!map) continue;
                // Skip if map is unranked
                const isRanked = ['ranked', 'loved', 'approved'].includes(map.status);
                if (!isRanked) continue;
                // Check for existing pass and skip if found
                const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                    user.id, score.beatmap_id, ruleset
                );
                if (existingPass) continue;
                // Save the pass and log
                db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, mapset_id, map_id, mode, status, is_convert, time_passed) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                    user.id, map.beatmapset_id, score.beatmap_id, ruleset, map.status, map.convert ? 1 : 0, score.ended_at?.getTime() || Date.now()
                );
                log(`Found and saved a new ${ruleset} map pass for ${user.name}`);
                // Log counts
                logUserPassCount(user.id);
                // Update user stats
                await updateUserStats(user.id);
            }
            // Wait a second for rate limiting
            await sleep(1000);
        }
    } catch (error) {
        log('Error while updating users from global recents:', error);
    }
    // Wait and check again
    setTimeout(updateUsersFromGlobalRecents, 1000 * 15);
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
            const msSinceLastUpdate = Date.now() - (userEntry?.last_score_update || 0);
            if (msSinceLastUpdate < 1000 * 60 * 60 * 24) {
                updateUserFromRecents(task.user_id);
            } else {
                updateUserFromAllPasses(task.user_id);
            }
        }
    } catch (error) {
        log('Error while initializing user update tasks:', error);
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
        const osu = await osuApiInstance;
        let countInactiveUsers = 0;
        let countQueuedUsers = 0;
        let offset = 0;
        let limit = 50;
        log('Checking for active users to queue for updates...');
        while (true) {
            // Select batch of users
            const userIds = db.prepare(
                `SELECT id, last_score_update FROM users LIMIT ? OFFSET ?`
            ).all(limit, offset).map(u => u.id);
            if (userIds.length === 0) break;
            offset += limit;
            // Fetch user data in bulk
            const users = await osu.getUsers(userIds);
            // Loop through users
            for (const user of users) {
                let didPlayCountsChange = false;
                // Check fetched stats to see if play counts changed
                for (const mode in user.statistics_rulesets) {
                    const stats = user.statistics_rulesets[mode];
                    const currentCount = stats.play_count;
                    const storedCount = db.prepare(
                        `SELECT count FROM user_play_counts
                         WHERE user_id = ? AND mode = ?`
                    ).get(user.id, mode)?.count || 0;
                    if (currentCount !== storedCount) {
                        didPlayCountsChange = true;
                        break;
                    }
                }
                if (didPlayCountsChange) {
                    // Queue user for update if they aren't already queued
                    const existingTask = db.prepare(`SELECT 1 FROM user_update_tasks WHERE user_id = ? LIMIT 1`).get(user.id);
                    if (!existingTask) {
                        db.prepare(
                            `INSERT OR IGNORE INTO user_update_tasks
                             (user_id, time_queued, last_mapset_id, count_new_passes, percent_complete)
                             VALUES (?, ?, 0, 0, 0)`
                        ).run(user.id, Date.now());
                        log(`Queued ${user.username} for update due to changed play counts`);
                        await updateUserProfile(user.id, user);
                        countQueuedUsers++;
                    }
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
    }
    // Run again in an hour
    setTimeout(queueActiveUsers, 1000 * 60 * 60);
};

// Start update processes
log(`Starting update processes...`);
updateSavedMaps();
startQueuedUserUpdates();
updateUsersFromGlobalRecents();
queueActiveUsers();