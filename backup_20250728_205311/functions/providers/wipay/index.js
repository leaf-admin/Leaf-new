const { onRequest } = require('firebase-functions/v2/https');
const wipaycheckout = require('./checkout');

exports.link = onRequest(wipaycheckout.render_checkout);
exports.process = onRequest(wipaycheckout.process_checkout);