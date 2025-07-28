const { onRequest } = require('firebase-functions/v2/https');
const razorpaycheckout = require('./checkout');

exports.link = onRequest(razorpaycheckout.render_checkout);
exports.process = onRequest(razorpaycheckout.process_checkout);