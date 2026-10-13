const {
  REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT,
  evaluateRequestVolume
} = require('../../../../services/pricing/volumeGuard');

describe('pricing/volumeGuard', () => {
  test('sinaliza somente quando a queda supera 30%', () => {
    const atThreshold = evaluateRequestVolume({
      currentRequests5m: 7,
      expectedRequests5m: 10
    });
    const aboveThreshold = evaluateRequestVolume({
      currentRequests5m: 6.9,
      expectedRequests5m: 10
    });

    expect(atThreshold).toMatchObject({
      dropPercent: 30,
      thresholdPercent: REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT,
      alert: false
    });
    expect(aboveThreshold).toMatchObject({
      dropPercent: 31,
      alert: true
    });
  });

  test('não cria alerta quando o baseline não está disponível', () => {
    expect(evaluateRequestVolume({
      currentRequests5m: 0,
      expectedRequests5m: null
    })).toMatchObject({
      expected5m: null,
      baselineAvailable: false,
      dropPercent: 0,
      alert: false
    });
  });
});
