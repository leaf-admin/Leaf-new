jest.unmock('express');

const express = require('express');
const request = require('supertest');
const legalPages = require('../../../routes/legal-pages');

function app() {
  const server = express();
  server.use(legalPages);
  return server;
}

describe('legal pages', () => {
  afterEach(() => {
    delete process.env.LEGAL_PAGES_REDIRECT;
    delete process.env.LEAF_LEGAL_SITE_URL;
  });

  it.each([
    ['/terms', 'https://leaf.app.br/terms-of-service'],
    ['/terms-of-service', 'https://leaf.app.br/terms-of-service'],
    ['/privacy', 'https://leaf.app.br/privacy-policy'],
    ['/refund-policy', 'https://leaf.app.br/refund-policy'],
    ['/delete-account', 'https://leaf.app.br/delete-account'],
    ['/support', 'https://leaf.app.br/support']
  ])('redirects %s to the site text', async (path, target) => {
    const response = await request(app()).get(path).expect(302);
    expect(response.headers.location).toBe(target);
  });

  it('lists the site URLs', async () => {
    const response = await request(app()).get('/api/legal/links').expect(200);
    expect(response.body.termsOfServiceUrl).toBe('https://leaf.app.br/terms-of-service');
  });

  it('serves the old copy when redirects are off', async () => {
    process.env.LEGAL_PAGES_REDIRECT = 'false';
    const response = await request(app()).get('/privacy-policy').expect(200);
    expect(response.text).toContain('Nos formulários do site');
  });
});
