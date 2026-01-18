const puppeteer = require('puppeteer');
const utils = require('./utils');

// CONFIGURATION
// Locking this to 1 is the single best thing for stability on an 8GB server sharing resources with a DB.
const MAX_CONCURRENT_PAGES = 1;
const MAX_RENDERS_BEFORE_RESTART = 50; // Lowered slightly to keep memory fresh
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',      // Critical for Docker/Linux environments
    '--disable-gpu',                // Critical stability flag for headless Linux
    '--disable-extensions',
    '--disable-accelerated-2d-canvas', // Saves RAM
    '--font-render-hinting=none',
    '--force-color-profile=srgb',
    '--hide-scrollbars'
];

// STATE
let browser = null;
let activeWorkers = 0;
let renderCount = 0;
const queue = [];

/**
 * Lazily initializes the browser instance with robust timeout settings.
 */
async function getBrowser() {
    if (!browser) {
        utils.log('Starting new Puppeteer browser instance...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: BROWSER_ARGS,
            // 60s timeout gives the browser plenty of time to start under load
            protocolTimeout: 60000
        });

        renderCount = 0;

        browser.on('disconnected', () => {
            utils.log('Lost connection to Puppeteer browser, resetting instance...');
            browser = null;
        });
    }
    return browser;
}

/**
 * Checks if the browser needs to be recycled to clear memory leaks.
 */
async function checkLifecycle() {
    if (renderCount >= MAX_RENDERS_BEFORE_RESTART && activeWorkers === 0 && browser) {
        await browser.close().catch(() => { });
        browser = null;
        renderCount = 0;
    }
}

/**
 * Worker to process the URL queue.
 */
async function processQueue() {
    if (activeWorkers >= MAX_CONCURRENT_PAGES || queue.length === 0) {
        return;
    }

    const task = queue.shift();
    activeWorkers++;

    let page = null;

    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();

        await page.setViewport({
            width: task.viewportWidth,
            height: task.viewportHeight,
            deviceScaleFactor: task.scaleFactor
        });

        // 1. Navigate
        // 'networkidle0' is safer for complex SPAs like osu! stats, ensuring hydration finishes
        await page.goto(task.url, {
            waitUntil: task.waitUntil || 'networkidle0',
            timeout: 20000
        });

        // 2. Force Lazy Images (Stability Fix)
        // Helps prevent white boxes where images should be
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll("img"));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve) => {
                    img.loading = "eager";
                    img.onload = resolve;
                    img.onerror = resolve;
                });
            }));
        });

        // 3. Wait for Fonts
        await page.evaluateHandle('document.fonts.ready');

        // 4. Capture Screenshot (Performance Fix)
        // captureBeyondViewport: false prevents Puppeteer from calculating layout 
        // for the entire scrollable page, which causes "ProtocolError: Timed out"
        const imageBuffer = await page.screenshot({
            type: 'png',
            omitBackground: false,
            encoding: 'binary',
            captureBeyondViewport: false,
            clip: { x: 0, y: 0, width: task.viewportWidth, height: task.viewportHeight }
        });

        task.resolve(imageBuffer);
        renderCount++;

    } catch (error) {
        // Critical Error Handling
        // If the browser hangs, kills the process so the next request gets a fresh start
        const isCriticalError = error.message.includes('Protocol error') ||
            error.message.includes('timed out') ||
            error.message.includes('Target closed');

        if (isCriticalError && browser) {
            console.error('Critical Puppeteer error detected. Restarting browser...');
            browser.close().catch(() => { });
            browser = null;
        }

        task.reject(error);
    } finally {
        if (page) { try { await page.close(); } catch (e) { } }

        activeWorkers--;
        await checkLifecycle();
        // Trigger next task immediately
        processQueue();
    }
}

/**
 * Call this when your server starts to pre-warm the browser.
 */
function warmup() {
    getBrowser().catch(() => { });
}

/**
 * Renders URL to PNG.
 */
function urlToPng(url, viewportWidth = 600, viewportHeight = 315, scaleFactor = 2, waitUntil = 'networkidle0') {
    return new Promise((resolve, reject) => {
        queue.push({ url, viewportWidth, viewportHeight, scaleFactor, waitUntil, resolve, reject });
        processQueue();
    });
}

async function closeBrowser() {
    if (browser) {
        await browser.close().catch(() => { });
        browser = null;
    }
}

module.exports = {
    warmup,
    urlToPng,
    closeBrowser
};