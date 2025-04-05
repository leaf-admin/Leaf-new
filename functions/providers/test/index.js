const { onRequest } = require('firebase-functions/v2/https');
const testcheckout = require('./checkout');

exports.link = onRequest(testcheckout.render_checkout);
exports.process = onRequest(testcheckout.process_checkout);