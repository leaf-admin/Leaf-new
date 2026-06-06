import Polyline from '@mapbox/polyline';

import {
  GetDistance,
  calcularPedagiosPorPolyline,
} from '../src/services/canonical/locationService';

describe('locationService GetDistance', () => {
  it('returns zero for equal coordinates', () => {
    expect(GetDistance(-22.984, -43.203, -22.984, -43.203)).toBe(0);
  });

  it('keeps the legacy distance calculation in kilometers', () => {
    const copacabanaToLeblon = GetDistance(-22.9711, -43.1822, -22.9837, -43.2232);
    expect(copacabanaToLeblon).toBeCloseTo(4.42, 1);
  });

  it('calculates tolls crossed by an encoded route polyline', () => {
    const routePolyline = Polyline.encode([
      [0, 0],
      [0, 0.01],
    ]);

    const result = calcularPedagiosPorPolyline(routePolyline, [
      {
        'Praça de Pedágio': 'Pedágio Teste',
        Latitude: '0',
        Longitude: '0.005',
        'Tarifa Automóvel (R$)': '5.50',
      },
    ], 1);

    expect(result.pedagiosCruzados).toHaveLength(1);
    expect(result.valorTotal).toBe(5.5);
  });
});
