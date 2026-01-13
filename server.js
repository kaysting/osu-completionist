const env = require('./helpers/env');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { marked } = require('marked');
const dayjs = require('dayjs');

const { log, logError } = require('./helpers/utils');
const db = require('./helpers/db');
const { getAuthenticatedUser, updateLastUrl } = require('./helpers/middleware');

const app = express();

// Register global middleware
app.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    // Define functions to easily render with required data
    res.renderPage = (page, data = {}) => {
        res.render('layout', {
            ...data,
            page,
            me: req.me
        });
    };
    res.renderError = (number, title, message) => {
        res.status(number).render('layout', {
            title: title || number,
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

// Add functions for use within EJS
app.locals.dayjs = dayjs;
app.locals.includeMarkdown = (filePath) => marked.parse(fs.readFileSync(filePath, 'utf-8'));

// Register JSON middleware and API route
app.use(express.json());
app.use('/api/v1', require('./routes/api-v1'));

// Register static files and view engine
app.set('view engine', 'ejs');
app.use(express.static('public', { dotfiles: 'allow' }));

// Register webapp middleware
app.use(cookieParser());
app.use(session({
    secret: env.SESSION_SECRET,
    name: 'osucomplete.sid',
    resave: false,
    saveUninitialized: false
}));
app.use(express.urlencoded({ extended: true }));
app.use(getAuthenticatedUser);
app.use(updateLastUrl);

// Register client rate limiter
app.set('trust proxy', 1);
app.use(rateLimit({
    windowMs: (env.CLIENT_RATE_LIMIT_WINDOW_SECS) * 1000,
    limit: env.CLIENT_RATE_LIMIT_LIMIT,
    ipv6Subnet: 60,
    handler: (req, res) => {
        res.renderError(429, '429 rate limit exceeded', `You're going too fast! Slow down, play more.`);
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
app.use('/api', require('./routes/apiDocs'));
app.use('/tos', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(fs.readFileSync('views/markdown/tos.md', 'utf-8')),
        title: 'Terms of Service',
        meta: {
            title: 'Terms of Service',
            description: 'View the osu!complete terms of service.'
        }
    });
});
app.use('/privacy', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(fs.readFileSync('views/markdown/privacy.md', 'utf-8')),
        title: 'Privacy Policy',
        meta: {
            title: 'Privacy Policy',
            description: 'View the osu!complete privacy policy.'
        }
    });
});

app.use((req, res) => {
    res.renderError(404, '404 not found', `The requested resource couldn't be found.`);
});

app.use((err, req, res, next) => {
    logError(err);
    res.renderError(500, '500 internal server error', `An internal server error occurred. Please try again later.`);
});

app.listen(env.WEBSERVER_PORT, () => {
    log(`Server is running on port ${env.WEBSERVER_PORT}`);
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