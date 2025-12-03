const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('layout', {
        page: 'search',
        title: 'Search completionists',
        meta: {
            title: `Search completionists`,
            description: `Search tracked completionists by name to find their profiles.`
        },
        me: req.me
    });
});

module.exports = router;