#!/usr/bin/env node
// Refuses to continue unless every Firebase client points at the local
// emulators of a demo- project and Redis is local. The load tests write
// users, vehicles and rides; against real Firebase they would pollute
// production data shared with real users.
'use strict';

const problems = [];
const env = process.env;
const isLocal = (value) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(value || '').trim());

const project = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || '';
if (!project.startsWith('demo-')) problems.push(`GCLOUD_PROJECT must be a demo- project (got "${project}")`);
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!isLocal(env[name])) problems.push(`${name} must be a local emulator (got "${env[name] || ''}")`);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?\?ns=demo-/.test(env.FIREBASE_DATABASE_URL || '')) {
  problems.push(`FIREBASE_DATABASE_URL must point at the local RTDB emulator with a demo- namespace (got "${env.FIREBASE_DATABASE_URL || ''}")`);
}
if (!/^redis:\/\/(:[^@]*@)?(127\.0\.0\.1|localhost):\d+/.test(env.REDIS_URL || '')) {
  problems.push(`REDIS_URL must be local (got "${(env.REDIS_URL || '').replace(/:[^@/]*@/, ':***@')}")`);
}
if (String(env.NODE_ENV || '').toLowerCase() === 'production') problems.push('NODE_ENV must not be production');
for (const name of ['WOOVI_API_TOKEN', 'WOOVI_MASTER_API_TOKEN', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'SENTRY_DSN']) {
  if (env[name]) problems.push(`${name} must be empty in the isolated stack`);
}

if (problems.length) {
  console.error('[isolated-stack] REFUSING to run:\n - ' + problems.join('\n - '));
  process.exit(3);
}
console.log(`[isolated-stack] ok: project=${project}, emulators local, Redis local, no provider keys`);
