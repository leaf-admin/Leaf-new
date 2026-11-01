jest.unmock('express');

const express = require('express');
const request = require('supertest');
const legalPages = require('../../../routes/legal-pages');

describe('legal pages', () => {
  it('serves the privacy policy with the site forms section', async () => {
    const app = express();
    app.use(legalPages);
    const response = await request(app).get('/privacy-policy').expect(200);
    expect(response.text).toContain('Nos formulários do site');
  });
});
