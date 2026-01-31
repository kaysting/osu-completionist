/**
 * Partial.js
 * A lightweight, dependency-free library for partial page reloads.
 * @version 1.1.0 (Stable Diffing)
 */

// Track active requests: Map<SelectorString, AbortController>
const activeRequests = new Map();

// Helper: Re-execute <script> tags inside replaced content
const executeScripts = (element) => {
    element.querySelectorAll('script').forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
};

// Helper: Apply loading visual state
const applyLoadingStyle = (element) => {
    element.style.transition = '0.1s ease-in-out';
    element.style.opacity = '0.5';
    element.style.pointerEvents = 'none';
};

// Helper: Remove loading visual state
const removeLoadingStyle = (element) => {
    element.style.removeProperty('opacity');
    element.style.removeProperty('pointer-events');
    setTimeout(() => {
        element.style.removeProperty('transition');
    }, 300);
};

/**
 * Standalone Fetcher: Fetches the partial HTML for specific selectors.
 * Returns a Promise<Document> containing the new elements.
 */
const fetchPartials = async (selectors, options = {}) => {
    const targets = Array.isArray(selectors) ? selectors : [selectors];
    const url = options.url || window.location.href;
    const signal = options.signal || null;

    const response = await fetch(url, {
        headers: { 'X-Reload-Selectors': targets.join(',') },
        signal: signal
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
};

/**
 * Helper: Generates a "clean" DOM Node for comparison.
 * It strips known client-side-only attributes so we can verify
 * if the underlying content actually changed.
 */
const getCleanNode = (element) => {
    const clone = element.cloneNode(true);

    // 1. Clean Images
    clone.classList.remove('loaded', 'updating');
    clone.querySelectorAll('.loaded').forEach(el => el.classList.remove('loaded'));

    // 2. Clean Forms
    clone.removeAttribute('data-live-bound');
    clone.querySelectorAll('[data-live-bound]').forEach(el => el.removeAttribute('data-live-bound'));

    // 3. Clean Tooltips (Revert data-tooltip back to title)
    const revertTooltip = (el) => {
        if (el.hasAttribute('data-tooltip')) {
            const title = el.getAttribute('data-tooltip');
            // Only set title if it's not empty, matching standard browser behavior
            if (title) el.setAttribute('title', title);
            el.removeAttribute('data-tooltip');
        }
    };
    revertTooltip(clone);
    clone.querySelectorAll('[data-tooltip]').forEach(revertTooltip);

    return clone;
};

/**
 * Main function to reload specific DOM elements from the server.
 */
const reloadElement = async (targetSelectors, options = {}) => {
    const targets = Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors];
    const url = options.url || window.location.href;
    const { replaceAddress, pushAddress, silent } = options;

    const newElements = targets.map(s => document.querySelector(s)).filter(el => el);

    // 1. SMART COLLISION FIX
    activeRequests.forEach((controller, activeSelector) => {
        const activeElement = document.querySelector(activeSelector);
        if (!activeElement) return;
        const isCollision = newElements.some(newEl =>
            activeElement === newEl || activeElement.contains(newEl) || newEl.contains(activeElement)
        );
        if (isCollision) controller.abort();
    });

    const controller = new AbortController();
    targets.forEach(selector => activeRequests.set(selector, controller));

    if (pushAddress && url) history.pushState({ reloadSelectors: targets }, '', url);
    else if (replaceAddress && url) history.replaceState({ reloadSelectors: targets }, '', url);

    if (!silent) {
        targets.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) applyLoadingStyle(el);
        });
    }

    try {
        // --- UPDATED: USE THE NEW HELPER ---
        const doc = await fetchPartials(targets, {
            url: url,
            signal: controller.signal
        });

        let successCount = 0;

        for (const selector of targets) {
            const oldElement = document.querySelector(selector);
            const newElement = doc.querySelector(selector);

            if (oldElement && newElement) {
                // --- DIFF CHECK START ---
                const cleanOldNode = getCleanNode(oldElement);

                if (cleanOldNode.isEqualNode(newElement)) {
                    if (!silent) removeLoadingStyle(oldElement);
                    successCount++;
                    continue;
                }
                // --- DIFF CHECK END ---

                oldElement.replaceWith(newElement);

                if (!silent) {
                    applyLoadingStyle(newElement);
                    setTimeout(() => removeLoadingStyle(newElement), 50);
                }

                initLiveForms();
                executeScripts(newElement);
                successCount++;

            } else if (oldElement && !newElement) {
                // Safety check for custom URLs
                if (url !== window.location.href) {
                    if (!silent) console.warn(`[Partial] Selector "${selector}" missing in response from "${url}". Preserving existing element.`);
                    if (!silent) removeLoadingStyle(oldElement);
                    continue;
                }

                // Normal deletion logic
                oldElement.style.transition = '0.1s ease-in-out';
                oldElement.style.opacity = '0';
                setTimeout(() => oldElement.remove(), 200);
                successCount++;
            }
        }

        if (successCount > 0) document.dispatchEvent(new Event('page:updated'));

    } catch (error) {
        if (error.name === 'AbortError') return;
        if (!silent) console.error('[Partial] Error:', error);
        targets.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) removeLoadingStyle(el);
        });
    } finally {
        targets.forEach(selector => {
            if (activeRequests.get(selector) === controller) activeRequests.delete(selector);
        });
    }
};

/**
 * Module: Live Form Binding
 */
const initLiveForms = () => {
    document.querySelectorAll('form[data-reload-selectors]:not([data-live-bound])').forEach(form => {
        form.dataset.liveBound = 'true';
        const selectors = form.dataset.reloadSelectors.split(',').map(s => s.trim());
        const action = form.getAttribute('action') || window.location.pathname;

        const performUpdate = () => {
            const formData = new FormData(form);
            const params = new URLSearchParams(formData);
            reloadElement(selectors, {
                url: `${action}?${params.toString()}`,
                replaceAddress: true
            });
        };

        let timeout;
        form.addEventListener('input', (e) => {
            if (e.target.matches('input[type="text"], input[type="number"], input[type="search"], textarea')) {
                // Visual feedback immediately
                selectors.forEach(s => {
                    const el = document.querySelector(s);
                    if (el) applyLoadingStyle(el);
                });
                clearTimeout(timeout);
                timeout = setTimeout(performUpdate, 500);
            }
        });
        form.addEventListener('change', (e) => {
            if (e.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
                performUpdate();
            }
        });
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            clearTimeout(timeout);
            performUpdate();
        });
    });
};

/**
 * Module: Auto-Refresher (Batching)
 */
const autoReloadBatches = new Map();

setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    const groups = new Map();

    document.querySelectorAll('[data-reload-interval]').forEach(el => {
        if (!el.id) return;
        const secs = parseInt(el.dataset.reloadInterval);
        if (isNaN(secs) || secs <= 0) return;
        const url = el.getAttribute('data-reload-url') || 'CURRENT';

        const key = `${secs}|${url}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(`#${el.id}`);
    });

    groups.forEach((selectors, key) => {
        const [secsStr, urlStr] = key.split('|');
        const intervalMs = parseInt(secsStr) * 1000;

        if (!autoReloadBatches.has(key)) {
            autoReloadBatches.set(key, now);
            return;
        }

        if (now - autoReloadBatches.get(key) >= intervalMs) {
            autoReloadBatches.set(key, now);
            const targetUrl = urlStr === 'CURRENT' ? window.location.href : urlStr;
            reloadElement(selectors, { url: targetUrl, silent: true });
        }
    });
}, 1000);

// --- GLOBAL LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    initLiveForms();
    if (!history.state) {
        history.replaceState({ reloadSelectors: ['main'] }, '', window.location.href);
    }
});

document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-reload-selectors]');
    if (!trigger || trigger.tagName === 'FORM') return;

    if (trigger.tagName === 'A' || trigger.getAttribute('type') === 'submit') {
        e.preventDefault();
    }

    const selectors = trigger.dataset.reloadSelectors.split(',').map(s => s.trim());
    const url = trigger.dataset.reloadUrl || trigger.getAttribute('href') || undefined;

    reloadElement(selectors, {
        url: url,
        replaceAddress: trigger.dataset.reloadReplaceAddress === 'true',
        pushAddress: trigger.dataset.reloadPushAddress === 'true',
        silent: trigger.dataset.reloadSilent === 'true'
    });
});

window.addEventListener('popstate', (event) => {
    if (event.state?.reloadSelectors) {
        reloadElement(event.state.reloadSelectors, {
            url: window.location.href,
            replaceAddress: false,
            pushAddress: false
        });
    } else {
        window.location.reload();
    }
});

// Track visibility state for reload-on-show functionality
let hiddenSinceTime = null;
const HIDDEN_THRESHOLD_MS = 60 * 1000; // 1 minute

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        hiddenSinceTime = Date.now();
        return;
    }

    // Window is now visible. Check if it was hidden long enough
    if (!hiddenSinceTime || Date.now() - hiddenSinceTime < HIDDEN_THRESHOLD_MS) {
        hiddenSinceTime = null;
        return;
    }

    hiddenSinceTime = null;

    const elementsToReload = document.querySelectorAll('[data-reload-on-show]');
    if (elementsToReload.length === 0) return;

    // Group elements by their reload URL
    const urlGroups = new Map();
    Array.from(elementsToReload).forEach((el) => {
        const url = el.getAttribute('data-reload-url') || window.location.href;
        if (!urlGroups.has(url)) {
            urlGroups.set(url, []);
        }

        const selector = el.id ? `#${el.id}` : el.tagName.toLowerCase() +
            (el.className ? '.' + el.className.split(' ').join('.') : '');
        urlGroups.get(url).push(selector);
    });

    // Reload each group with its respective URL
    urlGroups.forEach((selectors, url) => {
        reloadElement(selectors, {
            url: url,
            silent: true
        });
    });
});