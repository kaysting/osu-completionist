const express = require('express');
const { searchUsers, searchBeatmaps } = require('../helpers/dbHelpers');

const router = express.Router();

router.get('/', (req, res) => {
    const query = req.query.q?.trim() || '';
    const limits = 12;
    const users = searchUsers(query, limits, 0);
    const maps = searchBeatmaps(query, true, false, null, null, limits, 0);
    res.render('layout', {
        page: 'search',
        title: 'Search',
        meta: {
            title: `Search tracked completionists and maps`,
            description: `Search all tracked players and beatmaps.`
        },
        me: req.me,
        user_results: users,
        map_results: maps,
        query
    });
});

module.exports = router;