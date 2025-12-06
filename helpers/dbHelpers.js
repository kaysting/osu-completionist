const db = require('../db');
const utils = require('../utils');

const formatUserEntry = (entry) => {
    return {
        id: entry.id,
        name: entry.name,
        avatar_url: entry.avatar_url,
        banner_url: entry.banner_url,
        country: {
            code: entry.country_code,
            name: entry.country_name
        },
        team: {
            id: entry.team_id,
            name: entry.team_name,
            flag_url: entry.team_flag_url
        }
    };
};

const getBulkUserProfiles = (userIds) => {
    if (userIds.length === 0) {
        return [];
    }
    const rows = db.prepare(
        `SELECT u.id, u.name, u.avatar_url, u.banner_url, u.country_code, u.team_id, u.team_name, u.team_flag_url, c.name AS country_name
         FROM users u
         LEFT JOIN country_names c ON u.country_code = c.code
         WHERE u.id IN (${userIds.map(() => '?').join(',')})`
    ).all(...userIds);
    const userIdToProfile = {};
    for (const row of rows) {
        userIdToProfile[row.id] = formatUserEntry(row);
    }
    return userIds.map(id => userIdToProfile[id] || null);
};

const getUserProfile = (userId, includes = []) => {
    return getBulkUserProfiles([userId], includes)?.[0];
};

const getBulkUserCompletionStats = (userIds, mode, includeLoved, includeConverts) => {
    if (userIds.length === 0) {
        return [];
    }
    const totalMaps = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0)?.count || 0;
    const rows = db.prepare(
        `SELECT * FROM user_stats WHERE user_id IN (${userIds.map(() => '?').join(',')})
         AND mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).all(...userIds, mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const statsByUserId = {};
    for (const row of rows) {
        statsByUserId[row.user_id] = {
            count_complete: row.count,
            count_total: totalMaps,
            percentage_completed: totalMaps > 0 ? ((row.count / totalMaps) * 100) : 0
        };
    }
    return rows.map(row => ({
        id: row.user_id,
        stats: statsByUserId[row.user_id] || {
            count_complete: 0,
            count_total: totalMaps,
            percentage_completed: 0
        }
    }));
};

const getLeaderboard = (mode, includeLoved, includeConverts, limit = 100, offset = 0) => {
    const rows = db.prepare(
        `SELECT u.id
         FROM users u
         JOIN user_stats us ON u.id = us.user_id
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.count DESC
         LIMIT ? OFFSET ?`
    ).all(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, limit, offset);
    const userIds = rows.map(row => row.id);
    // Get user profiles
    const userProfiles = getBulkUserProfiles(userIds);
    const userIdToProfile = {};
    for (const profile of userProfiles) {
        userIdToProfile[profile.id] = profile;
    }
    // Get user stats
    const userStats = getBulkUserCompletionStats(userIds, mode, includeLoved, includeConverts);
    const userIdToStats = {};
    for (const entry of userStats) {
        userIdToStats[entry.id] = entry.stats;
    }
    // Build result
    const entries = rows.map((row, i) => ({
        rank: offset + i + 1,
        user: userIdToProfile[row.id] || null,
        stats: userIdToStats[row.id] || null
    }));
    return entries;
};

const getUserYearlyCompletionStats = (userId, mode, includeLoved, includeConverts) => {

};

const formatBeatmap = (beatmap, beatmapset) => {

};

const getBulkBeatmaps = (mapIds) => {

};

const getBulkBeatmapsets = (mapsetIds) => {

};

const getUserRecentPasses = (userId, mode, includeLoved, includeConverts, limit = 100, offset = 0) => {

};

const getUserRecommendedMaps = (userId, mode, includeLoved, includeConverts, limit = 100, offset = 0, starsMin, starsMax, timeRankedMin, timeRankedMax) => {

};

module.exports = {
    getBulkUserCompletionStats,
    getUserProfile,
    getLeaderboard,
    getUserRecentPasses,
    getUserYearlyCompletionStats,
    getUserRecommendedMaps
};