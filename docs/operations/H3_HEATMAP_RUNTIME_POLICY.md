# H3 Heatmap Runtime Policy

## Objective

Allow operations to tune the driver demand heatmap without changing dynamic
pricing rules or publishing a new native build.

The heatmap represents Leaf supply/demand pressure. It does not claim to
measure traffic. Google traffic remains a visual road layer, while a real
passenger quote uses traffic-aware route duration.

The policy is stored by the backend in `systemConfig/h3VisualPolicy` and is
managed from `/runtime-flags`.

## Controls

- Overlay enabled or hidden.
- Polygon opacity.
- Region size through a guarded H3 resolution offset (`-1`, `0`, `1`).
- Yellow, red, and purple palette.
- Percentage label enabled or hidden.
- Minimum percentage for a label.
- Maximum visible labels.
- Label template containing `{percent}`.
- Label background, text, border opacity, and font size.

## Guardrails

- Dynamic pricing remains capped by the existing 35% business rule.
- Driver heatmap and demand markup use the same canonical supply/demand score.
- Open requests are demand. Active rides are not counted again as unmet demand.
- Traffic does not affect the H3 percentage.
- Google traffic rendering is visual-only and is not parsed or converted into
  Leaf pricing data.
- No H3 refresh calls Google, Woovi, Firebase from the browser, or another paid
  provider.
- The runtime policy changes presentation only. It does not change fare,
  matching, demand scoring, or driver supply calculations.
- H3 resolution is clamped to avoid a large increase in polygons and payload.
- Dashboard and operational map styling remain on their canonical defaults.
- Only monitoring/admin roles can read or update the policy.
- Every update is stored in the dashboard audit trail with the operator and
  the before/after values.

## Runtime And Cache

- The policy is cached in backend memory for 30 seconds.
- H3 viewport snapshots are cached for 10 seconds.
- The mobile safety poll defaults to 60 seconds.
- Socket hints coalesce relevant supply/demand events with the next allowed
  refresh; they never bypass the client minimum interval.
- The payload declares `source=leaf_internal_supply_demand` and
  `paidProviderCalls=false`.
- The H3 response includes the effective policy and policy version.
- Mobile receives polygon geometry and style in the existing H3 response, so
  there is no extra provider call or paid API call.
- Existing builds already receive backend polygon opacity, color, region size,
  and label text/visibility.
- Driver UI displays at most five separated percentage labels per viewport.
- Driver polygons have no visible H3 borders and use restrained transparency.
- Empty cells are not transferred to the mobile driver surface.
- The mobile JS update adds remote control of label skin and maximum labels.
  It can be delivered by OTA when Expo Updates is enabled, or in the next
  native build.

## Rollback

1. Open `/runtime-flags`.
2. Restore the standard region size and opacity.
3. Publish the policy.
4. To hide the overlay immediately, set it to hidden and publish.

If the dashboard is unavailable, restore or delete
`systemConfig/h3VisualPolicy`; the service falls back to conservative defaults.

## Pricing Rollout

`PRICING_DEMAND_PRESSURE_MODE` controls the financial rollout:

- `legacy`: previous combined pressure model.
- `dry_run`: previous fare remains active; demand-only fare is calculated and
  returned in `pricing_shadow` for comparison.
- `active`: traffic changes the time component of the quote, while the dynamic
  percentage comes only from supply/demand pressure.

Recommended rollout:

1. Keep `dry_run` until enough quotes cover normal and peak periods.
2. Compare legacy and demand-only percentage, final fare, conversion and driver
   acceptance.
3. Activate for a controlled operational window.
4. Roll back immediately by restoring `legacy` or `dry_run`.
