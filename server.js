require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { log, logError } = require('./utils');
const { getAuthenticatedUser } = require('./middleware');
const dayjs = require('dayjs');

const app = express();

app.use((req, res, next) => {
    if (!req.headers['cf-ray'] && process.env.ENFORCE_CLOUDFLARE_ONLY === 'true') {
        res.status(403).send('Forbidden');
        return;
    }
    log(req.headers['cf-connecting-ip'], req.method, req.url);
    next();
});

app.locals.dayjs = dayjs;

app.set('view engine', 'ejs');
app.use(cookieParser());
app.use(express.static('public', { dotfiles: 'allow' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(getAuthenticatedUser);

app.get('/', require('./routes/home'));
app.use('/leaderboard', require('./routes/leaderboard'));
app.use('/u', require('./routes/profile'));
app.use('/search', require('./routes/search'));
app.use('/auth', require('./routes/auth'));
app.use('/recommended', require('./routes/recommended'));
app.use('/queue', require('./routes/queue'));

app.use((req, res) => {
    res.status(404).render('layout', {
        title: '404 not found',
        page: 'error',
        number: 404,
        message: `The page you requested couldn't be found.`,
        me: req.me
    });
});

app.use((err, req, res, next) => {
    logError(err);
    res.status(500);
    res.render('layout', {
        title: `500 internal server error`,
        page: 'error',
        number: 500,
        message: `An internal server error occurred. Please try again later.`,
        me: req.me
    });
});

const port = process.env.WEBSERVER_PORT || 8080;
app.listen(port, () => {
    log(`Server is running on port ${port}`);
});

let shuttingDown = false;
const shutDown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    db.close();
    process.exit(0);
};

process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection at:', promise, 'reason:', reason);
    shutDown();
});

process.on('uncaughtException', (err) => {
    logError('Uncaught Exception thrown:', err);
});

process.on('SIGINT', () => {
    log('Received SIGINT');
    shutDown();
});

process.on('SIGTERM', () => {
    log('Received SIGTERM');
    shutDown();
});