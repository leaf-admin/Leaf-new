const { onRequest } = require('firebase-functions/v2/https');
const paytmcheckout = require('./checkout');

exports.link = onRequest(paytmcheckout.render_checkout);
exports.process = onRequest(paytmcheckout.process_checkout);