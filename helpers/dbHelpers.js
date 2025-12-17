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
            const count_total = yearToTotalCount[year];
            if (!count_total) continue;
            const count_completed = userIdToYearlyCompletions[userId]?.[year] || 0;
            const percentage_completed = count_total > 0 ? ((count_completed / count_total) * 100) : 0;
            entry.push({
                year: parseInt(year),
                count_completed,
                count_total,
                percentage_completed
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
    difficulty_color: utils.rgbToHex(...utils.starsToColor(beatmap.stars)),
    duration_secs: beatmap.duration_secs,
    is_convert: !!beatmap.is_convert,
    status: beatmap.status,
    cs: beatmap?.cs,
    ar: beatmap?.ar,
    od: beatmap?.od,
    hp: beatmap?.hp,
    bpm: beatmap?.bpm
});

const formatBeatmapset = (beatmapset) => ({
    id: beatmapset.id,
    artist: beatmapset.artist,
    title: beatmapset.title,
    mapper: beatmapset.mapper,
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

const searchBeatmaps = (query, includeLoved, includeConverts, sort, notPlayedByUserId, limit = 50, offset = 0) => {
    const filterRegex = /(cs|ar|od|hp|keys|stars|sr|bpm|length|mode|year|month)\s?(<=|>=|=|<|>)\s?([\w.]+)(\s|$)/gi;
    const filterMatches = query.matchAll(filterRegex);
    const textQuery = query.replace(filterRegex, '').trim();

    const params = [];
    const whereClauses = [];
    let joinClause = '';
    let sortClause = '';
    let mode = null;
    const filters = [];

    // Loop through filter matches
    for (const match of filterMatches) {
        const key = match[1];
        const operator = match[2];
        const value = match[3].toLowerCase();
        filters.push({ key, operator, value });

        const valueInt = parseInt(value);
        const valueFloat = parseFloat(value);

        switch (key) {
            case 'stars':
            case 'sr':
                if (!isNaN(valueFloat)) whereClauses.push(`map.stars ${operator} ${valueFloat}`);
                break;
            case 'keys':
            case 'cs':
                if (!isNaN(valueFloat)) whereClauses.push(`map.cs ${operator} ${valueFloat}`);
                break;
            case 'ar':
                if (!isNaN(valueFloat)) whereClauses.push(`map.ar ${operator} ${valueFloat}`);
                break;
            case 'od':
                if (!isNaN(valueFloat)) whereClauses.push(`map.od ${operator} ${valueFloat}`);
                break;
            case 'hp':
                if (!isNaN(valueFloat)) whereClauses.push(`map.hp ${operator} ${valueFloat}`);
                break;
            case 'bpm':
                if (!isNaN(valueFloat)) whereClauses.push(`map.bpm ${operator} ${valueFloat}`);
                break;
            case 'length':
                if (!isNaN(valueInt)) whereClauses.push(`map.duration_secs ${operator} ${valueInt}`);
                break;
            case 'mode':
                const modeKey = utils.rulesetNameToKey(value);
                if (!modeKey || operator !== '=') break;
                whereClauses.push(`map.mode = '${modeKey}'`);
                mode = modeKey;
                break;
            case 'year': {
                if (isNaN(valueInt) || valueInt < 2007 || valueInt > new Date().getFullYear() + 1) break;
                const startMs = Date.UTC(valueInt, 0, 1);
                const endMs = Date.UTC(valueInt + 1, 0, 1);
                switch (operator) {
                    case '=':
                        whereClauses.push(`mapset.time_ranked >= ${startMs} AND mapset.time_ranked < ${endMs}`);
                        break;
                    case '>=':
                        whereClauses.push(`mapset.time_ranked >= ${startMs}`);
                        break;
                    case '<=':
                        whereClauses.push(`mapset.time_ranked < ${endMs}`);
                        break;
                    case '>':
                        whereClauses.push(`mapset.time_ranked >= ${endMs}`);
                        break;
                    case '<':
                        whereClauses.push(`mapset.time_ranked < ${startMs}`);
                        break;
                }
                break;
            }
            case 'month': {
                if (!value.match(/^\d{4}-\d{1,2}$/)) break;
                const [yearStr, monthStr] = value.split('-');
                const year = parseInt(yearStr);
                const monthIndex = parseInt(monthStr) - 1;
                const startMs = Date.UTC(year, monthIndex, 1);
                const endMs = Date.UTC(year, monthIndex + 1, 1);
                switch (operator) {
                    case '=':
                        whereClauses.push(`mapset.time_ranked >= ${startMs} AND mapset.time_ranked < ${endMs}`);
                        break;
                    case '>=':
                        whereClauses.push(`mapset.time_ranked >= ${startMs}`);
                        break;
                    case '<=':
                        whereClauses.push(`mapset.time_ranked < ${endMs}`);
                        break;
                    case '>':
                        whereClauses.push(`mapset.time_ranked >= ${endMs}`);
                        break;
                    case '<':
                        whereClauses.push(`mapset.time_ranked < ${startMs}`);
                        break;
                }
                break;
            }
        }
    }

    // Handle including loved
    if (includeLoved) {
        whereClauses.push(`map.status IN ('ranked', 'approved', 'loved')`);
    } else {
        whereClauses.push(`map.status IN ('ranked', 'approved')`);
    }

    // Handle excluding converts
    if (!includeConverts || !mode) {
        whereClauses.push(`map.is_convert = 0`);
    }

    // Exclude passed maps
    if (notPlayedByUserId) {
        whereClauses.push(`
            NOT EXISTS (
                SELECT 1 FROM user_passes up 
                WHERE up.user_id = ? 
                AND up.map_id = map.id 
                AND up.mode = map.mode
            )
        `);
        params.push(notPlayedByUserId);
    }

    // Join FTS table if we have a text search
    if (textQuery) {
        joinClause = `JOIN beatmaps_search ON map.id = beatmaps_search.map_id AND map.mode = beatmaps_search.mode`;
        whereClauses.push(`beatmaps_search MATCH ?`);
        params.push(utils.sanitizeFtsQuery(textQuery));
    }

    // Handle sorting
    switch (sort) {
        case 'stars_asc': sortClause = `map.stars ASC`; break;
        case 'stars_desc': sortClause = `map.stars DESC`; break;
        case 'date_asc': sortClause = `mapset.time_ranked ASC, map.stars ASC`; break;
        case 'date_desc': sortClause = `mapset.time_ranked DESC, map.stars DESC`; break;
        case 'length_asc': sortClause = `map.duration_secs ASC`; break;
        case 'length_desc': sortClause = `map.duration_secs DESC`; break;
        case 'bpm_asc': sortClause = `map.bpm ASC`; break;
        case 'bpm_desc': sortClause = `map.bpm DESC`; break;
        default: {
            if (textQuery) {
                sortClause = `beatmaps_search.rank`;
            } else {
                sortClause = `RANDOM()`;
            }
        }
    }

    // Get result IDs
    const startTime = Date.now();
    const sql = `
        SELECT DISTINCT map.id, COUNT(*) OVER() AS total_matches
        FROM beatmaps map
        JOIN beatmapsets mapset ON map.mapset_id = mapset.id
        ${joinClause}
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ${sortClause}
        LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(sql).all(...params, limit, offset);
    const endTime = Date.now();
    const totalMatches = rows.length > 0 ? rows[0].total_matches : 0;

    const beatmaps = getBulkBeatmaps(rows.map(row => row.id), true, mode);
    return {
        total_matches: totalMatches,
        process_time_ms: endTime - startTime,
        beatmaps,
        query: {
            filters,
            text: textQuery
        }
    };
};

const searchUsers = (query, limit = 50, offset = 0) => {
    query = query.trim();
    let total_matches = 0;
    let users = [];
    try {
        if (query) {
            const rows = db.prepare(`
                SELECT rowid, COUNT(*) OVER() AS total_matches FROM users_search
                WHERE names MATCH ?
                ORDER BY rank
                LIMIT ? OFFSET ?
            `).all(utils.sanitizeFtsQuery(query), limit, offset);
            total_matches = rows.length > 0 ? rows[0].total_matches : 0;
            users = getBulkUserProfiles(rows.map(row => row.rowid));
        } else {
            const rows = db.prepare(`
                SELECT id, COUNT(*) OVER() AS total_matches FROM users
                ORDER BY last_score_submit DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset);
            total_matches = rows.length > 0 ? rows[0].total_matches : 0;
            users = getBulkUserProfiles(rows.map(row => row.id));
        }
    } catch (err) {
        console.error("Error while searching users:", err);
    }
    return { query, total_matches, users };
};

module.exports = {
    getBulkUserCompletionStats,
    getUserProfile,
    getLeaderboard,
    getUserRecentPasses,
    getUserYearlyCompletionStats,
    getUserHistoricalCompletionStats,
    getUserCompletionStats,
    getBulkUserProfiles,
    getBulkBeatmaps,
    getBulkBeatmapsets,
    getBeatmap,
    getBeatmapset,
    getUserUpdateStatus,
    searchBeatmaps,
    searchUsers
};