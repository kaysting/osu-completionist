const env = require('../helpers/env');
const path = require('path');
const fs = require('fs');
const express = require('express');
const dbHelpers = require('../helpers/dbHelpers');
const statsCategories = require('../helpers/statCategories');
const utils = require('../helpers/utils');
const imageRenderer = require('../helpers/imageRenderer');

const renders = {
    'profile-meta': {
        params: ['category', 'user_id']
    }
};

const router = express.Router();

imageRenderer.warmup();

router.get('/:template', async (req, res) => {
    // Piece together render HTML URL
    const template = req.params.template;
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
    if (!fs.existsSync(cachePath) || (Date.now() - fs.statSync(cachePath).mtimeMs) > cacheLifetimeMs) {
        utils.log(`Rendering ${template} with params ${JSON.stringify(req.query)}`);
        const buffer = await imageRenderer.urlToPng(url, req.query.width || undefined, req.query.height || undefined);
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
    for (const param of requiredParams) {
        if (req.query[param] === undefined) return sendInvalid();
    }
    const data = {};
    if (requiredParams.includes('user_id')) {
        data.user = dbHelpers.getUserProfile(req.query.user_id);
        data.stats = dbHelpers.getUserCompletionStats(req.query.user_id, req.query.category);
        data.percentageColor = utils.percentageToColor(data.stats.percentage_completed / 100);
    }
    if (requiredParams.includes('category')) {
        data.categoryName = statsCategories.getCategoryName(req.query.category);
    }
    res.render(`pages/renders/${template}`, data);
});

module.exports = router;