#!/usr/bin/env node

'use strict';

const path = require('path');

process.env.NODE_ENV = 'production';
process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
process.env.LEAF_PILOT_CONTROLLED = 'true';
process.env.GEOFENCE_FAIL_CLOSED = 'true';
process.env.GEOFENCE_REQUIRE_DESTINATION_INSIDE_REGION = 'true';
process.env.GEOFENCE_REGION_FILE = 'config/geofence.json';
process.env.BYPASS_GEOFENCE = 'false';
process.env.GEOFENCE_RADIUS_KM = '';

const geofenceService = require('../../services/geofence-service');
const geofenceArtifact = require(path.resolve(__dirname, '../../config/geofence.json'));

const pointCases = [
  { id: 'centro', lat: -22.9068, lng: -43.1729, expected: true },
  { id: 'lapa', lat: -22.9137, lng: -43.1808, expected: true },
  { id: 'copacabana', lat: -22.971964, lng: -43.182543, expected: true },
  { id: 'leblon', lat: -22.984843, lng: -43.221972, expected: true },
  { id: 'botafogo', lat: -22.951912, lng: -43.182182, expected: true },
  { id: 'barra', lat: -23.0005, lng: -43.365, expected: false },
  { id: 'tijuca', lat: -22.925, lng: -43.233, expected: false },
  { id: 'paqueta', lat: -22.7595, lng: -43.1095, expected: false },
  { id: 'niteroi', lat: -22.8977, lng: -43.1183, expected: false },
  { id: 'sao-paulo', lat: -23.5505, lng: -46.6333, expected: false }
];

const boundary = geofenceArtifact.features[0].geometry.coordinates[0][0][0];
pointCases.push({ id: 'official-boundary', lat: boundary[1], lng: boundary[0], expected: true });

const pointResults = pointCases.map((testCase) => {
  const actual = geofenceService.isPointInPolygon(testCase.lat, testCase.lng);
  return { ...testCase, actual, passed: actual === testCase.expected };
});

const rideCases = [
  {
    id: 'centro-to-copacabana',
    pickup: { lat: -22.9068, lng: -43.1729 },
    destination: { lat: -22.971964, lng: -43.182543 },
    expected: { valid: true, code: null }
  },
  {
    id: 'lapa-to-leblon',
    pickup: { lat: -22.9137, lng: -43.1808 },
    destination: { lat: -22.984843, lng: -43.221972 },
    expected: { valid: true, code: null }
  },
  {
    id: 'barra-pickup-blocked',
    pickup: { lat: -23.0005, lng: -43.365 },
    destination: { lat: -22.971964, lng: -43.182543 },
    expected: { valid: false, code: 'PICKUP_OUTSIDE_REGION' }
  },
  {
    id: 'outside-destination-blocked',
    pickup: { lat: -22.971964, lng: -43.182543 },
    destination: { lat: -23.0005, lng: -43.365 },
    expected: { valid: false, code: 'DESTINATION_OUTSIDE_REGION' }
  },
  {
    id: 'invalid-pickup-blocked',
    pickup: { lat: 91, lng: -43.182543 },
    destination: { lat: -22.984843, lng: -43.221972 },
    expected: { valid: false, code: 'INVALID_PICKUP' }
  }
];

const rideResults = rideCases.map((testCase) => {
  const result = geofenceService.validateRideLocations(testCase.pickup, testCase.destination);
  const actual = { valid: result.valid === true, code: result.code || null };
  return {
    id: testCase.id,
    expected: testCase.expected,
    actual,
    passed: actual.valid === testCase.expected.valid && actual.code === testCase.expected.code
  };
});

const status = geofenceService.getOperationalStatus();
const failures = [...pointResults, ...rideResults].filter((result) => !result.passed);
const report = {
  ok: failures.length === 0,
  policyId: geofenceArtifact.metadata.policyId,
  source: geofenceArtifact.metadata.source,
  operationalStatus: status,
  pointCases: pointResults,
  rideCases: rideResults,
  failureCount: failures.length
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
