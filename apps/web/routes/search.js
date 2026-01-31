const express = require('express');
const { searchUsers, searchBeatmaps } = require('#api/read.js');

const router = express.Router();

router.get('/', (req, res) => {
    const query = req.query.q?.trim() || '';
    const limits = 12;
    const users = searchUsers(query, limits, 0);
    const maps = searchBeatmaps(
        query, null,
        query ? null : 'date_desc',
        null, limits, 0
    );
    res.render('layout', {
        page: 'search',
        title: 'Search tracked completionists and maps',
        meta: {
            title: `Search tracked completionists and maps`,
            description: `Find who or what you're looking for using natural text or filtered searches.`
        },
        me: req.me,
        user_results: users,
        map_results: maps,
        query
    });
});

module.exports = router;