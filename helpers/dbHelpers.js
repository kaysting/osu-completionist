const dayjs = require('dayjs');
const db = require('../db');
const utils = require('../utils');

const formatUserEntry = (entry) => ({
    id: entry.id,
    name: entry.name,
    avatar_url: entry.avatar_url,
    banner_url: entry.banner_url,
    country: {
        code: entry.country_code,
        name: entry.country_name,
        flag_url: `/assets/flags/${entry.country_code.toUpperCase()}.png`
    },
    team: {
        id: entry.team_id,
        name: entry.team_name,
        flag_url: entry.team_flag_url
    },
    last_score_update_time: entry.last_score_update
});

const getBulkUserProfiles = (userIds) => {
    if (userIds.length === 0) {
        return [];
    }
    const rows = db.prepare(
        `SELECT u.id, u.name, u.avatar_url, u.banner_url, u.country_code, u.team_id, u.team_name, u.team_flag_url, c.name AS country_name, u.last_score_update
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
    const totals = db.prepare(
        `SELECT count, time_total_secs FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
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
    const defaultStats = {
        count_completed: 0,
        count_total: totals.count,
        percentage_completed: 0,
        time_spent_secs: 0,
        time_remaining_secs: totals.time_total_secs,
        time_total_secs: totals.time_total_secs,
        rank: -1
    };
    for (const row of rows) {
        const stats = { ...defaultStats };
        stats.count_completed = row.count;
        stats.count_total = totals.count;
        stats.time_spent_secs = row.time_spent_secs;
        stats.time_remaining_secs = totals.time_total_secs - row.time_spent_secs;
        stats.time_total_secs = totals.time_total_secs;
        stats.percentage_completed = row.time_spent_secs > 0 ? ((row.time_spent_secs / totals.time_total_secs) * 100) : 0;
        stats.rank = row.rank;
        statsByUserId[row.user_id] = stats;
    }
    return userIds.map(id => ({
        id: id,
        stats: statsByUserId[id] || defaultStats
    }));
};

const getUserHistoricalCompletionStats = (userId, mode, includeLoved, includeConverts, aggregate = 'day') => {
    // Fetch all daily stats
    const rows = db.prepare(
        `SELECT time, count, percent, time_spent_secs FROM user_stats_history
             WHERE user_id = ? AND mode = ? AND includes_loved = ? AND includes_converts = ?
             ORDER BY time ASC`
    ).all(userId, mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    if (rows.length === 0) return [];
    if (aggregate === 'day') {
        // Return most recent 90 days
        return rows.reverse().slice(0, 90).map(row => ({
            date: dayjs(row.time).format('YYYY-MM-DD'),
            count_completed: row.count,
            percentage_completed: row.percent,
            time_spent_secs: row.time_spent_secs,
            time_saved: row.time
        }));
    } else if (aggregate === 'month') {
        // Group by month
        const monthly = {};
        for (const row of rows) {
            const date = dayjs(row.time).format('YYYY-MM');
            if (!monthly[date])
                monthly[date] = [];
            monthly[date].push(row);
        }
        const monthKeys = Object.keys(monthly).sort();
        // Compile stats for each month
        const entries = [];
        for (const month of monthKeys) {
            const rows = monthly[month];
            const first = rows[0];
            const last = rows[rows.length - 1];
            entries.push({
                month,
                start: {
                    time_saved: first.time,
                    count_completed: first.count,
                    percentage_completed: first.percent,
                    time_spent_secs: first.time_spent_secs
                },
                end: {
                    time_saved: last.time,
                    count_completed: last.count,
                    percentage_completed: last.percent,
                    time_spent_secs: last.time_spent_secs
                },
                delta: {
                    count_completed: last.count - first.count,
                    percentage_completed: last.percent - first.percent,
                    time_spent_secs: last.time_spent_secs - first.time_spent_secs
                }
            });
        }
        return entries;
    }
};

const getUserCompletionStats = (userId, mode, includeLoved, includeConverts) => {
    return getBulkUserCompletionStats([userId], mode, includeLoved, includeConverts)?.[0]?.stats;
};

const getLeaderboard = (mode, includeLoved, includeConverts, limit = 100, offset = 0) => {
    const totalRows = db.prepare(
        `SELECT COUNT(*) AS count
         FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const totalPlayers = totalRows.count;
    const rows = db.prepare(
        `SELECT u.id
         FROM users u
         JOIN user_stats us ON u.id = us.user_id
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.time_spent_secs DESC
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
    const leaderboard = rows.map((row, i) => ({
        rank: offset + i + 1,
        user: userIdToProfile[row.id] || null,
        stats: userIdToStats[row.id] || null
    }));
    return {
        total_players: totalPlayers,
        leaderboard
    };
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

const formatBeatmap = (beatmap) => ({
    id: beatmap.id,
    mapset_id: beatmap.mapset_id,
    mode: beatmap.mode,
    name: beatmap.name,
    stars: beatmap.stars,
    difficulty_color: utils.starsToColor(beatmap.stars),
    duration_secs: beatmap.duration_secs,
    is_convert: !!beatmap.is_convert,
    status: beatmap.status
});

const formatBeatmapset = (beatmapset) => ({
    id: beatmapset.id,
    artist: beatmapset.artist,
    title: beatmapset.title,
    time_ranked: beatmapset.time_ranked,
    status: beatmapset.status
});

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
            map.beatmapset = mapsetIdToMapset[map.mapset_id] || null;
        }
    }
    const mapIdToBeatmap = {};
    for (const map of beatmaps) {
        mapIdToBeatmap[map.id] = map;
    }
    return mapIds.map(id => mapIdToBeatmap[id] || null);
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
        if (!map) continue;
        beatmapIdsToMaps[map.id] = map;
    }
    const passes = [];
    for (const row of rows) {
        const beatmap = beatmapIdsToMaps[row.map_id] || null;
        if (!beatmap) {
            utils.log(`Warning getting user recent passes: Couldn't find beatmap with ID ${row.map_id}`);
            continue;
        }
        passes.push({
            time_passed: row.time_passed, beatmap
        });
    }
    return passes;
};

const getUserUpdateStatus = (userId) => {
    const entry = db.prepare(`SELECT * FROM user_update_tasks WHERE user_id = ?`).get(userId);
    if (entry) {
        const position = db.prepare(
            `SELECT COUNT(*) + 1 AS pos FROM user_update_tasks
             WHERE time_queued < ?`
        ).get(entry.time_queued)?.pos || 0;
        return {
            updating: true,
            details: {
                time_queued: entry.time_queued,
                position,
                percent_completed: entry.percent_complete,
                count_new_passes: entry.count_new_passes
            }
        };
    } else {
        return {
            updating: false,
            details: null
        };
    }
};

const getUserRecommendedMaps = (userId, mode, includeLoved = false, includeConverts = false, limit = 100, offset = 0, sort, starsMin, starsMax, timeRankedMin, timeRankedMax) => {
    const convertsSql = includeConverts ? '' : 'AND b.is_convert = 0';
    const statusSql = includeLoved ? `b.status IN ('ranked', 'approved', 'loved')` : `b.status IN ('ranked', 'approved')`;
    // Get min/max values
    const minStars = 0;
    const maxStars = db.prepare(
        `SELECT MAX(b.stars) AS max_stars FROM beatmaps b
        WHERE b.mode = ? AND ${statusSql} ${convertsSql}`
    ).get(mode)?.max_stars || 0;
    const minTimeRanked = db.prepare(
        `SELECT MIN(bs.time_ranked) AS min_time FROM beatmapsets bs
        JOIN beatmaps b ON bs.id = b.mapset_id
        WHERE b.mode = ? AND ${statusSql} ${convertsSql}`
    ).get(mode)?.min_time || 0;
    const maxTimeRanked = db.prepare(
        `SELECT MAX(bs.time_ranked) AS max_time FROM beatmapsets bs
        JOIN beatmaps b ON bs.id = b.mapset_id
        WHERE b.mode = ? AND ${statusSql} ${convertsSql}`
    ).get(mode)?.max_time || 0;
    // Build base query
    let sql = `
        SELECT b.id FROM beatmaps b
        JOIN beatmapsets bs ON b.mapset_id = bs.id
        LEFT JOIN user_passes up ON b.id = up.map_id AND up.user_id = ?
        WHERE up.map_id IS NULL
        AND b.mode = ? AND ${statusSql} ${convertsSql}
    `;
    const params = [userId, mode];
    // Add stars filtering
    if (starsMin) {
        sql += ` AND b.stars >= ?`;
        params.push(starsMin);
    }
    if (starsMax) {
        sql += ` AND b.stars < ?`;
        params.push(starsMax);
    }
    // Add time ranked filtering
    if (timeRankedMin) {
        sql += ` AND bs.time_ranked >= ?`;
        params.push(timeRankedMin);
    }
    if (timeRankedMax) {
        sql += ` AND bs.time_ranked < ?`;
        params.push(timeRankedMax);
    }
    // Add sort
    switch (sort) {
        case 'stars_asc':
            sql += ` ORDER BY b.stars ASC`;
            break;
        case 'stars_desc':
            sql += ` ORDER BY b.stars DESC`;
            break;
        case 'time_ranked_asc':
            sql += ` ORDER BY bs.time_ranked ASC`;
            break;
        case 'time_ranked_desc':
            sql += ` ORDER BY bs.time_ranked DESC`;
            break;
        case 'random':
        default:
            sql += ` ORDER BY RANDOM()`;
    }
    // Add limit and offset
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    // Execute query and fetch results
    const rows = db.prepare(sql).all(...params);
    const beatmapIds = rows.map(row => row.id);
    const beatmaps = getBulkBeatmaps(beatmapIds, true, mode);
    return {
        min_max: {
            stars: {
                min: minStars,
                max: maxStars
            },
            time_ranked: {
                min: minTimeRanked,
                max: maxTimeRanked
            }
        },
        beatmaps
    };
};

module.exports = {
    getBulkUserCompletionStats,
    getUserProfile,
    getLeaderboard,
    getUserRecentPasses,
    getUserYearlyCompletionStats,
    getUserHistoricalCompletionStats,
    getUserRecommendedMaps,
    getUserCompletionStats,
    getBulkUserProfiles,
    getBulkBeatmaps,
    getBulkBeatmapsets,
    getBeatmap,
    getBeatmapset,
    getUserUpdateStatus
};