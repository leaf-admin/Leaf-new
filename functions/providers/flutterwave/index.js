const { onRequest } = require('firebase-functions/v2/https');
const flutterwavecheckout = require('./checkout');

exports.link = onRequest(flutterwavecheckout.render_checkout);
exports.process = onRequest(flutterwavecheckout.process_checkout);
