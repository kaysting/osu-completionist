const express = require('express');
const { getQueuedUsers } = require('../helpers/dbHelpers');

const router = express.Router();

router.get('/', (req, res) => {
    const results = getQueuedUsers();
    res.render('layout', {
        page: 'queue',
        title: 'Queue',
        meta: {
            title: 'User update queue',
            description: `${results.in_progress.length} users are currently being updated and ${results.waiting.length} users are waiting in the queue.`
        },
        results,
        me: req.me
    });
});

module.exports = router;