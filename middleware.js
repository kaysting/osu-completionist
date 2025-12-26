const db = require('./helpers/db');
const fs = require('fs');
const utils = require('./helpers/utils');
const { getUserProfile } = require('./helpers/dbHelpers');

const middleware = {

    ensureUserExists: (req, res, next) => {
        const userId = req.params.id;
        const user = getUserProfile(userId);
        if (!user) {
            return res.status(404).render('layout', {
                title: 'User not found',
                page: 'error',
                number: 404,
                message: `We aren't tracking the user with ID ${userId} yet. If you want to see their completion stats, have them visit this site and log in with osu!.`,
                me: req.me
            });
        }
        req.user = user;
        next();
    },

    getAuthenticatedUser: (req, res, next) => {
        const jwt = req.cookies?.token;
        const data = utils.verifyJWT(jwt);
        req.me = null;
        if (data?.id) {
            req.me = db.prepare('SELECT * FROM users WHERE id = ?').get(data.id);
            db.prepare(`UPDATE users SET last_login_time = ? WHERE id = ?`).run(Date.now(), data.id);
        }
        next();
    }

};

module.exports = middleware;