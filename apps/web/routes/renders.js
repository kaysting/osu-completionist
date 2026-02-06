const env = require('#env');
const path = require('path');
const fs = require('fs');
const express = require('express');
const dbHelpers = require('#api/read.js');
const statCategories = require('#config/statCategories.js');
const utils = require('#utils');
const imageRenderer = require('#lib/ImageRenderer.js');

const renders = {
    'profile-meta': {
        params: ['category', 'user_id'],
        size: { width: 600, height: 315 }
    },
    'leaderboard-meta': {
        params: ['category'],
        data: ['leaderboard'],
        size: { width: 600, height: 315 }
    },
    'profile-yearly': {
        params: ['category', 'user_id'],
        data: ['yearly'],
        size: { width: 900, height: 'auto' }
    },
    'profile-basics': {
        params: ['category', 'user_id'],
        data: ['stats'],
        size: { width: 900, height: 'auto' }
    }
};

const router = express.Router();

imageRenderer.warmup();

router.get('/:template', async (req, res) => {
    // Piece together render HTML URL
    const template = req.params.template;
    const templateInfo = renders[template];
    if (!templateInfo) {
        return res.status(404).end();
    }
    const queryRaw = req.originalUrl.split('?')[1] || '';
    const url = `http://localhost:${env.WEBSERVER_PORT}/renders/${template}/html?${queryRaw}`;
    // Create cache dir if it doesn't exist
    const cacheDir = path.join(__dirname, '../cache/renders');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    // Check cache for render and create if missing/stale
    const hash = utils.sha256(url);
    const cachePath = path.join(cacheDir, `${hash}.png`);
    const cacheLifetimeMs = 1000 * 60 * 15;
    const force = req.query.force === 'true';
    if (force || !fs.existsSync(cachePath) || Date.now() - fs.statSync(cachePath).mtimeMs > cacheLifetimeMs) {
        utils.log(`Rendering ${template} with params ${JSON.stringify(req.query)}`);
        const buffer = await imageRenderer.urlToPng(url, templateInfo.size.width, templateInfo.size.height);
        fs.writeFileSync(cachePath, buffer);
    }
    // Set attachment name
    res.setHeader('Content-Disposition', `inline; filename="${template}.png"`);
    // Send image
    res.sendFile(cachePath);
});

router.get('/:template/html', async (req, res) => {
    const template = req.params.template;
    const sendInvalid = () => res.status(400).end();
    if (!renders[template]) return sendInvalid();
    const templateInfo = renders[template];
    const requiredParams = templateInfo.params || [];
    const requiredData = templateInfo.data || [];
    for (const param of requiredParams) {
        if (req.query[param] === undefined) return sendInvalid();
    }
    const data = {
        query: req.query
    };
    const category = statCategories.validateCategoryId(req.query?.category) || '';
    if (requiredParams.includes('user_id')) {
        data.user = dbHelpers.getUserProfile(req.query.user_id);
        data.stats = dbHelpers.getUserCompletionStats(req.query.user_id, category);
        data.percentageColor = utils.percentageToColor(data.stats.percentage_completed / 100);
        if (requiredData.includes('yearly')) {
            data.yearly = dbHelpers.getUserYearlyCompletionStats(req.query.user_id, category);
        }
        if (requiredData.includes('stats')) {
            data.stats = dbHelpers.getUserCompletionStats(req.query.user_id, category);
        }
    }
    if (requiredParams.includes('category')) {
        data.categoryName = statCategories.getCategoryName(category);
    }
    if (requiredData.includes('leaderboard')) {
        data.leaderboard = dbHelpers.getLeaderboard(category, 10);
    }
    res.render(`pages/renders/${template}`, data);
});

module.exports = router;
