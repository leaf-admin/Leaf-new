const { onRequest } = require('firebase-functions/v2/https');
const paymongocheckout = require('./checkout');

exports.link = onRequest(paymongocheckout.render_checkout);
exports.process = onRequest(paymongocheckout.process_checkout);