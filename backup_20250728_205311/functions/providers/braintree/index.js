const { onRequest } = require('firebase-functions/v2/https');
const braintreecheckout = require('./checkout');

exports.link = onRequest(braintreecheckout.render_checkout);
exports.process = onRequest(braintreecheckout.process_checkout);