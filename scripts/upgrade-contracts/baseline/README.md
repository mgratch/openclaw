# upgrade-contracts baseline artifacts

This directory receives generated reports from `scripts/upgrade-contracts/run.mjs`.

- `latest.json` / `latest.md` — most recent report-only baseline.
- `latest-gate.json` / `latest-gate.md` — most recent strict-gate run.
- `report-<runId>.json` / `.md` — timestamped snapshots from either mode.

Everything except this README and `.gitignore` is generated and gitignored.
Copy a report elsewhere (or commit it deliberately) if you need to keep it.
