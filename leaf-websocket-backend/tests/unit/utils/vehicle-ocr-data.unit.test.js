'use strict';

const {
  buildVehicleOcrUpdates,
  normalizeColor,
  normalizePlate,
  normalizeVehicleOcrPayload,
  sanitizeVehicleOcrData
} = require('../../../utils/vehicle-ocr-data');

describe('vehicle-ocr-data', () => {
  it('normalizes CRLV color aliases into canonical vehicle fields', () => {
    expect(normalizeColor('branca')).toBe('BRANCO');
    expect(normalizeColor('PRETA')).toBe('PRETO');
    expect(normalizeColor('cor predominante: prata')).toBe('PRATA');
  });

  it('normalizes plate and OCR aliases from CRLV payloads', () => {
    const normalized = normalizeVehicleOcrPayload({
      placa: 'rja-2d41',
      cor: 'branca',
      marca: 'Honda',
      modelo: 'City EX',
      anoModelo: '2024',
      renavam: '123.456.789-00',
      chassi: '9BWZZZ377VT004251'
    });

    expect(normalized).toEqual(expect.objectContaining({
      plate: 'RJA2D41',
      plateNormalized: 'RJA2D41',
      color: 'BRANCO',
      vehicleColor: 'BRANCO',
      carColor: 'BRANCO',
      cor: 'BRANCO',
      make: 'Honda',
      brand: 'Honda',
      model: 'City EX',
      year: '2024',
      renavam: '12345678900',
      chassis: '9BWZZZ377VT004251',
      vin: '9BWZZZ377VT004251'
    }));
  });

  it('keeps sensitive OCR artifacts out of persisted audit data', () => {
    const sanitized = sanitizeVehicleOcrData({
      cor: 'preto',
      auditImage: 'data:image/jpeg;base64,secret',
      rawText: 'documento completo',
      textoCompleto: 'documento completo',
      fileName: 'crlv.pdf'
    });

    expect(sanitized).toEqual({
      cor: 'preto',
      fileName: 'crlv.pdf'
    });
  });

  it('builds field-level Firebase updates without overwriting vehicle nodes', () => {
    const { updates, normalized } = buildVehicleOcrUpdates({
      vehicleId: 'vehicle_1',
      userId: 'driver_1',
      userVehicleId: 'driver_vehicle_1',
      payload: {
        placa: 'abc1d23',
        cor: 'preta',
        modelo: 'Prius'
      },
      metadata: {
        fileName: 'crlv.pdf',
        auditImage: 'data:image/jpeg;base64,secret'
      },
      nowIso: '2026-06-20T09:00:00.000Z'
    });

    expect(normalized.color).toBe('PRETO');
    expect(updates['vehicles/vehicle_1']).toBeUndefined();
    expect(updates['user_vehicles/driver_1/driver_vehicle_1']).toBeUndefined();
    expect(updates['vehicles/vehicle_1/color']).toBe('PRETO');
    expect(updates['vehicles/vehicle_1/vehicleColor']).toBe('PRETO');
    expect(updates['vehicles/vehicle_1/plate']).toBe('ABC1D23');
    expect(updates['user_vehicles/driver_1/driver_vehicle_1/color']).toBe('PRETO');
    expect(updates['vehicles/vehicle_1/ocrData'].metadata).toEqual({ fileName: 'crlv.pdf' });
  });
});
