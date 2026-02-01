const env = require('#env');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { marked } = require('marked');
const dayjs = require('dayjs');
const utils = require('#utils');
const db = require('#db');
const apiWrite = require('#api/write.js');
const socketIo = require('socket.io');
const http = require('http');
const { getAuthenticatedUser, updateLastUrl } = require('./middleware');
const dbRead = require('#api/read.js');

// Extend dayjs
dayjs.extend(require('dayjs/plugin/relativeTime'));
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/advancedFormat'));

// Update robots.txt
apiWrite.generateRobotsTxt();

// Create express app
const app = express();

// Create http server
const server = http.createServer(app);

// Create socket
const io = socketIo(server, {
    path: '/ws',
    cors: {
        origin: '*'
    }
});

// Handle socket connections
require('./socket')(io);

// Register global middleware
app.use((req, res, next) => {
    // Get IP from headers or req.ip
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    // Log request including processing time
    const START_TIME = process.hrtime.bigint();
    const originalEnd = res.end;
    res.end = function (...args) {
        const elapsed = (Number(process.hrtime.bigint() - START_TIME) / 1_000_000).toFixed(2);
        const status = res.statusCode;
        const logParts = [ip, req.method, status, req.url];
        const reloadSelectors = req.headers['x-reload-selectors'];
        if (reloadSelectors) logParts.push(JSON.stringify(reloadSelectors.split(',')));
        logParts.push(`[${elapsed}ms]`);
        utils.log(...logParts);
        return originalEnd.apply(this, args);
    };
    // Define functions to easily render with required data
    res.renderPage = (page, data = {}) => {
        res.render('layout', {
            ...data,
            page,
            me: req.me,
            query: req.query
        });
    };
    res.renderPartial = (partial, data = {}) => {
        res.render(`partials/${partial}`, {
            ...data
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
    // Move to next middleware
    next();
});

// Register body parsing middleware
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf; // Store raw bytes for later
        }
    })
);
app.use(express.urlencoded({ extended: true }));

// Register API route
app.use('/api/v1', require('./routes/api-v1'));

// Register webhook routes
app.use('/discord', require('./routes/discord'));
app.use('/github', require('./routes/github'));
app.use('/kofi', require('./routes/kofi'));

// Register static files and view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));

// Register webapp middleware
app.use(cookieParser());
app.use(
    session({
        secret: dbRead.readMiscData('session_secret'),
        name: 'osucomplete.sid',
        resave: false,
        saveUninitialized: false
    })
);
app.use(getAuthenticatedUser);
app.use(updateLastUrl);

// Register client rate limiter
app.set('trust proxy', 1);
app.use(
    rateLimit({
        windowMs: env.CLIENT_RATE_LIMIT_WINDOW_SECS * 1000,
        limit: env.CLIENT_RATE_LIMIT_LIMIT,
        ipv6Subnet: 60,
        handler: (req, res) => {
            res.renderError(429, '429 rate limit exceeded', `You're going too fast! Slow down, play more.`);
        }
    })
);

// Expose git info to templates
try {
    const hash = cp.execSync('git rev-parse --short HEAD').toString().trim();
    const date = cp.execSync('git log -1 --format=%cI').toString().trim();
    app.locals.git = { hash, date };
} catch (e) {
    app.locals.git = { hash: 'unknown', date: 'unknown' };
}

// Add functions for use within EJS
app.locals.dayjs = dayjs;
app.locals.utils = utils;
app.locals.n = utils.formatNumber;
app.locals.env = env;
app.locals.includeMarkdown = filePath => marked.parse(fs.readFileSync(path.join(__dirname, filePath), 'utf-8'));
app.locals.asset = pathRel => {
    pathRel = pathRel.replace(/^\/+/g, ''); // remove leading slash for append
    const fullPath = path.join(__dirname, 'public', pathRel);
    try {
        const stats = fs.statSync(fullPath);
        const mtime = stats.mtime.getTime();
        return `${env.BASE_URL}/${pathRel}?v=${mtime}`;
    } catch (error) {
        return `${env.BASE_URL}/${pathRel}`;
    }
};

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
app.use('/', require('./routes/misc'));

app.use((req, res) => {
    res.renderError(404, '404 not found', `The requested resource couldn't be found.`);
});

app.use((err, req, res, next) => {
    utils.logError(err);
    res.renderError(
        500,
        '500 internal server error',
        `An internal server error occurred. Please try again later, and join the Discord server linked in the top bar to let us know if the issue persists.`
    );
});

// Listen with http server, not express
server.listen(env.WEBSERVER_PORT, () => {
    utils.log(`Server is running on port ${env.WEBSERVER_PORT}`);
});

let shuttingDown = false;
const shutDown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    db.close();
    process.exit(0);
};

process.on('unhandledRejection', (reason, promise) => {
    utils.logError('Unhandled Rejection at:', promise, 'reason:', reason);
    shutDown();
});

process.on('uncaughtException', err => {
    utils.logError('Uncaught Exception thrown:', err);
});

process.on('SIGINT', () => {
    utils.log('Received SIGINT');
    shutDown();
});

process.on('SIGTERM', () => {
    utils.log('Received SIGTERM');
    shutDown();
});
