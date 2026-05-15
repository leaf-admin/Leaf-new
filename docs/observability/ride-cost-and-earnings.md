# Ride cost and daily earnings

## Scope

The ride cost telemetry used by ops dashboards, alerts, and the daily earnings report includes only variable costs owned by Leaf runtime:

- Google Maps Platform SKUs.
- Backend command attempts.
- Redis, Firebase, and database operation costs.

Woovi and payment processor costs are intentionally excluded from `ride_cost_average_brl`, `rideCostTotalBrl`, and platform net earnings. The telemetry report exposes this contract in `totals.cost.excludedCostProviders`.

## Runtime limits

The in-process alert service uses configurable environment variables:

- `RIDE_COST_ALERTS_ENABLED`, default `true`.
- `RIDE_COST_ALERT_WINDOW_SIZE`, default `20`.
- `RIDE_COST_ALERT_MIN_COMPLETED_RIDES`, default `5`.
- `RIDE_COST_WARNING_BRL`, default `0.20`.
- `RIDE_COST_CRITICAL_BRL`, default `0.30`.
- `RIDE_COST_DIRECTIONS_WARNING_PER_RIDE`, default `2.2`.
- `RIDE_COST_DIRECTIONS_CRITICAL_PER_RIDE`, default `3`.
- `RIDE_COST_ALERT_CHECK_INTERVAL_MS`, default `60000`.

When triggered, alerts are sent through `alert-service`, which can route them to Discord via `DISCORD_ALERT_WEBHOOK_URL` or `DISCORD_CRITICAL_ALERT_WEBHOOK_URL`.

Prometheus rules in `observability/prometheus/alert-rules.yml` mirror the default thresholds for environments that alert directly from metrics.

## Daily Discord report

The daily earnings report posts to `DISCORD_EARNINGS_WEBHOOK_URL`, `DISCORD_DAILY_EARNINGS_WEBHOOK_URL`, or `LEAF_EARNINGS_DISCORD_WEBHOOK_URL`.

The Discord payload includes completed rides, total ride cost, average ride cost, total operational fee, platform net earnings, Google cost, Firebase/infra cost, and Directions calls per ride.
