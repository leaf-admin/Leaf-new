const { onRequest } = require('firebase-functions/v2/https');
const iyzicocheckout = require('./checkout');

exports.link = onRequest(iyzicocheckout.render_checkout);
exports.process = onRequest(iyzicocheckout.process_checkout);