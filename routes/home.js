const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('layout', {
        page: 'home',
        meta: {
            title: `osu! completionist tracker and leaderboard`,
            description: `Track your osu! completionist progress across all game modes, ranked, loved, and convert maps, and compare your progress with others!`
        },
        me: req.me
    });
});

module.exports = router;