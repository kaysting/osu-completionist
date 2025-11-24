const express = require('express');
const db = require('./db');
const config = require('./config.json');

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
    return res.redirect(`/leaderboard/osu`);
    res.render('layout', {
        page: 'home'
    });
});

app.get('/leaderboard', (req, res) => {
    res.redirect(`/leaderboard/osu?loved=true`);
});

app.get('/leaderboard/:mode', (req, res) => {
    // Get params
    const page = parseInt(req.query.p) || 1;
    const mode = req.params.mode || 'osu';
    const includeConverts = req.query.converts === 'true' || false;
    const includeLoved = req.query.loved === 'true' || false;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check params
    const validModes = ['osu', 'taiko', 'catch', 'mania'];
    if (!validModes.includes(mode)) {
        return res.redirect('/leaderboard/osu?loved=true');
    }
    // Get leaderboard entries
    const entries = db.prepare(
        `SELECT u.id, u.name, u.avatar_url, us.count FROM users u
         JOIN user_stats us ON u.id = us.user_id
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.count DESC
         LIMIT ? OFFSET ?`
    ).all(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0, limit, offset);
    // Get total number of beatmaps
    const totalMapCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).count;
    // Get total number of players
    const totalPlayers = db.prepare(
        `SELECT COUNT(*) AS total FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ? AND count > 0`
    ).get(mode, includeLoved ? 1 : 0, includeConverts ? 1 : 0).total;
    // Calculate last page
    const lastPage = Math.ceil(totalPlayers / limit);
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
    res.render('layout', {
        title: 'Leaderboard',
        page: 'leaderboard',
        settings: {
            mode, page, lastPage, includeConverts, includeLoved
        },
        leaderboard: leaderboard
    });
});

app.get('/users/:id', (req, res) => {
    const userId = req.params.id;
    res.render('layout', {
        title: userId,
        page: 'profile',
        userId: userId
    });
});

app.get('/queue', (req, res) => {
    res.render('layout', {
        title: `Update queue`,
        page: 'queue'
    });
});

app.use((req, res) => {
    res.status(404).render('layout', {
        title: '404 Not Found',
        page: 'error',
        number: 404,
        message: `The page you requested couldn't be found.`
    });
});

app.use((err, req, res, next) => {
    log(err);
    res.status(500);
    res.render('layout', {
        title: `500 Internal Server Error`,
        page: 'error',
        number: 500,
        message: `An internal server error occurred. Please try again later.`
    });
});

app.listen(config.webserver_port, () => {
    console.log(`Server is running on port ${config.webserver_port}`);
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