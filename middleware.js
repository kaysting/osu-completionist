const db = require('./db');

const middleware = {
    ensureUserExists: (req, res, next) => {
        const userId = req.params.id;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).render('layout', {
                title: 'User not found',
                page: 'error',
                number: 404,
                message: `We aren't tracking the user with ID ${userId} yet. If you want to see their completion stats, have them visit this site and log in with osu!.`
            });
        }
        req.user = user;
        next();
    }
};

module.exports = middleware;