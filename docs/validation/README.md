# Validation Execution Kit

This directory is the source of truth for validation planning and run tracking.

## Files

- [master-validation-manifest.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/master-validation-manifest.json): machine-readable scenario registry
- `reports/validation-runs/<timestamp>_<label>/tracker.md`: generated tracker for a specific run
- `reports/validation-runs/<timestamp>_<label>/notes.md`: free-form notes for findings and decisions

## Main commands

Initialize a new run:

```bash
node scripts/validation/init-validation-run.cjs --label full-validation
```

Run Wave 0 preflight:

```bash
bash scripts/validation/run-wave0-preflight.sh --label full-validation
```

Run Wave 3 ideal lifecycle:

```bash
bash scripts/validation/run-wave3-ideal.sh --label full-validation
```

Run automated waves in sequence:

```bash
bash scripts/validation/run-master-validation.sh --label full-validation
```

## Evidence rules

- Dynamic UI screenshots wait 15 seconds unless the test validates immediate response
- UI scenarios require screenshot or video
- Backend or business rule scenarios require log, JSON report, Redis or persistence evidence
- Every scenario should end as `pass`, `fail` or `blocked`
