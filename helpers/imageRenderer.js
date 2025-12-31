const puppeteer = require('puppeteer');

// CONFIGURATION
const MAX_CONCURRENT_PAGES = 2;
const MAX_RENDERS_BEFORE_RESTART = 100;
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
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
 * Lazily initializes the browser instance.
 */
async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: 'new',
            args: BROWSER_ARGS,
            protocolTimeout: 60000 // Increased to 60s to prevent premature timeouts
        });

        renderCount = 0;

        browser.on('disconnected', () => {
            browser = null;
        });
    }
    return browser;
}

/**
 * Call this when your server starts to pre-launch Puppeteer.
 */
function warmup() {
    getBrowser().catch(() => { });
}

/**
 * Checks if the browser needs to be recycled (restarted) to clear memory.
 */
async function checkLifecycle() {
    if (renderCount >= MAX_RENDERS_BEFORE_RESTART && activeWorkers === 0 && browser) {
        await browser.close().catch(() => { });
        browser = null;
        renderCount = 0;
    }
}

/**
 * Worker to process the queue.
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

        const defaultWait = task.url ? 'networkidle0' : 'load';
        const waitStrategy = task.waitUntil || defaultWait;

        if (task.url) {
            await page.goto(task.url, { waitUntil: waitStrategy, timeout: 15000 });
        } else if (task.html) {
            await page.setContent(task.html, { waitUntil: waitStrategy, timeout: 10000 });
        }

        // Force lazy images to load
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

        // Wait for fonts
        await page.evaluateHandle('document.fonts.ready');

        const imageBuffer = await page.screenshot({
            type: 'png',
            omitBackground: false,
            encoding: 'binary',
            clip: { x: 0, y: 0, width: task.viewportWidth, height: task.viewportHeight }
        });

        task.resolve(imageBuffer);
        renderCount++;

    } catch (error) {
        // If the browser hangs or times out, kill it so the next request gets a fresh instance
        const isCriticalError = error.message.includes('Protocol error') ||
            error.message.includes('timed out') ||
            error.message.includes('Target closed');

        if (isCriticalError && browser) {
            browser.close().catch(() => { });
            browser = null;
        }

        task.reject(error);
    } finally {
        if (page) { try { await page.close(); } catch (e) { } }

        activeWorkers--;
        await checkLifecycle();
        processQueue();
    }
}

/**
 * Renders HTML string to PNG.
 */
function htmlToPng(html, viewportWidth = 600, viewportHeight = 315, scaleFactor = 2, waitUntil = 'load') {
    return new Promise((resolve, reject) => {
        queue.push({ html, viewportWidth, viewportHeight, scaleFactor, waitUntil, resolve, reject });
        processQueue();
    });
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
    htmlToPng,
    urlToPng,
    closeBrowser
};