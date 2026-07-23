const fs = require('fs');
const path = require('path');

describe('support realtime source boundary', () => {
  it('does not broadcast support payloads to an entire root namespace', () => {
    const files = [
      '../../../routes/support.js',
      '../../../services/support-chat-service.js',
      '../../../bootstrap/register-socket-safety-support-handlers.js'
    ];

    files.forEach((relativePath) => {
      const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
      expect(source).not.toMatch(/(?:ioInstance|this\.io|io)\.emit\(['"]support:/);
    });
  });

  it('uses the shared authenticated dashboard and exact-owner publisher', () => {
    const publisherSource = fs.readFileSync(
      path.join(__dirname, '../../../services/support-realtime-publisher.js'),
      'utf8'
    );

    expect(publisherSource).toContain("const DASHBOARD_NAMESPACE = '/dashboard'");
    expect(publisherSource).toContain("const DASHBOARD_AUTHENTICATED_ROOM = 'dashboard:authenticated'");
    expect(publisherSource).toContain('io.to(roomName)');
    expect(publisherSource).not.toMatch(/\bio\.emit\(/);
  });
});
