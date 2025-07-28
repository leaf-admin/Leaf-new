const { onRequest } = require('firebase-functions/v2/https');
const payulatamcheckout = require('./checkout');

exports.link = onRequest(payulatamcheckout.render_checkout);
exports.process = onRequest(payulatamcheckout.process_checkout);
