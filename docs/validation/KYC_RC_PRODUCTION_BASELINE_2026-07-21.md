# KYC RC production baseline — 2026-07-21

Captured at `2026-07-21T22:47:55Z` from the production source directories before applying the reviewed KYC delta.

## Source

- Backend: `62.169.31.231:/opt/leaf-app`
- Dashboard: `62.169.31.231:/opt/leaf-dashboard-js`
- Launch profile: `ride_flow_validation`
- Runtime configuration validation: passed in the active backend container

## Runtime fingerprints before rollout

- `leaf-websocket`: `sha256:3283c9d066f1ed0ee511b36c23a90a71476ebfb5ae272802909a9507a771ab0a`
- `leaf-websocket-gateway-2`: `sha256:60b34caef159815bd459170cf89ffb4bb5f27cd382d6def1026af77ee4ee959e`
- `leaf-websocket-gateway-3`: `sha256:b7e47f4a6639d9fab2b7bedfcdaee7b6bf36318277a306f7a5eb64e15bd65065`
- `leaf-dashboard`: `sha256:4110998882202932d793fe97b5736978aa865760b582fbd2ca66a599420ede13`
- Dashboard Next build: `WA2hOoTn7glJPskx7zCTO`

## Sanitized source fingerprints

- Backend: `ff0f5cf455dde28a8c3e2dde9d1938881d50be797a2dfd98e13094e330ac500d`
- Dashboard: `0ac7a148a5303b906fe2c3345a3e35d8fa800561d14a4b7815d5834c0658fa74`

The fingerprints cover sorted file content after excluding runtime secrets, `.env` files, credentials, dependencies, build output, coverage, logs, backups, SSL material, and one-off hotfix directories.

## Credential handling

No credential content was opened or copied into Git. Runtime credential files remain excluded from synchronization and from the release commit. Their rotation or removal is a separate operational change.

## Rollback baseline

The canonical production deploy creates a timestamped source and compose backup under `/opt/leaf-app/backups/modular-rollout-*` before synchronization. The image fingerprints above identify the pre-rollout containers.
