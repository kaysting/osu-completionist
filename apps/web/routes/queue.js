const express = require('express');
const { getQueuedUsers } = require('#api/read.js');

const router = express.Router();

router.get('/', (req, res) => {
    const results = getQueuedUsers();
    res.render('layout', {
        page: 'queue',
        title: 'Import queue',
        meta: {
            title: 'Import queue',
            description: `${results.in_progress.length} users are currently being imported and ${results.waiting.length} users are waiting in the queue.`
        },
        results,
        me: req.me
    });
});

module.exports = router;
