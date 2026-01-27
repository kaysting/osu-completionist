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
            const reloadSelectors = [];

            targets.forEach(el => {
                if (el.dataset.reloadSocketEvent) {
                    const events = el.dataset.reloadSocketEvent.split(',').map(e => e.trim());
                    if (events.includes(event) && el.id) {
                        reloadSelectors.push(`#${el.id}`);
                    }
                }
            });

            // Reload the elements
            if (reloadSelectors.length > 0) {
                console.log(`Reloading elements:`, reloadSelectors);
                if (typeof reloadElement === 'function') {
                    reloadElement(reloadSelectors, {
                        silent: true
                    });
                }
            }
        });
    });

});