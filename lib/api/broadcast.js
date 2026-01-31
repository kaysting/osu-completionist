const env = require('#env');
const { io } = require('socket.io-client');
const read = require('#api/read.js');
const utils = require('#utils');

// Connect to webserver socket
const socket = io(`http://127.0.0.1:${env.WEBSERVER_PORT}`, {
    path: '/ws',
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    transports: ['websocket']
});

socket.on('connect', () => {
    utils.log('Connected to webserver socket for broadcasting');
});

// Silently fail if we can't connect
socket.on('connect_error', () => {
    //utils.log('Failed to connect to webserver socket for broadcasting');
});

module.exports = (room, event, data) => {
    const secret = read.readMiscData('trusted_socket_secret');
    socket.emit('trusted_broadcast', {
        secret,
        room,
        event,
        data
    });
};
