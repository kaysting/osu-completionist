const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('layout', {
        title: 'Search completionists',
        page: 'search'
    });
});

module.exports = router;