const { io } = require('socket.io-client');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('🔗 Connected to websocket server');

    // Pretend to be a development/production script trying to pass only uid
    socket.emit('authenticate', { uid: 'user-001', userType: 'customer' });
});

socket.on('authenticated', (data) => {
    console.log('✅ Authenticated! This SUBVERTS the rules if in production!', data);
    process.exit(1);
});

socket.on('authentication_error', (data) => {
    console.log('❌ Auth Error! Expected if token is missing:', data);
    process.exit(0);
});

socket.on('disconnect', () => {
    console.log('🔌 Disconnected');
});

setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 3000);
