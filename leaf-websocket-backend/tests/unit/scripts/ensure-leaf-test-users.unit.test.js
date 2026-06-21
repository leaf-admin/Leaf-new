'use strict';

const {
  resolveTestVehicleIdentity,
} = require('../../../scripts/tests/ensure-leaf-test-users.cjs');

describe('ensure-leaf-test-users vehicle fixture', () => {
  it('provisions a complete explicitly labeled CRLV fixture', () => {
    const identity = resolveTestVehicleIdentity({
      currentVehicle: {},
      carPlate: 'TES6789',
      nowIso: '2026-06-21T02:00:00.000Z',
      env: {},
    });

    expect(identity).toEqual(expect.objectContaining({
      vehicleMake: 'Toyota',
      vehicleModel: 'Prius',
      vehicleColor: 'PRETO',
      vehicleIdentitySource: 'qa_crlv_fixture',
    }));
    expect(identity.vehicleOcrData).toEqual(expect.objectContaining({
      source: 'qa_crlv_fixture',
      metadata: expect.objectContaining({ fixture: true }),
      data: {
        plate: 'TES6789',
        make: 'Toyota',
        model: 'Prius',
        color: 'PRETO',
      },
    }));
  });

  it('preserves real CRLV OCR data instead of replacing it with fixture metadata', () => {
    const currentOcrData = {
      source: 'crlv_pdf_ocr',
      data: { plate: 'RJA2D41', model: 'City', color: 'BRANCO' },
    };
    const identity = resolveTestVehicleIdentity({
      currentVehicle: {
        make: 'Honda',
        model: 'City',
        color: 'BRANCO',
        ocrData: currentOcrData,
      },
      carPlate: 'RJA2D41',
      nowIso: '2026-06-21T02:00:00.000Z',
      env: {},
    });

    expect(identity.vehicleIdentitySource).toBe('crlv_pdf_ocr');
    expect(identity.vehicleOcrData).toBe(currentOcrData);
  });

  it('does not invent a color when real CRLV OCR is incomplete', () => {
    const identity = resolveTestVehicleIdentity({
      currentVehicle: {
        plate: 'RIO2A34',
        make: 'Honda',
        model: 'City',
        ocrData: {
          source: 'crlv_pdf_ocr',
          data: { plate: 'RIO2A34', make: 'Honda', model: 'City' }
        }
      },
      carPlate: 'RIO2A34',
      nowIso: '2026-06-20T20:00:00.000Z',
      env: {}
    });

    expect(identity.vehicleIdentitySource).toBe('crlv_pdf_ocr');
    expect(identity.vehicleColor).toBe('');
    expect(identity.vehicleOcrData.data.color).toBeUndefined();
  });
});
