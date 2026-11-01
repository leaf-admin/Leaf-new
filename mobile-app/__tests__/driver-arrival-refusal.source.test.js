const fs = require('fs');
const path = require('path');

const runtime = fs.readFileSync(
  path.join(__dirname, '../src/screens/prototype/prototypeRideRuntime.js'),
  'utf8',
);

describe('driver arrival refusal', () => {
  it('treats only a successful arrivedAtPickup as an arrival', () => {
    const handler = runtime.slice(runtime.indexOf('const handleDriverArrived = (payload) => {'));

    expect(handler.indexOf('payload?.success === false')).toBeGreaterThan(-1);
    expect(handler.indexOf('payload?.success === false')).toBeLessThan(
      handler.indexOf('startBoardingCountdown(deadlineAt)'),
    );
    expect(runtime).toContain('socket.on("arrivedAtPickup", handleDriverArrived)');
  });
});
