# Driver Daily Operational Fee

## Current Decision

The Leaf driver daily fee is disabled by default and must stay behind
`SUBSCRIPTION_DAILY_BILLING_ENABLED=false` until the city reaches operational
maturity.

When enabled, it is not a subscription, monthly charge, prepaid credit purchase,
or mandatory top-up. It is an operational daily fee calculated from the driver's
gross daily revenue generated through Leaf and collected only during withdrawal.

## Activation Guard Rails

The backend must allow activation only when all conditions are satisfied:

- Global flag `SUBSCRIPTION_DAILY_BILLING_ENABLED=true`.
- City is explicitly enabled by runtime billing config or env.
- Driver account age satisfies `SUBSCRIPTION_DAILY_MIN_ACCOUNT_AGE_DAYS`, default
  `60`.
- Driver received prior notice satisfying `SUBSCRIPTION_DAILY_NOTICE_DAYS`,
  default `60`.
- Driver is not manually excluded.

Manual cohort activation is supported through `enabledDriverIds`, but it still
does not bypass the global flag.

## Fee Table

Gross daily revenue through Leaf:

| Gross daily revenue | Daily fee |
| --- | ---: |
| Up to R$ 100.00 | R$ 0.00 |
| Above R$ 100.00 up to R$ 200.00 | R$ 4.90 |
| Above R$ 200.00 up to R$ 300.00 | R$ 7.90 |
| Above R$ 300.00 up to R$ 500.00 | R$ 12.90 |
| Above R$ 500.00 | R$ 14.90 |

The fee is accumulated as pending balance and settled exclusively on withdrawal.

## Rules That Did Not Change

- Withdrawal below R$ 500.00 keeps the Woovi fee of R$ 1.00.
- The per-ride Leaf operational fee remains unchanged.
- Passenger UI must show gross amount paid.
- Driver UI may show driver net amount where appropriate.
- Backend remains the source of truth for balance, pending fees and withdrawal
  eligibility.

## Rollback

Set `SUBSCRIPTION_DAILY_BILLING_ENABLED=false`. With the flag disabled, the
backend keeps nominal policy metadata available for operation, but effective
daily fee and withdrawal settlement remain zero.
