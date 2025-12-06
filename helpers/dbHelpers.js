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
    const rows = db.prepare(`
        SELECT s1.*,
               (SELECT COUNT(*) FROM user_stats s2
                WHERE s2.mode = s1.mode
                AND s2.includes_loved = s1.includes_loved
                AND s2.includes_converts = s1.includes_converts
                AND s2.count > s1.count
               ) + 1 AS rank
        FROM user_stats s1
        WHERE s1.user_id IN (${userIds.map(() => '?').join(',')})
        AND s1.mode = ? AND s1.includes_loved = ? AND s1.includes_converts = ?
    `).all(...userIds, mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const statsByUserId = {};
    for (const row of rows) {
        statsByUserId[row.user_id] = {
            count_completed: row.count,
            count_total: totalMaps,
            percentage_completed: totalMaps > 0 ? ((row.count / totalMaps) * 100) : 0,
            rank: row.rank
        };
    }
    return rows.map(row => ({
        id: row.user_id,
        stats: statsByUserId[row.user_id] || {
            count_completed: 0,
            count_total: totalMaps,
            percentage_completed: 0,
            rank: -1
        }
    }));
};

const getUserCompletionStats = (userId, mode, includeLoved, includeConverts) => {
    return getBulkUserCompletionStats([userId], mode, includeLoved, includeConverts)?.[0]?.stats || null;
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

const getBulkUserYearlyCompletionStats = (userIds, mode, includeLoved, includeConverts) => {
    if (userIds.length === 0) {
        return [];
    }
    const totalsRows = db.prepare(
        `SELECT year, count FROM beatmap_stats_yearly
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).all(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const yearToTotalCount = {};
    for (const row of totalsRows) {
        yearToTotalCount[row.year] = row.count;
    }
    const completedRows = db.prepare(
        `SELECT user_id, year, count FROM user_stats_yearly
         WHERE user_id IN (${userIds.map(() => '?').join(',')})
         AND mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).all(...userIds, mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const userIdToYearlyCompletions = {};
    for (const row of completedRows) {
        if (!userIdToYearlyCompletions[row.user_id]) {
            userIdToYearlyCompletions[row.user_id] = {};
        }
        userIdToYearlyCompletions[row.user_id][row.year] = row.count;
    }
    const entries = [];
    for (const userId of userIds) {
        const entry = [];
        for (const year in yearToTotalCount) {
            entry.push({
                year: parseInt(year),
                count_completed: userIdToYearlyCompletions[userId]?.[year] || 0,
                count_total: yearToTotalCount[year],
                percentage_completed: yearToTotalCount[year] > 0 ? (((userIdToYearlyCompletions[userId]?.[year] || 0) / yearToTotalCount[year]) * 100) : 0
            });
        }
        entries.push(entry);
    }
    return entries;
};

const getUserYearlyCompletionStats = (userId, mode, includeLoved, includeConverts) => {
    return getBulkUserYearlyCompletionStats([userId], mode, includeLoved, includeConverts)?.[0] || [];
};

const formatBeatmap = (beatmap) => {
    return {
        id: beatmap.id,
        mapset_id: beatmap.mapset_id,
        mode: beatmap.mode,
        name: beatmap.name,
        stars: beatmap.stars,
        difficulty_color: utils.starsToColor(beatmap.stars),
        duration_secs: beatmap.duration_secs,
        is_convert: !!beatmap.is_convert,
        status: beatmap.status
    };
};

const formatBeatmapset = (beatmapset) => {
    return {
        id: beatmapset.id,
        artist: beatmapset.artist,
        title: beatmapset.title,
        time_ranked: beatmapset.time_ranked,
        status: beatmapset.status
    };
};

const getBulkBeatmapsets = (mapsetIds, includeBeatmaps, includeConverts) => {
    if (mapsetIds.length === 0) {
        return [];
    }
    const rows = db.prepare(
        `SELECT * FROM beatmapsets
         WHERE id IN (${mapsetIds.map(() => '?').join(',')})`
    ).all(...mapsetIds);
    const beatmapsets = rows.map(row => formatBeatmapset(row));
    if (includeBeatmaps) {
        const mapsetIdToBeatmaps = {};
        const beatmapRows = db.prepare(
            `SELECT * FROM beatmaps
             WHERE mapset_id IN (${mapsetIds.map(() => '?').join(',')})
             ${includeConverts ? '' : 'AND is_convert = 0'}
             ORDER BY stars ASC`
        ).all(...mapsetIds);
        for (const row of beatmapRows) {
            const beatmap = formatBeatmap(row);
            if (!mapsetIdToBeatmaps[beatmap.mapset_id]) {
                mapsetIdToBeatmaps[beatmap.mapset_id] = [];
            }
            mapsetIdToBeatmaps[beatmap.mapset_id].push(beatmap);
        }
        for (const mapset of beatmapsets) {
            mapset.beatmaps = mapsetIdToBeatmaps[mapset.id] || [];
        }
    }
    return beatmapsets;
};

const getBulkBeatmaps = (mapIds, includeMapset, mode) => {
    if (mapIds.length === 0) {
        return [];
    }
    const rows = db.prepare(
        `SELECT * FROM beatmaps
         WHERE id IN (${mapIds.map(() => '?').join(',')})
         ${mode ? 'AND mode = ?' : 'AND is_convert = 0'}`
    ).all(...mapIds, ...(mode ? [mode] : []));
    const beatmaps = rows.map(row => formatBeatmap(row));
    if (includeMapset) {
        const mapsetIds = [...new Set(beatmaps.map(bm => bm.mapset_id))];
        const mapsets = getBulkBeatmapsets(mapsetIds, false, false);
        const mapsetIdToMapset = {};
        for (const mapset of mapsets) {
            mapsetIdToMapset[mapset.id] = mapset;
        }
        for (const map of beatmaps) {
            map.mapset = mapsetIdToMapset[map.mapset_id] || null;
        }
    }
    return beatmaps;
};

const getBeatmapset = (mapsetId, includeBeatmaps, includeConverts) => {
    return getBulkBeatmapsets([mapsetId], includeBeatmaps, includeConverts)?.[0] || null;
};

const getBeatmap = (mapId, includeMapset) => {
    return getBulkBeatmaps([mapId], includeMapset)?.[0] || null;
};

const getUserRecentPasses = (userId, mode, includeLoved, includeConverts, limit = 100, offset = 0) => {
    const rows = db.prepare(
        `SELECT map_id, time_passed FROM user_passes
             WHERE user_id = ?
               AND mode = ?
               AND ${includeLoved ? `status IN ('ranked', 'approved', 'loved')` : `status IN ('ranked', 'approved')`}
               ${includeConverts ? '' : 'AND is_convert = 0'}
             ORDER BY time_passed DESC
             LIMIT ? OFFSET ?`
    ).all(userId, mode, limit, offset);
    const beatmapIdsToMaps = {};
    const beatmapIds = rows.map(row => row.map_id);
    const beatmaps = getBulkBeatmaps(beatmapIds, true, mode);
    for (const map of beatmaps) {
        beatmapIdsToMaps[map.id] = map;
    }
    const passes = rows.map(row => ({
        time_passed: row.time_passed,
        beatmap: beatmapIdsToMaps[row.map_id] || null
    }));
    return passes;
};

const getUserRecommendedMaps = (userId, mode, includeLoved, includeConverts, limit = 100, offset = 0, starsMin, starsMax, timeRankedMin, timeRankedMax) => {

};

module.exports = {
    getBulkUserCompletionStats,
    getUserProfile,
    getLeaderboard,
    getUserRecentPasses,
    getUserYearlyCompletionStats,
    getUserRecommendedMaps,
    getUserCompletionStats,
    getBulkUserProfiles,
    getBulkBeatmaps,
    getBulkBeatmapsets,
    getBeatmap,
    getBeatmapset
};