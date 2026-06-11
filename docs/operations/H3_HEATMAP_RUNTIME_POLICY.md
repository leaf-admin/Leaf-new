# H3 Heatmap Runtime Policy

## Objective

Allow operations to tune the driver demand heatmap without changing dynamic
pricing rules or publishing a new native build.

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
- The runtime policy changes presentation only. It does not change fare,
  matching, demand scoring, or driver supply calculations.
- H3 resolution is clamped to avoid a large increase in polygons and payload.
- Dashboard and operational map styling remain on their canonical defaults.
- Only monitoring/admin roles can read or update the policy.
- Every update is stored in the dashboard audit trail with the operator and
  the before/after values.

## Runtime And Cache

- The policy is cached in backend memory for 30 seconds.
- The H3 response includes the effective policy and policy version.
- Mobile receives polygon geometry and style in the existing H3 response, so
  there is no extra provider call or paid API call.
- Existing builds already receive backend polygon opacity, color, region size,
  and label text/visibility.
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
