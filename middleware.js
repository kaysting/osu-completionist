const db = require('./db');
const fs = require('fs');

const middleware = {
    ensureUserExists: (req, res, next) => {
        const userId = req.params.id;
        const user = db.prepare('SELECT * FROM users WHERE id = ? OR name = ?').get(userId, userId);
        if (!user) {
            return res.status(404).render('layout', {
                title: 'User not found',
                page: 'error',
                number: 404,
                message: `We aren't tracking the user with ID ${userId} yet. If you want to see their completion stats, have them visit this site and log in with osu!.`
            });
        }
        req.user = user;
        req.user.country = db.prepare(`SELECT name, code FROM country_names WHERE code = ?`).get(user.country_code) || { name: 'Unknown', code: 'XX' };
        req.user.country.flag_url = `/assets/flags/fallback.png`;
        if (fs.existsSync(`./public/assets/flags/${req.user.country.code.toUpperCase()}.png`)) {
            req.user.country.flag_url = `/assets/flags/${req.user.country.code.toUpperCase()}.png`;
        }
        next();
    }
};

module.exports = middleware;