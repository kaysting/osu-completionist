const db = require('../db');
const utils = require('../utils');
const osu = require('../osu');

// Function to fetch a user's profile and update their stored data
// Returns the fetched user data
const updateUserProfile = async (userId, userObj) => {
    try {
        const user = userObj || (await osu.getUsers({ ids: [userId] })).users[0];
        // Check if a user entry already exists
        const existingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
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
                `INSERT INTO users (id, name, avatar_url, banner_url, country_code, team_id, team_name, team_name_short, team_flag_url)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, user.team?.name, user.team?.short_name, user.team?.flag_url);
            utils.log(`Stored user data for ${user.username}`);
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
        utils.log('Error while fetching/updating user profile:', error);
        return null;
    }
};

// Function to queue a specific user for updates
// Returns true if queued, false if already queued, null on error
const queueUser = async (userId) => {
    try {
        const existingTask = db.prepare(`SELECT 1 FROM user_update_tasks WHERE user_id = ? LIMIT 1`).get(userId);
        if (!existingTask) {
            db.prepare(
                `INSERT OR IGNORE INTO user_update_tasks
                (user_id, time_queued, last_mapset_id, count_new_passes, percent_complete)
                VALUES (?, ?, 0, 0, 0)`
            ).run(userId, Date.now());
            const user = await updateUserProfile(userId);
            utils.log(`Queued ${user.username} for update`);
            return true;
        }
        return false;
    } catch (error) {
        utils.log('Error while queueing user for update:', error);
        return null;
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
    stmtInsertMapset.run(mapset.id, mapset.status, mapset.title, mapset.artist, new Date(mapset.ranked_date || mapset.submitted_date || undefined).getTime(), mapset.creator);
    // Loop through maps and converts and save
    let mapCount = 0;
    for (const map of [...mapset.beatmaps, ...(mapset.converts || [])]) {
        stmtInsertMap.run(map.id, mapset.id, map.mode, map.status, map.version, map.difficulty_rating, map.convert ? 1 : 0, map.total_length, map.cs, map.ar, map.accuracy, map.drain, map.bpm);
        if (shouldIndex)
            stmtInsertMapIndex.run(mapset.title, mapset.artist, map.version, map.id, map.mode);
        mapCount++;
    }
    console.log(`Saved mapset ${mapset.id} with ${mapCount} maps: ${mapset.artist} - ${mapset.title}`);
});

// Function to fetch and save a mapset
const saveMapset = async (mapsetId, index = true) => {
    // Fetch full mapset again to get converts
    let mapsetFull = null;
    while (true) {
        try {
            mapsetFull = await osu.getBeatmapset(mapsetId);
            break;
        } catch (error) {
            console.error(`Error fetching beatmapset ${mapsetId}: ${error}. Retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    // Save mapset and its maps
    saveMapsetTransaction(mapsetFull, index);
};

module.exports = {
    updateUserProfile,
    queueUser,
    saveMapset
};