const express = require('express');
const { searchBeatmaps } = require('../helpers/dbHelpers');
const utils = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect(`/recommended/osu/ranked`);
});

router.get('/:mode', (req, res) => {
    res.redirect(`/recommended/${req.params.mode}/ranked`);
});

router.get('/:mode/:includes', (req, res) => {
    const mode = req.params.mode;
    const includes = req.params.includes.split('-');
    const includeConverts = includes.includes('converts') ? 1 : 0;
    const includeLoved = includes.includes('loved') ? 1 : 0;
    const query = req.query.q?.trim() || '';
    const sort = req.query.sort || '';
    const page = parseInt(req.query.p) || 1;
    const limit = 96;
    const offset = (page - 1) * limit;
    // Make sure mode is valid
    const modeKey = utils.rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect('/recommended/osu/ranked');
    }
    // Add mode to query
    const queryFull = `mode=${mode} ${query}`;
    // Get results
    const results = searchBeatmaps(
        queryFull, includeLoved, includeConverts,
        sort, req.me?.id, limit, offset
    );
    // Define sort types
    const sortTypes = [
        { id: 'stars_asc', name: 'Easiest to hardest' },
        { id: 'stars_desc', name: 'Hardest to easiest' },
        { id: 'length_asc', name: 'Shortest to longest' },
        { id: 'length_desc', name: 'Longest to shortest' },
        { id: 'date_asc', name: 'Oldest to newest' },
        { id: 'date_desc', name: 'Newest to oldest' }
    ];
    sortTypes.unshift({ id: '', name: `Auto (${results.query.text ? 'Relevant' : 'Random'})` });
    // Define placeholder list and pick one
    const placeholders = [
        `Try "stars>5.5 stars<7" to get maps in your comfort zone`,
        `Try "length>240 camellia" to get long Camellia maps`,
        `Try "ar>9.5 cs<4" to find high AR low CS maps`,
        `Try "year=2007" to get maps from 2007`,
        `Try "keys=4" to find just 4K maps (with mania selected)`,
        `Try "ar=10" to find high AR maps`
    ];
    const placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];
    // Render
    res.render('layout', {
        title: 'Play next',
        page: 'recommended',
        meta: {
            title: `Find beatmaps to complete next`,
            description: `Complete faster by using advanced filters and sorting to get the perfect list of maps to play next.`
        },
        settings: {
            modeKey, mode, includes, basePath: '/recommended', query, sort, sortTypes, page
        },
        placeholder,
        results,
        me: req.me
    });
});

module.exports = router;