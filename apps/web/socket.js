const utils = require('#utils');
const read = require('#api/read.js');

module.exports = io => {

    io.on('connection', socket => {

        utils.log(`New socket connection: ${socket.id}`);

        socket.on('disconnect', () => {
            utils.log(`Socket disconnected: ${socket.id}`);
        });

        socket.on('subscribe', room => {
            socket.join(room);
            utils.log(`Socket ${socket.id} subscribed to room: ${room}`);
        });

        socket.on('unsubscribe', room => {
            socket.leave(room);
            utils.log(`Socket ${socket.id} unsubscribed from room: ${room}`);
        });

        socket.on('trusted_broadcast', payload => {
            const TRUSTED_BROADCAST_SECRET = read.readMiscData('trusted_socket_secret');
            const {
                secret,
                room,
                event,
                data
            } = payload;
            if (secret !== TRUSTED_BROADCAST_SECRET) {
                utils.log(`Socket ${socket.id} attempted to broadcast with invalid secret`);
                return;
            }
            utils.log(`Broadcasting event '${event}' to ${room ? `room '${room}'` : 'all sockets'}`);
            if (room)
                io.to(room).emit(event, data);
            else
                io.emit(event, data);
        });

    });

};