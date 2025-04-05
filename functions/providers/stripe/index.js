const { onRequest } = require('firebase-functions/v2/https');
const stripecheckout = require('./checkout');

exports.link = onRequest(stripecheckout.render_checkout);
exports.process = onRequest(stripecheckout.process_checkout);