#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const srcDir = path.join(rootDir, 'mobile-app', 'src');

const requiredSelectors = [
  ['auth-phone-input', /auth-phone-input/],
  ['auth-continue-btn', /auth-continue-btn/],
  ['auth-otp-digit dynamic ids', /auth-otp-digit-\$\{index\}/],
  ['auth-profile-option-customer', /auth-profile-option-\$\{option\.key\}/],
  ['driver-email-input', /driver-email-input/],
  ['passenger-home-destination-input', /passenger-home-destination-input/],
  ['passenger-destination-search-input', /passenger-destination-search-input/],
  ['passenger-destination-confirm-button', /passenger-destination-confirm-button/],
  ['passenger-payment-pay-pix-button', /passenger-payment-pay-pix-button/],
  ['passenger-driver-search-elapsed', /passenger-driver-search-elapsed/],
  ['passenger-trip-screen', /passenger-trip-screen/],
  ['passenger-trip-cancel-button', /passenger-trip-cancel-button/],
  ['passenger-trip-support-button', /passenger-trip-support-button/],
  ['passenger-receipt-screen', /passenger-receipt-screen/],
  ['passenger-receipt-rate-trip-button', /passenger-receipt-rate-trip-button/],
  ['passenger-rating-submit-button', /passenger-rating-submit-button/],
  ['driver-home-toggle-online', /driver-home-toggle-online/],
  ['driver-live-offer-accept-button', /driver-live-offer-accept-button/],
  ['driver-live-primary-action-arrive-button', /driver-live-primary-action-arrive-button/],
  ['driver-live-primary-action-start-button', /driver-live-primary-action-start-button/],
  ['driver-live-primary-action-complete-button', /driver-live-primary-action-complete-button/],
  ['driver-receipt-screen', /driver-receipt-screen/],
  ['support-screen', /support-screen/],
  ['support-chat-message-input', /support-chat-message-input/],
  ['support-ticket-screen', /support-ticket-screen/],
  ['support-ticket-open-create-button', /support-ticket-open-create-button/],
  ['support-ticket-subject-input', /support-ticket-subject-input/],
  ['support-ticket-description-input', /support-ticket-description-input/],
  ['driver-vehicles-screen', /driver-vehicles-screen/],
  ['driver-vehicle-add-button', /driver-vehicle-add-button/],
  ['driver-vehicle-confirm-active-button', /driver-vehicle-confirm-active-button/],
  ['driver-add-vehicle-screen', /driver-add-vehicle-screen/],
  ['driver-add-vehicle-submit-button', /driver-add-vehicle-submit-button/],
  ['driver-withdraw-screen', /driver-withdraw-screen/],
  ['driver-withdraw-submit-button', /driver-withdraw-submit-button/]
];

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, output);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      output.push(absolute);
    }
  }
  return output;
}

const corpus = walk(srcDir)
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const missing = requiredSelectors
  .filter(([, pattern]) => !pattern.test(corpus))
  .map(([label]) => label);

if (missing.length > 0) {
  console.error('Seletores mobile obrigatorios ausentes:');
  missing.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Mobile testID guard: PASS (${requiredSelectors.length} selectors)`);
