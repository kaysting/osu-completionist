const env = require('../helpers/env');
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
    const template = req.params.template;
    utils.log(`Rendering ${template} with params ${JSON.stringify(req.query)}`);
    const queryRaw = req.originalUrl.split('?')[1] || '';
    const url = `http://localhost:${env.WEBSERVER_PORT}/renders/${template}/html?${queryRaw}`;
    const buffer = await imageRenderer.urlToPng(url, req.query.width || undefined, req.query.height || undefined);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
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