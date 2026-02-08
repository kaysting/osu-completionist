const express = require('express');
const { getQueuedUsers, getAllRecentPasses, getRecentActivityLeaderboard, getAnalyticsData } = require('#api/read.js');

const getOneDayAgo = () => Date.now() - 1000 * 60 * 60 * 24;
const getOneMonthAgo = () => Date.now() - 1000 * 60 * 60 * 24 * 30;
const CATEGORY = 'all-ranked-loved-specifics-converts';

const router = express.Router();

let leaderboardDaily = [];
let leaderboardMonthly = [];
let lastCacheUpdate = 0;

const cacheData = () => {
    leaderboardDaily = getRecentActivityLeaderboard(CATEGORY, 50, getOneDayAgo());
    leaderboardMonthly = getRecentActivityLeaderboard(CATEGORY, 50, getOneMonthAgo());
    lastCacheUpdate = Date.now();
};
cacheData();
setInterval(cacheData, 1000 * 60 * 3);

router.get('/', (req, res) => {
    // Define time thresholds

    // Get data
    const queue = getQueuedUsers();
    const passes = getAllRecentPasses(CATEGORY, 100, 0, getOneDayAgo());
    const analytics = getAnalyticsData(90);

    // Render
    res.render('layout', {
        page: 'activity',
        title: 'Activity & Queue',
        meta: {
            title: 'osu!complete Activity and Import Queue',
            description: `${queue.in_progress.length} users are currently being imported and ${queue.waiting.length} users are waiting in the queue.`
        },
        topbar: {
            icon: 'autorenew',
            title: 'Activity & Queue'
        },
        queue,
        passes,
        leaderboardDaily,
        leaderboardMonthly,
        analytics,
        lastCacheUpdate,
        me: req.me
    });
});

module.exports = router;
