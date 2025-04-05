const { onRequest } = require('firebase-functions/v2/https');
const payfastcheckout = require('./checkout');

exports.link = onRequest(payfastcheckout.render_checkout);
exports.process = onRequest(payfastcheckout.process_checkout);