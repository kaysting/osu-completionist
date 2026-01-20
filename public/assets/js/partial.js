/**
 * Partial.js
 * A lightweight, dependency-free library for partial page reloads, 
 * form binding, and history management.
 * * @author Written by Gemini for Kayla
 * @version 1.0.0
 * * --- USAGE DOCUMENTATION ---
 * * 1. BASIC BUTTON / LINK:
 * Add `data-reload-selectors` to any element to make it trigger a partial reload.
 * <button data-reload-selectors="#content" data-reload-url="/page/2">Next</button>
 * * 2. HISTORY MANAGEMENT:
 * Update the browser URL and history stack without a full page load.
 * <a href="/profile/taiko" 
 * data-reload-selectors="#profile-card" 
 * data-reload-push-address="true">Taiko Mode</a>
 * * 3. LIVE FORMS:
 * Add `data-reload-selectors` to a form. It will automatically submit via AJAX
 * when inputs change (debounced for text) or on submit.
 * <form action="/search" data-reload-selectors="#results">
 * <input name="q" placeholder="Search...">
 * </form>
 * * 4. AUTO-REFRESH (POLLING):
 * Add `data-reload-interval` (in seconds) to the container you want to refresh.
 * <div id="status-card" data-reload-interval="15">...</div>
 * * --- ATTRIBUTES API ---
 * * data-reload-selectors       (Required) Comma-separated list of CSS selectors to update.
 * data-reload-url             (Optional) URL to fetch. Defaults to href (for links) or current URL.
 * data-reload-push-address    (Optional) "true" to push new URL to history (Back button support).
 * data-reload-replace-address (Optional) "true" to replace current URL (no history entry).
 * data-reload-silent          (Optional) "true" to suppress loading states and error alerts.
 * data-reload-interval        (Optional) Seconds between auto-refreshes (for containers).
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
 * Main function to reload specific DOM elements from the server.
 * @param {string|string[]} targetSelectors - CSS selectors to update
 * @param {Object} options - { url, replaceAddress, pushAddress, silent }
 */
const reloadElement = async (targetSelectors, options = {}) => {
    // Normalize targets to array
    const targets = Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors];
    const url = options.url || window.location.href;
    const { replaceAddress, pushAddress, silent } = options;

    // Resolve the actual DOM elements we are about to update
    const newElements = targets.map(s => document.querySelector(s)).filter(el => el);

    // 1. SMART COLLISION FIX: DOM-Aware Aborting
    // Check if any ACTIVE request targets an element that overlaps (Parent/Child) with new targets.
    activeRequests.forEach((controller, activeSelector) => {
        const activeElement = document.querySelector(activeSelector);
        if (!activeElement) return;

        const isCollision = newElements.some(newEl =>
            activeElement === newEl ||
            activeElement.contains(newEl) ||
            newEl.contains(activeElement)
        );

        if (isCollision) {
            controller.abort();
            if (!silent) console.log(`[Partial] Aborted stale request for '${activeSelector}'`);
        }
    });

    // 2. Setup New Controller
    const controller = new AbortController();
    targets.forEach(selector => activeRequests.set(selector, controller));

    // 3. History Management
    if (pushAddress && url) {
        history.pushState({ reloadSelectors: targets }, '', url);
    } else if (replaceAddress && url) {
        history.replaceState({ reloadSelectors: targets }, '', url);
    }

    // 4. UI Loading State
    // We apply this if not silent. Note: LiveForms might have already applied it manually.
    if (!silent) {
        targets.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) applyLoadingStyle(el);
        });
    }

    try {
        // 5. Fetch Data
        const response = await fetch(url, {
            headers: { 'X-Reload-Selectors': targets.join(',') },
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`);

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        let successCount = 0;
        const missing = [];

        // 6. Swap Elements
        for (const selector of targets) {
            const oldElement = document.querySelector(selector);
            const newElement = doc.querySelector(selector);

            if (oldElement && newElement) {
                // Update existing element
                oldElement.replaceWith(newElement);

                if (!silent) {
                    applyLoadingStyle(newElement); // Re-apply to ensure transition works on new element
                    setTimeout(() => removeLoadingStyle(newElement), 50);
                }

                // Re-init functionality
                if (window.initImageLoadStates) window.initImageLoadStates(newElement);
                initLiveForms(); // Re-bind any new forms
                executeScripts(newElement);
                successCount++;

            } else if (oldElement && !newElement) {
                // Remove element (Server removed it)
                oldElement.style.transition = '0.1s ease-in-out';
                oldElement.style.opacity = '0';
                setTimeout(() => oldElement.remove(), 200);
                successCount++;
            } else {
                missing.push(selector);
            }
        }

        if (successCount === 0 && !silent) {
            throw new Error(`No matching elements found. (Failed: ${missing.join(', ')})`);
        }

        // Global event for other scripts
        document.dispatchEvent(new Event('page:updated'));

    } catch (error) {
        if (error.name === 'AbortError') return; // Expected behavior

        if (!silent) console.error('[Partial] Error:', error);

        // CLEANUP: Always remove loading styles on error, even if silent.
        // This ensures UI doesn't get stuck if a silent auto-refresh fails.
        targets.forEach(selector => {
            const el = document.querySelector(selector);
            if (el && el.isConnected) removeLoadingStyle(el);
        });

        // Show error popup (assumes showPopup is global in base.js)
        if (!silent && window.showPopup) {
            showPopup('Refresh failed',
                `<p>Failed to refresh content. <br><code>${error.message}</code></p>`,
                [{ label: 'Try again', onClick: () => reloadElement(targets, options) }, { label: 'Okay', class: 'primary' }]
            );
        }
    } finally {
        // 7. Cleanup
        targets.forEach(selector => {
            if (activeRequests.get(selector) === controller) {
                activeRequests.delete(selector);
            }
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
        // Text inputs (Debounced)
        form.addEventListener('input', (e) => {
            if (e.target.matches('input[type="text"], input[type="search"], textarea')) {

                // VISUAL: Apply loading state IMMEDIATELY when typing starts
                selectors.forEach(s => {
                    const el = document.querySelector(s);
                    if (el) applyLoadingStyle(el);
                });

                clearTimeout(timeout);
                timeout = setTimeout(performUpdate, 500);
            }
        });
        // Toggles (Immediate)
        form.addEventListener('change', (e) => {
            if (e.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
                performUpdate();
            }
        });
        // Submit (Immediate)
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

            // console.log(`[Partial] Auto-refreshing: ${selectors.join(', ')}`);
            reloadElement(selectors, { url: targetUrl, silent: true });
        }
    });
}, 1000);

// --- GLOBAL LISTENERS ---

// Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
    initLiveForms();
    // Save initial state for history
    if (!history.state) {
        history.replaceState({ reloadSelectors: ['main'] }, '', window.location.href);
    }
});

// Click Delegator (Intercepts clicks on elements with data-reload-selectors)
document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-reload-selectors]');
    if (!trigger) return;

    // Ignore if it's a form element (forms handle themselves via initLiveForms)
    if (trigger.tagName === 'FORM') return;

    // If it's a link or submit button, stop the browser's default action
    if (trigger.tagName === 'A' || trigger.getAttribute('type') === 'submit') {
        e.preventDefault();
    }

    const selectors = trigger.dataset.reloadSelectors.split(',').map(s => s.trim());

    // Prefer data-reload-url, fall back to href (for links), then undefined (current page)
    const url = trigger.dataset.reloadUrl || trigger.getAttribute('href') || undefined;

    reloadElement(selectors, {
        url: url,
        replaceAddress: trigger.dataset.reloadReplaceAddress === 'true',
        pushAddress: trigger.dataset.reloadPushAddress === 'true',
        silent: trigger.dataset.reloadSilent === 'true'
    });
});

// History Handler (Back/Forward buttons)
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