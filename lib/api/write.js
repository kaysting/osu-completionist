const env = require('#env');
const db = require('#db');
const utils = require('#utils');
const osu = require('#lib/osu.js');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const statCategories = require('#config/statCategories.js');
const apiRead = require('#api/read.js');
const ejs = require('ejs');
const axios = require('axios');

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
    // Get formatted map data
    const mapset = apiRead.getBeatmapset(mapsetId, true);
    // Log to Discord
    const diffLines = [];
    for (const map of mapset.beatmaps) {
        diffLines.push(`* **${utils.rulesetKeyToName(map.mode)} ${map.stars.toFixed(2)} ★** - [${map.name}](https://osu.ppy.sh/beatmapsets/${mapset.id}#${map.mode}/${map.id})`);
        if (diffLines.join('\n').length > 1000) {
            diffLines.pop();
            diffLines.push(`... and ${mapset.beatmaps.length - diffLines.length} more ...`);
            break;
        }
    }
    setImmediate(() => {
        utils.sendDiscordMessage(env.MAP_FEED_DISCORD_CHANNEL_ID, {
            embeds: [{
                author: {
                    name: `${index ? `Saved new beatmapset` : 'Updated saved beatmapset'}`,
                },
                title: `${mapset.artist} - ${mapset.title}`,
                url: `https://osu.ppy.sh/beatmapsets/${mapset.id}`,
                fields: [
                    {
                        name: 'Status',
                        value: mapset.status,
                        inline: true
                    },
                    {
                        name: 'Mapper',
                        value: mapset.mapper,
                        inline: true
                    },
                    {
                        name: `Difficulties (${mapset.beatmaps.length})`,
                        value: diffLines.join('\n')
                    }
                ],
                thumbnail: {
                    url: `https://assets.ppy.sh/beatmaps/${mapset.id}/covers/list.jpg`
                },
                color: 0xBEA3F5
            }]
        });
    });
    // Return new entry
    return mapset;
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
        const savedMapsets = [];
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
                const res = await saveMapset(mapset.id, true);
                savedMapsets.push(res);
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
                const rankedStatuses = ['ranked', 'approved', 'loved'];
                if (oldStatus === newStatus) continue;
                // Save updated mapset
                await saveMapset(mapset.id, false);
                // Delete passes if the map got unranked
                if (!rankedStatuses.includes(newStatus)) {
                    db.prepare(`DELETE FROM user_passes WHERE mapset_id = ?`).run(mapset.id);
                    utils.log(`Deleted all passes for now ${newStatus} mapset ${mapset.id}`);
                }
            }
        }
    } catch (error) {
        utils.logError('Error while updating map statuses:', error);
    }
};

/**
 * Fetch and store up to date profile data for a user from the osu! API
 * @param {number} userId The user ID whose data to update
 * @param {boolean} force Whether to force update the profile data even if it's been updated recently
 * @returns A row from the users table
 */
const updateUserProfile = async (userId, force = false) => {
    try {
        // Check if a user entry already exists
        const existingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        // Stop now if it's been too soon since last profile update
        const msSinceLastUpdate = Date.now() - (existingUser?.last_profile_update_time || 0);
        if (existingUser && msSinceLastUpdate < (1000 * 60 * 15) && !force) {
            return existingUser;
        }
        // Fetch user from osu
        const user = (await osu.getUsers({ ids: [userId] })).users[0];
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
                    last_profile_update_time = ?
                WHERE id = ?`
            ).run(user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, Date.now(), user.id);
            utils.log(`Updated stored user data for ${user.username}`);
        } else {
            // Create new user entry
            db.prepare(
                `INSERT INTO users (id, name, avatar_url, banner_url, country_code, team_id, time_created, last_profile_update_time, api_key)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(user.id, user.username, user.avatar_url, user.cover.url, user.country.code, user.team?.id, Date.now(), Date.now(), utils.generateSecretKey(32));
            utils.log(`Stored user data for ${user.username}`);
        }
        // Create/update country entry
        db.prepare(`INSERT OR IGNORE INTO country_names (code, name) VALUES (?, ?)`)
            .run(user.country.code, user.country.name);
        // Create/update team entry
        if (user.team?.id) {
            db.prepare(`INSERT OR REPLACE INTO teams (id, name, name_short, flag_url) VALUES (?, ?, ?, ?)`).run(user.team.id, user.team.name, user.team.short_name, user.team.flag_url);
        }
        // Return fresh user entry
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
        if (filter.notIn !== undefined) {
            if (filter.notIn.includes(rowValue)) return false;
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
 * @param {boolean} force Whether to force update even if the user is currently importing
 */
const updateUserCategoryStats = (userId, force = false) => {
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

        // Check if user is importing
        if (!force && !IS_GLOBAL) {
            const queueEntry = db.prepare(`SELECT * FROM user_import_queue WHERE user_id = ?`).get(userId);
            if (queueEntry?.time_started > 0) {
                utils.log(`${user.name} is currently being imported, skipping stats update`);
                return;
            }
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
            `).iterate();
        } else {
            rows = db.prepare(`
                SELECT ${cols.join(', ')}
                FROM user_passes pass
                JOIN beatmaps diff ON pass.map_id = diff.id AND pass.mode = diff.mode
                JOIN beatmapsets mapset ON diff.mapset_id = mapset.id
                WHERE pass.user_id = ?
            `).iterate(userId);
        }

        // Prepare a map to store collected stats
        const catTotals = {};
        const catYearly = {};
        const catStatsOld = {};
        const catStatsYearlyOld = {};

        // Get existing stats for each category
        for (const cat of statCategories.definitions) {
            catStatsOld[cat.id] = apiRead.getUserCompletionStats(userId, cat.id);
            catStatsYearlyOld[cat.id] = apiRead.getUserYearlyCompletionStats(userId, cat.id);
        }

        // Loop through rows
        // Switched to using iterator approach so we don't use a ton of memory
        // and we only have to loop through the rows once, not once per category
        for (const row of rows) {
            // Loop through categories
            for (const cat of statCategories.definitions) {

                // Skip row if it doesn't match category filters
                if (!matchesCatDefFilters(row, cat)) continue;

                // Update totals
                if (!catTotals[cat.id])
                    catTotals[cat.id] = { count: 0, seconds: 0 };
                catTotals[cat.id].count++;
                catTotals[cat.id].seconds += row.duration_secs;

                // Update yearly
                if (!catYearly[cat.id])
                    catYearly[cat.id] = {};
                if (!catYearly[cat.id][row.year])
                    catYearly[cat.id][row.year] = { count: 0, seconds: 0 };
                catYearly[cat.id][row.year].count++;
                catYearly[cat.id][row.year].seconds += row.duration_secs;

            }
        }

        // Prepare insert statements
        const stmtMain = db.prepare(`
            INSERT OR REPLACE INTO user_category_stats 
            (user_id, category, count, seconds, best_rank, best_rank_time, best_percent, best_percent_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const stmtYearly = db.prepare(`
            INSERT OR REPLACE INTO user_category_stats_yearly 
            (user_id, category, year, count, seconds) VALUES (?, ?, ?, ?, ?)
        `);

        // Update stats
        const statsUpdateTransaction = db.transaction(() => {
            for (const cat of statCategories.definitions) {

                const totals = catTotals[cat.id] || { count: 0, seconds: 0 };
                const yearlyTotals = catYearly[cat.id] || {};
                const defaultYearlyData = { count: 0, seconds: 0 };
                const statsOld = catStatsOld[cat.id];

                // Insert main stats
                stmtMain.run(
                    user.id, cat.id, totals.count, totals.seconds,
                    statsOld.best_rank, statsOld.best_rank_time,
                    statsOld.best_percentage_completed, statsOld.best_percentage_completed_time
                );

                // Insert yearly stats
                const startYear = 2007;
                const currentYear = new Date().getFullYear();
                for (let year = startYear; year <= currentYear; year++) {
                    const yearly = yearlyTotals[year] || defaultYearlyData;
                    stmtYearly.run(user.id, cat.id, year, yearly.count, yearly.seconds);
                }

            }
        });

        // Update bests
        const bestsInserts = [];
        for (const cat of statCategories.definitions) {
            if (IS_GLOBAL) continue;

            const totals = catTotals[cat.id] || { count: 0, seconds: 0 };
            const statsOld = catStatsOld[cat.id];

            // Get new main stats
            const statsNew = apiRead.getUserCompletionStats(userId, cat.id);
            let bestRank = statsOld.best_rank;
            let bestPercent = statsOld.best_percentage_completed;
            let bestRankTime = statsOld.best_rank_time;
            let bestPercentTime = statsOld.best_percentage_completed_time;
            let hasNewBests = false;

            // Check if we have a new best rank
            if (statsNew.rank > 0 && (statsOld.best_rank === 0 || statsNew.rank <= statsOld.best_rank)) {
                bestRank = statsNew.rank;
                bestRankTime = Date.now();
                hasNewBests = true;
            }

            // Check if we have a new best completion percentage
            if (statsNew.percentage_completed > 0 && (statsOld.best_percentage_completed === 0 || statsNew.percentage_completed >= statsOld.best_percentage_completed)) {
                bestPercent = statsNew.percentage_completed;
                bestPercentTime = Date.now();
                hasNewBests = true;
            }

            // Write new bests if needed
            if (hasNewBests) {
                bestsInserts.push([
                    user.id, cat.id, totals.count, totals.seconds, bestRank, bestRankTime, bestPercent, bestPercentTime
                ]);
            }

        }
        const bestsUpdateTransaction = db.transaction(() => {
            for (const params of bestsInserts) {
                stmtMain.run(...params);
            }
        });

        // Run transactions
        statsUpdateTransaction();
        bestsUpdateTransaction();
        utils.log(`Updated stats in ${statCategories.definitions.length} categories for ${user.name}`);

        // Check for milestones
        const userBaseUrl = `${env.HTTPS ? 'https' : 'http'}://${env.HOST}/u/${user.id}`;
        for (const cat of statCategories.definitions) {
            if (IS_GLOBAL) continue;

            // Collect old and new stats
            const statsOld = catStatsOld[cat.id];
            const yearlyOld = catStatsYearlyOld[cat.id];
            const statsNew = apiRead.getUserCompletionStats(userId, cat.id);
            const yearlyNew = apiRead.getUserYearlyCompletionStats(userId, cat.id);

            // If the new completion percentage is 100 and the old one was less,
            // save a full completions entry
            if (statsNew.percentage_completed === 100 && statsOld.percentage_completed < 100) {
                db.prepare(`
                    INSERT INTO user_full_completions (user_id, category, count, seconds, time) VALUES (?, ?, ?, ?, ?)
                `).run(user.id, cat.id, statsNew.count_completed, statsNew.secs_spent, Date.now());
            }

            // If this is a force update, stop here
            if (force) continue;

            // Define milestone step sizes
            const totalPercentStep = 5;
            const yearlyPercentStep = 25;
            const playcountStep = 1000;
            const cxpStep = 10000;
            const milestoneEmbeds = [];
            const categoryName = statCategories.getCategoryName(cat.id).toLowerCase();

            // Embed template
            const makeEmbed = (title, fields) => ({
                author: {
                    name: user.name,
                    icon_url: user.avatar_url,
                    url: `${userBaseUrl}/${cat.id}`
                },
                title, fields,
                footer: {
                    text: `osu!complete`
                },
                timestamp: new Date().toISOString(),
                color: 0xf5e7a3
            });

            const categoryFields = [
                { name: 'rank', value: `#${statsNew.rank.toLocaleString()}`, inline: true },
                { name: 'completion xp', value: statsNew.xp.toLocaleString(), inline: true },
                { name: 'maps passed', value: statsNew.count_completed.toLocaleString(), inline: true }
            ];

            // Check category completion percentage milestones
            const totalPercentStepOld = utils.floorToNearest(statsOld.percentage_completed, totalPercentStep);
            const totalPercentStepNew = utils.floorToNearest(statsNew.percentage_completed, totalPercentStep);
            if (totalPercentStepNew > totalPercentStepOld) {
                milestoneEmbeds.push(makeEmbed(
                    `Reached ${totalPercentStepNew}% completion in ${categoryName}!`,
                    categoryFields
                ));
            }

            // Check category pass count milestones
            const totalPassCountStepOld = utils.floorToNearest(statsOld.count_completed, playcountStep);
            const totalPassCountStepNew = utils.floorToNearest(statsNew.count_completed, playcountStep);
            if (totalPassCountStepNew > totalPassCountStepOld) {
                milestoneEmbeds.push(makeEmbed(
                    `Reached ${totalPassCountStepNew.toLocaleString()} passes in ${categoryName}!`,
                    categoryFields
                ));
            }

            // Check category cxp milestones
            const totalCxpStepOld = utils.floorToNearest(statsOld.xp, cxpStep);
            const totalCxpStepNew = utils.floorToNearest(statsNew.xp, cxpStep);
            if (totalCxpStepNew > totalCxpStepOld) {
                milestoneEmbeds.push(makeEmbed(
                    `Reached ${totalCxpStepNew.toLocaleString()} cxp in ${categoryName}!`,
                    categoryFields
                ));
            }

            // Loop through each year to check for yearly milestones
            for (const statsNew of yearlyNew) {
                const statsOld = yearlyOld.find(s => s.year === statsNew.year) || {
                    count_completed: 0,
                    time_percentage_completed: 0
                };
                const fields = [
                    { name: 'completion xp', value: statsNew.xp.toLocaleString(), inline: true },
                    { name: 'maps passed', value: statsNew.count_completed.toLocaleString(), inline: true }
                ];

                // Check category yearly completion percentage milestones
                const yearlyPercentStepOld = utils.floorToNearest(statsOld.time_percentage_completed, yearlyPercentStep);
                const yearlyPercentStepNew = utils.floorToNearest(statsNew.time_percentage_completed, yearlyPercentStep);
                if (yearlyPercentStepNew > yearlyPercentStepOld) {
                    milestoneEmbeds.push(makeEmbed(
                        `Reached ${yearlyPercentStepNew}% ${statsNew.year} completion in ${categoryName}!`,
                        fields
                    ));
                }

                // Check category yearly pass count milestones
                const yearlyPassCountStepOld = utils.floorToNearest(statsOld.count_completed, playcountStep);
                const yearlyPassCountStepNew = utils.floorToNearest(statsNew.count_completed, playcountStep);
                if (yearlyPassCountStepNew > yearlyPassCountStepOld) {
                    milestoneEmbeds.push(makeEmbed(
                        `Reached ${yearlyPassCountStepNew.toLocaleString()} passes in ${categoryName} for ${statsNew.year}!`,
                        fields
                    ));
                }

            }

            // Send milestone embeds lumped together
            while (milestoneEmbeds.length > 0) {
                utils.sendDiscordMessage(env.MILESTONE_FEED_DISCORD_CHANNEL_ID, {
                    embeds: milestoneEmbeds.splice(0, 10)
                });
            }

        }

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
        updateUserCategoryStats(id, true);
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
            LEFT JOIN user_import_queue q ON s.user_id = q.user_id
            WHERE s.user_id != 0 AND u.last_import_time != 0 AND (q.time_started IS NULL OR q.time_started = 0)
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
// or by checking all maps for passes if a full import is requested
let isImportRunning = false;
const importUser = async (userId, doFullImport = false) => {
    const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    isImportRunning = true;
    try {

        // Delete existing passes so we have a clean slate
        utils.log(`Deleting existing passes for ${user.name}...`);
        db.prepare(`DELETE FROM user_passes WHERE user_id = ?`).run(userId);

        utils.log(`Starting ${doFullImport ? `FULL ` : ''}import of ${user.name}'s passes...`);
        const uniqueMapsetIds = new Set();
        const pendingMapsetIds = [];

        // If full import, count total beatmaps
        let beatmapsCount = 0;
        if (doFullImport)
            beatmapsCount = db.prepare(`SELECT COUNT(*) AS count FROM beatmaps`).get().count;

        // Get playcounts count or use length of pendingMapsetIds if full import
        const osuUser = !doFullImport ? await osu.getUser(userId) : null;
        const playcountsCount = beatmapsCount || osuUser.beatmap_playcounts_count;

        // Update queue entry
        const timeStarted = Date.now();
        db.prepare(
            `UPDATE user_import_queue
            SET time_started = ?, percent_complete = 0, count_passes_imported = 0,
                time_queued = 0, playcounts_count = ?
            WHERE user_id = ?`
        ).run(timeStarted, playcountsCount, userId);

        // Outer loop to fetch and process passes
        let beatmapsOffset = 0;
        let passCount = 0;
        let lastStatUpdateTime = Date.now();
        while (true) {

            // Inner loop to fetch unique mapset IDs from most played
            while (true) {

                if (pendingMapsetIds.length >= 50) break;

                // Collect beatmap entries depending on import type
                const entries = [];
                if (doFullImport) {

                    // Fetch chunk of maps from db
                    const rows = db.prepare(
                        `SELECT mapset.id AS mapset_id, mapset.status AS status
                        FROM beatmaps map
                        JOIN beatmapsets mapset ON map.mapset_id = mapset.id
                        ORDER BY map.mode, map.id ASC
                        LIMIT 100 OFFSET ?`
                    ).all(beatmapsOffset);

                    // Add entries
                    for (const row of rows) {
                        const mapsetId = row.mapset_id;
                        const status = row.status;
                        entries.push({ mapsetId, status });
                    }

                } else {

                    // Fetch most played maps
                    const res = await osu.getUserBeatmaps(userId, 'most_played', {
                        limit: 100, offset: beatmapsOffset
                    });
                    if (res.length == 0) break;

                    // Add entries
                    for (const entry of res) {
                        const mapsetId = entry.beatmapset.id;
                        const status = entry.beatmapset.status;
                        entries.push({ mapsetId, status });
                    }

                }

                // Break if no more entries
                if (entries.length === 0) break;

                // Loop through entries and add unique valid mapset IDs to pending list
                for (const entry of entries) {
                    const { mapsetId, status } = entry;
                    const isValidStatus = ['ranked', 'approved', 'loved'].includes(status);
                    const isUnseenMapset = !uniqueMapsetIds.has(mapsetId);
                    if (isUnseenMapset && isValidStatus) {
                        uniqueMapsetIds.add(mapsetId);
                        pendingMapsetIds.push(mapsetId);
                    }
                    beatmapsOffset++;
                }

            }

            // Break if no more mapsets to process
            if (pendingMapsetIds.length === 0) break;

            // Collect batch of mapsets
            const ids = pendingMapsetIds.splice(0, 50);
            const mapsetIdsNeedingStatusUpdate = [];

            // Check for missing mapsets
            const existingMapsetIds = db.prepare(
                `SELECT id FROM beatmapsets
                WHERE id IN (${ids.map(() => '?').join(',')})`
            ).all(...ids).map(row => row.id);
            const missingMapsetIds = ids.filter(id => !existingMapsetIds.includes(id));

            // Fetch and save any missing mapsets
            for (const mapsetId of missingMapsetIds) {
                await saveMapset(mapsetId, true);
            }

            // Determine what modes need to be selected
            const modes = db.prepare(
                `SELECT DISTINCT mode FROM beatmaps
                WHERE mapset_id IN (${ids.map(() => '?').join(',')})`
            ).all(...ids).map(row => row.mode);
            const modeSet = new Set(modes);
            // If modes includes osu, add all modes since converts may exist
            if (modeSet.has('osu')) {
                modeSet.add('taiko');
                modeSet.add('fruits');
                modeSet.add('mania');
            }
            const rulesetIds = Array.from(modeSet).map(key => ({ osu: 0, taiko: 1, fruits: 2, mania: 3 }[key]));

            // Check for passes in each mode
            for (const ruleset_id of rulesetIds) {
                const modeKey = utils.rulesetNameToKey(ruleset_id);

                // Fetch passes
                const res = await osu.getUserBeatmapsPassed(userId, {
                    beatmapset_ids: ids,
                    no_diff_reduction: false,
                    ruleset_id,
                    // Don't include converts for standard
                    // If we left this included them, a pass on a convert would appear as a standard pass
                    exclude_converts: ruleset_id === 0 ? true : false
                });

                // Save passes to DB
                // Note: We do NOT trust map.mode returned from the API, since it's set to 'osu' on converts, not the convert mode
                const transaction = db.transaction(() => {
                    for (const map of res.beatmaps_passed) {

                        // Skip if no leaderboard
                        if (!['ranked', 'loved', 'approved'].includes(map.status)) continue;

                        // Check if map needs to be saved
                        // Either if we don't have a record of it, or if its status has changed
                        const existingMap = db.prepare(`SELECT * FROM beatmaps WHERE id = ? AND mode = ? LIMIT 1`).get(map.id, modeKey);
                        const oldStatus = existingMap?.status;
                        const newStatus = map.status;
                        if (oldStatus !== newStatus) {
                            mapsetIdsNeedingStatusUpdate.push(map.beatmapset_id);
                        }

                        // Save pass
                        const time = Date.now();
                        db.prepare(`INSERT OR IGNORE INTO user_passes (user_id, map_id, mapset_id, mode, time_passed) VALUES (?, ?, ?, ?, ?)`).run(
                            user.id, map.id, map.beatmapset_id, modeKey, time
                        );
                        passCount++;

                    }
                });
                transaction();

            }

            // Save any mapsets that need to be saved/updated and update stats if needed
            if (mapsetIdsNeedingStatusUpdate.length > 0) {
                for (const mapsetId of mapsetIdsNeedingStatusUpdate) {
                    await saveMapset(mapsetId, false);
                }
                updateUserCategoryStats(0);
            }

            // Update queue entry progress
            const percentComplete = (beatmapsOffset / playcountsCount * 100).toFixed(2);
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
                (beatmapsOffset / (Date.now() - timeStarted)) * 1000 * 60
            );
            utils.log(`[Importing ${percentComplete}%] Saved ${passCount} new passes for ${user.name} (${scoresPerMinute} scores/min)`);

            // Update stats every so often so they can see their progress
            // Only do this if they don't already have saved stats
            const statUpdateInterval = 1000 * 60 * 2;
            if ((Date.now() - lastStatUpdateTime) > statUpdateInterval && !user.last_import_time) {
                updateUserCategoryStats(userId, true);
                lastStatUpdateTime = Date.now();
            }

        }

        // Remove from import queue
        db.prepare(`DELETE FROM user_import_queue WHERE user_id = ?`).run(userId);

        // Save last import time and import status
        db.prepare(
            `UPDATE users SET last_import_time = ?, has_full_import = ? WHERE id = ?`
        ).run(Date.now(), doFullImport ? 1 : 0, userId);

        // Update user stats
        updateUserCategoryStats(userId, true);

        // Log import completion and speed
        const importDurationMs = (Date.now() - timeStarted);
        const scoresPerMinute = Math.round(
            (beatmapsOffset / (Date.now() - timeStarted)) * 1000 * 60
        );
        utils.log(`Completed import of ${passCount} passes for ${user.name} in ${utils.secsToDuration(Math.round(importDurationMs / 1000))} (${scoresPerMinute} scores/min)`);

        // Get remaining queue details
        const queueEntries = db.prepare(`SELECT * FROM user_import_queue`).all();
        const queueCount = queueEntries.length;
        const queueSecsRemaining = queueEntries.reduce((secs, entry) => {
            const perSec = (entry.is_full ? env.SCORES_PER_MINUTE_FULL : env.SCORES_PER_MINUTE) / 60;
            return (secs + (entry.playcounts_count / perSec));
        }, 0);

        // Post log to Discord
        await utils.sendDiscordMessage(env.USER_FEED_DISCORD_CHANNEL_ID, {
            embeds: [{
                author: {
                    name: user.name,
                    icon_url: user.avatar_url,
                    url: `${env.HTTPS ? 'https' : 'http'}://${env.HOST}/u/${user.id}`
                },
                title: `Completed ${doFullImport ? 'full ' : ''}import of ${passCount.toLocaleString()} passes`,
                description: [
                    `Took ${utils.secsToDuration(Math.round(importDurationMs / 1000))} to check ${beatmapsOffset.toLocaleString()} beatmaps (${scoresPerMinute} scores/min)`,
                    `${queueCount == 0 ? `The queue is now empty!` : `Queue of ${queueCount} user${queueCount > 1 ? 's' : ''} estimated to be empty in ${utils.getRelativeTimestamp(Date.now() + Math.round(queueSecsRemaining * 1000), undefined, false)}...`}`
                ].join('\n'),
                color: 0xA3F5F5
            }]
        });

    } catch (error) {
        utils.logError(`Error while importing user ${user.name}:`, error);
    }
    isImportRunning = false;
};

// Function to save passes given an array of osu score objects
// This function is agnostic to how the scores were fetched, so it should
// work with global recents, user recents, or another source
const savePassesFromScores = async scores => {
    try {

        // Filter scores to only include those from tracked users
        const trackedUserIds = new Set(
            db.prepare(`SELECT id FROM users`).all().map(row => row.id)
        );
        const mapIds = new Set();
        const scoresByUser = {};
        let relevantScoreCount = 0;
        for (const score of scores) {
            // Skip if user not tracked
            if (!trackedUserIds.has(score.user_id)) continue;
            // Save score and map id for later processing
            if (!scoresByUser[score.user_id]) {
                scoresByUser[score.user_id] = [];
            }
            scoresByUser[score.user_id].push(score);
            mapIds.add(score.beatmap_id || score.beatmap.id);
            relevantScoreCount++;
        }

        // Stop here if no scores to process
        if (mapIds.size === 0) {
            return 0;
        }

        // Fetch all maps in batches of 50
        utils.log(`Fetching data for ${mapIds.size} beatmaps...`);
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
            // Save mapset data if not already saved or if status has changed
            const mapsetId = map.beatmapset.id;
            const existingMapset = db.prepare(`SELECT * FROM beatmapsets WHERE id = ? LIMIT 1`).get(mapsetId);
            const oldStatus = existingMapset?.status;
            const newStatus = map.beatmapset.status;
            if (!existingMapset || oldStatus !== newStatus) {
                await saveMapset(mapsetId, !existingMapset);
                savedNewMapsets = true;
            }
        }

        // Update beatmap stats if we saved any new mapsets
        if (savedNewMapsets) {
            updateUserCategoryStats(0);
        }

        // Loop through each affected user to process scores
        utils.log(`Processing and saving passes from ${relevantScoreCount} relevant (of ${scores.length} total) scores...`);
        const savedPasses = [];
        for (const userId in scoresByUser) {

            // Save and get user profile
            await updateUserProfile(userId);
            const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

            // Process scores in a transaction
            let newCount = 0;
            let latestTime = 0;
            const transaction = db.transaction(() => {
                for (const score of scoresByUser[userId]) {

                    // Make sure map data was fetched
                    const mapId = score.beatmap_id || score.beatmap.id;
                    const map = mapsById[mapId];
                    if (!map) {
                        utils.log(`Warning: Beatmap with ID ${mapId} couldn't be fetched from osu API`);
                        continue;
                    }

                    // Collect other data
                    const time = new Date(score.ended_at || score.started_at || Date.now()).getTime();
                    if (time > latestTime) latestTime = time;
                    const mode = utils.rulesetNameToKey(score.mode || score.ruleset_id);
                    const status = map.status;
                    const mapsetId = map.beatmapset.id;

                    // Skip if map doesn't have a leaderboard
                    const validStatuses = ['ranked', 'loved', 'approved'];
                    if (!validStatuses.includes(status)) continue;

                    // Skip if pass is already saved
                    const existingPass = db.prepare(`SELECT 1 FROM user_passes WHERE user_id = ? AND map_id = ? AND mode = ? LIMIT 1`).get(userId, mapId, mode);
                    if (existingPass) continue;

                    // Save pass
                    db.prepare(`INSERT INTO user_passes (user_id, map_id, mapset_id, mode, time_passed) VALUES (?, ?, ?, ?, ?)`).run(
                        userId, mapId, mapsetId, mode, time
                    );
                    savedPasses.push({
                        userId, userName: user.name,
                        mapsetId, mapId, mode,
                        mapName: `${map.beatmapset.artist} - ${map.beatmapset.title} [${map.version}]`,
                        xp: apiRead.secsToXp(map.total_length)
                    });
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

        // Log passes to Discord
        if (savedPasses.length > 0) {
            const content = savedPasses.map(pass => {
                return `-# * **[${pass.userName}](<${env.HTTPS ? 'https' : 'http'}://${env.HOST}/u/${pass.userId}>)** gained **${pass.xp.toLocaleString()} cxp** from [${pass.mapName}](<https://osu.ppy.sh/beatmapsets/${pass.mapsetId}#${pass.mode}/${pass.mapId}>) **(${utils.rulesetKeyToName(pass.mode, true)})**`;
            }).join('\n');
            await utils.sendDiscordMessage(env.PASS_FEED_DISCORD_CHANNEL_ID, { content });
            utils.log(`Finished processing ${scores.length} scores, saved ${savedPasses.length} new passes`);
        }
        return savedPasses.length;
    } catch (error) {
        utils.logError(`Error while saving passes from scores:`, error);
        return -1;
    }
};

// Save passes from osu! score cache
// This is a separate project that collects and stores recent scores for longer than osu! API does
const savePassesFromScoreCache = async () => {
    try {
        utils.log(`Fetching recent scores from osu! score cache...`);
        // Get cursor from db or default to no cursor
        const defaultCursor = Date.now() - (1000 * 60 * 5);
        const cursor = db.prepare(`SELECT value FROM misc WHERE key = 'score_cache_cursor'`).get()?.value || defaultCursor;
        // Fetch the scores
        const res = await axios.get(`${env.OSU_SCORE_CACHE_BASE_URL}/api/scores`, {
            params: { after: cursor, limit: 1000 }
        });
        // Stop now if we didn't get any
        const scores = res.data.scores || [];
        if (scores.length === 0) {
            utils.log(`No new scores found in score cache`);
            return 0;
        }
        // Save passes
        const savedPassesCount = await savePassesFromScores(scores);
        if (savedPassesCount == -1) {
            throw new Error('Score processing failed');
        }
        // Save new cursor
        const newCursor = res.data.meta.cursors.newer;
        db.prepare(`INSERT OR REPLACE INTO misc (key, value) VALUES ('score_cache_cursor', ?)`).run(newCursor);
        return scores.length;
    } catch (error) {
        utils.logError(`Error while processing score cache:`, error);
        return 0;
    }
};

// Function to fetch and save passes from global recents
const savePassesFromGlobalRecents = async () => {
    try {
        utils.log(`Fetching global recents in all modes...`);
        // Fetch all global recent scores
        const modes = ['osu', 'taiko', 'fruits', 'mania'];
        const newCursors = {};
        const scores = [];
        let maxFetchedCount = 0;
        for (const mode of modes) {
            const cursor = db.prepare(
                `SELECT cursor FROM global_recents_cursors WHERE mode = ?`
            ).get(mode)?.cursor || null;
            const res = await osu.getScores({ ruleset: mode, cursor_string: cursor });
            // Save scores for processing
            scores.push(...res.scores);
            maxFetchedCount = Math.max(maxFetchedCount, res.scores.length);
            // Make note of new cursor
            newCursors[mode] = res.cursor_string;
        };
        // Save passes
        const savedPassesCount = await savePassesFromScores(scores);
        if (savedPassesCount == -1) {
            throw new Error('Score processing failed');
        }
        // Save new cursors
        // We do this down here so if something fails above, we don't lose the cursor position
        for (const mode of modes) {
            const newCursor = newCursors[mode];
            db.prepare(`INSERT OR REPLACE INTO global_recents_cursors (mode, cursor) VALUES (?, ?)`).run(mode, newCursor);
        }
        // Immediately run again if we fetched a lot of scores,
        // indicating that there are probably more to fetch
        if (maxFetchedCount > 800) {
            utils.log(`Fetched a large number of scores (${maxFetchedCount}), checking global recents again...`);
            return await savePassesFromGlobalRecents();
        }
    } catch (error) {
        utils.logError(`Error while processing global recents:`, error);
    }
};

const savePassesFromUserRecents = async userId => {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    try {
        if (!user) {
            utils.logError(`User with ID ${userId} not found in database`);
            return;
        }
        const scores = [];
        for (const mode of ['osu', 'taiko', 'fruits', 'mania']) {
            utils.log(`Fetching recent scores for ${user.name} in mode ${mode}...`);
            let offset = 0;
            while (true) {
                const res = await osu.getUserScores(userId, 'recent', {
                    include_fails: false, limit: 50, mode, offset
                });
                if (res.length === 0) break;
                scores.push(...res);
                offset += res.length;
                // If we fetched less than requested, we're done
                if (res.length < 50) break;
            }
        }
        // Save passes
        const savedPassesCount = await savePassesFromScores(scores);
        if (savedPassesCount == -1) {
            throw new Error('Score processing failed');
        }
    } catch (error) {
        utils.logError(`Error while processing user recents for ${user?.name || userId}:`, error);
    }
};

const savePassesFromAllUserRecents = async () => {
    try {
        const userIds = db.prepare(`SELECT id FROM users`).all().map(row => row.id);
        for (const userId of userIds) {
            await savePassesFromUserRecents(userId);
        }
    } catch (error) {
        utils.logError(`Error while processing all user recents:`, error);
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
    importUser(userId, nextEntry.is_full === 1);
};

// Function to queue a user for import
const beatmapCount = db.prepare(`SELECT COUNT(*) AS count FROM beatmaps`).get().count;
const queueUserForImport = async (userId, full = false) => {
    try {
        const existingTask = db.prepare(`SELECT 1 FROM user_import_queue WHERE user_id = ? LIMIT 1`).get(userId);
        if (existingTask) return false;
        // Fetch playcounts count
        const user = await osu.getUser(userId);
        const playcountsCount = full
            ? beatmapCount
            : user?.beatmap_playcounts_count || 0;
        if (!user || playcountsCount === 0) {
            utils.log(`User ${user?.username} has no playcounts, not queueing for import`);
            return false;
        }
        // Add to queue
        const queueTime = full ? Date.now() + (1000 * 60 * 60 * 24 * 7) : Date.now();
        db.prepare(
            `INSERT OR IGNORE INTO user_import_queue
            (user_id, time_queued, playcounts_count, is_full)
            VALUES (?, ?, ?, ?)`
        ).run(userId, queueTime, playcountsCount, full ? 1 : 0);
        utils.log(`Queued ${user.username} for ${full ? 'full ' : ''}import`);
        return true;
    } catch (error) {
        utils.logError(`Error while queueing user ${userId} for import:`, error);
        return null;
    }
};

const unqueueUser = async (userId) => {
    try {
        const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        if (!user) {
            utils.logError(`User with ID ${userId} not found in database`);
            return false;
        }
        const existingTask = db.prepare(`SELECT 1 FROM user_import_queue WHERE user_id = ? LIMIT 1`).get(userId);
        if (!existingTask) {
            utils.log(`${user.name} isn't in the import queue`);
            return false;
        }
        db.prepare(`DELETE FROM user_import_queue WHERE user_id = ?`).run(userId);
        utils.log(`Removed ${user.name} from the import queue`);
        return true;
    } catch (error) {
        utils.logError(`Error while unqueueing user ${userId} from import queue:`, error);
        return null;
    }
};

const backupDatabase = async () => {
    const backupsDir = env.DB_BACKUPS_DIR;
    const backupFile = path.join(backupsDir, `${dayjs().format('YYYYMMDD-HHmmss')}.db`);
    utils.log(`Backing up database to ${backupFile}...`);
    await db.backup(backupFile);
    utils.log(`Backup complete`);
};

// Function to backup the database periodically
const backupDatabaseClean = async () => {
    try {
        const backupsDir = env.DB_BACKUPS_DIR;
        const backupIntervalHours = env.DB_BACKUP_INTERVAL_HOURS;
        const keepBackupsCount = env.DB_KEEP_BACKUPS_COUNT;
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
            await backupDatabase();
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

const saveAnalytics = async () => {
    try {
        const date = dayjs().format('YYYY-MM-DD');
        const tsOneDayAgo = Date.now() - (1000 * 60 * 60 * 24);
        const tsOneWeekAgo = Date.now() - (1000 * 60 * 60 * 24 * 7);
        const tsOneMonthAgo = Date.now() - (1000 * 60 * 60 * 24 * 30);
        const stmtRecentActiveUserCount = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE last_login_time > ?`);
        const stmtRecentNewUserCount = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE time_created > ?`);
        const stmtRecentPassesCount = db.prepare(`SELECT COUNT(*) AS count FROM user_passes WHERE time_passed > ?`);
        const stmtRecentMapsCount = db.prepare(
            `SELECT COUNT(*) AS count
            FROM beatmaps map
            JOIN beatmapsets mapset ON map.mapset_id = mapset.id
            WHERE mapset.time_ranked > ?`
        );
        const stmtRecentMapsetsCount = db.prepare(
            `SELECT COUNT(*) AS count
            FROM beatmapsets
            WHERE time_ranked > ?`
        );
        const stats = {
            active_users_past_day: stmtRecentActiveUserCount.get(tsOneDayAgo).count,
            active_users_past_week: stmtRecentActiveUserCount.get(tsOneWeekAgo).count,
            active_users_past_month: stmtRecentActiveUserCount.get(tsOneMonthAgo).count,
            new_users_past_day: stmtRecentNewUserCount.get(tsOneDayAgo).count,
            new_users_past_week: stmtRecentNewUserCount.get(tsOneWeekAgo).count,
            new_users_past_month: stmtRecentNewUserCount.get(tsOneMonthAgo).count,
            passes_past_day: stmtRecentPassesCount.get(tsOneDayAgo).count,
            passes_past_week: stmtRecentPassesCount.get(tsOneWeekAgo).count,
            passes_past_month: stmtRecentPassesCount.get(tsOneMonthAgo).count,
            maps_past_day: stmtRecentMapsCount.get(tsOneDayAgo).count,
            maps_past_week: stmtRecentMapsCount.get(tsOneWeekAgo).count,
            maps_past_month: stmtRecentMapsCount.get(tsOneMonthAgo).count,
            mapsets_past_day: stmtRecentMapsetsCount.get(tsOneDayAgo).count,
            mapsets_past_week: stmtRecentMapsetsCount.get(tsOneWeekAgo).count,
            mapsets_past_month: stmtRecentMapsetsCount.get(tsOneMonthAgo).count,
            total_users: db.prepare(`SELECT COUNT(*) AS count FROM users`).get().count,
            total_maps: db.prepare(`SELECT COUNT(*) AS count FROM beatmaps`).get().count,
            total_mapsets: db.prepare(`SELECT COUNT(*) AS count FROM beatmapsets`).get().count,
            total_passes: db.prepare(`SELECT COUNT(*) AS count FROM user_passes`).get().count,
        };
        const stmtInsertAnalytics = db.prepare(`INSERT OR REPLACE INTO analytics (date, metric, value) VALUES (?, ?, ?)`);
        const transaction = db.transaction(() => {
            for (const [metric, value] of Object.entries(stats)) {
                stmtInsertAnalytics.run(date, metric, value);
            }
        });
        transaction();
        utils.log(`Saved/updated ${Object.keys(stats).length} metrics of analytics data for ${date}`);
    } catch (error) {
        utils.logError('Error while saving analytics data:', error);
    }
};

const generateSitemap = async (outputPath) => {
    outputPath = outputPath || path.join(env.ROOT, 'apps/web/public/sitemap.xml');
    // Select user data
    const userEntries = db.prepare(`
        SELECT 
            u.id AS id, 
            s.category AS category_id,
            s.count AS category_playcount,
            u.last_pass_time, 
            u.time_created,
            total.count AS total_playcount
        FROM users u
        JOIN user_category_stats s ON u.id = s.user_id
        LEFT JOIN user_category_stats total 
            ON u.id = total.user_id 
            AND total.category = 'global-ranked-loved-converts'
        WHERE 
            s.user_id != 0
            AND s.count > 0
            AND s.category NOT LIKE 'global-%'
            AND total.count != 0
    `).all();
    // Map user ID to category passes
    const userPassCounts = {};
    for (const entry of userEntries) {
        if (!userPassCounts[entry.id]) {
            userPassCounts[entry.id] = entry;
            userPassCounts[entry.id].counts = {};
        }
        userPassCounts[entry.id].counts[entry.category_id] = entry.category_playcount;
    }
    // Filter active/relevant user categories
    const userPages = [];
    for (const userId in userPassCounts) {
        const entry = userPassCounts[userId];
        const counts = entry.counts;
        const countTotal = entry.total_playcount;
        for (const catId in counts) {
            // Total isn't a category
            if (catId === 'total') continue;
            const currentCount = counts[catId];
            // Skip if not at least 10% of total or at least 1000 passes
            if (currentCount < 1000 && currentCount < (countTotal * 0.1)) continue;
            // Track redundancy
            let isRedundant = false;
            // If this is a loved category
            if (catId.includes('-loved')) {
                const catIdBase = catId.replace('-loved', '');
                // Skip if delta doesn't meet the same requirements
                const baseCount = counts[catIdBase] || 0;
                const delta = currentCount - baseCount;
                if (delta < 1000 && delta < (currentCount * 0.1))
                    isRedundant = true;
            }
            // If this is a converts category
            if (!isRedundant && catId.includes('-converts')) {
                const catIdBase = catId.replace('-converts', '');
                // Skip if delta doesn't meet the same requirements
                const baseCount = counts[catIdBase] || 0;
                const delta = currentCount - baseCount;
                if (delta < 1000 && delta < (currentCount * 0.1))
                    isRedundant = true;
            }
            if (isRedundant) continue;
            // Passed all checks, add to sitemap
            userPages.push({
                id: entry.id,
                category_id: catId,
                last_pass_time: entry.last_pass_time,
                time_created: entry.time_created
            });
        }
    }
    // Get category IDs
    const categoryIds = statCategories.definitions.map(cat => cat.id);
    // Render sitemap XML
    const xml = await ejs.renderFile(path.join(env.ROOT, 'apps/web/views/sitemap.ejs'), {
        baseUrl: env.BASE_URL, userPages, categoryIds, dayjs,
        staticPaths: ['', 'tos', 'privacy', 'changelog', 'faq', 'search']
    });
    fs.writeFileSync(outputPath, xml);
    // Count and log sitemap entries
    const matches = xml.match(/<url>/g);
    const entryCount = matches ? matches.length : 0;
    utils.log(`Generated and saved sitemap with ${entryCount} entries to ${outputPath}`);
};

const generateRobotsTxt = async (outputPath) => {
    outputPath = outputPath || path.join(env.ROOT, 'apps/web/public/robots.txt');
    const lines = [];
    lines.push(`User-agent: *`);
    lines.push(`Allow: /`);
    lines.push(`Disallow: /api/`);
    lines.push(`Disallow: /recommended/`);
    lines.push(`Sitemap: ${env.BASE_URL}/sitemap.xml`);
    fs.writeFileSync(outputPath, lines.join('\n'));
    utils.log(`Generated and saved robots.txt to ${outputPath}`);
};

module.exports = {
    updateUserProfile,
    saveMapset,
    savePassesFromScores,
    savePassesFromScoreCache,
    savePassesFromGlobalRecents,
    savePassesFromUserRecents,
    savePassesFromAllUserRecents,
    importUser,
    backupDatabase,
    backupDatabaseClean,
    startQueuedImports,
    queueUserForImport,
    fetchNewMapData,
    updateUserCategoryStats,
    snapshotCategoryStats,
    updateAllUserCategoryStats,
    updateMapStatuses,
    unqueueUser,
    saveAnalytics,
    generateSitemap,
    generateRobotsTxt
};