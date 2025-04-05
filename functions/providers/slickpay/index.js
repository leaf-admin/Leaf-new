const { onRequest } = require('firebase-functions/v2/https');
const slickpaycheckout = require('./checkout');

exports.link = onRequest(slickpaycheckout.render_checkout);
exports.process = onRequest(slickpaycheckout.process_checkout);