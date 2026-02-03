const puppeteer = require('puppeteer');
const utils = require('#utils');

// CONFIGURATION
const MAX_CONCURRENT_PAGES = 1;
const MAX_RENDERS_BEFORE_RESTART = 50;
const MAX_RETRIES = 3; // Try 3 times before failing
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-accelerated-2d-canvas',
    '--font-render-hinting=none',
    '--force-color-profile=srgb',
    '--hide-scrollbars'
];

// STATE
let browser = null;
let activeWorkers = 0;
let renderCount = 0;
const queue = [];

async function getBrowser() {
    if (!browser) {
        // utils.log('Starting new Puppeteer browser instance...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: BROWSER_ARGS,
            protocolTimeout: 60000
        });

        renderCount = 0;

        browser.on('disconnected', () => {
            browser = null;
        });
    }
    return browser;
}

async function checkLifecycle() {
    if (renderCount >= MAX_RENDERS_BEFORE_RESTART && activeWorkers === 0 && browser) {
        await browser.close().catch(() => {});
        browser = null;
        renderCount = 0;
    }
}

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

        // Standardize viewport
        const initialHeight = task.viewportHeight === 'auto' ? 200 : task.viewportHeight;
        await page.setViewport({
            width: task.viewportWidth,
            height: initialHeight,
            deviceScaleFactor: task.scaleFactor
        });

        // 1. Navigate
        // We strictly use networkidle0 as requested to ensure images load
        await page.goto(task.url, {
            waitUntil: task.waitUntil || 'networkidle0',
            timeout: 20000
        });

        // 2. Resize if auto-height
        if (task.viewportHeight === 'auto') {
            const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
            const finalHeight = Math.max(scrollHeight, 1);
            await page.setViewport({
                width: task.viewportWidth,
                height: finalHeight,
                deviceScaleFactor: task.scaleFactor
            });
            task.viewportHeight = finalHeight;
        }

        // 3. Screenshot
        const imageBuffer = await page.screenshot({
            type: 'png',
            omitBackground: true,
            encoding: 'binary',
            captureBeyondViewport: false,
            clip: { x: 0, y: 0, width: task.viewportWidth, height: task.viewportHeight }
        });

        task.resolve(imageBuffer);
        renderCount++;
    } catch (error) {
        // ERROR HANDLING & RETRY LOGIC
        const retryCount = task.retries || 0;

        if (retryCount < MAX_RETRIES) {
            utils.log(
                `Render failed for ${task.url} (Attempt ${retryCount + 1}/${MAX_RETRIES}). Restarting browser and retrying...`
            );

            // CRITICAL: Kill the browser immediately.
            // This ensures the next attempt uses a fresh process.
            if (browser) await browser.close().catch(() => {});
            browser = null;

            // Increment retry count and put back in queue
            task.retries = retryCount + 1;
            queue.unshift(task);
        } else {
            utils.logError(`Failed to render ${task.url} after ${MAX_RETRIES} attempts.`, error);
            task.reject(error);
        }
    } finally {
        if (page) await page.close().catch(() => {});

        activeWorkers--;

        // Only run lifecycle check if browser still exists (didn't crash)
        if (browser) await checkLifecycle();

        processQueue();
    }
}

function warmup() {
    getBrowser().catch(() => {});
}

function urlToPng(url, viewportWidth = 600, viewportHeight = 315, scaleFactor = 2, waitUntil = 'networkidle0') {
    return new Promise((resolve, reject) => {
        queue.push({
            url,
            viewportWidth,
            viewportHeight,
            scaleFactor,
            waitUntil,
            resolve,
            reject,
            retries: 0
        });
        processQueue();
    });
}

async function closeBrowser() {
    if (browser) {
        await browser.close().catch(() => {});
        browser = null;
    }
}

module.exports = {
    warmup,
    urlToPng,
    closeBrowser
};
