const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    const countUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const countBeatmaps = db.prepare('SELECT COUNT(*) AS count FROM beatmaps').get().count;
    const countPasses = db.prepare('SELECT COUNT(*) AS count FROM user_passes').get().count;
    res.render('layout', {
        page: 'home',
        meta: {
            title: `osu! completionist tracker and leaderboard`,
            description: `Track your osu! completionist progress across all game modes, ranked, loved, and convert maps, and compare your progress with others!`
        },
        stats: {
            users: countUsers,
            beatmaps: countBeatmaps,
            passes: countPasses
        },
        me: req.me
    });
});

module.exports = router;