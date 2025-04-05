const { onRequest } = require('firebase-functions/v2/https');
const tapcheckout = require('./checkout');

exports.link = onRequest(tapcheckout.render_checkout);
exports.process = onRequest(tapcheckout.process_checkout);