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
    await updater.queueUserForImport(req.params.id);
    res.redirect(`/u/${req.params.id}`);
});

router.get('/:id/:category', ensureUserExists, (req, res) => {
    const user = req.user;
    const category = req.params.category.toLowerCase();
    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.redirect(`/u/${req.user.id}/osu-ranked`);
    }
    req.session.category = category;
    const mode = category.split('-')[0];
    const modeKey = utils.rulesetNameToKey(mode);
    const modeName = mode == 'global' ? 'Global' : utils.rulesetKeyToName(modeKey, true);
    // Get data
    const stats = dbHelpers.getUserCompletionStats(req.user.id, category);
    const yearly = dbHelpers.getUserYearlyCompletionStats(req.user.id, category);
    const timeRecentsAfter = Date.now() - (1000 * 60 * 60 * 24);
    const recentPasses = dbHelpers.getUserRecentPasses(req.user.id, category, 100, 0, timeRecentsAfter);
    const updateStatus = dbHelpers.getUserUpdateStatus(req.user.id);
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
    // If viewing our own profile, get user trends and recommended maps
    let recommended = null;
    let recommendedQuery = '';
    if (req.user.id === req.me?.id) {
        // Determine min and max recent star rating and ranked time
        let minStars, maxStars, minTime, maxTime = null;
        let passesToCheck = 20;
        let passesChecked = 0;
        let limit = 6;
        for (const pass of recentPasses) {
            if (passesChecked >= passesToCheck) break;
            const stars = pass.beatmap.stars;
            const timeRanked = pass.beatmap.beatmapset.time_ranked;
            minStars = minStars === undefined || stars < minStars ? stars : minStars;
            maxStars = maxStars === undefined || stars > maxStars ? stars : maxStars;
            minTime = minTime === undefined || timeRanked < minTime ? timeRanked : minTime;
            maxTime = maxTime === undefined || timeRanked > maxTime ? timeRanked : maxTime;
            passesChecked++;
        }
        // Put together a query to get recommended beatmaps if we got
        // recommended filters from recent passes
        if (passesChecked) {
            recommendedQuery = `stars > ${(minStars - 0.5).toFixed(1)} stars < ${(maxStars + 0.5).toFixed(1)} year >= ${new Date(minTime).getUTCFullYear()} year <= ${new Date(maxTime).getUTCFullYear()}`;
        }
        recommended = [];
        // Get as many maps as we can using the recommended query
        recommended.push(
            ...dbHelpers.searchBeatmaps(recommendedQuery, category, 'random', req.user.id, limit).beatmaps
        );
        // If we don't have enough, clear the recommended query and get remainder
        if (recommended.length < limit) {
            recommendedQuery = '';
            recommended.push(
                ...dbHelpers.searchBeatmaps('', category, 'random', req.user.id, limit - recommended.length).beatmaps
            );
        }
    }
    // Format times
    stats.timeToCompletion = utils.secsToDuration(stats?.time_remaining_secs || 0);
    stats.timeSpentCompleting = utils.secsToDuration(stats?.time_spent_secs || 0);
    // Get completion colors for each year
    for (const yearData of yearly) {
        yearData.color = utils.percentageToColor(yearData.percentage_completed / 100);
    }
    // Get relative timestamps for recent passes
    for (const pass of recentPasses) {
        pass.timeSincePass = utils.getRelativeTimestamp(pass.time_passed);
    }
    // Generate copyable text
    const categoryName = statCategories.getCategoryName(category);
    const statsText = [
        `${user.name}'s ${modeName.toLowerCase()} ${categoryName.toLowerCase()} completion stats:\n`
    ];
    for (const year of yearly) {
        const checkbox = year.count_completed === year.count_total ? '☑' : '☐';
        statsText.push(`${checkbox} ${year.year}: ${year.count_completed.toLocaleString()} / ${year.count_total.toLocaleString()} (${year.percentage_completed.toFixed(2)}%)`);
    }
    statsText.push(`\nTotal: ${stats.count_completed.toLocaleString()} / ${stats.count_total.toLocaleString()} (${stats.percentage_completed.toFixed(2)}%)`);
    // Render
    res.renderPage('profile', {
        title: req.user.name,
        meta: {
            title: `${req.user.name}'s ${modeName.toLowerCase()} completionist profile`,
            description: `${req.user.name} has passed ${stats.percentage_completed.toFixed(2)}% of all ${categoryName.toLowerCase()} beatmaps! Click to view more of their completionist stats.`,
            image: `/u/${user.id}/${category}/renders/main`
        },
        user: {
            ...user, stats, yearly, recentPasses, updateStatus, recommended, recommendedQuery
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
