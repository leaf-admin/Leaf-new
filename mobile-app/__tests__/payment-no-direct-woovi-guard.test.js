const fs = require('fs');
const path = require('path');

const ACTIVE_PAYMENT_FILES = [
  'src/services/WooviService.js',
  'src/services/paymentService.js',
  'src/services/canonical/paymentService.js',
  'src/components/PixPayment.js',
  'src/components/payment/WooviPaymentModal.js',
];

const LEGACY_DIRECT_WOOVI_FILES = [
  { file: 'src/services/WooviDriverService.js', note: 'calls api.woovi.com directly via axios - legacy, not in active payment path' },
  { file: 'config/WooviConfig.js', note: 'defines baseUrl = https://api.woovi.com/api/v1 - legacy config, not imported by active payment services' },
  { file: 'src/hooks/useWooviDriver.js', note: 'consumes WooviDriverService - legacy hook, not part of active Pix payment flow' },
];

describe('payment: no direct Woovi provider call in active production path', () => {
  for (const relPath of ACTIVE_PAYMENT_FILES) {
    const absPath = path.join(__dirname, '..', relPath);
    const source = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;

    if (source === null) {
      it(`${relPath} — file not found`, () => {
        expect(absPath).toBe('FILE_SHOULD_EXIST');
      });
      continue;
    }

    describe(`${relPath}`, () => {
      it('does not contain direct Woovi API host', () => {
        expect(source).not.toMatch(/api\.woovi\.com/);
      });

      it('does not contain WooviConfig.baseUrl', () => {
        expect(source).not.toMatch(/WooviConfig\.baseUrl/);
      });

      it('does not construct a direct Woovi axios client', () => {
        expect(source).not.toMatch(/baseURL.*woovi/i);
      });

      it('does not set direct Woovi Authorization or X-App-ID headers', () => {
        expect(source).not.toMatch(/['"]Authorization['"]\s*[:=]/);
        expect(source).not.toMatch(/['"]X-App-ID['"]\s*[:=]/);
      });

      if (relPath === 'src/services/WooviService.js' || relPath === 'src/services/paymentService.js') {
        it('uses Leaf backend path /api/payment/advance', () => {
          expect(source).toMatch(/\/api\/payment\/advance/);
        });

        it('uses Leaf backend path /api/payment/status', () => {
          expect(source).toMatch(/\/api\/payment\/status/);
        });
      }
    });
  }
});

describe('payment: legacy direct-Woovi files documented for follow-up', () => {
  for (const { file, note } of LEGACY_DIRECT_WOOVI_FILES) {
    it(`TODO - ${file}: ${note}`, () => {
      const absPath = path.join(__dirname, '..', file);
      expect(fs.existsSync(absPath)).toBe(true);
    });
  }
});
