const express = require('express');

const statCategories = require('../helpers/statCategories.js');
const { ensureUserExists } = require('../helpers/middleware.js');
const utils = require('../helpers/utils.js');
const updater = require('../helpers/updaterHelpers.js');
const dbHelpers = require('../helpers/dbHelpers.js');
const ejs = require('ejs');
const imageRenderer = require('../helpers/imageRenderer.js');

const router = express.Router();

const minMsSinceLastImport = 1000 * 60 * 60 * 24 * 7;

router.get('/:id', ensureUserExists, (req, res) => {
    const category = req?.session?.category || 'osu-ranked';
    res.redirect(`/u/${req.user.id}/${category}`);
});

router.get('/:id/update', async (req, res) => {
    if (!req.me || req.me.id != req.params.id) {
        return res.redirect(`/u/${req.params.id}`);
    }
    const minMsSinceLastImport = 1000 * 60 * 60 * 24 * 7;
    const msSinceLastImport = Date.now() - (req.me.last_import_time || 0);
    if (msSinceLastImport < minMsSinceLastImport) {
        return res.redirect(`/u/${req.params.id}`);
    }
    await updater.queueUserForImport(req.params.id, true);
    res.redirect(`/u/${req.params.id}`);
});

router.get('/:id/:category', ensureUserExists, (req, res) => {

    const user = req.user;
    const category = req.params.category.toLowerCase();
    const yearlyType = utils.ensureOneOf(req.query.yearly_type || req.session.yearlyType, ['maps', 'xp'], 'maps');
    req.session.yearlyType = yearlyType;

    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.redirect(`/u/${req.user.id}/osu-ranked`);
    }
    req.session.category = category;

    // Get data
    const stats = dbHelpers.getUserCompletionStats(req.user.id, category);
    const yearly = dbHelpers.getUserYearlyCompletionStats(req.user.id, category);
    const timeRecentsAfter = Date.now() - (1000 * 60 * 60 * 24);
    const recentPasses = dbHelpers.getUserRecentPasses(req.user.id, category, 100, 0, timeRecentsAfter);
    const updateStatus = dbHelpers.getUserUpdateStatus(req.user.id);
    const historyDaily = dbHelpers.getUserHistoricalCompletionStats(req.user.id, category, 'day');
    const historyMonthly = dbHelpers.getUserHistoricalCompletionStats(req.user.id, category, 'month');

    // Format update status
    if (updateStatus.updating) {
        updateStatus.details.time_remaining = utils.getRelativeTimestamp(
            (Date.now() + (updateStatus.details.time_remaining_secs * 1000)), undefined, false
        );
        updateStatus.details.position_ordinal = utils.ordinalSuffix(updateStatus.details.position);
    }
    updateStatus.canReimport = false;
    const msSinceLastImport = Date.now() - (req.user.last_import_time || 0);
    if (msSinceLastImport > minMsSinceLastImport) {
        updateStatus.canReimport = true;
    }
    const msUntilNextImport = minMsSinceLastImport - msSinceLastImport;
    updateStatus.timeUntilNextImport = utils.getRelativeTimestamp(
        Date.now() + msUntilNextImport, undefined, false
    );

    // Format durations
    stats.timeSpent = utils.secsToDuration(stats.secs_spent);
    stats.timeRemaining = utils.secsToDuration(stats.secs_remaining);
    stats.timeTotal = utils.secsToDuration(stats.secs_total);

    // If viewing our own profile, get user trends and recommended maps
    let recommended = null;
    let recommendedQuery = '';
    let recommendedLimit = 6;
    if (req.user.id === req.me?.id) {

        // Collect star ratings and ranked times from recent passes
        let passesToCheck = 25;
        let passesChecked = 0;
        const collectedStarRatings = [];
        const collectedRankTimes = [];
        for (const pass of recentPasses) {
            if (passesChecked >= passesToCheck) break;
            collectedStarRatings.push(pass.beatmap.stars);
            collectedRankTimes.push(pass.beatmap.beatmapset.time_ranked);
            passesChecked++;
        }

        // Calculate limits and put together a recommended query if we have recent passes
        if (passesChecked) {

            // Sort collected star ratings and ranked times
            collectedStarRatings.sort((a, b) => a - b);
            collectedRankTimes.sort((a, b) => a - b);

            // Discard top and bottom 20% to avoid outliers
            const discardCount = Math.floor(passesChecked * 0.2);
            const usableStars = collectedStarRatings.slice(discardCount, collectedStarRatings.length - discardCount);
            const usableTimes = collectedRankTimes.slice(discardCount, collectedRankTimes.length - discardCount);

            // Determine min and max recent star rating and ranked time
            let minStars = usableStars[0] || 0;
            let maxStars = usableStars[usableStars.length - 1] || 0;
            let minTime = usableTimes[0] || Date.now();
            let maxTime = usableTimes[usableTimes.length - 1] || Date.now();

            // Expand star rating range slightly
            const starPadding = 0.5;
            minStars = (Math.max(0, minStars - starPadding)).toFixed(1);
            maxStars = (maxStars + starPadding).toFixed(1);

            // Get years from ranked times
            const minYear = new Date(minTime).getUTCFullYear();
            const maxYear = new Date(maxTime).getUTCFullYear();

            // Build query
            recommendedQuery = `stars > ${minStars} stars < ${maxStars} year >= ${minYear} year <= ${maxYear}`;

        }

        // Get as many maps as we can using the recommended query
        recommended = [];
        recommended.push(
            ...dbHelpers.searchBeatmaps(recommendedQuery, category, 'random', req.user.id, recommendedLimit).beatmaps
        );

        // If we don't have enough, clear the recommended query and get remainder
        if (recommended.length < recommendedLimit) {
            recommendedQuery = '';
            recommended.push(
                ...dbHelpers.searchBeatmaps('', category, 'random', req.user.id, recommendedLimit - recommended.length).beatmaps
            );
        }

    }

    // Get completion colors for each year
    for (const yearData of yearly) {
        const completed = yearlyType == 'xp' ? yearData.xp : yearData.count_completed;
        const total = yearlyType == 'xp' ? yearData.xp_total : yearData.count_total;
        yearData.color = utils.percentageToColor(completed / total);
    }

    // Get relative timestamps for recent passes
    for (const pass of recentPasses) {
        pass.timeSincePass = utils.getRelativeTimestamp(pass.time_passed);
    }

    // Build copyable text
    const categoryName = statCategories.getCategoryName(category);
    const statsText = [
        `${user.name}'s ${categoryName.toLowerCase()} completion stats:\n`
    ];
    for (const year of yearly) {
        const checkbox = year.count_completed === year.count_total ? '☑' : '☐';
        statsText.push(`${checkbox} ${year.year}: ${year.count_completed.toLocaleString()} / ${year.count_total.toLocaleString()} (${year.map_percentage_completed.toFixed(2)}%)`);
    }
    statsText.push(`\nTotal: ${stats.count_completed.toLocaleString()} / ${stats.count_total.toLocaleString()} (${stats.percentage_completed.toFixed(2)}%)`);

    // Render
    res.renderPage('profile', {
        title: req.user.name,
        meta: {
            title: `${req.user.name}'s ${categoryName.toLowerCase()} completionist profile`,
            description: `${req.user.name} has passed ${stats.percentage_completed.toFixed(2)}% of beatmaps in this category. Click to view more of their completionist stats!`,
            image: `/u/${user.id}/${category}/renders/main?t=${user.last_pass_time}`
        },
        user: {
            ...user, stats, yearly, recentPasses, updateStatus, recommended, recommendedQuery, yearlyType, historyDaily, historyMonthly
        },
        copyable: statsText.join('\n'),
        category,
        category_navigation: statCategories.getCategoryNavPaths(`/u/${req.user.id}`, category),
    });

});

imageRenderer.warmup();

router.get('/:id/:category/renders/:type', ensureUserExists, async (req, res) => {
    const user = req.user;
    const userId = req.user.id;
    const category = req.params.category.toLowerCase();
    const type = req.params.type.toLowerCase();
    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.status(404).end();
    }
    // Check type
    let template;
    switch (type) {
        case 'main': template = 'profileMain'; break;
        default:
            return res.status(404).end();
    }
    // Render image
    const url = `http://localhost:${process.env.WEBSERVER_PORT}/renders/html/${template}?user_id=${userId}&category=${category}`;
    const startTime = Date.now();
    const buffer = await imageRenderer.urlToPng(url, undefined, undefined, 1);
    utils.log(`Rendered social image ${type} for ${user.name} in category ${category} in ${Date.now() - startTime}ms`);
    // Set headers and send image
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store'); // Don't cache
    res.send(buffer);
});

module.exports = router;
