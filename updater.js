const db = require('./db');
const osuApi = require('osu-api-v2-js');
const config = require('./config.json');

const log = (...args) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
};

const getOsuApiInstance = async () => {
    return await osuApi.API.createAsync(config.osu_client_id, config.osu_api_token);
};

// Function to fetch new beatmaps(ets)
const FETCH_ALL_MAPS = false;
const fetchNewMaps = async () => {
    try {
        // Initialize API
        const osu = await osuApi.API.createAsync(config.osu_client_id, config.osu_api_token);
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
            for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
                for (const status of ['ranked', 'loved', 'approved']) {
                    for (const includeConverts of [1, 0]) {
                        let count = 0;
                        if (includeConverts) {
                            count = db.prepare(
                                `SELECT COUNT(*) AS count
                                FROM beatmaps
                                WHERE mode = ? AND status = ?`
                            ).get(mode, status).count;
                        } else {
                            count = db.prepare(
                                `SELECT COUNT(*) AS count
                                FROM beatmaps
                                WHERE mode = ? AND status = ? AND is_convert = 0`
                            ).get(mode, status).count;
                        }
                        db.prepare(`INSERT OR REPLACE INTO beatmap_stats (mode, status, include_converts, count) VALUES (?, ?, ?, ?)`).run(
                            mode, status, includeConverts, count
                        );
                    }
                }
            }
        }
    } catch (error) {
        log('Error while updating stored beatmap data:', error);
    }
    // Wait an hour and then run again
    setTimeout(fetchNewMaps, 1000 * 60 * 60);
};

const updateUserProfile = async (userId) => {
    try {
        const osu = await getOsuApiInstance();
        const user = await osu.getUser(userId);
        // Update stored user data
        const existingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
        if (existingUser) {
            db.prepare(
                `UPDATE users
                SET name = ?,
                    avatar_url = ?,
                    banner_url = ?,
                    mode = ?
                WHERE id = ?`
            ).run(user.username, user.avatar_url, user.cover.url, user.playmode, user.id);
            log(`Updated stored user data for ${user.username}`);
        } else {
            db.prepare(
                `INSERT OR REPLACE INTO users (id, name, avatar_url, banner_url, mode)
                VALUES (?, ?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url, user.playmode);
            log(`Stored user data for ${user.username}`);
        }
        return user;
    } catch (error) {
        log('Error while fetching/updating user profile:', error);
        return null;
    }
};

let isAllPassesUpdateRunning = false;
let isRecentsUpdateRunning = false;

const updateUserAllPasses = async (userId) => {
    try {
        if (isAllPassesUpdateRunning) {
            return;
        }
        isAllPassesUpdateRunning = true;
        const osu = await getOsuApiInstance();
        const user = await updateUserProfile(userId);
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
                log(`Completed full pass history update for ${user.username}`);
                break;
            }
            // Calculate progress
            const countMapsetsRemaining = countMapsetsTotal - mapsetIds.length - db.prepare(
                `SELECT COUNT(*) AS count FROM beatmapsets WHERE id <= ?`
            ).get(task.last_mapset_id).count;
            const percentage = ((countMapsetsTotal - countMapsetsRemaining) / countMapsetsTotal * 100);
            // Log
            log(`[${percentage.toFixed(2)}%] Fetching passed maps for ${user.username}...`);
            // Fetch passed maps for each mapset
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
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else {
                        throw error;
                    }
                }
            }
            // Save new passes
            const transaction = db.transaction((maps) => {
                let newCount = 0;
                for (const map of maps) {
                    // Skip if we already have this pass saved
                    const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(
                        user.id, map.id, map.mode
                    );
                    if (existingPass) continue;
                    // Save the pass
                    db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, mapset_id, map_id, mode, status, is_convert) VALUES (?, ?, ?, ?, ?, ?)`).run(
                        user.id, map.beatmapset_id, map.id, map.mode, map.status, map.convert ? 1 : 0
                    );
                    newCount++;
                }
                // Log
                if (newCount > 0)
                    log(`[${percentage.toFixed(2)}%] Found ${newCount} new map passes for ${user.username}`);
                // Update task info
                db.prepare(`
                        UPDATE user_update_tasks
                        SET count_new_passes = count_new_passes + ?,
                            last_mapset_id = ?, percent_complete = ?
                        WHERE user_id = ?
                    `).run(newCount, mapsetIds.pop(), percentage, user.id);
            });
            transaction(maps);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    } catch (error) {
        log('Error while updating user with full pass history:', error);
    }
    // Get counts
    const passCount = db.prepare(
        `SELECT COUNT(*) AS count
                    FROM user_passes
                    WHERE user_id = ?`
    ).get(user.id).count;
    log(`Now storing ${passCount} map passes for ${user.username}`);
};

const updateUserRecents = async (userId) => {
    try {
        if (isRecentsUpdateRunning) {
            return;
        }
        isRecentsUpdateRunning = true;
        const osu = await getOsuApiInstance();
        const user = await updateUserProfile(userId);
        log(`Fetching recent scores for ${user.username}`);
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
                if (!existingPass) {
                    scores.push(score);
                    newCount++;
                }
            }
            if (newCount > 0)
                log(`Found ${newCount} new ${ruleset} map passes for ${user.username}`);
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
                db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, mapset_id, map_id, mode, status, is_convert) VALUES (?, ?, ?, ?, ?, ?)`).run(
                    user.id, score.beatmapset.id, score.beatmap.id, score.beatmap.mode, score.beatmap.status, score.beatmap.convert ? 1 : 0
                );
            }
            db.prepare(`UPDATE users SET last_score_update = ? WHERE id = ?`).run(updateTime, user.id);
            db.prepare(`DELETE FROM user_update_tasks WHERE user_id = ?`).run(user.id);
            log(`Completed recent score update for ${user.username}`);
        });
        transaction(scores);
    } catch (error) {
        log('Error while updating user recent scores:', error);
    }
};

// Function that initializes scheduled user update tasks
// If it's been less than 24 hours since last user pass update,
// only update using their recent scores. Otherwise, scrape their
// whole map pass history.
const updateUsers = async () => {
    const tasks = db.prepare(`SELECT * FROM user_update_tasks ORDER BY time_queued ASC`).all();
    for (const task of tasks) {
        const msSinceLastUpdate = Date.now() - userEntry.last_score_update;
        if (msSinceLastUpdate < 1000 * 60 * 60 * 24) {
            await updateUserRecents(task.user_id);
        } else {
            await updateUserAllPasses(task.user_id);
        }
    }
    setTimeout(updateUsers, 1000);
};

// Queue users for update if they haven't been updated recently
const queueUsers = () => {
    try {
        const minLastUpdate = Date.now() - (1000 * 60 * 60 * 16);
        const usersToQueue = db.prepare(
            `SELECT id, name FROM users
             WHERE last_score_update < ?
             AND id NOT IN (SELECT user_id FROM user_update_tasks)
             ORDER BY last_score_update ASC`
        ).all(minLastUpdate);
        const insertTask = db.prepare(
            `INSERT INTO user_update_tasks (user_id, time_queued)
             VALUES (?, 0)`
        );
        for (const user of usersToQueue) {
            insertTask.run(user.id);
            log(`Queued ${user.name} for update`);
        }
    } catch (error) {
        log('Error while queuing users for update:', error);
    }
    setTimeout(queueUsers, 1000 * 60);
};

// Start update processes
log(`Starting update processes...`);
fetchNewMaps();
updateUsers();
queueUsers();