# Geofence pilot validation — expanded Rio policy

Date: 2026-09-18  
Policy: `rio-zona-sul-barra-jacarepagua-v2`

## Canonical boundary

The versioned GeoJSON is `leaf-websocket-backend/config/geofence.json`.

Selection:

- official planning region `2.1` — Zona Sul;
- official neighborhoods `Centro`, `Lapa`, `Barra da Tijuca` and `Jacarepaguá`;
- broader planning region `1.1` remains excluded.

Source: Prefeitura da Cidade do Rio de Janeiro, `Cartografia/Limites_administrativos` ArcGIS service, layers 2 and 4. The source geometries were requested in EPSG:4326 with `maxAllowableOffset=0.00001` and stored as one GeoJSON `MultiPolygon`.

Source queries:

- `MapServer/2: rp='2.1'`;
- `MapServer/4: nome IN ('Centro','Lapa','Barra da Tijuca','Jacarepaguá')`.

Artifact summary:

- 33 polygons;
- 7,122 points;
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
- Barra da Tijuca;
- Jacarepaguá;
- an exact official boundary vertex.

Blocked points:

- Tijuca;
- Paquetá;
- Niterói;
- São Paulo.

Ride contracts:

- Centro to Copacabana: allowed;
- Lapa to Leblon: allowed;
- Barra da Tijuca to Copacabana: allowed;
- Jacarepaguá to Barra da Tijuca: allowed;
- Copacabana to Tijuca: `DESTINATION_OUTSIDE_REGION`;
- invalid pickup coordinate: `INVALID_PICKUP`.

Command:

```bash
npm --prefix leaf-websocket-backend run qa:geofence-pilot
```

Result: all 12 point cases and all 6 ride cases passed locally on 2026-09-18.

## Rollout state

The committed versioned artifact, pilot validation profile examples, compose defaults, and unit expectations now reference `rio-zona-sul-barra-jacarepagua-v2`. A production or VPS rollout still requires the authorized backend deployment and a post-deploy `/api/geofence/check` verification; no external deployment was executed by this change.
