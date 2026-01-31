const db = require('#db');
const utils = require('#utils');
const { getUserProfile } = require('#api/read.js');

const middleware = {
    ensureUserExists: (req, res, next) => {
        let userId = req.params.id;
        // If userId doesn't parse to int, attempt to find user by name
        // This won't work for users whose names are purely numeric
        if (isNaN(parseInt(userId))) {
            const entry = db
                .prepare(
                    `
                SELECT u.id
                FROM users u
                LEFT JOIN user_previous_names un ON u.id = un.user_id
                WHERE un.name = ? OR u.name = ?
            `
                )
                .get(userId, userId);
            if (entry) userId = entry.id;
        }
        // Fetch user profile using resolved user ID
        const user = getUserProfile(userId);
        if (!user) {
            return res.renderError(
                404,
                'User not found',
                `We aren't tracking the user with ID ${userId} yet. If you want to see their completion stats, ask them to log in here.`
            );
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
            if (req.me) {
                const updateLastLoginTimeAfterMs = 1000 * 60 * 5;
                if (Date.now() - req.me.last_login_time > updateLastLoginTimeAfterMs) {
                    db.prepare(`UPDATE users SET last_login_time = ? WHERE id = ?`).run(Date.now(), data.id);
                }
            }
        }
        next();
    },

    updateLastUrl: (req, res, next) => {
        if (!req.session) return next();
        const url = req.originalUrl;
        // Don't save auth or API URLs
        if (url.startsWith('/auth') || url.startsWith('/api/v')) return next();
        req.session.lastUrl = url;
        next();
    },

    getApiUser: (req, res, next) => {
        const bearerKey = req.headers?.authorization?.split(' ')[1];
        const instructions = 'Find your API key at https://osucomplete.org/api.';
        if (!bearerKey) {
            return res.sendError(401, 'unauthorized', `Missing API key. ${instructions}`);
        }
        req.user = db.prepare(`SELECT * FROM users WHERE api_key = ?`).get(bearerKey);
        if (!req.user) {
            return res.sendError(401, 'unauthorized', `Invalid API key. ${instructions}`);
        }
        next();
    },

    doApiRateLimit: (req, res, next) => {}
};

module.exports = middleware;
