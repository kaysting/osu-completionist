const dayjs = require('dayjs');
const db = require('./db');
const utils = require('./utils');
const statCategories = require('./statCategories');

const secsToXp = (secs) => Math.round(secs / 10);

const formatUserEntry = (entry) => ({
    id: entry.id,
    name: entry.name,
    avatar_url: entry.avatar_url,
    banner_url: entry.banner_url,
    country: {
        code: entry.country_code,
        name: entry.country_name,
        flag_url: `/assets/images/flags/${entry.country_code.toUpperCase()}.png`
    },
    team: {
        id: entry.team_id,
        name: entry.team_name,
        flag_url: entry.team_flag_url
    },
    last_pass_time: entry.last_pass_time,
    last_login_time: entry.last_login_time,
    last_import_time: entry.last_import_time
});

const getBulkUserProfiles = (userIds) => {
    if (userIds.length === 0) return [];

    // Fetch required data for users
    const rows = db.prepare(
        `SELECT u.id, u.name, u.avatar_url, u.banner_url, u.country_code, u.team_id, u.team_name, u.team_flag_url, c.name AS country_name, u.last_login_time, u.last_import_time, u.last_pass_time
         FROM users u
         LEFT JOIN country_names c ON u.country_code = c.code
         WHERE u.id IN (${userIds.map(() => '?').join(',')})`
    ).all(...userIds);

    // Map users to their IDs and format their data
    const userIdToProfile = {};
    for (const row of rows) {
        userIdToProfile[row.id] = formatUserEntry(row);
    }

    // Return profiles in the same order as requested IDs, and null for users not found
    return userIds.map(id => userIdToProfile[id] || null);
};

const getUserProfile = (userId, includes = []) => {
    return getBulkUserProfiles([userId], includes)?.[0];
};

const getBulkUserCompletionStats = (userIds, categoryId) => {
    if (userIds.length === 0) return [];

    // Get totals for category
    const totals = db.prepare(
        `SELECT count, seconds FROM user_category_stats
         WHERE user_id = 0 AND category = ?`
    ).get(categoryId) || { count: 0, seconds: 0 };

    // Get user stats and rank, excluding users who have never imported
    const rows = db.prepare(`
        SELECT s1.*, u.*, q.time_queued,
               (SELECT COUNT(*) + 1 
                FROM user_category_stats s2
                JOIN users u2 ON s2.user_id = u2.id
                LEFT JOIN user_import_queue q2 ON s2.user_id = q2.user_id
                WHERE s2.category = s1.category 
                AND (
                    s2.seconds > s1.seconds
                    OR (
                        s2.seconds = s1.seconds
                        AND u2.last_pass_time < u.last_pass_time
                    )
                )
                AND s2.user_id != 0
                AND u2.last_import_time != 0
                AND q2.time_queued IS NULL
               ) AS rank
        FROM user_category_stats s1
        JOIN users u ON s1.user_id = u.id
        LEFT JOIN user_import_queue q ON s1.user_id = q.user_id
        WHERE s1.user_id IN (${userIds.map(() => '?').join(',')})
        AND s1.category = ?
    `).all(...userIds, categoryId);

    // Build stats by user
    const statsByUserId = {};
    const defaultStats = {
        count_completed: 0,
        count_total: totals.count,
        percentage_completed: 0,
        xp: 0,
        xp_remaining: secsToXp(totals.seconds),
        xp_total: secsToXp(totals.seconds),
        secs_spent: 0,
        secs_remaining: totals.seconds,
        secs_total: totals.seconds,
        rank: -1
    };
    for (const row of rows) {
        const stats = { ...defaultStats };
        stats.count_completed = row.count;
        stats.count_total = totals.count;
        stats.xp = secsToXp(row.seconds);
        stats.xp_remaining = secsToXp(totals.seconds - row.seconds);
        stats.secs_spent = row.seconds;
        stats.secs_remaining = totals.seconds - row.seconds;
        stats.percentage_completed = row.seconds > 0 ? ((row.seconds / totals.seconds) * 100) : 0;
        if (row.last_import_time > 0 && row.time_queued === null)
            stats.rank = row.rank;
        statsByUserId[row.user_id] = stats;
    }

    // Return stat entries with added IDs
    return userIds.map(id => ({
        id: id,
        stats: statsByUserId[id] || defaultStats
    }));
};

const getUserHistoricalCompletionStats = (userId, categoryId, aggregate = 'day') => {
    // Fetch all daily stats for this category
    const rows = db.prepare(
        `SELECT time, count, percent, seconds, date, rank
         FROM user_category_stats_history
         WHERE user_id = ? AND category = ?
         ORDER BY time ASC`
    ).all(userId, categoryId);
    if (rows.length === 0) return [];

    if (aggregate === 'day') {
        // Return most recent 90 days
        return rows.reverse().slice(0, 90).map(row => ({
            date: row.date,
            count_completed: row.count,
            xp: secsToXp(row.seconds),
            percentage_completed: row.percent,
            rank: row.rank,
            time_saved: row.time
        })).reverse();
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
        const entries = [];
        // Loop through months and build monthly stats
        for (const month of monthKeys) {
            const monthRows = monthly[month];
            const first = monthRows[0];
            const last = monthRows[monthRows.length - 1];
            entries.push({
                month,
                start: {
                    time_saved: first.time,
                    count_completed: first.count,
                    percentage_completed: first.percent,
                    rank: first.rank,
                    xp: Math.round(first.seconds / 10)
                },
                end: {
                    time_saved: last.time,
                    count_completed: last.count,
                    percentage_completed: last.percent,
                    rank: last.rank,
                    xp: Math.round(last.seconds / 10)
                },
                delta: {
                    count_completed: last.count - first.count,
                    percentage_completed: last.percent - first.percent,
                    rank: first.rank - last.rank,
                    xp: Math.round((last.seconds - first.seconds) / 10)
                }
            });
        }
        return entries;
    }
};

const getUserCompletionStats = (userId, categoryId) => {
    return getBulkUserCompletionStats([userId], categoryId)?.[0]?.stats;
};

const getLeaderboard = (categoryId, limit = 100, offset = 0) => {
    // Get totals for category
    const totalRows = db.prepare(
        `SELECT COUNT(*) AS count
         FROM user_category_stats s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN user_import_queue q ON s.user_id = q.user_id
         WHERE s.category = ?
         AND u.last_import_time != 0
         AND q.time_queued IS NULL`
    ).get(categoryId);
    const totalPlayers = totalRows.count;

    // Get user IDs ordered by seconds desc
    // Exclude users who have never imported
    const rows = db.prepare(
        `SELECT u.id
         FROM users u
         JOIN user_category_stats us ON u.id = us.user_id
         LEFT JOIN user_import_queue q ON u.id = q.user_id
         WHERE us.category = ? AND u.last_import_time != 0 AND q.time_queued IS NULL
         ORDER BY us.seconds DESC, u.last_pass_time ASC
         LIMIT ? OFFSET ?`
    ).all(categoryId, limit, offset);
    const userIds = rows.map(row => row.id);

    // Get individual profiles and stats
    const userProfiles = getBulkUserProfiles(userIds);
    const userStats = getBulkUserCompletionStats(userIds, categoryId);

    // Map profiles and stats to user IDs
    const userIdToProfile = {};
    for (const profile of userProfiles) userIdToProfile[profile.id] = profile;
    const userIdToStats = {};
    for (const entry of userStats) userIdToStats[entry.id] = entry.stats;

    // Build and return leaderboard entries
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

const getBulkUserYearlyCompletionStats = (userIds, categoryId) => {
    if (userIds.length === 0) {
        return [];
    }
    // Get totals for category and map counts to year
    const totalsRows = db.prepare(
        `SELECT year, count, seconds FROM user_category_stats_yearly
         WHERE user_id = 0 AND category = ?`
    ).all(categoryId);
    const yearToTotals = {};
    for (const row of totalsRows) {
        yearToTotals[row.year] = {
            count: row.count,
            seconds: row.seconds
        };
    }
    // Get user stats
    const completedRows = db.prepare(
        `SELECT user_id, year, count, seconds FROM user_category_stats_yearly
         WHERE user_id IN (${userIds.map(() => '?').join(',')})
         AND category = ?`
    ).all(...userIds, categoryId);
    // Map user-year to completed count
    const userIdToYearlyCompletions = {};
    for (const row of completedRows) {
        if (!userIdToYearlyCompletions[row.user_id]) {
            userIdToYearlyCompletions[row.user_id] = {};
        }
        userIdToYearlyCompletions[row.user_id][row.year] = {
            count: row.count,
            seconds: row.seconds
        };
    }
    // Build entries
    const entries = [];
    for (const userId of userIds) {
        const entry = [];
        for (const year in yearToTotals) {
            // Get totals and skip if no maps in this year
            const totals = yearToTotals[year];
            const count_total = totals.count;
            const secs_total = totals.seconds;
            const xp_total = secsToXp(secs_total);
            if (!count_total) continue;
            // Get and calculate completion stats
            const completed = userIdToYearlyCompletions[userId]?.[year] || {};
            const xp = secsToXp(completed?.seconds || 0);
            const count_completed = completed?.count || 0;
            const map_percentage_completed = count_total > 0 ? ((count_completed / count_total) * 100) : 0;
            const time_percentage_completed = secs_total > 0 ? ((completed?.seconds || 0) / secs_total) * 100 : 0;
            // Build object
            entry.push({
                year: parseInt(year),
                count_completed,
                count_total,
                xp,
                xp_total,
                secs_total,
                map_percentage_completed,
                time_percentage_completed
            });
        }
        entries.push(entry);
    }
    return entries;
};

const getUserYearlyCompletionStats = (userId, categoryId) => {
    return getBulkUserYearlyCompletionStats([userId], categoryId)?.[0] || [];
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
    if (mapsetIds.length === 0) return [];

    // Fetch and format beatmapset data
    const rows = db.prepare(
        `SELECT * FROM beatmapsets
         WHERE id IN (${mapsetIds.map(() => '?').join(',')})`
    ).all(...mapsetIds);
    const beatmapsets = rows.map(row => formatBeatmapset(row));

    // If requested, fetch and attach beatmaps
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

    // Map beatmapsets to their IDs
    const mapsetIdToMapset = {};
    for (const mapset of beatmapsets) {
        mapsetIdToMapset[mapset.id] = mapset;
    }

    // Return beatmapsets in the same order as requested IDs, and null for mapsets not found
    return mapsetIds.map(id => mapsetIdToMapset[id] || null);
};

const getBulkBeatmaps = (mapIds, includeMapset, mode) => {
    if (mapIds.length === 0) return [];

    // Fetch and format beatmap data
    const rows = db.prepare(
        `SELECT * FROM beatmaps
         WHERE id IN (${mapIds.map(() => '?').join(',')})
         ${mode ? 'AND mode = ?' : 'AND is_convert = 0'}`
    ).all(...mapIds, ...(mode ? [mode] : []));
    const beatmaps = rows.map(row => formatBeatmap(row));

    // If requested, fetch and attach mapset data
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

    // Map beatmaps to their IDs
    const mapIdToBeatmap = {};
    for (const map of beatmaps) {
        mapIdToBeatmap[map.id] = map;
    }

    // Return beatmaps in the same order as requested IDs, and null for maps not found
    return mapIds.map(id => mapIdToBeatmap[id] || null);
};

const getBeatmapset = (mapsetId, includeBeatmaps, includeConverts) => {
    return getBulkBeatmapsets([mapsetId], includeBeatmaps, includeConverts)?.[0] || null;
};

const getBeatmap = (mapId, includeMapset, mode) => {
    return getBulkBeatmaps([mapId], includeMapset, mode)?.[0] || null;
};

const getUserRecentPasses = (userId, categoryId, limit = 100, offset = 0, after = 0) => {
    // Get user entry
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!user) return [];

    // Convert category filters to SQL
    const { where, params, def } = statCategories.categoryToSql(categoryId, 'b');

    // Fetch recent passes
    const rows = db.prepare(`
        SELECT up.map_id, up.time_passed 
        FROM user_passes up
        JOIN beatmaps b ON up.map_id = b.id AND up.mode = b.mode
        WHERE up.user_id = ?
        AND ${where} AND up.time_passed > ?
        ORDER BY up.time_passed DESC
        LIMIT ? OFFSET ?
    `).all(userId, ...params, Math.max(after, user.last_import_time) || Date.now(), limit, offset);

    // Get full map data
    const beatmapIdsToMaps = {};
    const beatmapIds = rows.map(row => row.map_id);
    const modeFilter = def.filters.find(f => f.field === 'mode');
    const modeHint = modeFilter?.equals || null;
    const beatmaps = getBulkBeatmaps(beatmapIds, true, modeHint);
    for (const map of beatmaps) {
        if (!map) continue;
        beatmapIdsToMaps[map.id] = map;
    }

    // Format passes
    const passes = [];
    for (const row of rows) {
        const beatmap = beatmapIdsToMaps[row.map_id] || null;
        if (!beatmap) {
            utils.log(`Warning getting user recent passes: Couldn't find beatmap with ID ${row.map_id}`);
            continue;
        }
        passes.push({
            time_passed: row.time_passed,
            beatmap
        });
    }

    return passes;
};

const getUserUpdateStatus = (userId) => {
    // These constants are defined through testing
    const SCORES_PER_MINUTE = 600;
    const SCORES_PER_MINUTE_FULL = 3500;
    const entry = db.prepare(`SELECT * FROM user_import_queue WHERE user_id = ?`).get(userId);
    if (!entry) {
        return {
            updating: false,
            details: null
        };
    }
    const entriesAhead = db.prepare(
        `SELECT * FROM user_import_queue WHERE time_queued < ?`
    ).all(entry.time_queued);
    let playcountsCountAhead = 0;
    let secsAhead = 0;
    for (const e of [...entriesAhead, entry]) {
        const scoresCompleted = e.playcounts_count * (e.percent_complete / 100);
        const scoresRemaining = e.playcounts_count - scoresCompleted;
        playcountsCountAhead += scoresRemaining;
        const scoresPerSec = e.is_full ? (SCORES_PER_MINUTE_FULL / 60) : (SCORES_PER_MINUTE / 60);
        secsAhead += scoresRemaining / scoresPerSec;
    }
    const position = entriesAhead.length || 1;
    const time_remaining_secs = Math.round(secsAhead);
    return {
        updating: true,
        details: {
            time_queued: entry.time_queued,
            time_started: entry.time_started,
            time_remaining_secs,
            position,
            percent_completed: entry.percent_complete,
            count_passes_imported: entry.count_passes_imported
        }
    };
};

const searchBeatmaps = (query, category, sort, notPlayedByUserId, limit = 50, offset = 0) => {
    const filterRegex = /(cs|ar|od|hp|keys|stars|sr|bpm|length|mode|year|month)\s?(<=|>=|=|<|>)\s?([\w.]+)(\s|$)/gi;
    const filterMatches = query.matchAll(filterRegex);
    const textQuery = query.replace(filterRegex, '').trim();
    const params = [];
    const whereClauses = [];
    let joinClause = '';
    let sortClause = '';
    const filters = [];

    // Apply category filters if category is specified
    let categorySql;
    if (category) {
        categorySql = statCategories.categoryToSql(category, 'map');
        whereClauses.push(categorySql.where);
        params.push(...categorySql.params);
    }

    // Parse user filters
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
                // User-specified mode overrides/narrows category mode if both exist, but usually redundant
                const modeKey = utils.rulesetNameToKey(value);
                if (!modeKey || operator !== '=') break;
                whereClauses.push(`map.mode = '${modeKey}'`);
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

    // Exclude passed maps if specified
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

    // Exclude converts if no mode is specified in either filters or category
    const mode = filters.find(f => f.key === 'mode')?.value ||
        categorySql?.def.filters.find(f => f.field === 'mode')?.equals;
    if (!mode) {
        whereClauses.push(`map.is_convert = 0`);
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

    // Get result IDs and total count
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
    // Get full beatmap data and format
    const beatmaps = getBulkBeatmaps(rows.map(row => row.id), true, mode || undefined);
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
                ORDER BY last_pass_time DESC
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

const getQueuedUsers = () => {
    const rows = db.prepare(`SELECT * FROM user_import_queue ORDER BY time_queued ASC`).all();
    const inProgressUserIds = [];
    const waitingUserIds = [];
    for (const row of rows) {
        if (row.percent_complete > 0) {
            inProgressUserIds.push(row.user_id);
        } else {
            waitingUserIds.push(row.user_id);
        }
    }
    return {
        in_progress: getBulkUserProfiles(inProgressUserIds).filter(Boolean),
        waiting: getBulkUserProfiles(waitingUserIds).filter(Boolean)
    };
};

module.exports = {
    secsToXp,
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
    searchUsers,
    getQueuedUsers
};