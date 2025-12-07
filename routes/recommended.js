const express = require('express');
const { getUserRecommendedMaps } = require('../helpers/dbHelpers');
const utils = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
    if (!req.me) {
        return res.redirect('/auth/login');
    }
    const mode = req.query.mode || 'osu';
    const modeKey = utils.rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect('/recommended?mode=osu');
    }
    const includeConverts = req.query.converts === 'true';
    const includeLoved = req.query.loved === 'true';
    const minStars = parseFloat(req.query.min_stars) || null;
    const maxStars = parseFloat(req.query.max_stars) || null;
    const year = parseInt(req.query.year) || null;
    const sort = req.query.sort || null;
    const minRankedTime = year ? new Date(`${year}-01-01`).getTime() : null;
    const maxRankedTime = year ? new Date(`${year + 1}-01-01`).getTime() : null;
    const page = parseInt(req.query.p) || 1;
    const limit = 100;
    const offset = (page - 1) * limit;
    const results = getUserRecommendedMaps(
        req.me.id, modeKey, includeLoved, includeConverts,
        limit, offset, sort, minStars, maxStars, minRankedTime, maxRankedTime
    );
    results.min_max.time_ranked.min_year = new Date(results.min_max.time_ranked.min).getFullYear();
    results.min_max.time_ranked.max_year = new Date(results.min_max.time_ranked.max).getFullYear();
    res.render('layout', {
        title: 'Play next',
        page: 'recommended',
        meta: {
            title: `Find beatmaps to complete next`,
            description: `Filter by mode, ranked date, and star rating to narrow down what you feel like playing and get results that you haven't passed yet.`
        },
        settings: {
            modeKey, mode, includeLoved, includeConverts,
            minStars, maxStars, year, sort
        },
        results,
        me: req.me
    });
});

module.exports = router;