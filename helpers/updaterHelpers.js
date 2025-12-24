require('dotenv').config({ path: '../.env' });
const db = require('../db');
const utils = require('../utils');
const osu = require('../osu');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const dayjs = require('dayjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'storage.db');

// Function to fetch new beatmaps(ets)
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
        if (countNewlySaved > 0)
            updateBeatmapStats();
        utils.log('Beatmap database is up to date');
    } catch (error) {
        utils.logError('Error while updating stored beatmap data:', error);
    }
};

// Function to update beatmap stats and totals in the database
const updateBeatmapStats = () => {
    try {
        utils.log(`Updating beatmap stats...`);
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
        utils.log('Updated beatmap stats');
    } catch (error) {
        utils.logError('Error while updating beatmap stats:', error);
    }
};

// Function to fetch a user's profile and update their stored data
// Returns the fetched user data
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
                    team_flag_url = ?
                WHERE id = ?`
            ).run(user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, user.team?.name, user.team?.short_name, user.team?.flag_url, user.id);
            utils.log(`Updated stored user data for ${user.username}`);
        } else {
            // Create new user entry
            db.prepare(
                `INSERT INTO users (id, name, avatar_url, banner_url, country_code, team_id, team_name, team_name_short, team_flag_url, time_created)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, user.team?.name, user.team?.short_name, user.team?.flag_url, Date.now());
            utils.log(`Stored user data for ${user.username}`);
        }
        return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    } catch (error) {
        utils.logError('Error while fetching/updating user profile:', error);
        return null;
    }
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
                        JOIN beatmaps b ON up.map_id = b.id AND b.mode = up.mode
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
                        INNER JOIN beatmapsets s ON up.mapset_id = s.id
                        WHERE up.user_id = ?
                        AND up.mode = '${mode}'
                        AND ${includesLoved ? "up.status IN ('ranked', 'approved', 'loved')" : "up.status IN ('ranked', 'approved')"}
                        ${includesConverts ? '' : 'AND up.is_convert = 0'}
                        GROUP BY year
                    `).all(userId);
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
                            yearlyStmt.run(userId, mode, includesLoved, includesConverts, year, count);
                        }
                    });
                    updateStats(stats);
                }
            }
        }
        utils.log('Updated user stats for', userEntry?.name || userId);
        return true;
    } catch (error) {
        utils.logError('Error while updating user stats:', error);
        return false;
    }
};

const saveUserHistory = async () => {
    try {
        const hhmm = dayjs().format('HHmm');
        if (hhmm !== '0000') return;
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
        logError('Error while saving user history:', error);
    }
};

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

// Function to fetch and save a mapset
const saveMapset = async (mapsetId, index = true) => {
    // Fetch full mapset including converts and save it
    let mapsetFull = await osu.getBeatmapset(mapsetId);
    saveMapsetTransaction(mapsetFull, index);
};

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
            SET time_started = ?, percent_complete = 0, count_passes_imported = 0
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
            for (const map of res.beatmaps_passed) {
                // Skip if no leaderboard
                const validStatuses = ['ranked', 'loved', 'approved'];
                if (!validStatuses.includes(map.status)) continue;
                // Save mapset data if not already saved
                const existingMapset = db.prepare(`SELECT * FROM beatmapsets WHERE id = ? LIMIT 1`).get(map.beatmapset_id);
                if (!existingMapset || existingMapset.status !== map.status) {
                    await saveMapset(map.beatmapset_id, !existingMapset);
                }
                // Push pass data
                passes.push({ mapId: map.id, mapsetId: map.beatmapset_id, mode: map.mode, status: map.status, isConvert: false });
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
        await updateUserStats(userId);
        // Log import completion and speed
        const importDurationMs = (Date.now() - timeStarted);
        const scoresPerMinute = Math.round(
            (mostPlayedOffset / (Date.now() - timeStarted)) * 1000 * 60
        );
        const status = `Completed import of ${passCount} passes for ${user.name} in ${utils.secsToDuration(Math.round(importDurationMs / 1000))} (${scoresPerMinute} scores/min)`;
        utils.log(status);
        utils.logError(`NOT AN ERROR:`, status);
    } catch (error) {
        utils.logError(`Error while importing user ${user.name}:`, error);
    }
    isImportRunning = false;
};

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
            }
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
            await updateUserStats(userId);
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

const queueUserForImport = async (userId) => {
    try {
        const existingTask = db.prepare(`SELECT 1 FROM user_import_queue WHERE user_id = ? LIMIT 1`).get(userId);
        if (!existingTask) {
            console.log(existingTask);
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
        }
        return false;
    } catch (error) {
        utils.logError(`Error while queueing user ${userId} for import:`, error);
        return null;
    }
};

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
    updateUserStats,
    savePassesFromGlobalRecents,
    importUser,
    backupDatabase,
    startQueuedImports,
    queueUserForImport,
    updateBeatmapStats,
    fetchNewMapData,
    saveUserHistory
};