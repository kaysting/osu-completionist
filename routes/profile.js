const express = require('express');
const statCategories = require('../helpers/statCategories.js');
const { ensureUserExists } = require('../helpers/middleware.js');
const utils = require('../helpers/utils.js');
const updater = require('../helpers/updaterHelpers.js');
const dbHelpers = require('../helpers/dbHelpers.js');

const router = express.Router();

router.get('/:id', ensureUserExists, (req, res) => {
    const category = req?.session?.category || 'osu-ranked';
    res.redirect(`/u/${req.user.id}/${category}`);
});

router.get('/:id/reimport', async (req, res) => {
    if (!req.me || req.me.id != req.params.id) {
        return res.redirect(`/u/${req.params.id}`);
    }
    const hasFullImport = req.me.has_full_import;
    if (hasFullImport) {
        return res.redirect(`/u/${req.params.id}`);
    }
    await updater.queueUserForImport(req.params.id, true);
    res.redirect(`/u/${req.params.id}`);
});

router.get('/:id/:category', ensureUserExists, (req, res) => {

    const user = req.user;
    const category = req.params.category.toLowerCase();
    const yearlyType = utils.ensureOneOf(req.query.yearly_type || req.session.yearlyType, ['maps', 'xp'], 'maps');
    const selectors = req.headers['x-reload-selectors'] || '';

    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.redirect(`/u/${req.user.id}/osu-ranked`);
    }

    // Update session variables
    req.session.category = category;
    req.session.yearlyType = yearlyType;

    const getUpdateStatus = () => {
        const updateStatus = dbHelpers.getUserUpdateStatus(req.user.id);
        // Format time remaining and position
        if (updateStatus.updating) {
            updateStatus.details.time_remaining = utils.getRelativeTimestamp(
                (Date.now() + (updateStatus.details.time_remaining_secs * 1000)), undefined, false
            );
            updateStatus.details.position_ordinal = utils.ordinalSuffix(updateStatus.details.position);
        }
        return updateStatus;
    };

    const getYearlyStats = () => {
        return dbHelpers.getUserYearlyCompletionStats(req.user.id, category);
    };

    const getStats = () => {
        const stats = dbHelpers.getUserCompletionStats(req.user.id, category);
        // Format durations
        stats.timeSpent = utils.secsToDuration(stats.secs_spent);
        stats.timeRemaining = utils.secsToDuration(stats.secs_remaining);
        stats.timeTotal = utils.secsToDuration(stats.secs_total);
        return stats;
    };

    const getRecommended = (recentPasses) => {
        // If not viewing our own profile or if basic stats are requested, return null
        if (req.user.id !== req.me?.id || selectors.match(/#basicStats/)) {
            return { recommended: null, recommendedQuery: null };
        }

        let recommended = null;
        let recommendedQuery = '';
        let recommendedLimit = 6;

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
        return { recommended, recommendedQuery };
    };

    const getRecentPasses = () => {
        const timeRecentsAfter = Date.now() - (1000 * 60 * 60 * 24);
        const recentPasses = dbHelpers.getUserRecentPasses(req.user.id, category, 100, 0, timeRecentsAfter);
        // Get relative timestamps for recent passes
        for (const pass of recentPasses) {
            pass.timeSincePass = utils.getRelativeTimestamp(pass.time_passed);
        }
        return recentPasses;
    };

    const getShareData = (stats, yearly) => {
        const data = {};
        const categoryName = statCategories.getCategoryName(category);
        const statsText = [
            `${user.name}'s ${categoryName.toLowerCase()} completion stats:\n`
        ];
        for (const year of yearly) {
            const checkbox = year.count_completed === year.count_total ? '☑' : '☐';
            statsText.push(`${checkbox} ${year.year}: ${year.count_completed.toLocaleString()} / ${year.count_total.toLocaleString()} (${year.map_percentage_completed.toFixed(2)}%)`);
        }
        statsText.push(`\nTotal: ${stats.count_completed.toLocaleString()} / ${stats.count_total.toLocaleString()} (${stats.percentage_completed.toFixed(2)}%)`);
        data.plainText = statsText.join('\n');
        data.profileUrl = `${req.protocol}://${req.get('host')}/u/${user.id}/${category}`;
        const getImageUrl = (template, params) => {
            return `${req.protocol}://${req.get('host')}/renders/${template}?${params.toString()}`;
        };
        const getHtmlUrl = (template, params) => {
            return `${req.protocol}://${req.get('host')}/renders/${template}/html?${params.toString()}`;
        };
        const getBbcode = (template) => {
            const imageUrl = getImageUrl(template, yearlyParams);
            return `[url=${data.profileUrl}][img]${imageUrl}[/img][/url]`;
        };
        const yearlyParams = new URLSearchParams({
            user_id: user.id,
            category: category
        });
        if (req.query.share_base_hue) {
            yearlyParams.set('base_hue', req.query.share_base_hue);
        }
        if (req.query.share_base_sat) {
            yearlyParams.set('base_sat', req.query.share_base_sat);
        }
        data.renders = {};
        data.renders.yearly = {
            name: `Category completion by year`,
            description: `Perfect for your osu me! section, this image embed dynamically updates to show your per-year completion stats for the selected category.`,
            urls: {
                html: getHtmlUrl('profile-yearly', yearlyParams),
                image: getImageUrl('profile-yearly', yearlyParams)
            },
            embeds: {
                bbcode: getBbcode('profile-yearly')
            }
        };
        return data;
    };

    const getDailyHistory = () => {
        return dbHelpers.getUserHistoricalCompletionStats(req.user.id, category, 'day');
    };

    const getMonthlyHistory = () => {
        return dbHelpers.getUserHistoricalCompletionStats(req.user.id, category, 'month');
    };

    // Render import progress partial if requested
    if (selectors.match(/#importProgressCard/)) {
        return res.renderPartial('profile/cardImportProgress', { updateStatus: getUpdateStatus() });
    }

    // Render yearly stats partial if requested
    if (selectors.match(/#yearlyStats/)) {
        return res.renderPartial('profile/yearlyStats', { yearly: getYearlyStats(), yearlyType });
    }

    // Render play next partial if requested
    if (selectors.match(/#playNext/)) {
        const recentPasses = getRecentPasses();
        const { recommended, recommendedQuery } = getRecommended(recentPasses);
        console.log(`playnext`);
        return res.renderPartial('profile/cardPlayNext', { recommended, recommendedQuery, category });
    }

    // Render full page
    const stats = getStats();
    const yearly = getYearlyStats();
    const recentPasses = getRecentPasses();
    const { recommended, recommendedQuery } = getRecommended(recentPasses);
    const updateStatus = getUpdateStatus();
    const historyDaily = getDailyHistory();
    const historyMonthly = getMonthlyHistory();
    const share = getShareData(stats, yearly);
    const categoryName = statCategories.getCategoryName(category);
    res.renderPage('profile', {
        title: req.user.name,
        meta: {
            title: `${req.user.name}'s ${categoryName.toLowerCase()} completionist profile`,
            description: `${req.user.name} has passed ${stats.percentage_completed.toFixed(2)}% of beatmaps in this category. Click to view more of their completionist stats!`,
            image: `/renders/profile-meta?category=${category}&user_id=${req.user.id}`
        },
        user: {
            ...user,
            isMe: req.me?.id === req.user.id
        },
        stats, yearly, recentPasses, updateStatus,
        recommended, recommendedQuery, yearlyType, historyDaily, historyMonthly,
        share,
        category,
        category_navigation: statCategories.getCategoryNavPaths(`/u/${req.user.id}`, category),
    });

});

module.exports = router;