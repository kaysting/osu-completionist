const express = require('express');
const statCatDefs = require('../statCategoryDefinitions');

const { rulesetNameToKey, rulesetKeyToName } = require('../helpers/utils.js');
const { getLeaderboard } = require('../helpers/dbHelpers.js');
const utils = require('../helpers/utils.js');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect(`/leaderboard/osu-ranked`);
});

router.get('/:category', (req, res) => {
    // Get params
    const category = req.params.category.toLowerCase();
    const page = parseInt(req.query.p) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check params
    if (!statCatDefs.find(cat => cat.id === category)) {
        return res.redirect('/leaderboard/osu-ranked');
    }
    // Get leaderboard data
    const { leaderboard, total_players } = getLeaderboard(category, limit, offset);
    // Get colors for completion progress bars and format time spent
    for (const entry of leaderboard) {
        const percentage = parseFloat(entry.stats.percentage_completed) / 100;
        entry.color = utils.percentageToColor(percentage);
        entry.stats.time_spent = Math.round(entry.stats.time_spent_secs / 3600);
    }
    // Calculate total page count
    const maxPages = Math.ceil(total_players / limit);
    const pagesToShow = [];
    for (let i = 1; i <= maxPages; i++) {
        if (i === 1 || i === maxPages || (i >= page - 2 && i <= page + 2)) {
            pagesToShow.push(i);
        } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
            pagesToShow.push('...');
        }
    }
    // Render
    const modeName = rulesetKeyToName(rulesetNameToKey(category.split('-')[0]), true);
    res.render('layout', {
        title: `${modeName} leaderboard`,
        meta: {
            title: `${modeName} completionist leaderboard`,
            description: `View the players who have passed the most ${modeName} beatmaps!`
        },
        page: 'leaderboard',
        category,
        category_navigation: utils.getCatNavPaths('/leaderboard', category),
        pagination: {
            current: page, nav: pagesToShow, basePath: `/leaderboard/${category}`
        },
        leaderboard,
        me: req.me
    });
});

module.exports = router;