const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('layout', {
        title: 'Play next',
        page: 'recommended',
        meta: {
            title: `Find what beatmaps you need to complete next`,
            description: `Filter by mode, year, and star rating to narrow down what you feel like playing and get results that you haven't passed yet.`
        },
        me: req.me
    });
});

module.exports = router;