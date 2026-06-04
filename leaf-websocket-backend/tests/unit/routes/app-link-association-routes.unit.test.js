jest.unmock('express');

const express = require('express');
const request = require('supertest');

function createApp() {
  const appLinkAssociationRoutes = require('../../../routes/app-link-association');
  const app = express();
  app.use('/', appLinkAssociationRoutes);
  return app;
}

describe('app-link-association routes', () => {
  it('serves Apple association with all public app link paths', async () => {
    const response = await request(createApp())
      .get('/.well-known/apple-app-site-association')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.body.applinks.details[0].appIDs).toContain('DTA8W5KA5D.br.com.leaf.ride');
    expect(response.body.applinks.details[0].paths).toEqual([
      '/convite/*',
      '/motorista/convite/*',
      '/viagem/*'
    ]);
  });

  it('serves Android asset links for the production package', async () => {
    const response = await request(createApp())
      .get('/.well-known/assetlinks.json')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body[0].target).toMatchObject({
      namespace: 'android_app',
      package_name: 'br.com.leaf.ride'
    });
    expect(response.body[0].target.sha256_cert_fingerprints[0]).toMatch(/^B8:A2/);
  });

  it.each([
    ['/convite/ABC123', 'leafapp://convite/ABC123', 'Convite Leaf'],
    ['/motorista/convite/DRV123', 'leafapp://motorista/convite/DRV123', 'Convite para dirigir na Leaf'],
    ['/viagem/TRIP123', 'leafapp://viagem/TRIP123', 'Acompanhar viagem']
  ])('serves a fallback page for %s', async (path, deepLink, title) => {
    const response = await request(createApp())
      .get(path)
      .set('Host', 'leaf.app.br')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain(title);
    expect(response.text).toContain(deepLink);
    expect(response.text).toContain(`https://leaf.app.br${path}`);
  });
});
