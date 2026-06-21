'use strict';

const {
  buildDriverVehicleIdentity,
  resolveVehicleIdentitySource,
} = require('../../../utils/driver-vehicle-identity');

describe('driver-vehicle-identity', () => {
  it('marks a complete CRLV identity as canonical', () => {
    expect(buildDriverVehicleIdentity({
      activeVehicleId: 'vehicle_1',
      vehiclePlate: 'RJA2D41',
      vehicleMake: 'Honda',
      vehicleModel: 'City',
      vehicleColor: 'BRANCO',
      vehicleIdentitySource: 'crlv_pdf_ocr',
    })).toEqual({
      activeVehicleId: 'vehicle_1',
      plate: 'RJA2D41',
      make: 'Honda',
      model: 'City',
      color: 'BRANCO',
      source: 'crlv_pdf_ocr',
      canonical: true,
      complete: true,
    });
  });

  it('keeps an identity incomplete when the CRLV color is absent', () => {
    expect(buildDriverVehicleIdentity({
      vehiclePlate: 'RJA2D41',
      vehicleModel: 'City',
      vehicleIdentitySource: 'crlv_pdf_ocr',
    })).toEqual(expect.objectContaining({
      color: null,
      canonical: true,
      complete: false,
    }));
  });

  it('prefers explicit CRLV provenance over catalog and legacy records', () => {
    expect(resolveVehicleIdentitySource({
      vehicle: {
        plate: 'RJA2D41',
        model: 'City',
        color: 'BRANCO',
        ocrData: { source: 'crlv_pdf_ocr' },
      },
      user: { carPlate: 'LEG0001' },
    })).toBe('crlv_pdf_ocr');
  });

  it('keeps the explicitly labeled QA CRLV fixture canonical without calling it real OCR', () => {
    expect(buildDriverVehicleIdentity({
      vehiclePlate: 'TES6789',
      vehicleModel: 'Prius',
      vehicleColor: 'PRETO',
      vehicleIdentitySource: 'qa_crlv_fixture',
    })).toEqual(expect.objectContaining({
      source: 'qa_crlv_fixture',
      canonical: true,
      complete: true,
    }));
  });
});
