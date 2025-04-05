const { onRequest } = require('firebase-functions/v2/https');
const xenditcheckout = require('./checkout');

exports.link = onRequest(xenditcheckout.render_checkout);
exports.process = onRequest(xenditcheckout.process_checkout);