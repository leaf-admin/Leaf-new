const { onRequest } = require('firebase-functions/v2/https');
const paypalcheckout = require('./checkout');

exports.link = onRequest(paypalcheckout.render_checkout);
exports.process = onRequest(paypalcheckout.process_checkout);