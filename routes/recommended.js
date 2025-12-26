const express = require('express');
const { searchBeatmaps } = require('../helpers/dbHelpers');
const utils = require('../helpers/utils');
const marked = require('marked');
const fs = require('fs');
const statCatDefs = require('../statCategoryDefinitions');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect(`/recommended/osu-ranked`);
});

router.get('/:category', (req, res) => {
    const category = req.params.category.toLowerCase();
    const query = req.query.q?.trim() || '';
    const sort = req.query.sort || '';
    const page = parseInt(req.query.p) || 1;
    const limit = 96;
    const offset = (page - 1) * limit;
    // Check category
    if (!statCatDefs.find(cat => cat.id === category)) {
        return res.redirect('/recommended/osu-ranked');
    }
    // Get results
    const results = searchBeatmaps(
        query, category,
        sort, req.me?.id, limit, offset
    );
    // Define sort types
    const sortTypes = [
        { id: 'date_asc', name: 'Oldest to newest' },
        { id: 'date_desc', name: 'Newest to oldest' },
        { id: 'stars_asc', name: 'Easiest to hardest' },
        { id: 'stars_desc', name: 'Hardest to easiest' },
        { id: 'length_asc', name: 'Shortest to longest' },
        { id: 'length_desc', name: 'Longest to shortest' },
        { id: 'bpm_asc', name: 'Slowest to fastest' },
        { id: 'bpm_desc', name: 'Fastest to slowest' }
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
        category,
        category_navigation: utils.getCatNavPaths(`/recommended`, category),
        settings: {
            sort, sortTypes
        },
        placeholder,
        results,
        filterHelpHtml: marked.parse(fs.readFileSync('./views/markdown/filterHelp.md', 'utf-8')),
        me: req.me
    });
});

module.exports = router;