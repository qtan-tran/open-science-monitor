// Cron guard for the weekly workflow.
//
// GitHub cron runs in UTC and does not switch for CET/CEST, so the workflow
// schedules two crons (07:30 and 06:30 UTC on Fridays) and this guard picks
// the one that is actually 08:30 Europe/Berlin. workflow_dispatch bypasses
// the guard entirely (set SKIP via the workflow, not here).
//
// Usage in a workflow step:
//   - id: guard
//     run: node scripts/berlin-guard.ts >> "$GITHUB_OUTPUT"
// Subsequent steps: if: github.event_name == 'workflow_dispatch' || steps.guard.outputs.run == 'true'

import { isFridayBerlinRunSlot } from "../shared/iso-week.ts";

const now = new Date();
const run = isFridayBerlinRunSlot(now) ? "true" : "false";
console.log(`run=${run}`);
