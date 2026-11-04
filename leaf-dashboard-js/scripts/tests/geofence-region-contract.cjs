const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Executa o módulo real do dashboard (ESM) como script, trocando os exports.
const file = path.resolve(__dirname, '../../src/utils/geofence-region.js');
const source = fs.readFileSync(file, 'utf8').replace(/^export /gm, '');
const context = { Date, Math, Number, String, Array, Error };
vm.runInNewContext(`${source}\nthis.api = { normalizeRegionRings, buildGeofenceFile, countRegionPoints, suggestNextPolicyId };`, context, { filename: file });
const { normalizeRegionRings, buildGeofenceFile, countRegionPoints, suggestNextPolicyId } = context.api;

const square = [[-43.2, -22.98], [-43.18, -22.98], [-43.18, -22.96], [-43.2, -22.96]];
const triangle = [[-43.3, -23.0], [-43.28, -23.0], [-43.29, -22.99]];

// Anel único sem fechar vira anel fechado.
const single = normalizeRegionRings(square);
assert.equal(single.length, 1);
assert.deepEqual(single[0][0], single[0][4]);
assert.equal(countRegionPoints(single), 4);

// Vários anéis, como o backend devolve em produção.
const multi = normalizeRegionRings([square, triangle]);
assert.equal(multi.length, 2);
assert.equal(countRegionPoints(multi), 7);

// GeoJSON do arquivo versionado.
const geojson = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[...square, square[0]]], [[...triangle, triangle[0]]]] } }],
};
assert.equal(normalizeRegionRings(geojson).length, 2);

// Inválidos: poucos pontos, coordenada fora do mundo, texto.
assert.equal(normalizeRegionRings([[0, 0], [1, 1]]), null);
assert.equal(normalizeRegionRings([[0, 0], [1, 1], [200, 1]]), null);
assert.equal(normalizeRegionRings([square, [[0, 0]]]), null);
assert.equal(normalizeRegionRings([]).length, 0);

// Arquivo gerado no formato do config/geofence.json.
// JSON de ida e volta: é o que vai para o arquivo, e tira os objetos do contexto do vm.
const output = JSON.parse(JSON.stringify(
  buildGeofenceFile([square, triangle], { policyId: 'rio-zona-sul-v4', name: 'Piloto Rio', generatedAt: '2026-11-03' }),
));
assert.equal(output.type, 'FeatureCollection');
assert.equal(output.metadata.policyId, 'rio-zona-sul-v4');
assert.equal(output.metadata.polygonCount, 2);
assert.equal(output.metadata.pointCount, 7);
assert.equal(output.features.length, 1);
assert.equal(output.features[0].properties.version, 'rio-zona-sul-v4');
assert.equal(output.features[0].geometry.type, 'MultiPolygon');
assert.equal(output.features[0].geometry.coordinates.length, 2);
assert.deepEqual(output.features[0].geometry.coordinates[0][0].at(-1), square[0]);
// Relido pelo próprio normalizador, dá as mesmas áreas.
assert.equal(normalizeRegionRings(output).length, 2);

assert.throws(() => buildGeofenceFile([], { policyId: 'rio-v2' }), /ao menos uma área/);
assert.throws(() => buildGeofenceFile([square], { policyId: 'Rio Zona Sul' }), /Versão inválida/);

assert.equal(suggestNextPolicyId('rio-zona-sul-v3'), 'rio-zona-sul-v4');
assert.equal(suggestNextPolicyId('piloto'), 'piloto-v2');

console.log('[geofence-region] ok');
