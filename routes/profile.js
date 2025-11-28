const express = require('express');
const db = require('../db');

const { ensureUserExists } = require('../middleware.js');
const { rulesetNameToKey, rulesetKeyToName, getRelativeTimestamp, starsToColor } = require('../utils.js');

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
    // Get user rank
    const rankResult = db.prepare(
        `SELECT COUNT(*) + 1 AS rank FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > ?`
    ).get(modeKey, includeLoved, includeConverts, completedCount);
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
        timeSincePass: getRelativeTimestamp(pass.time_passed),
        title: pass.title,
        artist: pass.artist,
        mode: pass.mode,
        diff: pass.name,
        stars: pass.stars,
        mapsetId: pass.mapset_id,
        mapId: pass.map_id,
        colorDiff: starsToColor(pass.stars),
        colorText: pass.stars > 7.1 ? 'hsl(45, 95%, 70%)' : 'black'
    }));
    // Get queue status
    user.updating = db.prepare(
        `SELECT * FROM user_update_tasks
         WHERE user_id = ?`
    ).get(user.id);
    // Compile user stats
    const percentage = totalMapCount > 0 ? ((completedCount / totalMapCount) * 100).toFixed(2) : '0.00';
    user.stats = {
        completed: completedCount,
        total: totalMapCount,
        percentage,
        rank: rankResult.rank
    };
    const includesString = `${includeLoved ? 'ranked and loved' : 'ranked only'}, ${includeConverts ? 'with converts' : 'no converts'}`;
    // Render
    const modeName = rulesetKeyToName(modeKey, true);
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