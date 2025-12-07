const express = require('express');

const { rulesetNameToKey, rulesetKeyToName } = require('../utils.js');
const { getLeaderboard } = require('../helpers/dbHelpers.js');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect(`/leaderboard/osu/ranked`);
});

router.get('/:mode', (req, res) => {
    res.redirect(`/leaderboard/${req.params.mode}/ranked`);
});

router.get('/:mode/:includes', (req, res) => {
    // Get params
    const page = parseInt(req.query.p) || 1;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked'];
    const includeConverts = includes.includes('converts') ? 1 : 0;
    const includeLoved = includes.includes('loved') ? 1 : 0;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check params
    const modeKey = rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect('/leaderboard/osu/ranked-loved');
    }
    // Get leaderboard data
    const { leaderboard, total_players } = getLeaderboard(modeKey, includeLoved, includeConverts, limit, offset);
    // Calculate total page count
    const maxPages = Math.ceil(total_players / limit);
    const pagesToShow = [];
    for (let i = 1; i <= maxPages; i++) {
        if (i === 1 || i === maxPages || (i >= page - 1 && i <= page + 1)) {
            pagesToShow.push(i);
        } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
            pagesToShow.push('...');
        }
    }
    // Render
    const modeNameFull = rulesetKeyToName(modeKey, true);
    res.render('layout', {
        title: `${modeNameFull} leaderboard`,
        meta: {
            title: `${modeNameFull} completionist leaderboard`,
            description: `View the players who have passed the most ${modeNameFull} beatmaps!`
        },
        page: 'leaderboard',
        settings: {
            modeKey, mode, includes, basePath: '/leaderboard'
        },
        pagination: {
            current: page, nav: pagesToShow, basePath: `/leaderboard/${mode}/${includes.join('-')}`
        },
        leaderboard,
        me: req.me
    });
});

module.exports = router;