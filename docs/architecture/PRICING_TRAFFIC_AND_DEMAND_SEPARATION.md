# Traffic And Demand Pricing Separation

## Canonical Model

Leaf now treats traffic and demand as independent signals:

1. Traffic-aware route duration feeds the normal time component of a quote.
2. Open passenger requests versus available drivers feeds the dynamic markup.
3. Pickup distance/time remains a separate capped adjustment.
4. Tolls remain explicit pass-through values.

This prevents traffic from increasing both the time component and the dynamic
multiplier.

## Driver Map

- Google traffic layer shows road conditions visually.
- Leaf H3 overlay shows unmet demand versus available supply.
- Normal regions are not painted.
- Hot cells use translucent yellow, red and purple fills without visible H3
  borders.
- At most five separated `+X%` labels are shown in a viewport.
- A quote is authoritative; the heatmap is operational guidance.

## Cost Contract

H3 refresh uses Redis-backed Leaf state and makes no paid provider call.
Enabling the native Google traffic layer does not create Routes API requests.
Traffic-aware Routes remains limited to real quotes and approved navigation
flows.

## API Contract

Pricing responses preserve existing fields and add:

- `pricing_model`
- `pricing_model_mode`
- `dynamic_reason`
- `traffic_adjusted`
- `traffic_notice`
- `demand_pressure`
- `pricing_shadow` in dry-run

H3 responses identify:

- `source: leaf_internal_supply_demand`
- `paidProviderCalls: false`
- refresh and traffic-layer policy

## Rollback

Set `PRICING_DEMAND_PRESSURE_MODE=legacy` and restart the modular gateway.
No rate card, ledger entry, payment record, or persisted ride contract needs
migration for rollback.
