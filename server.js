require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const db = require('./helpers/db');
const { log, logError } = require('./helpers/utils');
const { getAuthenticatedUser } = require('./helpers/middleware');
const dayjs = require('dayjs');

const app = express();

app.use((req, res, next) => {
    // Get IP and make sure it's allowed to access the server
    const ip = req.headers['cf-connecting-ip'] || req.ip.replace('::ffff:', '');
    const isLocal = ip === '::1' || ip.match(/^(127|192|10|100)\.*/);
    if (!req.headers['cf-ray'] && process.env.ENFORCE_CLOUDFLARE_ONLY === 'true' && !isLocal) {
        res.status(403).send('Forbidden');
        return;
    }
    // Define functions to easily render with required data
    res.renderPage = (page, data = {}) => {
        res.render('layout', {
            ...data,
            page,
            me: req.me
        });
    };
    res.renderError = (number, message) => {
        res.status(number).render('layout', {
            title: number,
            page: 'error',
            number,
            message,
            me: req.me
        });
    };
    // Log request
    log(ip, req.method, req.url);
    // Move to next middleware
    next();
});

// Add dayjs so it can be used in EJS templates
app.locals.dayjs = dayjs;

// Register JSON middleware and API route
app.use(express.json());
app.use('/api', require('./routes/api'));

// Register static files and view engine
app.set('view engine', 'ejs');
app.use(express.static('public', { dotfiles: 'allow' }));

// Register webapp middleware
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(getAuthenticatedUser);

// Register client rate limiter
app.use(rateLimit({
    windowMs: (process.env.CLIENT_RATE_LIMIT_WINDOW_SECS || 300) * 1000,
    limit: process.env.CLIENT_RATE_LIMIT_LIMIT || 50,
    ipv6Subnet: 60,
    handler: (req, res) => {
        res.renderError(429, `You're going too fast! Slow down, play more.`);
    }
}));

// Register webapp routes
app.use('/', require('./routes/home'));
app.use('/leaderboard', require('./routes/leaderboard'));
app.use('/u', require('./routes/profile'));
app.use('/search', require('./routes/search'));
app.use('/auth', require('./routes/auth'));
app.use('/recommended', require('./routes/recommended'));
app.use('/queue', require('./routes/queue'));
app.use('/renders', require('./routes/renders'));

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