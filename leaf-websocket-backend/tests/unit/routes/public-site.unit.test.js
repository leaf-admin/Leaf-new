jest.unmock('express');

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockDocuments = new Map();

function mockDocument(path) {
  return {
    path,
    get: async () => ({ exists: mockDocuments.has(path), data: () => mockDocuments.get(path) }),
    set: async (value) => { mockDocuments.set(path, value); }
  };
}

jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { increment: (value) => ({ increment: value }), serverTimestamp: () => 'now' } }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: () => ({
    collection: (name) => ({
      doc: (id) => mockDocument(`${name}/${id}`),
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: [...mockDocuments.entries()]
              .filter(([key]) => key.startsWith(`${name}/`))
              .map(([key, value]) => ({ id: key.split('/')[1], data: () => value }))
          })
        })
      })
    }),
    batch: () => {
      const steps = [];
      return {
        create: (doc, value) => steps.push(() => {
          if (mockDocuments.has(doc.path)) throw Object.assign(new Error('exists'), { code: 6 });
          mockDocuments.set(doc.path, value);
        }),
        set: (doc, value) => steps.push(() => mockDocuments.set(doc.path, value)),
        commit: async () => steps.forEach((step) => step())
      };
    }
  })
}));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: jest.fn((req, res, next) => {
    const role = req.headers.authorization?.replace('Bearer ', '');
    if (!role) return res.status(401).json({ success: false });
    req.user = { id: `${role}_1`, role };
    return next();
  }),
  requireSupportRoles: (roles) => (req, res, next) => (
    roles.includes(req.user.role) ? next() : res.status(403).json({ success: false })
  )
}));

jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

let app;
const SITE = 'https://leaf.app.br';
const validRequest = {
  regionKey: 'madureira',
  role: 'driver',
  nome: 'Bia Santos',
  celular: '(21) 99999-0000',
  consent: true
};

beforeEach(() => {
  mockDocuments.clear();
  jest.isolateModules(() => {
    app = express();
    app.use(express.json());
    app.use(require('../../../routes/public-site'));
  });
});

describe('public site routes', () => {
  it('hides the numbers until they are published', async () => {
    mockDocuments.set('public_site/numbers', { rides: 541, drivers: 7, published: false });
    const response = await request(app).get('/api/public/site-data').expect(200);
    expect(response.body.numbers).toBeNull();
  });

  it('returns published numbers and never lead data', async () => {
    mockDocuments.set('public_site/numbers', { rides: 12, drivers: 3, published: true, note: 'interno' });
    mockDocuments.set('public_site/regions', { madureira: { drivers: 2 } });
    const response = await request(app).get('/api/public/site-data').expect(200);
    expect(response.body.numbers).toEqual({ rides: 12, drivers: 3 });
    expect(response.body.regions).toEqual({});
  });

  it('hides goals and region counts until the flag is on', async () => {
    mockDocuments.set('public_site/regions', { madureira: { drivers: 2 } });
    const response = await request(app).get('/api/public/site-data').expect(200);
    expect(response.body.goals).toBeNull();
    expect(response.body.regions).toEqual({});
  });

  it('shows goals and region counts with the flag on', async () => {
    process.env.PUBLIC_REGION_GOALS_ENABLED = 'true';
    mockDocuments.set('public_site/regions', { madureira: { drivers: 2 } });
    const response = await request(app).get('/api/public/site-data').expect(200);
    delete process.env.PUBLIC_REGION_GOALS_ENABLED;
    expect(response.body.goals).toEqual({ drivers: 10, passengers: 100 });
    expect(response.body.regions).toEqual({ madureira: { drivers: 2 } });
  });

  it('records a region request once per phone, role and region', async () => {
    const first = await request(app).post('/api/public/region-interest').set('Origin', SITE).send(validRequest);
    expect(first.status).toBe(201);
    expect(mockDocuments.get('public_site/regions')).toEqual({ madureira: { drivers: { increment: 1 } } });
    const lead = [...mockDocuments.entries()].find(([key]) => key.startsWith('waitlist_landing/'))[1];
    expect(lead).toMatchObject({ celular: '21999990000', cidade: 'Madureira', role: 'driver', status: 'pending' });
    expect(lead.ip).toBeUndefined();

    mockDocuments.delete('public_site/regions');
    const second = await request(app).post('/api/public/region-interest').set('Origin', SITE).send(validRequest);
    expect(second.body).toEqual({ success: true, alreadyRegistered: true });
    expect(mockDocuments.has('public_site/regions')).toBe(false);
  });

  it.each([
    ['unknown region', { regionKey: 'atlantida' }],
    ['unknown role', { role: 'admin' }],
    ['short phone', { celular: '123' }],
    ['no consent', { consent: false }],
    ['markup in the name', { nome: '<script>' }]
  ])('rejects %s', async (_label, change) => {
    await request(app).post('/api/public/region-interest').set('Origin', SITE)
      .send({ ...validRequest, ...change }).expect(400);
    expect(mockDocuments.size).toBe(0);
  });

  it('refuses forms from another origin', async () => {
    await request(app).post('/api/public/region-interest').set('Origin', 'https://outro.site')
      .send(validRequest).expect(403);
    await request(app).post('/api/public/investor-interest').send({ nome: 'Ana', email: 'a@b.co', consent: true }).expect(403);
  });

  it('silently drops a filled honeypot', async () => {
    await request(app).post('/api/public/region-interest').set('Origin', SITE)
      .send({ ...validRequest, website: 'http://spam' }).expect(200);
    expect(mockDocuments.size).toBe(0);
  });

  it('stores an investor contact and shows it only to admins', async () => {
    await request(app).post('/api/public/investor-interest').set('Origin', SITE)
      .send({ nome: 'Ana Lima', email: 'Ana@Fundo.com', empresa: 'Fundo', mensagem: 'Oi', consent: true })
      .expect(201);
    await request(app).get('/api/waitlist/investor-leads').expect(401);
    await request(app).get('/api/waitlist/investor-leads').set('Authorization', 'Bearer support').expect(403);
    const listed = await request(app).get('/api/waitlist/investor-leads').set('Authorization', 'Bearer admin').expect(200);
    expect(listed.body.leads[0]).toMatchObject({ email: 'ana@fundo.com', empresa: 'Fundo' });
  });

  it('accepts every region published on the site map', async () => {
    const mapPath = path.resolve(__dirname, '../../../../landing-page/assets/leaf-area-map.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    for (const region of [...map.regions.filter((item) => !item.operating), ...map.cities]) {
      await request(app).post('/api/public/region-interest').set('Origin', SITE)
        .send({ ...validRequest, regionKey: region.key, celular: '21999990000' })
        .expect((response) => expect(response.status).not.toBe(400));
    }
  }, 30000);
});
