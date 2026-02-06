const express = require('express');
const statCategories = require('#config/statCategories.js');

const { getLeaderboard } = require('#api/read.js');

const router = express.Router();

router.get('/', (req, res) => {
    const category = req?.session?.category || 'osu-ranked';
    res.redirect(`/leaderboard/${category}`);
});

router.get('/:category', (req, res) => {
    // Get params
    const category = statCategories.validateCategoryId(req.params.category);
    const page = parseInt(req.query.p) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check category
    if (!category) {
        return res.redirect('/leaderboard/osu-ranked');
    }
    // Get leaderboard data
    const { leaderboard, total_players } = getLeaderboard(category, limit, offset);
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
    const categoryName = statCategories.getCategoryName(category);
    const title = `${categoryName} completionist leaderboard`;
    res.render('layout', {
        title,
        meta: {
            title,
            description: `View the players who have the highest completion in this category!`
        },
        topbar: {
            title: `Leaderboard - ${categoryName}`,
            icon: 'leaderboard'
        },
        page: 'leaderboard',
        category,
        category_navigation: statCategories.getCategoryNavPaths('/leaderboard', category),
        pagination: {
            current: page,
            nav: pagesToShow,
            basePath: `/leaderboard/${category}`
        },
        leaderboard,
        me: req.me
    });
});

module.exports = router;
