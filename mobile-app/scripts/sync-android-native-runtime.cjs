#!/usr/bin/env node

const path = require('path');
const { AndroidConfig } = require('@expo/config-plugins');

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml');
const defaultUpdateUrl = 'https://u.expo.dev/91dfdce0-9705-4fde-8417-747273ab7cc2';

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
const normalizeBoolean = (value, defaultValue) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }

  return TRUTHY_VALUES.has(String(value).trim().toLowerCase());
};

const upsertMetaData = (application, name, value) => {
  application['meta-data'] = application['meta-data'] || [];
  const existing = application['meta-data'].find((item) => item?.$?.['android:name'] === name);

  if (existing) {
    existing.$['android:value'] = value;
    return;
  }

  application['meta-data'].push({
    $: {
      'android:name': name,
      'android:value': value,
    },
  });
};

const removeMetaData = (application, name) => {
  application['meta-data'] = (application['meta-data'] || []).filter((item) => item?.$?.['android:name'] !== name);
};

async function main() {
  const updatesEnabled = normalizeBoolean(
    firstDefined(process.env.LEAF_ENABLE_OTA_UPDATES, process.env.EXPO_PUBLIC_LEAF_ENABLE_OTA_UPDATES),
    true
  );
  const updateUrl = firstDefined(process.env.LEAF_EXPO_UPDATE_URL, process.env.EXPO_UPDATE_URL) || defaultUpdateUrl;
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

  upsertMetaData(application, 'expo.modules.updates.ENABLED', updatesEnabled ? 'true' : 'false');
  upsertMetaData(application, 'expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH', updatesEnabled ? 'ALWAYS' : 'NEVER');
  upsertMetaData(application, 'expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS', '0');

  if (updatesEnabled) {
    upsertMetaData(application, 'expo.modules.updates.EXPO_UPDATE_URL', updateUrl);
  } else {
    removeMetaData(application, 'expo.modules.updates.EXPO_UPDATE_URL');
  }

  await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);
  console.log(
    `✅ Android native runtime sincronizado: expo-updates ${updatesEnabled ? 'enabled' : 'disabled'}${
      updatesEnabled ? ` (${updateUrl})` : ''
    }.`
  );
}

main().catch((error) => {
  console.error('❌ Falha ao sincronizar Android native runtime:', error);
  process.exit(1);
});
