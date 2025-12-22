const express = require('express');
const db = require('../db');

const { ensureUserExists } = require('../middleware.js');
const utils = require('../utils.js');
const { rulesetNameToKey, rulesetKeyToName } = utils;
const updater = require('../helpers/updaterHelpers.js');
const dbHelpers = require('../helpers/dbHelpers.js');

const router = express.Router();

const minMsSinceLastImport = 1000 * 60 * 60 * 24 * 7;

router.get('/:id', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/osu/ranked`);
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

router.get('/:id/:mode', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.params.mode}/ranked`);
});

router.get('/:id/:mode/:includes', ensureUserExists, (req, res) => {
    const user = req.user;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked'];
    const includeConverts = includes.includes('converts') ? 1 : 0;
    const includeLoved = includes.includes('loved') ? 1 : 0;
    // Ensure mode is valid
    const modeKey = rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect(`/u/${user.id}/osu/ranked`);
    }
    // Get data
    const stats = dbHelpers.getUserCompletionStats(req.user.id, modeKey, includeLoved, includeConverts);
    const yearly = dbHelpers.getUserYearlyCompletionStats(req.user.id, modeKey, includeLoved, includeConverts);
    const recentPasses = dbHelpers.getUserRecentPasses(req.user.id, modeKey, includeLoved, includeConverts, 100, 0);
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
    let recommendedQuery = null;
    if (req.me && req.user.id === req.me.id) {
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
        if (passesChecked) {
            // Get recommended maps
            recommendedQuery = `stars > ${(minStars - 0.5).toFixed(1)} stars < ${(maxStars + 0.5).toFixed(1)} year >= ${new Date(minTime).getUTCFullYear()} year <= ${new Date(maxTime).getUTCFullYear()}`;
            recommended = dbHelpers.searchBeatmaps(`${recommendedQuery} mode=${mode}`, includeLoved, includeConverts, 'random', req.user.id, limit);
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
    const modeName = rulesetKeyToName(modeKey, true);
    const statsText = [
        `${user.name}'s ${modeName} ${includeLoved ? 'ranked and loved' : 'ranked only'} (${includeConverts ? 'with converts' : 'no converts'}) completion stats:\n`
    ];
    for (const year of yearly) {
        const checkbox = year.count_completed === year.count_total ? '☑' : '☐';
        statsText.push(`${checkbox} ${year.year}: ${year.count_completed.toLocaleString()} / ${year.count_total.toLocaleString()} (${year.percentage_completed.toFixed(2)}%)`);
    }
    statsText.push(`\nTotal: ${stats.count_completed.toLocaleString()} / ${stats.count_total.toLocaleString()} (${stats.percentage_completed.toFixed(2)}%)`);
    // Render
    const includesString = `${includeLoved ? 'ranked and loved' : 'ranked only'}, ${includeConverts ? 'with converts' : 'no converts'}`;
    res.render('layout', {
        page: 'profile',
        title: req.user.name,
        meta: {
            title: `${req.user.name}'s ${modeName} completionist profile`,
            description: `${req.user.name} has passed ${stats.percentage_completed.toFixed(2)}% of all ${modeName} beatmaps (${includesString})! Click to view more of their completionist stats.`,
            thumbnail: user.avatar_url
        },
        user: {
            ...user, stats, yearly, recentPasses, updateStatus, recommended, recommendedQuery
        },
        copyable: statsText.join('\n'),
        settings: {
            modeKey, mode, includes, basePath: `/u/${user.id}`
        },
        me: req.me
    });
});

module.exports = router;