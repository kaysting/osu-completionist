// Use the sharing api or clipboard write to share text
const copyText = async text => {
    try {
        await navigator.clipboard.writeText(text);
        showPopup(
            'Text copied!',
            `<pre><code>${text}</code></pre>`,
            [{ label: 'Okay' }]
        );
    } catch (err) {
        showPopup(
            'Clipboard copy failed',
            `<p>We couldn't copy the text for you, so you'll have to do it yourself:</p>
        <pre><code>${text}</code></pre>`,
            [{ label: 'Close' }]
        );
        console.error('Error copying to clipboard:', err);
    }
};

const copyImage = async (imageUrl) => {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob })
        ]);
        showPopup(
            'Image copied!',
            `<p>The image has been copied to your clipboard.</p>`,
            [{ label: 'Okay' }]
        );
    } catch (err) {
        showPopup(
            'Clipboard copy failed',
            `<p>We couldn't copy the image for you, so you'll have to do it yourself:</p>
        <pre><code>${imageUrl}</code></pre>`,
            [{ label: 'Close' }]
        );
        console.error('Error copying image to clipboard:', err);
    }
};

const downloadFile = (fileUrl, filename) => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

    // 1. PROMOTE TO TOP LAYER
    // This allows the tooltip to float above native <dialog> elements
    tooltip.popover = "manual";
    tooltip.style.margin = '0'; // Prevent default user-agent margins from affecting math

    document.body.appendChild(tooltip);

    let currentTarget = null;

    const showTooltip = (target, text) => {
        // RESET to defaults (Single line mode)
        tooltip.style.whiteSpace = 'nowrap';
        tooltip.style.width = 'auto';
        tooltip.style.top = '0px';
        tooltip.style.left = '0px';
        tooltip.style.removeProperty('--arrow-x');
        tooltip.style.removeProperty('--arrow-y');

        // Set text
        tooltip.textContent = text;

        // 2. SHOW POPOVER (Renders it to DOM so we can measure it)
        tooltip.showPopover();
        tooltip.classList.add('visible');

        // MEASURE natural width
        let tooltipRect = tooltip.getBoundingClientRect();

        // CONDITIONAL WRAPPING
        const maxWidth = 350;
        if (tooltipRect.width > maxWidth) {
            tooltip.style.whiteSpace = 'normal';
            tooltip.style.width = `${maxWidth}px`;
            tooltipRect = tooltip.getBoundingClientRect(); // Re-measure height
        }

        const targetRect = target.getBoundingClientRect();
        const arrowSize = 6;
        const gap = 6;
        const padding = 10;

        // DETERMINE PLACEMENT
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

        // CALCULATE COORDINATES
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

        // Swap title to data-tooltip
        if (target.hasAttribute('title')) {
            const text = target.getAttribute('title');
            if (!text.trim()) return;
            target.setAttribute('data-tooltip', text);
            target.removeAttribute('title');
        }

        // Overflow Logic
        if (target.hasAttribute('data-tooltip-overflow')) {
            const range = document.createRange();
            range.selectNodeContents(target);
            const textWidth = range.getBoundingClientRect().width;
            const style = window.getComputedStyle(target);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const contentWidth = target.clientWidth - padding;
            if (textWidth <= contentWidth + 1) return;
        }

        // Show Tooltip
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

            // 3. CLEAN UP POPOVER
            // Wait for CSS transition (opacity) to finish before removing from DOM
            setTimeout(() => {
                if (!tooltip.classList.contains('visible')) {
                    tooltip.hidePopover();
                }
            }, 200);

            currentTarget = null;
        }
    });

    window.addEventListener('scroll', () => {
        if (tooltip.classList.contains('visible')) {
            tooltip.classList.remove('visible');
            tooltip.hidePopover();
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