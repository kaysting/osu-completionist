require('dotenv').config();
const express = require('express');
const db = require('./db');

const log = (...args) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
};

const app = express();

app.use((req, res, next) => {
    log(req.headers['cf-connecting-ip'], req.method, req.url);
    next();
});

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
    return res.redirect(`/leaderboard`);
});

app.get('/leaderboard', (req, res) => {
    res.redirect(`/leaderboard/osu/ranked-loved`);
});

app.get('/leaderboard/:mode', (req, res) => {
    res.redirect(`/leaderboard/${req.params.mode}/ranked-loved`);
});

app.get('/leaderboard/:mode/:includes', (req, res) => {
    // Get params
    const page = parseInt(req.query.p) || 1;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked', 'loved'];
    const includeConverts = includes.includes('converts');
    const includeLoved = includes.includes('loved');
    const limit = 100;
    const offset = (page - 1) * limit;
    // Check params
    const validModes = ['osu', 'taiko', 'catch', 'mania'];
    if (!validModes.includes(mode)) {
        return res.redirect('/leaderboard/osu/ranked-loved');
    }
    // Get leaderboard entries
    const entries = db.prepare(
        `SELECT u.id, u.name, u.avatar_url, us.count FROM users u
         JOIN user_stats us ON u.id = us.user_id
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.count DESC
         LIMIT ? OFFSET ?`
    ).all(mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, limit, offset);
    // Get total number of beatmaps
    const totalMapCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;
    // Get total number of players
    const totalPlayers = db.prepare(
        `SELECT COUNT(*) AS total FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).total;
    // Calculate last page
    const lastPage = Math.ceil(totalPlayers / limit);
    // Determine what page numbers to show
    // Always show first and last page, and 2 pages before and after current page
    const pagesToShow = [];
    for (let i = 1; i <= lastPage; i++) {
        if (i === 1 || i === lastPage || (i >= page - 2 && i <= page + 2)) {
            pagesToShow.push(i);
        } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
            pagesToShow.push('...');
        }
    }
    // Compile data
    const leaderboard = entries.map((entry, index) => ({
        rank: offset + index + 1,
        id: entry.id,
        name: entry.name,
        avatar: entry.avatar_url,
        completed: entry.count,
        total: totalMapCount,
        percentage: totalMapCount > 0 ? ((entry.count / totalMapCount) * 100).toFixed(2) : '0.00'
    }));
    // Render
    const includedText = {
        true_true: 'all ranked, loved, and convert maps',
        true_false: 'all ranked and loved maps, without converts',
        false_true: 'ranked maps and their converts only',
        false_false: 'ranked maps only'
    }[`${includeLoved.toString()}_${includeConverts.toString()}`];
    res.render('layout', {
        tabTitle: `osu!${mode != 'osu' ? `${mode}` : ''} leaderboard`,
        title: `osu!${mode != 'osu' ? `${mode}` : ''} completionist leaderboard`,
        description: `View the players who have passed the most osu!${mode != 'osu' ? `${mode}` : ''} beatmaps!`,
        page: 'leaderboard',
        settings: {
            mode, page, pagesToShow, includes
        },
        leaderboard: leaderboard
    });
});

const ensureUserExists = (req, res, next) => {
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
};

app.get('/search', (req, res) => {
    res.render('layout', {
        title: 'Search completionists',
        page: 'search'
    });
});

app.get('/u/:id', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.user.mode}/ranked-loved`);
});

app.get('/u/:id/:mode', ensureUserExists, (req, res) => {
    res.redirect(`/u/${req.user.id}/${req.params.mode}/ranked-loved`);
});

app.get('/u/:id/:mode/:includes', ensureUserExists, (req, res) => {
    const user = req.user;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked', 'loved'];
    const includeConverts = includes.includes('converts');
    const includeLoved = includes.includes('loved');
    // Ensure mode is valid
    const validModes = ['osu', 'taiko', 'catch', 'mania'];
    if (!validModes.includes(mode)) {
        return res.redirect(`/u/${user.id}/osu/ranked-loved`);
    }
    // Get user stats
    const stats = db.prepare(
        `SELECT count FROM user_stats
         WHERE user_id = ? AND mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(user.id, mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0);
    const completedCount = stats ? stats.count : 0;
    // Get total number of beatmaps
    const totalMapCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;
    // Get user rank
    const rankResult = db.prepare(
        `SELECT COUNT(*) + 1 AS rank FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > ?`
    ).get(mode == 'catch' ? 'fruits' : mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, completedCount);
    // Compile user stats
    const percentage = totalMapCount > 0 ? ((completedCount / totalMapCount) * 100).toFixed(2) : '0.00';
    user.stats = {
        completed: completedCount,
        total: totalMapCount,
        percentage,
        rank: rankResult.rank
    };
    const includesString = `${includeLoved ? 'ranked and loved' : 'ranked only'}, ${includeConverts ? 'with converts' : 'no converts'}`;
    // Render
    res.render('layout', {
        page: 'profile',
        tabTitle: req.user.name,
        title: `${req.user.name}'s osu!${mode != 'osu' ? `${mode}` : ''} completionist profile`,
        description: `${req.user.name} has passed ${percentage}% of all osu!${mode != 'osu' ? `${mode}` : ''} beatmaps (${includesString})! Click to view more of their completionist stats.`,
        user,
        settings: {
            mode, includes
        }
    });
});

app.use((req, res) => {
    res.status(404).render('layout', {
        title: '404 not found',
        page: 'error',
        number: 404,
        message: `The page you requested couldn't be found.`
    });
});

app.use((err, req, res, next) => {
    log(err);
    res.status(500);
    res.render('layout', {
        title: `500 internal server error`,
        page: 'error',
        number: 500,
        message: `An internal server error occurred. Please try again later.`
    });
});

const port = process.env.WEBSERVER_PORT || 8080;
app.listen(port, () => {
    log(`Server is running on port ${port}`);
});

let shuttingDown = false;

process.on('unhandledRejection', (reason, promise) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Unhandled Rejection at:', promise, 'reason:', reason);
    db.close();
});

process.on('uncaughtException', (err) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Uncaught Exception:', err);
    db.close();
});

process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Received SIGINT');
    db.close();
});

process.on('SIGTERM', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Received SIGTERM');
    db.close();
});