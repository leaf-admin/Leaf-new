const { onRequest } = require('firebase-functions/v2/https');
const paystackcheckout = require('./checkout');

exports.link = onRequest(paystackcheckout.render_checkout);
exports.process = onRequest(paystackcheckout.process_checkout);