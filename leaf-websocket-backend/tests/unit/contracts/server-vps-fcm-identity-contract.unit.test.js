const fs = require('fs');
const path = require('path');

describe('server.vps FCM identity contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../server.vps.js'), 'utf8');
  const start = source.indexOf("socket.on('registerFCMToken'");
  const end = source.indexOf("socket.on('registerRideLiveActivityToken'", start);
  const handlerSource = source.slice(start, end);

  it('binds FCM registration and removal to socket identity rather than payload identity', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handlerSource).toContain('const isAuthenticated = Boolean(socket.userId)');
    expect(handlerSource).toContain('const effectiveUserId = socket.userId || `temp_${socket.id}`');
    expect(handlerSource).not.toMatch(/const\s*\{[^}]*userId[^}]*\}\s*=\s*(data|payload)/);
    expect(handlerSource).not.toContain('removeUserFCMToken(userId, fcmToken)');
  });
});
