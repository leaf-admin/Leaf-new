# Same-Ride Reconciliation

- Contract: same_ride_reconciliation_v1
- Evidence level: E3
- Ride: booking_1789188861310_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2
- Status: PASS
- Integrated: yes

## Evidence files
- quote: /Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/quote-evidence.json
- payment: /Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/sandbox-payment-confirmation.json
- receipt: /Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/receipt-evidence.json
- dashboard: /Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/dashboard-evidence.json
- ledger: /Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/ledger-evidence.json

## Checks
- PASS: required_sources_present
- PASS: ride_id_defined
- PASS: same_ride_identity
- PASS: gross_amounts_present_and_equal
- PASS: pix_provider_sandbox
- PASS: pix_confirmed
- PASS: dashboard_backend_final_snapshot
- PASS: receipt_backend_final_provenance
- PASS: dashboard_source_documents_complete
- PASS: financial_context_sandbox
- PASS: ledger_payment_and_settlement_posted
- PASS: ledger_and_documents_amounts_equal
- PASS: receipt_components_match_backend_final
- PASS: ledger_settlement_components_match_backend_final

## Failures
- None
