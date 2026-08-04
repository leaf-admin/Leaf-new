const fs = require('fs');
const path = require('path');

describe('start-http-server GraphQL legacy removal', () => {
  const backendRoot = path.resolve(__dirname, '../../..');
  const serverSource = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(
    path.join(backendRoot, 'bootstrap/start-http-server.js'),
    'utf8'
  );

  it('does not load or inject an Apollo middleware into the live server', () => {
    expect(serverSource).not.toContain("require('./graphql/server')");
    expect(serverSource).not.toContain('applyMiddleware,');
    expect(bootstrapSource).not.toContain('initializeGraphQL');
    expect(bootstrapSource).not.toContain('applyMiddleware');
  });

  it('keeps the retired endpoint explicitly unmounted before HTTP startup', () => {
    expect(bootstrapSource).toContain('const graphqlMounted = false;');
    expect(bootstrapSource).toContain('GraphQL legado removido, iniciando servidor HTTP');
  });
});
