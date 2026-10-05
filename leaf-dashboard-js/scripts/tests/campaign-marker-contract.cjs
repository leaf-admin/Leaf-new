#!/usr/bin/env node
// Exercise the actual page's form predicates and API payload builders without
// network requests or dashboard credentials. JSX is parsed, not executed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const source = fs.readFileSync(path.resolve(__dirname, '../../app/campaign-center/page.js'), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
const declarations = nodes => nodes.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []);
const top = declarations(ast.program.body);
const locals = declarations(component.body.body);
const expression = node => source.slice(node.start, node.end);
const local = name => locals.find(node => node.id.name === name).init;
const defaultForm = vm.runInNewContext(`(${expression(top.find(node => node.id.name === 'defaultForm').init)})`);
const helpers = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && ['csvToArray', 'parseBRLCents'].includes(node.id.name))
  .map(expression).join('\n');
function harness(formPatch = {}, allowed = true) {
  const created = [], updated = [], errors = [];
  const noop = () => {};
  const context = {
    defaultForm, form: { ...defaultForm, ...formPatch }, canMutateCampaignCenter: allowed,
    isMarkerCampaign: (formPatch.template || defaultForm.template) === 'map_vehicle_marker',
    actionBlockedMessage: '', selectedSlot: { id: 'ride_map_vehicle_marker', dimensions: {} },
    setSaving: noop, setError: value => { if (value) errors.push(value); }, setNotice: noop,
    setForm: noop, setAssetFile: noop, setAssetPreviewUrl: noop, setBusyCampaignId: noop, load: async () => {},
    leafAPI: { createInAppCampaign: async payload => created.push(payload), updateInAppCampaign: async (...args) => updated.push(args) },
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  context.canCreate = vm.runInContext(`(${expression(local('canCreate').arguments[0])})()`, context);
  return { context, created, updated, errors,
    create: vm.runInContext(`(${expression(local('create'))})`, context),
    update: vm.runInContext(`(${expression(local('updateMarkerShape'))})`, context),
  };
}
(async () => {
  const base = { name: 'Halloween Leaf', template: 'map_vehicle_marker', roles: 'all', surfaces: 'ride_map', placements: 'vehicle_marker' };
  const builtIn = harness({ ...base, assetKey: 'halloween_pumpkin', imageUrl: 'https://cdn.leaf.test/old.webp', endAt: '2026-11-02T00:00' });
  assert.equal(builtIn.context.canCreate, true, 'bundled marker must not require banner title/body');
  await builtIn.create();
  assert.equal(builtIn.created[0].content.assetKey, 'halloween_pumpkin');
  assert.equal(builtIn.created[0].content.imageUrl, '', 'old art must not override the chosen vector');
  assert.equal(builtIn.created[0].status, 'paused', 'creation must keep the existing default status');
  assert.equal(builtIn.created[0].rules.maxImpressionsPerUser, 0);
  assert.equal(builtIn.created[0].rules.maxImpressionsPerDay, 0);
  assert.ok(builtIn.created[0].endAt);
  const custom = harness({ ...base, imageUrl: 'https://cdn.leaf.test/custom.webp' });
  await custom.create();
  assert.equal(custom.created[0].content.assetKey, '');
  assert.equal(custom.created[0].content.imageUrl, 'https://cdn.leaf.test/custom.webp');
  const missing = harness(base);
  assert.equal(missing.context.canCreate, false);
  await missing.create();
  assert.equal(missing.created.length, 0);
  assert.equal(harness({ name: 'Banner without copy' }).context.canCreate, false, 'banner validation stays intact');
  const blocked = harness({ ...base, assetKey: 'leaf_vehicle' }, false);
  await blocked.create();
  await blocked.update({ id: 'existing', content: {} }, 'halloween_pumpkin');
  assert.equal(blocked.created.length + blocked.updated.length, 0, 'permission gate must stay intact');
  await builtIn.update({ id: 'existing', content: { imageUrl: 'https://cdn.leaf.test/old.webp' } }, 'leaf_vehicle');
  assert.equal(builtIn.updated[0][1].content.assetKey, 'leaf_vehicle');
  assert.equal(builtIn.updated[0][1].content.imageUrl, '');
  await builtIn.update({ id: 'existing', content: {} }, '');
  assert.equal(builtIn.updated.length, 1, 'custom format requires an uploaded creative');
  console.log('Campaign marker form, API payload, permission and fallback contracts: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
