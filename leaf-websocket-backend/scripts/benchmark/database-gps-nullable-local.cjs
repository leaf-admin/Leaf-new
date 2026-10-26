#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const withPrivateRedis = require('./private-redis.cjs');
const loadService = require('./isolated-gps-service.cjs');
const { APPEND_BUFFER } = require('../../utils/trip-location-buffer-ops');

withPrivateRedis(async redis => {
  const rows = [];
  for (const baseline of [true, false]) {
    let conflict = true;
    const client = new Proxy(redis, { get(target, command) {
      if (command === 'eval') return async (...args) => {
        if (args[0] === APPEND_BUFFER && conflict) { conflict = false; return [-1, 0]; }
        return target.eval(...args);
      };
      return typeof target[command] === 'function' ? target[command].bind(target) : target[command];
    } });
    const tripId = baseline ? 'synthetic-before' : 'synthetic-after';
    const service = loadService(client, {}, { sourceRef: baseline ? '3e318ac15' : null });
    const point = { tripId, driverId: 'driver', lat: -23, lng: -46, seq: 1,
      capturedAt: 1710000000000, receivedAt: 1710000000100 };
    await service.bufferLocationEvent(point);
    const replay = await service.bufferLocationEvent(point);
    rows.push({ variant: baseline ? '3e318ac15' : 'candidate', pointsAfterCasAndReplay: await redis.llen(service.getBufferKey(tripId)),
      replayDeduplicated: replay.duplicate === true });
  }
  assert.equal(rows[0].pointsAfterCasAndReplay, 2);
  assert.equal(rows[1].pointsAfterCasAndReplay, 1);
  assert.equal(rows[1].replayDeduplicated, true);
  console.log(JSON.stringify({ environment: 'Private Redis; synthetic CAS conflict followed by lost worker ACK replay; no external access', rows }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
