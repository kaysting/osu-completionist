const env = require('#env');
const express = require('express');
const statCategories = require('#config/statCategories.js');
const { ensureUserExists } = require('../middleware.js');
const utils = require('#utils');
const updater = require('#api/write.js');
const apiRead = require('#api/read.js');

const router = express.Router();

router.get('/:id', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.user.primary_category}`);
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
    const year = req.query.year;
    const month = req.query.month;
    const sort = req.query.sort || 'date_asc';

    // Check category
    if (!statCategories.definitions.find(cat => cat.id === category)) {
        return res.redirect(`/u/${req.user.id}`);
    }

    // Update session variables
    req.session.category = category;
    req.session.yearlyType = yearlyType;

    const getUpdateStatus = () => {
        const updateStatus = apiRead.getUserUpdateStatus(req.user.id);
        // Format time remaining and position
        if (updateStatus.updating) {
            updateStatus.details.time_remaining = utils.getRelativeTimestamp(
                Date.now() + updateStatus.details.time_remaining_secs * 1000,
                undefined,
                false
            );
        }
        return updateStatus;
    };

    const getYearlyStats = () => {
        return apiRead.getUserYearlyCompletionStats(req.user.id, category);
    };

    const getYearDetails = () => {
        const years = apiRead.getUserYearlyCompletionStats(req.user.id, category);
        const stats = years.find(e => e.year == year);
        if (!stats?.year) return null;
        const query = [month ? `month=${year}-${month}` : `year=${year}`].join(' ');
        const maps =
            user.id === req.me?.id ? apiRead.searchBeatmaps(query, category, sort, user.id, 50).beatmaps : null;
        return {
            stats,
            query,
            maps,
            category,
            month,
            sort
        };
    };

    const getStats = () => {
        return apiRead.getUserCompletionStats(req.user.id, category);
    };

    const getRecommended = recentPasses => {
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
            minStars = Math.max(0, minStars - starPadding).toFixed(1);
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
            ...apiRead.searchBeatmaps(recommendedQuery, category, 'random', req.user.id, recommendedLimit).beatmaps
        );

        // If we don't have enough, clear the recommended query and get remainder
        if (recommended.length < recommendedLimit) {
            recommendedQuery = '';
            recommended.push(
                ...apiRead.searchBeatmaps('', category, 'random', req.user.id, recommendedLimit - recommended.length)
                    .beatmaps
            );
        }
        return { recommended, recommendedQuery };
    };

    const getRecentPasses = () => {
        const timeRecentsAfter = Date.now() - 1000 * 60 * 60 * 24;
        const recentPasses = apiRead.getUserRecentPasses(req.user.id, category, 100, 0, timeRecentsAfter);
        // Get relative timestamps for recent passes
        for (const pass of recentPasses) {
            pass.timeSincePass = utils.getRelativeTimestamp(pass.time_passed);
        }
        return recentPasses;
    };

    const getShareData = (stats, yearly) => {
        const data = {};
        const categoryName = statCategories.getCategoryName(category);
        const statsText = [`${user.name}'s ${categoryName.toLowerCase()} completion stats:\n`];
        for (const year of yearly) {
            const checkbox = year.count_completed === year.count_total ? '☑' : '☐';
            statsText.push(
                `${checkbox} ${year.year}: ${utils.formatNumber(year.count_completed)} / ${utils.formatNumber(year.count_total)} (${utils.formatNumber(year.map_percentage_completed, 2)}%)`
            );
        }
        statsText.push(
            `\nTotal: ${utils.formatNumber(stats.count_completed)} / ${utils.formatNumber(stats.count_total)} (${utils.formatNumber(stats.percentage_completed, 2)}%)`
        );
        data.plainText = statsText.join('\n');
        data.profileUrl = `${req.protocol}://${req.get('host')}/u/${user.id}/${category}`;
        const getImageUrl = (template, params) => {
            return `${req.protocol}://${req.get('host')}/renders/${template}?${params.toString()}`;
        };
        const getHtmlUrl = (template, params) => {
            return `${req.protocol}://${req.get('host')}/renders/${template}/html?${params.toString()}`;
        };
        const getBbcode = template => {
            const imageUrl = getImageUrl(template, renderParams);
            return `[url=${data.profileUrl}][img]${imageUrl}[/img][/url]`;
        };
        const renderParams = new URLSearchParams({
            user_id: user.id,
            category: category
        });
        if (req.query.share_base_hue) {
            renderParams.set('base_hue', req.query.share_base_hue);
        }
        if (req.query.share_base_sat) {
            renderParams.set('base_sat', req.query.share_base_sat);
        }
        data.renders = {};
        data.renders.basics = {
            name: `Category completion basics`,
            description: `Perfect for your osu me! section, this image embed shows your primary completion stats (and totals) for the selected category.`,
            urls: {
                html: getHtmlUrl('profile-basics', renderParams),
                image: getImageUrl('profile-basics', renderParams)
            },
            embeds: {
                bbcode: getBbcode('profile-basics')
            }
        };
        data.renders.yearly = {
            name: `Category completion by year`,
            description: `Another excellent osu! me! addition, this image embed shows your per-year completion stats for the selected category.`,
            urls: {
                html: getHtmlUrl('profile-yearly', renderParams),
                image: getImageUrl('profile-yearly', renderParams)
            },
            embeds: {
                bbcode: getBbcode('profile-yearly')
            }
        };
        return data;
    };

    const getDailyHistory = () => {
        return apiRead.getUserHistoricalCompletionStats(req.user.id, category, 'day');
    };

    const getMonthlyHistory = () => {
        return apiRead.getUserHistoricalCompletionStats(req.user.id, category, 'month');
    };

    // Render import progress partial if requested
    if (selectors.match(/#importProgressCard/)) {
        return res.renderPartial('profile/cardImportProgress', { updateStatus: getUpdateStatus() });
    }

    // Render yearly stats partial if requested
    if (selectors.match(/#yearlyStats/)) {
        return res.renderPartial('profile/yearlyStats', { yearly: getYearlyStats(), yearlyType });
    }

    // Render year details if requested
    if (selectors.match(/#yearlyPopupBody/)) {
        const yearDetails = getYearDetails();
        if (!yearDetails) return res.end('');
        return res.renderPartial('profile/yearlyPopupBody', yearDetails);
    }

    // Render share popup body if requested
    if (selectors.match(/(#sharePopupBody|#sharePopupRenderList)/)) {
        const share = getShareData(getStats(), getYearlyStats());
        return res.renderPartial('profile/sharePopupBody', { share, query: req.query });
    }

    // Render play next partial if requested
    if (selectors.match(/#playNext/)) {
        const recentPasses = getRecentPasses();
        const { recommended, recommendedQuery } = getRecommended(recentPasses);
        return res.renderPartial('profile/cardPlayNext', {
            recommended,
            recommendedQuery,
            category
        });
    }

    // Render full page
    const stats = getStats();
    const yearly = getYearlyStats();
    const recentPasses = getRecentPasses();
    const { recommended, recommendedQuery } = getRecommended(recentPasses);
    const updateStatus = getUpdateStatus();
    const historyDaily = getDailyHistory();
    const historyMonthly = getMonthlyHistory();
    const categoryName = statCategories.getCategoryName(category);
    const title = `${req.user.name}'s ${categoryName} completionist profile`;
    res.renderPage('profile', {
        title,
        meta: {
            title,
            description: `${req.user.name} has passed ${utils.formatNumber(stats.percentage_completed, 2)}% of beatmaps in this category. Click to view more of their completionist stats!`,
            image: `${env.BASE_URL}/renders/profile-meta?category=${category}&user_id=${req.user.id}`
        },
        topbar: {
            icon: 'person',
            title: `${req.user.name} - ${categoryName}`
        },
        user: {
            ...user,
            isMe: req.me?.id === req.user.id
        },
        stats,
        yearly,
        recentPasses,
        updateStatus,
        recommended,
        recommendedQuery,
        yearlyType,
        historyDaily,
        historyMonthly,
        category,
        category_navigation: statCategories.getCategoryNavPaths(`/u/${req.user.id}`, category)
    });
});

module.exports = router;
