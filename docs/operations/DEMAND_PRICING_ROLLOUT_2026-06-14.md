# Demand Pricing Rollout - 2026-06-14

## Objective

Separate traffic-aware trip duration from dynamic demand markup, publish the
driver demand heatmap through OTA, and activate the demand-pressure pricing
model with a controlled rollback path.

## Production State

- Pricing model: `demand_pressure_v2`
- Runtime mode: `active`
- Maximum dynamic markup: `35%`
- Traffic: affects only the normal time component
- Demand signal: open requests versus available drivers
- Driver heatmap source: Leaf Redis-backed supply and demand state
- Heatmap refresh: 60 seconds
- Backend cache: 10 seconds
- Paid provider calls per heatmap refresh: zero
- Maximum visible percentage labels: five

## OTA

- Channel: `production`
- Runtime version: `1.0.3`
- Update group: `77d0aacf-480a-4f1e-99c3-98a3f24804a7`
- Android update: `019ec3c1-dcbb-7db1-8c69-93fe08b74be4`
- iOS update: `019ec3c1-dcbb-74e2-b582-8f8c0038cbbf`
- Source commit: `50ef068b147957b54e78381d09e0b2f0496167e5`

## Validation Evidence

- Mobile production guards: passed
- Mobile H3 presentation tests: 3 passed
- Expo export: passed for Android and iOS
- Public runtime config: `pricingPolicy.mode=active`
- Public runtime config: `dynamicMarkup=leaf_supply_demand_pressure`
- Public runtime config: heatmap reports `paidProviderCalls=false`
- Public Socket.IO smoke: passed
- Socket handshake p95: 1149 ms
- Socket reconnection: passed
- Multi-gateway readiness: passed
- Redis adapter: ready and required
- Redis was not restarted during rollout
- All gateways and workers: healthy

The post-activation pricing matrix produced:

| Scenario | Demand | Drivers | Dynamic markup |
| --- | ---: | ---: | ---: |
| Balanced with traffic | 6 | 8 | 0% |
| Mild shortage | 8 | 6 | 15% |
| High shortage | 18 | 5 | 35% |

## Rollback

1. Set `PRICING_DEMAND_PRESSURE_MODE=dry_run` in `/opt/leaf-app/.env`.
2. Recreate the three websocket gateways one at a time.
3. Reload Nginx after all gateways are healthy.
4. If required, restore `/opt/leaf-app/.env.before-demand-v2-20260614-033451`.
5. Roll back the Expo update group from the EAS production branch if the
   mobile presentation needs to be reverted independently.

No ledger, payment, ride, or rate-card data migration is required for rollback.

## Known Non-Blocking Observation

The public health endpoint can temporarily report `warning` when Firestore
latency exceeds the warning threshold. Redis, RTDB, Socket.IO, memory, CPU, and
all modular services remained healthy during the rollout.
