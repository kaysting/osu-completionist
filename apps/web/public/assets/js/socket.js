document.addEventListener('DOMContentLoaded', () => {
    // Connect to socket
    const socket = io('/', {
        path: '/ws'
    });

    // Subscribe to rooms on connect
    socket.on('connect', () => {
        console.log('Connected to socket');

        // Use a Set to avoid subscribing to 'user_123' multiple times
        const rooms = new Set();
        document.querySelectorAll('[data-reload-socket-room]').forEach(el => {
            if (el.dataset.reloadSocketRoom) {
                el.dataset.reloadSocketRoom.split(',').forEach(room => {
                    rooms.add(room.trim());
                });
            }
        });

        rooms.forEach(room => {
            console.log(`Subscribing to ${room}`);
            socket.emit('subscribe', room);
        });
    });

    // Find all unique event names
    const uniqueEvents = new Set();
    document.querySelectorAll('[data-reload-socket-event]').forEach(el => {
        if (el.dataset.reloadSocketEvent) {
            el.dataset.reloadSocketEvent.split(',').forEach(event => {
                uniqueEvents.add(event.trim());
            });
        }
    });

    // Register one listener per event
    uniqueEvents.forEach(event => {
        socket.on(event, () => {
            console.log(`Received socket event: ${event}`);

            // Find all elements that care about this specific event (including comma-separated)
            const targets = document.querySelectorAll(`[data-reload-socket-event]`);

            // Group elements by their reload URL
            const urlGroups = new Map();

            targets.forEach(el => {
                if (el.dataset.reloadSocketEvent) {
                    const events = el.dataset.reloadSocketEvent.split(',').map(e => e.trim());
                    if (events.includes(event) && el.id) {
                        // Get the reload URL from the element, default to current URL
                        const reloadUrl = el.dataset.reloadUrl || window.location.href;

                        if (!urlGroups.has(reloadUrl)) {
                            urlGroups.set(reloadUrl, []);
                        }
                        urlGroups.get(reloadUrl).push(`#${el.id}`);
                    }
                }
            });

            // Reload elements grouped by URL
            if (urlGroups.size > 0) {
                urlGroups.forEach((reloadSelectors, reloadUrl) => {
                    console.log(`Reloading elements from ${reloadUrl}:`, reloadSelectors);
                    if (typeof reloadElement === 'function') {
                        reloadElement(reloadSelectors, {
                            url: reloadUrl,
                            silent: true
                        });
                    }
                });
            }
        });
    });
});
