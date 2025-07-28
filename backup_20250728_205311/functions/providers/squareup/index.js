const { onRequest } = require('firebase-functions/v2/https');
const squareupcheckout = require('./checkout');

exports.link = onRequest(squareupcheckout.render_checkout);
exports.addcard = onRequest(squareupcheckout.add_card);
exports.process = onRequest(squareupcheckout.process_checkout);