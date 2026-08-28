const fs = require('fs');
const path = require('path');

describe('nginx dashboard routing contract', () => {
  const nginx = fs.readFileSync(
    path.resolve(__dirname, '../../../nginx.conf'),
    'utf8',
  );

  test('routes the dashboard host to the Next dashboard upstream', () => {
    expect(nginx).toContain('upstream leaf_dashboard');
    expect(nginx).toContain('server leaf-dashboard:3000');
    expect(nginx.match(/server_name dashboard\.leaf\.app\.br;/g)).toHaveLength(2);
    expect(nginx.match(/proxy_pass http:\/\/leaf_dashboard;/g)).toHaveLength(2);
  });

  test('does not route the dashboard host through the backend upstream', () => {
    expect(nginx).not.toContain(
      'server_name leaf.app.br api.leaf.app.br socket.leaf.app.br dashboard.leaf.app.br _;',
    );
    expect(nginx).not.toContain(
      'server_name api.leaf.app.br socket.leaf.app.br dashboard.leaf.app.br;',
    );
  });
});
