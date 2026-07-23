# Geofence pilot validation

Date: 2026-07-09
Policy: `rio-zona-sul-centro-lapa-v1`

## Canonical boundary

The versioned GeoJSON is `leaf-websocket-backend/config/geofence.json`.

Selection:

- official planning region `2.1` - Zona Sul;
- official neighborhood `Centro`;
- official neighborhood `Lapa`;
- broader planning region `1.1` is explicitly excluded.

Source: Prefeitura da Cidade do Rio de Janeiro, `Cartografia/Limites_administrativos` ArcGIS service, layers 2 and 4. The source geometries were requested in EPSG:4326 with `maxAllowableOffset=0.00001` (approximately one meter at Rio latitude) and stored as one GeoJSON `MultiPolygon`.

Artifact summary:

- 22 polygons;
- 4,337 points;
- inclusive boundary policy;
- fail-closed in pilot/production;
- pickup and destination are both required inside the operational region during the pilot.

## Automated matrix

Allowed points:

- Centro;
- Lapa;
- Copacabana;
- Leblon;
- Botafogo;
- an exact official boundary vertex.

Blocked points:

- Barra da Tijuca;
- Tijuca;
- Paqueta;
- Niteroi;
- Sao Paulo.

Ride contracts:

- Centro to Copacabana: allowed;
- Lapa to Leblon: allowed;
- Barra pickup: `PICKUP_OUTSIDE_REGION`;
- Copacabana to Barra: `DESTINATION_OUTSIDE_REGION`;
- invalid pickup coordinate: `INVALID_PICKUP`.

Command:

```bash
npm --prefix leaf-websocket-backend run qa:geofence-pilot
```

Result: all 11 point cases and all 5 ride cases passed.

Local policy-evaluation benchmark: 10,000 point checks completed in 693.85 ms, averaging 0.06938 ms per check on the development Mac.

## Test-user and payment profile review

Read-only verification against the configured Firebase/backend runtime confirmed:

- passenger exists in Firebase Auth, RTDB and Firestore, role `customer`, status `active`, approved;
- driver exists in Firebase Auth, RTDB and Firestore, role `driver`, status `approved`, activation `ACTIVE`, KYC test status `approved`, `kycBlocked=false`, `canGoOnline=true`;
- passenger resolves to payment profile `qa-test-users-sandbox-durable`;
- effective payment environment is `sandbox` and the profile is context-matched;
- no Firebase, payment-profile or provider mutation was executed during the review.

## Physical device readiness

- iPhone 15 Pro Max is paired and available through `devicectl`.
- Installed Leaf bundle: `br.com.leaf.ride`, build version `30`.
- Current discovery transport was local network; USB-C is preferred for the RC install/logging session.
- Android was not visible to `adb` during this validation. Connect it over USB-C, enable USB debugging and accept the host authorization prompt.

## Remaining gate before physical E2E

The versioned boundary must be included in the deployed backend RC before device behavior can be accepted as production evidence. The same mobile RC must then be installed on both devices. No backend deploy or native build was executed in this step.
