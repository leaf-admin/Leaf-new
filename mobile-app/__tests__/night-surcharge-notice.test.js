import fs from 'fs';
import path from 'path';
import {
  buildNightSurchargeNotice,
  isNightSurchargeActive,
  nextNightSurchargeTransition,
  NIGHT_SURCHARGE_END_HOUR,
  NIGHT_SURCHARGE_RATE,
  NIGHT_SURCHARGE_START_HOUR,
} from '../src/screens/prototype/nightSurchargeNotice';

// 23h em Brasília = 02h UTC.
const at = (iso) => new Date(iso);

describe('night surcharge notice', () => {
  it('uses the same rule as the server', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '../../leaf-websocket-backend/services/pricing/nightSurcharge.js'),
      'utf8',
    );
    expect(server).toContain(`const NIGHT_SURCHARGE_RATE = ${NIGHT_SURCHARGE_RATE};`);
    expect(server).toContain(`const NIGHT_SURCHARGE_START_HOUR = ${NIGHT_SURCHARGE_START_HOUR};`);
    expect(server).toContain(`const NIGHT_SURCHARGE_END_HOUR = ${NIGHT_SURCHARGE_END_HOUR};`);
  });

  it('is active from 23h to 4h in Brasília', () => {
    expect(isNightSurchargeActive(at('2026-10-14T01:59:00Z'))).toBe(false); // 22:59
    expect(isNightSurchargeActive(at('2026-10-14T02:00:00Z'))).toBe(true); // 23:00
    expect(isNightSurchargeActive(at('2026-10-14T06:59:00Z'))).toBe(true); // 03:59
    expect(isNightSurchargeActive(at('2026-10-14T07:00:00Z'))).toBe(false); // 04:00
  });

  it('finds the next start and end', () => {
    expect(nextNightSurchargeTransition(at('2026-10-14T15:00:00Z'))).toEqual({
      kind: 'start',
      at: at('2026-10-15T02:00:00Z'),
    });
    expect(nextNightSurchargeTransition(at('2026-10-14T03:30:00Z'))).toEqual({
      kind: 'end',
      at: at('2026-10-14T07:00:00Z'),
    });
  });

  it('lands exactly on the hour even from an odd second', () => {
    expect(nextNightSurchargeTransition(at('2026-10-14T15:00:37Z')).at).toEqual(at('2026-10-15T02:00:00Z'));
  });

  it('tells the driver what changes', () => {
    expect(buildNightSurchargeNotice('start')).toEqual({
      type: 'night_surcharge_started',
      title: 'Adicional noturno começou',
      message: 'Corridas até as 4h valem +15%.',
    });
    expect(buildNightSurchargeNotice('end').title).toBe('Adicional noturno terminou');
    expect(buildNightSurchargeNotice('active').title).toBe('Adicional noturno ativo');
  });
});
