const express = require('express');
const env = require('../helpers/env');
const utils = require('../helpers/utils');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect('https://github.com/kaysting/osu-completionist');
});

router.post('/webhook', (req, res) => {
    res.status(200).end();
    const secret = env.GITHUB_WEBHOOK_SECRET;
    const eventType = req.headers['x-github-event'];
    const signature = req.headers['x-hub-signature-256'].split('=')[1];
    const body = req.body;
    console.log(JSON.stringify(body, null, 2));
    switch (eventType) {
        case 'ping': {
            utils.log(`Received GitHub webhook ping event`);
            break;
        }
    }
});

module.exports = router;