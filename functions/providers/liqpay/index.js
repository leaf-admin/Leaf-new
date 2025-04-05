const { onRequest } = require('firebase-functions/v2/https');
const liqpaycheckout = require('./checkout');

exports.link = onRequest(liqpaycheckout.render_checkout);
exports.process = onRequest(liqpaycheckout.process_checkout);