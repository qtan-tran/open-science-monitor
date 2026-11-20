# Editorial guide: from run to published issue

This document is for whoever reviews the weekly PR and turns machine-collected
candidates into published items. The pipeline never invents facts; an editor's
job is to verify, contextualize and cut.

## Roles of the four outputs

| File | Role |
| --- | --- |
| `data/issues/<week>.json` | The single source of truth for the week. Everything else is rendered from it. |
| `issues/<week>/index.md` | Portable Markdown record (also usable as the reference copy). |
| `issues/<week>/index.html` | Standalone readable HTML with absolute source links (opens offline, attachable). |
| `issues/<week>/substack.md` | Newsletter draft: suggested headlines, lede, highlights. Raw material for your Substack issue, not publishable text. |

After any hand edit, run `node scripts/render-issue-outputs.ts` so all three
formats match the dataset again (CI fails otherwise: the committed renders
must equal what the renderer produces from the data).

## Fast editorial review checklist (per candidate)

1. **Open the source link.** If the link is dead or does not say what the title
   claims, drop the item and record why in the PR conversation.
2. **Check the date fields** reflect reality:
   - `dates.published` — when the document/announcement was published
   - `dates.updated` — a material revision date (not the feed's re-serialisation)
   - `dates.effective` — when a policy takes effect, if stated
   - `dates.consultation_deadline` — if the item is a consultation, the deadline
   - `dates.discovered` — when the monitor first saw it (pipeline-set; keep it)
   - If only the discovery date is known, leave the others `null`: the render
     labels the item "discovered-only". **Never guess a date.**
3. **Replace the auto-stub paragraphs.** `what_changed` ("What changed") states
   what actually changed in the world. `why_it_matters` ("Why it matters")
   states consequences you can explain *from the source*. If you need to add
   context beyond the source, link the additional source in `sources` instead
   of asserting it.
4. **Check classification:** `topics` (from the taxonomy in `shared/types.ts`),
   `region`, `organization`, `doc_type`, `status`. Fix wrong guesses.
5. **Link to a policy record** when the item belongs to a tracked policy
   (`policy_id`), or create a policy record in `data/policies/` with milestones.
   Milestone dates you have not verified must stay `verified: false` — the
   Policy Tracker renders them with the unverified label.
6. **Set `editorial_status: "edited"` and `verified: true`** for items you
   checked, or delete the item from `data/issues/<week>.json`'s `items` list.
   Deleted candidates remain in `data/events/` as checked-but-not-published
   only if you keep the event file; otherwise delete both.
7. **Write the weekly summary and signal** (`summary`, `signal` in the issue
   JSON) — 2-3 sentences, human tone, no inference beyond the items.

## What may never happen

- Publishing an item whose every link has not been opened.
- Keeping machine-stub text ("Pending editorial review") in a merged PR.
- Inventing dates, deadlines or milestones that no source states.
- Presenting counts as a measure of a country's or region's OA/OS "activity".
  Counts describe items recorded within the monitored source list, full stop.
- Publishing a week whose collection failed widely: the pipeline exits 1 and
  writes a `failed-collection` report; rerun instead of merging thin results.

## Quiet weeks

If nothing cleared the bar, the issue ships with 0 items, a quiet-week summary
that names how many sources were checked, and the run report lists what was
reviewed-but-not-shortlisted (with reasons). This is a feature: an honest
"nothing met the bar" is more useful to readers than filler. Do not top it up
with low-value items.

## Handling updates to an old development

A material change to an existing policy/initiative is a **new event** with
`supersedes: "<old event id>"`, linked to the same policy record. The old
event keeps its record and its appearances; the Policy Tracker shows the
timeline. Do not silently rewrite the old event's `what_changed`.

## LLM assist, if configured

With the `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` secrets set, the pipeline
asks the model for topic classification and draft paragraphs on *new* events.
Treat them exactly like auto-stubs: verify against the source before keeping.
`run_report.llm_assisted` records whether a draft came from the model, and the
model name is stored on the event (`llm_suggestions.model`) so drafts stay traceable.

## After the first live week

- The sample weeks keep `"sample": true` and stay in the archive, clearly
  marked. Live issues have `status: "draft"` until the PR is merged; after
  that they are the published record.
- `data/source-status.json` reflects the last real collection run; the Sources
  page shows it with its date, not as a freshness guarantee.
