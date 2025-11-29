const express = require('express');
const db = require('../db');

const { ensureUserExists } = require('../middleware.js');
const utils = require('../utils.js');
const { rulesetNameToKey, rulesetKeyToName, getRelativeTimestamp, starsToColor, secsToDuration } = utils;

const router = express.Router();

router.get('/:id', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.user.mode}/ranked-loved`);
});

router.get('/:id/:mode', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.params.mode}/ranked-loved`);
});

router.get('/:id/:mode/:includes', ensureUserExists, (req, res) => {
    const user = req.user;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked', 'loved'];
    const includeConverts = includes.includes('converts') ? 1 : 0;
    const includeLoved = includes.includes('loved') ? 1 : 0;
    // Ensure mode is valid
    const modeKey = rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect(`/u/${user.id}/osu/ranked-loved`);
    }
    // Get user stats
    const stats = db.prepare(
        `SELECT count FROM user_stats
         WHERE user_id = ? AND mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(user.id, modeKey, includeLoved, includeConverts);
    const completedCount = stats ? stats.count : 0;
    // Get total number of beatmaps
    const totalMapCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(modeKey, includeLoved, includeConverts).count;
    // Calculate completion percentage
    const percentage = totalMapCount > 0 ? ((completedCount / totalMapCount) * 100).toFixed(2) : '0.00';
    // Get user rank
    const rank = db.prepare(
        `SELECT COUNT(*) + 1 AS rank FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > ?`
    ).get(modeKey, includeLoved, includeConverts, completedCount)?.rank || -1;
    // Get time to pass remaining maps
    const secs = db.prepare(
        `SELECT SUM(duration_secs) AS secs FROM beatmaps
         WHERE id NOT IN (
             SELECT map_id FROM user_passes
             WHERE user_id = ?
               AND mode = ?
               AND ${includeLoved ? `status IN ('ranked', 'approved', 'loved')` : `status IN ('ranked', 'approved')`}
               ${includeConverts ? '' : 'AND is_convert = 0'}
         ) AND mode = ?
           AND ${includeLoved ? `status IN ('ranked', 'approved', 'loved')` : `status IN ('ranked', 'approved')`}
               ${includeConverts ? '' : 'AND is_convert = 0'}`
    ).get(user.id, modeKey, modeKey)?.secs || 0;
    const timeToComplete = utils.secsToDuration(secs);
    // Get yearly progress
    const oldestYear = 2007;
    const newestYear = new Date().getFullYear();
    const yearly = [];
    for (let year = newestYear; year >= oldestYear; year--) {
        const tsStart = new Date(year, 0, 1).getTime();
        const tsEnd = new Date(year + 1, 0, 1).getTime();
        const commonWhere = `
            FROM beatmaps b
            INNER JOIN beatmapsets s ON b.mapset_id = s.id
            WHERE b.mode = ?
            AND ${includeLoved ? `b.status IN ('ranked', 'approved', 'loved')` : `b.status IN ('ranked', 'approved')`}
            ${includeConverts ? '' : 'AND b.is_convert = 0'}
            AND s.time_ranked >= ? AND s.time_ranked < ?
        `;
        const total = db.prepare(
            `SELECT COUNT(*) AS total ${commonWhere}`
        ).get(modeKey, tsStart, tsEnd).total || 0;
        if (total === 0) continue;
        const completed = db.prepare(
            `SELECT COUNT(*) AS total ${commonWhere}
            AND b.id IN (
                SELECT map_id FROM user_passes 
                WHERE user_id = ? 
            )`
        ).get(modeKey, tsStart, tsEnd, user.id).total || 0;
        const percentage = total > 0 ? completed / total : 0;
        yearly.push({
            year,
            total,
            completed,
            percentage: (percentage * 100).toFixed(2),
            color: utils.interpolateColors(percentage, [
                [245, 61, 122], // pinkish red
                [245, 214, 61], // yellow
                [61, 245, 153], // blueish
            ])
        });
    }
    // Create copyable text
    const modeName = rulesetKeyToName(modeKey, true);
    const statsText = [
        `${user.name}'s ${modeName} ${includeLoved ? 'ranked and loved' : 'ranked only'} (${includeConverts ? 'with converts' : 'no converts'}) completion stats:\n`,
        `Overall: ${percentage}% (${completedCount.toLocaleString()} / ${totalMapCount.toLocaleString()})\n`,
        `Yearly breakdown:`
    ];
    for (const year of yearly) {
        const checkbox = year.completed === year.total ? '☑' : '☐';
        statsText.push(`${checkbox} ${year.year}: ${year.percentage}% (${year.completed.toLocaleString()} / ${year.total.toLocaleString()})`);
    }
    // Compile user stats
    user.stats = {
        completed: completedCount,
        total: totalMapCount,
        percentage,
        rank,
        timeToComplete,
        yearly,
        copyable: statsText.join('\n').replace(/"/g, '\\"').replace(/`/g, '\\`')
    };
    // Get recent passes
    const recentPasses = db.prepare(
        `SELECT up.time_passed, bs.title, bs.artist, bm.mode, bm.name, bm.stars, bs.id AS mapset_id, bm.id AS map_id
             FROM user_passes up
             JOIN beatmaps bm ON up.map_id = bm.id
             JOIN beatmapsets bs ON up.mapset_id = bs.id
             WHERE up.user_id = ?
               AND up.mode = ?
               AND bm.mode = up.mode
               AND ${includeLoved ? `up.status IN ('ranked', 'approved', 'loved')` : `up.status IN ('ranked', 'approved')`}
               ${includeConverts ? '' : 'AND up.is_convert = 0'}
             ORDER BY up.time_passed DESC
             LIMIT 100`
    ).all(user.id, modeKey);
    user.recentPasses = recentPasses.map(pass => ({
        timeSincePass: utils.getRelativeTimestamp(pass.time_passed),
        title: pass.title,
        artist: pass.artist,
        mode: pass.mode,
        diff: pass.name,
        stars: pass.stars,
        mapsetId: pass.mapset_id,
        mapId: pass.map_id,
        colorDiff: utils.starsToColor(pass.stars),
        colorText: pass.stars > 7.1 ? 'hsl(45, 95%, 70%)' : 'black'
    }));
    // Get queue status
    user.updating = db.prepare(
        `SELECT * FROM user_update_tasks
         WHERE user_id = ?`
    ).get(user.id);
    if (user.updating) {
        user.updating.pos = db.prepare(
            `SELECT COUNT(*) AS pos FROM user_update_tasks
         WHERE time_queued < ?`
        ).get(user.updating.time_queued)?.pos + 1;
    }
    const includesString = `${includeLoved ? 'ranked and loved' : 'ranked only'}, ${includeConverts ? 'with converts' : 'no converts'}`;
    // Render
    res.render('layout', {
        page: 'profile',
        tabTitle: req.user.name,
        title: `${req.user.name}'s ${modeName} completionist profile`,
        description: `${req.user.name} has passed ${percentage}% of all ${modeName} beatmaps (${includesString})! Click to view more of their completionist stats.`,
        user,
        settings: {
            modeKey, mode, includes, basePath: `/u/${user.id}`
        }
    });
});

module.exports = router;