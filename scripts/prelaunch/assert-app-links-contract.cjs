#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const requiredPaths = ['/convite', '/motorista/convite', '/viagem'];
const requiredWildcardPaths = requiredPaths.map((item) => `${item}/*`);
const hosts = ['leaf.app.br', 'www.leaf.app.br'];
const failures = [];
const passes = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, pass, failure) {
  if (condition) {
    passes.push(pass);
  } else {
    failures.push(failure);
  }
}

function containsAll(text, items) {
  return items.every((item) => text.includes(item));
}

const aasa = JSON.parse(read('landing-page/.well-known/apple-app-site-association'));
const assetlinks = JSON.parse(read('landing-page/.well-known/assetlinks.json'));
const redirects = read('landing-page/_redirects');
const headers = read('landing-page/_headers');
const appNavigator = read('mobile-app/src/navigation/AppNavigator.js');
const appConfig = require(path.join(root, 'mobile-app/app.config.js'));
const androidManifestPath = path.join(root, 'mobile-app/android/app/src/main/AndroidManifest.xml');
const manifest = fs.existsSync(androidManifestPath)
  ? fs.readFileSync(androidManifestPath, 'utf8')
  : '';

const aasaDetails = aasa?.applinks?.details || [];
const aasaPaths = new Set(aasaDetails.flatMap((detail) => detail.paths || []));
for (const item of requiredWildcardPaths) {
  assert(
    aasaPaths.has(item),
    `AASA cobre ${item}`,
    `AASA nao cobre ${item}`
  );
}

assert(
  Array.isArray(assetlinks) && assetlinks.some((entry) => entry?.target?.package_name === 'br.com.leaf.ride'),
  'assetlinks aponta para br.com.leaf.ride',
  'assetlinks nao aponta para br.com.leaf.ride'
);

for (const item of requiredPaths) {
  assert(
    redirects.includes(`${item}/* `),
    `_redirects cobre ${item}/*`,
    `_redirects nao cobre ${item}/*`
  );
  assert(
    headers.includes(`${item}/*`),
    `_headers cobre ${item}/*`,
    `_headers nao cobre ${item}/*`
  );
}

const intentData = (appConfig.android?.intentFilters || [])
  .flatMap((filter) => Array.isArray(filter.data) ? filter.data : [filter.data].filter(Boolean));

for (const host of hosts) {
  for (const item of requiredPaths) {
    assert(
      intentData.some((data) => data?.scheme === 'https' && data.host === host && data.pathPrefix === item),
      `Expo intent filter cobre https://${host}${item}`,
      `Expo intent filter nao cobre https://${host}${item}`
    );
    if (manifest) {
      assert(
        manifest.includes(`android:host="${host}"`) && manifest.includes(`android:pathPrefix="${item}"`),
        `AndroidManifest local cobre https://${host}${item}`,
        `AndroidManifest local nao cobre https://${host}${item}`
      );
    }
  }
}

if (!manifest) {
  passes.push('AndroidManifest local ausente; app.config.js permanece a fonte canonica para prebuild/EAS');
}

assert(
  appNavigator.includes("RobotaxiPrototypePublicTracking: 'viagem/:tripId'"),
  'Navigation parser usa /viagem/:tripId',
  'Navigation parser nao usa /viagem/:tripId'
);

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures, passes }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, passes }, null, 2));
