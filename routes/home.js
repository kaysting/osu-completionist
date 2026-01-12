const express = require('express');
const db = require('../helpers/db');

const router = express.Router();

const stats = {};
const statCacheTime = 1000 * 60;
let lastStatRefresh = 0;
const getStats = () => {
    const now = Date.now();
    if (now - lastStatRefresh < statCacheTime && stats.users && stats.beatmaps && stats.passes) {
        return stats;
    }
    stats.users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    stats.beatmaps = db.prepare('SELECT COUNT(*) AS count FROM beatmaps').get().count;
    stats.passes = db.prepare('SELECT COUNT(*) AS count FROM user_passes').get().count;
    const secs = db.prepare(`SELECT SUM(duration_secs) AS secs FROM beatmaps `);
    lastStatRefresh = now;
    return stats;
};

router.get('/', (req, res) => {
    const stats = getStats();
    res.render('layout', {
        page: 'home',
        stats: {
            users: stats.users.toLocaleString(),
            beatmaps: stats.beatmaps.toLocaleString(),
            passes: stats.passes.toLocaleString()
        },
        me: req.me
    });
});

module.exports = router;