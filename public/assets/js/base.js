// Use the sharing api or clipboard write to share text
const copyText = async text => {
    if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Error copying to clipboard:', err);
        }
    } else {
        showPopup(
            'Clipboard copy failed',
            `<p>We couldn't copy the text for you, so you'll have to do it yourself:</p>
            <pre><code>${text}</code></pre>`,
            [{ label: 'Close' }]
        );
    }
};

const showPopup = (title, body, actions, closedby = 'none') => {
    // Build base dialog element
    const dialog = document.createElement('dialog');
    dialog.classList.add('popup');
    dialog.innerHTML = /*html*/`
        <div class="title"></div>
        <div class="body"></div>
        <div class="actions"></div>
    `;
    dialog.closedby = closedby;
    // Populate dialog
    dialog.querySelector('.title').innerText = title;
    // Populate body
    if (typeof body === 'string') {
        dialog.querySelector('.body').innerHTML = body;
    } else {
        dialog.querySelector('.body').appendChild(body);
    }
    // Populate actions
    const actionsContainer = dialog.querySelector('.actions');
    for (const action of actions) {
        const btn = document.createElement(action.href ? 'a' : 'button');
        btn.classList = `btn medium ${action.class || ''}`;
        if (action.class == 'primary')
            btn.autofocus = true;
        btn.innerText = action.label;
        if (action.href) {
            btn.href = action.href;
            if (action.newTab) {
                btn.target = '_blank';
            }
        }
        btn.addEventListener('click', event => {
            if (action.onClick) action.onClick(dialog);
            if (action.noClose) return;
            dialog.close(event);
        });
        actionsContainer.appendChild(btn);
    }
    // Show dialog
    document.body.appendChild(dialog);
    dialog.showModal();
    // Delete on close
    dialog.addEventListener('close', () => {
        document.body.removeChild(dialog);
    });
    // Return
    return dialog;
};

// Tooltip logic written entirely by Gemimi
const initCustomTooltips = () => {
    const tooltip = document.createElement('div');
    tooltip.id = 'custom-tooltip';
    document.body.appendChild(tooltip);

    let currentTarget = null;

    const showTooltip = (target, text) => {
        // 1. RESET to defaults (Single line mode)
        tooltip.style.whiteSpace = 'nowrap';
        tooltip.style.width = 'auto';
        tooltip.style.top = '0px';
        tooltip.style.left = '0px';
        tooltip.style.removeProperty('--arrow-x');
        tooltip.style.removeProperty('--arrow-y');

        // Set text and show
        tooltip.textContent = text;
        tooltip.classList.add('visible');

        // 2. MEASURE natural width
        let tooltipRect = tooltip.getBoundingClientRect();

        // 3. CONDITIONAL WRAPPING
        // If the single line is wider than 300px, force wrapping
        const maxWidth = 350;
        if (tooltipRect.width > maxWidth) {
            tooltip.style.whiteSpace = 'normal';
            tooltip.style.width = `${maxWidth}px`; // Lock width to max
            tooltipRect = tooltip.getBoundingClientRect(); // Re-measure height with wrapping
        }

        // ... (Rest of your positioning logic remains the same) ...
        const targetRect = target.getBoundingClientRect();
        const arrowSize = 6;
        const gap = 6;
        const padding = 10;

        // 4. DETERMINE PLACEMENT
        const spaceTop = targetRect.top;
        const spaceBottom = window.innerHeight - targetRect.bottom;
        const spaceLeft = targetRect.left;
        const spaceRight = window.innerWidth - targetRect.right;

        let placement = 'top';

        if (spaceTop < (tooltipRect.height + gap + arrowSize) && spaceBottom > (tooltipRect.height + gap + arrowSize)) {
            placement = 'bottom';
        } else if (spaceTop < (tooltipRect.height + gap + arrowSize) && spaceRight > (tooltipRect.width + gap)) {
            placement = 'right';
        } else if (spaceTop < (tooltipRect.height + gap + arrowSize) && spaceLeft > (tooltipRect.width + gap)) {
            placement = 'left';
        }

        let top, left;

        // 5. CALCULATE COORDINATES
        if (placement === 'top' || placement === 'bottom') {
            top = (placement === 'top')
                ? targetRect.top - tooltipRect.height - gap
                : targetRect.bottom + gap;

            left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

            const minX = padding;
            const maxX = window.innerWidth - tooltipRect.width - padding;
            const clampedLeft = Math.max(minX, Math.min(left, maxX));

            const targetCenter = targetRect.left + (targetRect.width / 2);
            let arrowX = targetCenter - clampedLeft;
            arrowX = Math.max(8, Math.min(arrowX, tooltipRect.width - 8));

            left = clampedLeft;
            tooltip.style.setProperty('--arrow-x', `${Math.round(arrowX)}px`);

        } else {
            left = (placement === 'left')
                ? targetRect.left - tooltipRect.width - gap
                : targetRect.right + gap;

            top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);

            const minY = padding;
            const maxY = window.innerHeight - tooltipRect.height - padding;
            const clampedTop = Math.max(minY, Math.min(top, maxY));

            const targetCenterY = targetRect.top + (targetRect.height / 2);
            let arrowY = targetCenterY - clampedTop;
            arrowY = Math.max(8, Math.min(arrowY, tooltipRect.height - 8));

            top = clampedTop;
            tooltip.style.setProperty('--arrow-y', `${Math.round(arrowY)}px`);
        }

        // Apply final position
        tooltip.style.top = `${Math.round(top)}px`;
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.setAttribute('data-placement', placement);
    };

    // Listeners
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[title], [data-tooltip]');
        if (!target) return;
        if (currentTarget === target) return;

        // 1. Swap title to data-tooltip
        if (target.hasAttribute('title')) {
            const text = target.getAttribute('title');
            if (!text.trim()) return;
            target.setAttribute('data-tooltip', text);
            target.removeAttribute('title');
        }

        // 2. CHECK: Overflow Logic (The "Range" Method)
        if (target.hasAttribute('data-tooltip-overflow')) {
            const range = document.createRange();
            range.selectNodeContents(target);
            const textWidth = range.getBoundingClientRect().width;
            const style = window.getComputedStyle(target);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const contentWidth = target.clientWidth - padding;
            if (textWidth <= contentWidth + 1) return;
        }

        // 3. Show Tooltip
        const text = target.getAttribute('data-tooltip');
        if (text) {
            currentTarget = target;
            showTooltip(target, text);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target && target === currentTarget) {
            tooltip.classList.remove('visible');
            currentTarget = null;
        }
    });

    window.addEventListener('scroll', () => {
        if (tooltip.classList.contains('visible')) {
            tooltip.classList.remove('visible');
            currentTarget = null;
        }
    }, { capture: true, passive: true });
};

// Handle image load states
const initImageLoadStates = (parent = document) => {
    const images = parent.querySelectorAll('img');
    images.forEach(img => {
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => {
                img.classList.add('loaded');
            });
        }
    });
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initCustomTooltips();
    initImageLoadStates();
});

// Re-initialize on page update
document.addEventListener('page:updated', e => {
    initImageLoadStates();
});