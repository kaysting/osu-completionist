const crypto = require('crypto');
const express = require('express');
const env = require('../helpers/env');
const utils = require('../helpers/utils');
const cp = require('child_process');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect('https://github.com/kaysting/osu-completionist');
});

const verifySignature = (req) => {
    const signature = req.headers['x-hub-signature-256'];
    const secret = env.GITHUB_WEBHOOK_SECRET;

    if (!signature || !secret || !req.rawBody) {
        return false;
    }

    // GitHub signature format: "sha256=...."
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest)
    );
};

router.post('/webhook', async (req, res) => {

    // Validate signature
    if (!verifySignature(req)) {
        utils.log(`Invalid GitHub webhook signature`);
        return res.status(403).end();
    }

    // Satisfy GitHub with a response right away
    res.status(200).end();

    const eventType = req.headers['x-github-event'];
    utils.log(`Received GitHub webhook event: ${eventType}`);
    switch (eventType) {
        case 'push': {

            // Log commits to Discord
            for (const commit of req.body.commits) {
                const files = [
                    ...commit.added.map(f => ({ path: f, type: 'a' })),
                    ...commit.removed.map(f => ({ path: f, type: 'r' })),
                    ...commit.modified.map(f => ({ path: f, type: 'm' }))
                ];
                await utils.sendDiscordMessage(env.GITHUB_FEED_DISCORD_CHANNEL_ID, {
                    embeds: [{
                        author: {
                            name: `${req.body.sender.login} pushed a commit to ${req.body.repository.name}`,
                            url: req.body.repository.html_url,
                            icon_url: req.body.sender.avatar_url
                        },
                        title: commit.message.split('\n')[0],
                        description: commit.message.split('\n').slice(1).join('\n'),
                        fields: [{
                            name: 'Changes',
                            value: files.map(f => `-# - ${{ a: '🟢', r: '🔴', m: '🟡' }[f.type]} \`${f.path}\``).join('\n') || 'No files changed'
                        }],
                        url: commit.url,
                        timestamp: new Date(commit.timestamp).toISOString(),
                        color: 0xffffff
                    }]
                });
            }

            // Pull code from GitHub
            utils.log(`Pulling latest code from GitHub...`);
            const output = cp.execSync(`git pull`);
            utils.log(output.toString());

            // Gracefully restart server
            utils.log(`Restarting server to apply updates...`);
            process.kill(process.pid, 'SIGTERM');

            break;
        }
    }

});

module.exports = router;