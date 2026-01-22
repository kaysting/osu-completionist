const express = require('express');
const db = require('#db');
const dbHelpers = require('#api/read.js');

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
    const totalStats = db.prepare(
        `SELECT
            SUM(seconds) AS secs,
            SUM(count) AS passes
        FROM user_category_stats
        WHERE category = 'global-ranked-loved-converts' AND user_id > 0`
    ).get();
    stats.xp = dbHelpers.secsToXp(totalStats.secs);
    stats.passes = totalStats.passes;
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
            passes: stats.passes.toLocaleString(),
            xp: stats.xp.toLocaleString()
        },
        me: req.me
    });
});

module.exports = router;