require('dotenv').config({ path: '../.env' });
const db = require('./db');
const utils = require('./utils');
const osu = require('./osu');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const dayjs = require('dayjs');
const statCategories = require('./statCategories');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'storage.db');

// Prepare mapset data saving statements and transaction
const stmtInsertMapset = db.prepare(
    `INSERT OR REPLACE INTO beatmapsets
        (id, status, title, artist, time_ranked, mapper)
    VALUES (?, ?, ?, ?, ?, ?)`
);
const stmtInsertMap = db.prepare(
    `INSERT OR REPLACE INTO beatmaps
        (id, mapset_id, mode, status, name, stars, is_convert,
        duration_secs, cs, ar, od, hp, bpm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertMapIndex = db.prepare(
    `INSERT OR REPLACE INTO beatmaps_search (title, artist, name, map_id, mode)
     VALUES (?, ?, ?, ?, ?)`
);
const saveMapsetTransaction = db.transaction((mapset, shouldIndex) => {
    // Save mapset
    const rankTime = new Date(mapset.ranked_date || mapset.submitted_date || undefined).getTime();
    stmtInsertMapset.run(
        mapset.id, mapset.status, mapset.title, mapset.artist, rankTime, mapset.creator
    );
    // Build list of all maps (including converts)
    const maps = [...mapset.beatmaps];
    if (mapset.converts) {
        maps.push(...mapset.converts);
    }
    // Loop through map list and save
    for (const map of maps) {
        stmtInsertMap.run(map.id, mapset.id, map.mode, map.status, map.version, map.difficulty_rating, map.convert ? 1 : 0, map.total_length, map.cs, map.ar, map.accuracy, map.drain, map.bpm);
        if (shouldIndex)
            stmtInsertMapIndex.run(mapset.title, mapset.artist, map.version, map.id, map.mode);
    }
    utils.log(`Saved mapset ${mapset.id} with ${maps.length} maps: ${mapset.artist} - ${mapset.title}`);
});

/**
 * Fetch and store data for a mapset
 * @param {string} mapsetId The mapset ID to fetch and store
 * @param {boolean} index Whether or not the newly saved mapset should be added to the search index
 */
const saveMapset = async (mapsetId, index = true) => {
    // Fetch full mapset including converts and save it
    let mapsetFull = await osu.getBeatmapset(mapsetId);
    saveMapsetTransaction(mapsetFull, index);
};

/**
 * Fetch and store new beatmaps(ets) from osu! API
 */
const fetchNewMapData = async () => {
    try {
        utils.log(`Checking for new beatmaps...`);
        // Loop to get unsaved recent beatmapsets
        let countNewlySaved = 0;
        let cursor = null;
        while (true) {
            // Fetch mapsets
            const data = await osu.searchBeatmapsets({
                cursor_string: cursor,
                sort: 'ranked_desc',
                nsfw: true
            });
            // Extract data
            cursor = data.cursor_string;
            const mapsets = data.beatmapsets;
            // Loop through mapsets
            let savedNewMapset = false;
            for (const mapset of mapsets) {
                // Skip if we already have this mapset
                const existingMapset = db.prepare(`SELECT 1 FROM beatmapsets WHERE id = ? LIMIT 1`).get(mapset.id);
                if (existingMapset) continue;
                // Fetch full mapset and save
                await saveMapset(mapset.id, true);
                savedNewMapset = true;
                countNewlySaved++;
            }
            // We're done if no more mapsets, or we didn't find any new ones above
            if (!cursor || mapsets.length === 0 || !savedNewMapset) {
                break;
            }
        }
        // Update beatmap status
        if (countNewlySaved > 0) updateUserCategoryStats(0);
        utils.log('Beatmap database is up to date');
    } catch (error) {
        utils.logError('Error while updating stored beatmap data:', error);
    }
};

/**
 * Re-fetch all stored maps and update their data if their status has changed
 */
const updateMapStatuses = async () => {
    try {
        const countTotalMaps = db.prepare(`SELECT COUNT(*) AS count FROM beatmapsets`).get().count;
        let countProcessedMaps = 0;
        let lastMapsetId = 0;
        let lastLog = 0;
        while (true) {
            if ((Date.now() - lastLog) > 1000 * 15) {
                const percentage = ((countProcessedMaps / countTotalMaps) * 100).toFixed(2);
                utils.log(`Checking all saved maps for status updates (${percentage}%)...`);
                lastLog = Date.now();
            }
            // Get list of maps, one map per mapset
            const rows = db.prepare(
                `SELECT
                    map.mapset_id AS mapset_id,
                    map.id AS map_id,
                    mapset.status AS status
                FROM beatmaps map
                JOIN beatmapsets mapset ON map.mapset_id = mapset.id
                WHERE map.mapset_id > ?
                GROUP BY map.mapset_id
                ORDER BY mapset_id ASC
                LIMIT 50`
            ).all(lastMapsetId);
            if (rows.length === 0) break;
            lastMapsetId = rows[rows.length - 1].mapset_id;
            // Map mapset ids to statuses
            const savedMapsetStatuses = {};
            for (const mapset of rows) {
                savedMapsetStatuses[mapset.mapset_id] = mapset.status;
            }
            // Fetch maps from osu
            const ids = rows.map(row => row.map_id);
            const res = await osu.getBeatmaps({ ids });
            // Log maps that we tried to fetch but didn't receive
            const fetchedMapsetIds = new Set(res.beatmaps.map(map => map.beatmapset.id));
            for (const row of rows) {
                if (!fetchedMapsetIds.has(row.mapset_id)) {
                    utils.log(`Warning: Couldn't fetch mapset ID ${row.mapset_id} from osu! API`);
                }
            }
            // Loop through maps and save mapsets if their statuses changed
            for (const map of res.beatmaps) {
                countProcessedMaps++;
                // Check for status change
                const mapset = map.beatmapset;
                const oldStatus = savedMapsetStatuses[mapset.id];
                const newStatus = mapset.status;
                if (oldStatus === newStatus) continue;
                // Save updated mapset
                await saveMapset(mapset.id, false);
            }
        }
    } catch (error) {
        utils.logError('Error while updating map statuses:', error);
    }
};

/**
 * Fetch and store up to date profile data for a user from the osu! API
 * @param {number} userId The user ID whose data to update
 * @param {Object} userObj A user object previously returned from the osu! API, so we don't have to fetch it again
 * @returns A row from the users table
 */
const updateUserProfile = async (userId, userObj) => {
    try {
        // Check if a user entry already exists
        const existingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        // Stop now if it's been too soon since last profile update
        const msSinceLastUpdate = Date.now() - (existingUser?.last_profile_update_time || 0);
        if (existingUser && msSinceLastUpdate < (1000 * 60 * 15)) {
            return existingUser;
        }
        // Fetch user from osu
        const user = userObj || (await osu.getUsers({ ids: [userId] })).users[0];
        // Make sure we got a user
        if (!user?.username) {
            throw new Error(`User with ID ${userId} not found on osu! API`);
        }
        // Check if username has changed
        if (existingUser?.name !== user.username) {
            const oldNames = (await osu.getUser(user.id)).previous_usernames || [];
            db.transaction(() => {
                // Delete and re-save previous names
                db.prepare(`DELETE FROM user_previous_names WHERE user_id = ?`).run(user.id);
                for (const name of oldNames) {
                    db.prepare(`INSERT INTO user_previous_names (user_id, name) VALUES (?, ?)`).run(user.id, name);
                }
                // Update username search index
                const names = [user.username, ...oldNames];
                db.prepare(`INSERT OR REPLACE INTO users_search (rowid, names) VALUES (?, ?)`).run(user.id, names.join(' '));
            })();
            utils.log(`Updated saved previous names for ${user.username}`);
        }
        if (existingUser) {
            // Update user profile data
            db.prepare(
                `UPDATE users
                SET name = ?,
                    avatar_url = ?,
                    banner_url = ?,
                    country_code = ?,
                    team_id = ?,
                    team_name = ?,
                    team_name_short = ?,
                    team_flag_url = ?,
                    last_profile_update_time = ?
                WHERE id = ?`
            ).run(user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, user.team?.name, user.team?.short_name, user.team?.flag_url, Date.now(), user.id);
            utils.log(`Updated stored user data for ${user.username}`);
        } else {
            // Create new user entry
            db.prepare(
                `INSERT INTO users (id, name, avatar_url, banner_url, country_code, team_id, team_name, team_name_short, team_flag_url, time_created, last_profile_update_time, api_key)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, user.team?.name, user.team?.short_name, user.team?.flag_url, Date.now(), Date.now(), utils.generateSecretKey(32));
            utils.log(`Stored user data for ${user.username}`);
        }
        return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    } catch (error) {
        utils.logError('Error while fetching/updating user profile:', error);
        return null;
    }
};

/**
 * Internal function to check if a row matches a category definition's filters
 * @param {Object} row The database row to check
 * @param {Object} catDef The category definition
 */
const matchesCatDefFilters = (row, catDef) => {
    for (const filter of catDef.filters) {
        const rowValue = row[filter.field];
        if (filter.equals !== undefined) {
            if (rowValue != filter.equals) return false;
        }
        if (filter.in !== undefined) {
            if (!filter.in.includes(rowValue)) return false;
        }
        if (filter.range !== undefined) {
            if (rowValue < filter.range[0] || rowValue > filter.range[1]) return false;
        }
        if (filter.min !== undefined && rowValue < filter.min) return false;
        if (filter.max !== undefined && rowValue > filter.max) return false;
    }
    return true;
};

/**
 * Update a user's category stats based on their passes
 * @param {number} userId The user whose category stats to update, or 0 for beatmap totals
 */
const updateUserCategoryStats = (userId) => {
    const IS_GLOBAL = userId === 0;
    let user;
    try {
        // Get user info or global placeholder
        user = IS_GLOBAL ? {
            id: 0,
            name: 'all beatmaps',
        } : db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        if (!user) {
            throw new Error(`User with ID ${userId} not found in database`);
        }
        // Load unfiltered data into memory
        const cols = [
            `diff.mode AS mode`,
            `diff.status AS status`,
            `diff.is_convert AS is_convert`,
            `diff.cs AS cs`,
            `diff.ar AS ar`,
            `diff.od AS od`,
            `diff.hp AS hp`,
            `diff.duration_secs AS duration_secs`,
            `CAST(strftime('%Y', mapset.time_ranked / 1000, 'unixepoch') AS INTEGER) as year`
        ];
        let rows;
        if (IS_GLOBAL) {
            rows = db.prepare(`
                SELECT ${cols.join(', ')}
                FROM beatmaps diff
                JOIN beatmapsets mapset ON diff.mapset_id = mapset.id
            `).all();
        } else {
            rows = db.prepare(`
                SELECT ${cols.join(', ')}
                FROM user_passes pass
                JOIN beatmaps diff ON pass.map_id = diff.id AND pass.mode = diff.mode
                JOIN beatmapsets mapset ON diff.mapset_id = mapset.id
                WHERE pass.user_id = ?
            `).all(userId);
        }
        // Prepare insert statements
        const stmtMain = db.prepare(`
            INSERT OR REPLACE INTO user_category_stats 
            (user_id, category, count, seconds) VALUES (?, ?, ?, ?)
        `);
        const stmtYearly = db.prepare(`
            INSERT OR REPLACE INTO user_category_stats_yearly 
            (user_id, category, year, count, seconds) VALUES (?, ?, ?, ?, ?)
        `);
        // Do the updates in a transaction
        const transaction = db.transaction(() => {
            // Loop through categories
            for (const cat of statCategories.definitions) {
                // Track totals
                let totalCount = 0;
                let totalSecs = 0;
                const defaultYearlyData = { count: 0, seconds: 0 };
                const yearlyTotals = {};
                // Loop through rows and see if they match the category definition
                for (const row of rows) {
                    if (!matchesCatDefFilters(row, cat)) continue;
                    // Add to totals
                    totalCount++;
                    totalSecs += row.duration_secs;
                    if (!yearlyTotals[row.year])
                        yearlyTotals[row.year] = { ...defaultYearlyData };
                    yearlyTotals[row.year].count++;
                    yearlyTotals[row.year].seconds += row.duration_secs;
                }
                // Insert main stats
                stmtMain.run(user.id, cat.id, totalCount, totalSecs);
                // Insert yearly stats
                const startYear = 2007;
                const currentYear = new Date().getFullYear();
                for (let year = startYear; year <= currentYear; year++) {
                    const yearly = yearlyTotals[year] || defaultYearlyData;
                    stmtYearly.run(user.id, cat.id, year, yearly.count, yearly.seconds);
                }
            }
        });
        transaction();
        utils.log(`Updated stats in ${statCategories.definitions.length} categories for ${user.name}`);
    } catch (error) {
        utils.logError(`Error while updating category stats for ${user.name}:`, error);
    }
};

/**
 * Update category stats for all users
 */
const updateAllUserCategoryStats = () => {
    const userIds = db.prepare(`SELECT id FROM users`).all().map(row => row.id);
    userIds.push(0);
    console.log(`Updating category stats for ${userIds.length} users...`);
    for (const id of userIds) {
        updateUserCategoryStats(id);
    }
};

/**
 * Save a snapshot of the current state of category stats for all users. Only works once per calendar day.
 */
const snapshotCategoryStats = () => {
    try {
        const dateString = dayjs().format('YYYY-MM-DD');
        // Get totals
        const globalStats = db.prepare('SELECT category, seconds FROM user_category_stats WHERE user_id = 0').all();
        const categoryToTotalSecs = {};
        for (const row of globalStats) {
            categoryToTotalSecs[row.category] = row.seconds;
        }
        // Get all user stats sorted by implicit rank
        const allUserStats = db.prepare(`
            SELECT
                s.user_id AS user_id,
                s.category AS category,
                s.count AS count,
                s.seconds AS seconds
            FROM user_category_stats s
            JOIN users u ON s.user_id = u.id
            WHERE s.user_id != 0 AND u.last_import_time != 0
            ORDER BY s.category, s.seconds DESC
        `).all();
        if (allUserStats.length === 0) return;
        // Prepare insert
        const stmtInsert = db.prepare(`
            INSERT OR IGNORE INTO user_category_stats_history 
            (user_id, category, date, count, seconds, percent, rank, time) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        // Do the inserts in a transaction
        const transaction = db.transaction(() => {
            let category = null;
            let rank = 0;
            for (const row of allUserStats) {
                // Reset numbers on new category
                if (row.category !== category) {
                    category = row.category;
                    rank = 0;
                }
                rank++;
                // Calculate percentage
                const globalSecs = categoryToTotalSecs[row.category] || 0;
                const percent = globalSecs > 0 ? (row.seconds / globalSecs) * 100 : 0;
                // Insert
                stmtInsert.run(
                    row.user_id, row.category, dateString, row.count, row.seconds, percent, rank, Date.now()
                );
            }
        });
        transaction();
        utils.log(`Saved history snapshot`);
    } catch (error) {
        utils.logError('Error saving category stats history:', error);
    }
};

// Function to import a user's passes from their most played beatmaps
let isImportRunning = false;
const importUser = async (userId) => {
    const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    try {
        isImportRunning = true;
        utils.log(`Deleting existing passes for ${user.name}...`);
        db.prepare(`DELETE FROM user_passes WHERE user_id = ?`).run(userId);
        utils.log(`Starting import of ${user.name}'s passes...`);
        const osuUser = await osu.getUser(userId);
        const playcountsCount = osuUser.beatmap_playcounts_count;
        const uniqueMapsetIds = new Set();
        const uniqueStdMapsetIds = new Set();
        const pendingMapsetIds = [];
        // Update queue entry
        const timeStarted = Date.now();
        db.prepare(
            `UPDATE user_import_queue
            SET time_started = ?, percent_complete = 0, count_passes_imported = 0,
                time_queued = 0, playcounts_count = ?
            WHERE user_id = ?`
        ).run(timeStarted, playcountsCount, userId);
        // Outer loop to fetch and process passes
        let mostPlayedOffset = 0;
        let passCount = 0;
        while (true) {
            // Inner loop to fetch unique mapset IDs from most played
            while (true) {
                if (pendingMapsetIds.length >= 50) break;
                // Fetch most played maps
                const res = await osu.getUserBeatmaps(userId, 'most_played', {
                    limit: 100, offset: mostPlayedOffset
                });
                if (res.length == 0) break;
                // Collect unique mapset IDs
                for (const entry of res) {
                    const mapsetId = entry.beatmapset.id;
                    const status = entry.beatmapset.status;
                    const validStatuses = ['ranked', 'approved', 'loved'];
                    if (!uniqueMapsetIds.has(mapsetId) && validStatuses.includes(status)) {
                        uniqueMapsetIds.add(mapsetId);
                        pendingMapsetIds.push(mapsetId);
                        if (entry.beatmap.mode === 'osu') {
                            uniqueStdMapsetIds.add(mapsetId);
                        }
                    }
                    mostPlayedOffset++;
                }
            }
            // Break if no more mapsets to process
            if (pendingMapsetIds.length === 0) break;
            // Collect batch of mapsets
            const ids = pendingMapsetIds.splice(0, 50);
            const stdIds = ids.filter(id => uniqueStdMapsetIds.has(id));
            const passes = [];
            // Get non-convert passes for all maps
            const res = await osu.getUserBeatmapsPassed(user.id, {
                beatmapset_ids: ids,
                exclude_converts: true,
                no_diff_reduction: false
            });
            let savedNewMapsets = false;
            for (const map of res.beatmaps_passed) {
                // Skip if no leaderboard
                const validStatuses = ['ranked', 'loved', 'approved'];
                if (!validStatuses.includes(map.status)) continue;
                // Save mapset data if not already saved
                const existingMapset = db.prepare(`SELECT * FROM beatmapsets WHERE id = ? LIMIT 1`).get(map.beatmapset_id);
                if (!existingMapset || existingMapset.status !== map.status) {
                    await saveMapset(map.beatmapset_id, !existingMapset);
                    savedNewMapsets = true;
                }
                // Push pass data
                passes.push({ mapId: map.id, mapsetId: map.beatmapset_id, mode: map.mode, status: map.status, isConvert: false });
            }
            // Update beatmap stats if we saved any new mapsets
            if (savedNewMapsets) {
                updateUserCategoryStats(0);
            }
            // Get convert passes on standard maps
            if (stdIds.length > 0) {
                for (const mode of [1, 2, 3]) {
                    const modeName = utils.rulesetNameToKey(mode);
                    const resConverts = await osu.getUserBeatmapsPassed(user.id, {
                        beatmapset_ids: stdIds,
                        exclude_converts: false,
                        no_diff_reduction: false,
                        ruleset_id: mode
                    });
                    for (const map of resConverts.beatmaps_passed) {
                        // Skip if no leaderboard
                        const validStatuses = ['ranked', 'loved', 'approved'];
                        if (!validStatuses.includes(map.status)) continue;
                        // Push pass data
                        const isConvert = map.mode !== modeName;
                        passes.push({ mapId: map.id, mapsetId: map.beatmapset_id, mode: modeName, status: map.status, isConvert });
                    }
                }
            }
            // Save passes to DB
            const transaction = db.transaction(() => {
                for (const pass of passes) {
                    const time = Date.now();
                    db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, map_id, mapset_id, mode, status, is_convert, time_passed) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                        user.id, pass.mapId, pass.mapsetId, pass.mode, pass.status, pass.isConvert ? 1 : 0, time
                    );
                    passCount++;
                }
            });
            transaction();
            // Update queue entry progress
            const percentComplete = (mostPlayedOffset / playcountsCount * 100).toFixed(2);
            db.prepare(
                `UPDATE user_import_queue
                SET percent_complete = ?, count_passes_imported = ?
                WHERE user_id = ?`
            ).run(percentComplete, passCount, userId);
            // Update user's times
            db.prepare(
                `UPDATE users SET last_pass_time = ? WHERE id = ?`
            ).run(Date.now(), userId);
            // Log
            const scoresPerMinute = Math.round(
                (mostPlayedOffset / (Date.now() - timeStarted)) * 1000 * 60
            );
            utils.log(`[Importing ${percentComplete}%] Saved ${passes.length} new passes for ${user.name} (${scoresPerMinute} scores/min)`);
        }
        // Remove from import queue
        db.prepare(`DELETE FROM user_import_queue WHERE user_id = ?`).run(userId);
        // Save last import time
        db.prepare(`UPDATE users SET last_import_time = ? WHERE id = ?`).run(Date.now(), userId);
        // Update user stats
        updateUserCategoryStats(userId);
        // Log import completion and speed
        const importDurationMs = (Date.now() - timeStarted);
        const scoresPerMinute = Math.round(
            (mostPlayedOffset / (Date.now() - timeStarted)) * 1000 * 60
        );
        utils.logToDiscord(`Completed import of ${passCount} passes for ${user.name} in ${utils.secsToDuration(Math.round(importDurationMs / 1000))} (${scoresPerMinute} scores/min)`);
    } catch (error) {
        utils.logError(`Error while importing user ${user.name}:`, error);
    }
    isImportRunning = false;
};

// Function to save passes from global recents
const savePassesFromGlobalRecents = async () => {
    try {
        utils.log(`Fetching global recents in all modes...`);
        const modes = ['osu', 'taiko', 'fruits', 'mania'];
        // Fetch all global recent scores
        const mapIds = new Set();
        const scoresByUser = {};
        const newCursors = {};
        for (const mode of modes) {
            const cursor = db.prepare(
                `SELECT cursor FROM global_recents_cursors WHERE mode = ?`
            ).get(mode)?.cursor || null;
            const res = await osu.getScores({ ruleset: mode, cursor_string: cursor });
            // Save scores for processing
            for (const score of res.scores) {
                // Skip if user not tracked
                const existingUser = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(score.user_id);
                if (!existingUser) continue;
                // Save score and map id for later processing
                if (!scoresByUser[score.user_id]) {
                    scoresByUser[score.user_id] = [];
                }
                scoresByUser[score.user_id].push(score);
                mapIds.add(score.beatmap_id);
            }
            // Make note of new cursor
            newCursors[mode] = res.cursor_string;
        };
        // Stop here if no scores found
        if (mapIds.size === 0) {
            utils.log('No new scores found in global recents');
            return;
        }
        // Fetch all maps in batches of 50
        utils.log(`Fetching data for ${mapIds.size} beatmaps found in global recents...`);
        const mapsById = {};
        const mapIdsArray = Array.from(mapIds);
        while (mapIdsArray.length > 0) {
            const ids = mapIdsArray.splice(0, 50);
            const res = await osu.getBeatmaps({ ids });
            for (const map of res.beatmaps) {
                mapsById[map.id] = map;
            }
        }
        // Save mapset data if not already saved
        let savedNewMapsets = false;
        for (const mapId in mapsById) {
            const map = mapsById[mapId];
            // Skip if map doesn't have a leaderboard
            const validStatuses = ['ranked', 'loved', 'approved'];
            if (!validStatuses.includes(map.status)) continue;
            // Save mapset data if not already saved
            const mapsetId = map.beatmapset.id;
            const existingMapset = db.prepare(`SELECT * FROM beatmapsets WHERE id = ? LIMIT 1`).get(mapsetId);
            if (!existingMapset || existingMapset.status !== map.beatmapset.status) {
                await saveMapset(mapsetId, !existingMapset);
                savedNewMapsets = true;
            }
        }
        // Update beatmap stats if we saved any new mapsets
        if (savedNewMapsets) {
            updateUserCategoryStats(0);
        }
        // Process scores
        utils.log(`Processing and saving passes from global recents...`);
        for (const userId in scoresByUser) {
            await updateUserProfile(userId);
            const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
            let newCount = 0;
            let latestTime = 0;
            const transaction = db.transaction(() => {
                for (const score of scoresByUser[userId]) {
                    // Make sure map data was fetched
                    const mapId = score.beatmap_id;
                    const map = mapsById[mapId];
                    if (!map) {
                        utils.log(`Warning: Beatmap with ID ${mapId} couldn't be fetched from osu API`);
                        continue;
                    }
                    // Collect other data
                    const time = new Date(score.ended_at || score.started_at || Date.now()).getTime();
                    if (time > latestTime) latestTime = time;
                    const mode = utils.rulesetNameToKey(score.ruleset_id);
                    const status = map.status;
                    const isConvert = map.mode !== mode;
                    const mapsetId = map.beatmapset.id;
                    // Skip if map doesn't have a leaderboard
                    const validStatuses = ['ranked', 'loved', 'approved'];
                    if (!validStatuses.includes(status)) continue;
                    // Skip if pass is already saved
                    const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(userId, mapId, mode);
                    if (existingPass) continue;
                    // Save pass
                    db.prepare(`INSERT INTO user_passes (user_id, map_id, mapset_id, mode, status, is_convert, time_passed) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                        userId, mapId, mapsetId, mode, status, isConvert ? 1 : 0, time
                    );
                    newCount++;
                }
                // Update user's last pass time
                db.prepare(`UPDATE users SET last_pass_time = ? WHERE id = ?`).run(latestTime, userId);
            });
            transaction();
            if (newCount === 0) continue;
            // Update user stats
            utils.log(`Saved ${newCount} new passes for ${user.name}`);
            updateUserCategoryStats(userId);
        }
        // Save new cursors
        // We do this down here so if something fails above, we don't lose the cursor position
        for (const mode of modes) {
            const newCursor = newCursors[mode];
            db.prepare(`INSERT OR REPLACE INTO global_recents_cursors (mode, cursor) VALUES (?, ?)`).run(mode, newCursor);
        }
    } catch (error) {
        utils.logError(`Error while processing global recents:`, error);
    }
};

// Function to start the next queued user import
const startQueuedImports = async () => {
    const nextEntry = db.prepare(`SELECT * FROM user_import_queue ORDER BY time_queued ASC LIMIT 1`).get();
    if (!nextEntry) return;
    if (isImportRunning) return;
    const userId = nextEntry.user_id;
    const userEntry = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!userEntry) {
        // Remove from queue if user doesn't exist
        db.prepare(`DELETE FROM user_import_queue WHERE user_id = ?`).run(userId);
        utils.logError(`User with ID ${userId} not found in database, removed from import queue`);
        return;
    }
    importUser(userId);
};

// Function to queue a user for import
const queueUserForImport = async (userId) => {
    try {
        const existingTask = db.prepare(`SELECT 1 FROM user_import_queue WHERE user_id = ? LIMIT 1`).get(userId);
        if (existingTask) return false;
        // Fetch playcounts count
        const user = await osu.getUser(userId);
        const playcountsCount = user?.beatmap_playcounts_count || 0;
        if (!user || playcountsCount === 0) {
            utils.log(`User ${user?.username} has no playcounts, not queueing for import`);
            return false;
        }
        // Add to queue
        db.prepare(
            `INSERT OR IGNORE INTO user_import_queue
            (user_id, time_queued, playcounts_count)
            VALUES (?, ?, ?)`
        ).run(userId, Date.now(), playcountsCount);
        utils.log(`Queued ${user.username} for import`);
        return true;
    } catch (error) {
        utils.logError(`Error while queueing user ${userId} for import:`, error);
        return null;
    }
};

// Function to backup the database periodically
const backupDatabase = async () => {
    try {
        const backupsDir = process.env.DB_BACKUPS_DIR || path.join(__dirname, '../backups');
        const backupIntervalHours = process.env.DB_BACKUP_INTERVAL_HOURS || 6;
        const keepBackupsCount = process.env.DB_KEEP_BACKUPS_COUNT || 12;
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir);
        }
        // Get existing backups sorted by modification time
        const files = fs.readdirSync(backupsDir)
            .map(file => ({
                name: file,
                path: path.join(backupsDir, file),
                mtime: fs.statSync(path.join(backupsDir, file)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime);
        // Check if backup is needed
        const lastBackupTime = files.length > 0 ? files[0].mtime : 0;
        const needsBackup = Date.now() - lastBackupTime > (backupIntervalHours * 60 * 60 * 1000);
        if (needsBackup) {
            const backupFile = path.join(backupsDir, `${dayjs().format('YYYYMMDD-HHmmss')}.sql`);
            utils.log(`Backing up database to ${backupFile}...`);
            cp.execSync(`sqlite3 "${dbPath}" .dump > "${backupFile}"`);
            utils.log(`Backup complete`);
            const filesToDelete = files.slice(keepBackupsCount - 1);
            for (const file of filesToDelete) {
                fs.unlinkSync(file.path);
                utils.log(`Deleted old backup: ${file.path}`);
            }
        }
    } catch (error) {
        utils.logError('Error while backing up database:', error);
    }
};

module.exports = {
    updateUserProfile,
    saveMapset,
    savePassesFromGlobalRecents,
    importUser,
    backupDatabase,
    startQueuedImports,
    queueUserForImport,
    fetchNewMapData,
    updateUserCategoryStats,
    snapshotCategoryStats,
    updateAllUserCategoryStats,
    updateMapStatuses
};