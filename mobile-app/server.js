/**
 * @deprecated Legacy Express server entry point inside mobile-app.
 * This mounts the legacy wooviWebhook route. Not used by Expo/RN runtime.
 * Active payment processing is handled by the Leaf backend.
 */
const wooviWebhook = require('./routes/wooviWebhook');
app.use('/api', wooviWebhook); 