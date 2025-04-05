const { onRequest } = require('firebase-functions/v2/https');
const culqicheckout = require('./checkout');

exports.link = onRequest(culqicheckout.render_checkout);
exports.process = onRequest(culqicheckout.process_checkout);