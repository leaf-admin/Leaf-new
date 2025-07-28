const { onRequest } = require('firebase-functions/v2/https');
const mercadopagocheckout = require('./checkout');

exports.link = onRequest(mercadopagocheckout.render_checkout);
exports.process = onRequest(mercadopagocheckout.process_checkout);