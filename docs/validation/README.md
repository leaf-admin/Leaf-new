# Validation Execution Kit

This directory is the source of truth for validation planning and run tracking.

## Files

- [master-validation-manifest.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/master-validation-manifest.json): machine-readable scenario registry
- [PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md](/Users/izaakdias/Documents/Leaf-new/docs/validation/PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md): P0 production-readiness to-do, gates, and acceptance record
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

Run production-readiness closure without external L2 actions:

```bash
RUN_EXTENDED_LOCAL_GATES=true RUN_L2_SMOKE=false bash scripts/validation/run-master-validation.sh --label production-readiness --wave wave9
```

Run a fast Wave 9 runner sanity check without the expensive full unit gates:

```bash
RUN_EXTENDED_LOCAL_GATES=false RUN_L2_SMOKE=false bash scripts/validation/run-master-validation.sh --label wave9-runner-check --wave wave9
```

Run production-readiness closure with Android L2 only after explicit approval:

```bash
ANDROID_EMULATOR_STABILITY_SECONDS=60 EXPLICIT_L2_APPROVAL=true RUN_L2_SMOKE=true bash scripts/validation/run-master-validation.sh --label production-readiness-l2 --wave wave9
```

Wave 9 treats a missing approved financial policy reference in runtime config as `blocked`,
not as a product failure, when that is the only blocker. Firebase or Google/Maps config gaps
remain failures because they invalidate the backend baseline before device smoke.

## Evidence rules

- Dynamic UI screenshots wait 15 seconds unless the test validates immediate response
- UI scenarios require screenshot or video
- Backend or business rule scenarios require log, JSON report, Redis or persistence evidence
- Every scenario should end as `pass`, `fail` or `blocked`
