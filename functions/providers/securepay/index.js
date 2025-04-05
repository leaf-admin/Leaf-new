const { onRequest } = require('firebase-functions/v2/https');
const securepaycheckout = require('./checkout');

exports.link = onRequest(securepaycheckout.render_checkout);
exports.process = onRequest(securepaycheckout.process_checkout);