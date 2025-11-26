const express = require('express');
const db = require('../db');

const { ensureUserExists } = require('../middleware.js');
const { rulesetNameToKey, rulesetKeyToName } = require('../utils.js');

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