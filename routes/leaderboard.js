const express = require('express');
const statCategories = require('../helpers/statCategories.js');

const { rulesetNameToKey, rulesetKeyToName } = require('../helpers/utils.js');
const { getLeaderboard } = require('../helpers/dbHelpers.js');
const utils = require('../helpers/utils.js');

const router = express.Router();

router.get('/', (req, res) => {
    const category = req?.session?.category || 'osu-ranked';
    res.redirect(`/leaderboard/${category}`);
});

router.get('/:category', (req, res) => {
    // Get params
    const category = req.params.category.toLowerCase();
    const page = parseInt(req.query.p) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.redirect('/leaderboard/osu-ranked');
    }
    req.session.category = category;
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
    const mode = category.split('-')[0];
    const modeKey = rulesetNameToKey(mode);
    const modeName = mode == 'global' ? 'Global' : rulesetKeyToName(modeKey, true);
    res.render('layout', {
        title: `${modeName} leaderboard`,
        meta: {
            title: `${modeName} completionist leaderboard`,
            description: `View the players who have passed the most${mode == 'global' ? '' : ` ${modeName}`} beatmaps!`
        },
        page: 'leaderboard',
        category,
        category_navigation: statCategories.getCategoryNavPaths('/leaderboard', category),
        pagination: {
            current: page, nav: pagesToShow, basePath: `/leaderboard/${category}`
        },
        leaderboard,
        me: req.me
    });
});

module.exports = router;