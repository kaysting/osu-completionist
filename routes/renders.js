const express = require('express');
const dbHelpers = require('../helpers/dbHelpers');
const statsCategories = require('../helpers/statCategories');
const utils = require('../helpers/utils');

const router = express.Router();

router.get('/html/:template', (req, res) => {
    const template = req.params.template;
    const category = req.query?.category;
    const userId = req.query?.user_id;
    const data = {};
    const giveUp = () => res.status(400).end();
    switch (template) {
        case 'profileMain':
            if (!category || !userId) return giveUp();
            data.stats = dbHelpers.getUserCompletionStats(userId, category);
            data.user = dbHelpers.getUserProfile(userId);
            data.categoryName = statsCategories.getCategoryName(category);
            data.percentageColor = utils.percentageToColor(data.stats.percentage_completed / 100);
            data.hours = Math.round(data.stats.time_spent_secs / 3600);
            break;
        default:
            return res.status(404).end();
    }
    res.render(`pages/renders/${template}`, data);
});

module.exports = router;