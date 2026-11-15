# Testing and release evidence

## Unit and contract tests

```bash
npm test
```

Coverage includes:

- frozen event schemas and boundary validation
- capability attenuation and tool denial
- deterministic repair ranking and availability fallback
- full Lead → Scanner → Repair workflow
- approval, decline, stale proposal, double-decision, and failed repair paths
- report HTML/TXT/JSON status fidelity (including unavailable ≠ pass)
- source scan for secrets, private home paths, and local key material
- generated-art presence

## Local Electron smoke test

```bash
FEATHER_SMOKE_DECISION=approve npm run smoke
FEATHER_SMOKE_DECISION=decline npm run smoke
```

Each run launches Electron with the simulated adapter, drives a complete job,
captures `smoke/<decision>/feather-smoke.png`, writes
`smoke/<decision>/result.json`, and writes the three report files under
`smoke/<decision>/usb-root/reports/`.

The script fails if:

- the renderer did not render at least 10 check rows or 5 activity items
- no unavailable check is rendered as unavailable
- the decision does not match the requested mode
- the report bundle is incomplete, missing on disk, or written outside the test
  USB root
- no screenshot was captured

The local run is explicitly simulated. It is not evidence that a real Windows
computer was scanned.

## Genuine Windows acceptance test

The `Windows acceptance` GitHub Actions workflow runs on `windows-latest`:

1. `npm ci`
2. `npm test`
3. `npm run art` and verify generated assets
4. `npm run dist:win`
5. Copy `release/win-unpacked` to `%RUNNER_TEMP%\FeatherUSB` so `FeatherAI.exe`
   sits at the root, like a USB drive
6. Run `scripts/live-windows-test.js`, which launches the packaged executable
   twice from that folder:
   - **approve** pass: real Windows checks, proposal, approval, repair, report
   - **decline** pass: real Windows checks, proposal declined, no repair command,
     report
7. Upload the screenshots, `result.json` files, HTML/TXT/JSON reports, and build
   manifest as workflow artifacts

The live test validates:

- platform is `win32` and the run is not simulated
- at least 10 real check rows rendered (the full catalog is 11)
- UI unavailable/failed row counts match the measured summary
- approval decision recorded; repair ran and reported an outcome
- decline recorded; repair outcome is `declined` and no action ran
- HTML/TXT/JSON reports exist under the USB folder's `reports/`
- report JSON marks `job.simulated: false`, names a Windows OS, includes every
  check status from the allowed set, and contains the required event types

### Windows test limitations

- A CI runner has no physical USB stick. The test copies the packaged folder to
  a runner-local directory and runs from there; this preserves the portable-root
  and report-path behavior.
- The runner is a clean virtual machine, not a user's broken PC. It proves the
  real adapter executes and reports honestly, not that every hardware-specific
  finding appears on every machine.
- UAC prompts cannot be clicked in headless CI. The default healthy-runner
  proposal is normally a non-elevated action; if the runner's findings select an
  elevated repair and the environment blocks it, the report records the failed
  outcome. Set `FEATHER_LIVE_ALLOW_REPAIR_FAILURE=1` to accept that condition
  while still requiring the approval path and report to complete.

## Release

Push a `v*` tag (for example `v2.0.0`). The Windows workflow builds the zip and
USB layout, runs the live acceptance test, and then attaches:

- `FeatherAI-2.0.0-Windows-x64.zip`
- `FeatherAI-2.0.0-Windows-x64-usb.zip`
- `SHA256SUMS.txt`

The run also uploads test evidence as artifacts even when publishing is skipped.
