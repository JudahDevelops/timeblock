# What the neighbours do, and what of it is worth taking

August 2026. A read of the products nearest to Timeblock, written to answer one
question: where is Timeblock genuinely behind, and where is it merely different?

Timeblock's shape — _a calendar where every block of time is a page you work inside,
plus dashboards of tracked fields_ — has no exact competitor. Nothing else collapses
the event and the document into one object. So the comparison set is drawn from three
directions that each bracket part of it, and the useful findings turn out to be
concentrated in the dashboard half, where the prior art is much older and much better
settled.

---

## The set

| Product                       | What it is                                 | The one thing it teaches                                                                                  |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Sunsama**                   | Guided daily planner over calendar + tasks | Deliberate friction. The app makes you drag each task into the day so you cannot over-commit by accident. |
| **Motion**                    | AI auto-scheduler                          | The opposite bet: the calendar builds itself. Useful mainly as the road not taken.                        |
| **Amie**                      | Calendar + todos + meeting notes           | Notes attached to events, and todos extracted back out of the notes.                                      |
| **Notion Calendar** (né Cron) | Fast calendar wired into Notion            | Events _link_ to pages. The closest anyone comes, and the distinction that matters most.                  |
| **Notion** (dashboards)       | Docs, databases, dashboards                | A hard cap: 12 widgets, max 4 per row. Columns collapse to one file on mobile.                            |
| **DataDog**                   | Metrics dashboards                         | Per-widget minimum widths. The sharpest single idea found.                                                |
| **Elastic / Grafana**         | Metrics dashboards                         | 48-column grids, fixed row height, snap to boundary. The precedent for going finer.                       |

---

## The finding that matters most: link versus is

Notion Calendar is the nearest neighbour, and the gap is architectural rather than
cosmetic. There, an event **links** to a page: you search your workspace from the event,
attach a doc, and click through to open it. Cron shipped this in June 2023 and Notion
kept it after the acquisition.

Timeblock's block **is** the page. There is no attach step, no search, no picking — the
document exists because the block exists, and opening the block opens it.

That is a real advantage and it should not be quietly traded away. It also carries a
cost worth stating plainly: a linked page can be shared, reused across several events,
and lives on after the meeting. A block's page cannot outlive its block. Nobody has
asked for that yet, but it is the first thing that will be missed, and it is the reason
`bodyRev > 0` already protects a row from pruning.

Amie sits one step further out — notes are a meeting artifact, and the interesting move
is extraction (todos pulled _out_ of notes), not authorship. Sunsama and Motion do not
really compete on this axis at all.

---

## Where Timeblock is genuinely behind

**Mobile dashboards.** Until this week the dashboard directory contained exactly one
responsive class in the entire codebase — horizontal padding — against 26 `sm:` usages
in the calendar. Two real defects followed from that and are now fixed: single-column
stacking numbered rows instead of measuring them, so every group drew on top of its
neighbour; and a group kept its desktop height on a phone, clipping its own children
with nowhere to scroll. The industry consensus is unambiguous — stack to one column,
test at 360px, 44×44px touch targets, fluid cards — and Timeblock now meets the first
two. Touch targets have not been audited.

**No per-kind sizing floors.** DataDog's guidance is the sharpest thing in the whole
survey: timeseries widgets "should be at least 4 columns wide in order not to appear
squashed on smaller displays", log streams "at least 6 columns (half the dashboard
width) for readability". The insight is not the numbers, it is that _a column count
exists so that a minimum becomes expressible_. Timeblock has one blunt global `MIN_W`
for every kind, so a checkbox and a list are held to the same floor despite obviously
not needing the same room. This is the natural follow-on to the 24-column change and
is cheap now that the grid is fine enough for a per-kind floor to mean something.

**No density limit.** Notion caps a dashboard at 12 widgets, 4 per row. That is a
deliberate refusal to let a dashboard become a wall of numbers nobody reads. Timeblock
has no cap and no guidance. Worth considering; not urgent.

**Nothing has been measured on a real phone.** All mobile verification so far is
arithmetic — correct arithmetic, verified against production row shapes, but not the
same as looking at it.

---

## Where Timeblock is ahead, and should stay there

- **The block is the document.** Covered above. This is the whole product.
- **Two-way Google sync with real conflict resolution.** `reconcile.ts` distinguishes
  echo, apply, keep and withdraw on etag and clock. Most planners in this set are
  one-way mirrors of Google, or own the calendar outright.
- **Dashboards are free-form, not a widget menu.** Notion's dashboards render database
  views; Timeblock's fields are arbitrary typed readings placed anywhere on a grid.
- **Groups nest.** Notion's dashboard widgets do not.

---

## What to decline

**AI auto-scheduling (Motion's bet).** Motion moves your blocks for you when things
slip. That directly contradicts block-as-page: if a block carries a document you have
been writing in, having it silently relocated at 2am is hostile rather than helpful.
Sunsama's manual-control stance is the right neighbour here, and Timeblock is already
closer to it.

**Unlimited group nesting.** `MAX_GROUP_DEPTH = 2` exists because a group is a surface
with its own scroll, and unlimited nesting ends in a column of readings too narrow to
label. Every dashboard product in this survey is flatter than Timeblock, not deeper.

**48 columns.** Elastic's number, and tempting. But at phone widths and inside a nested
group a 48th of the width is a few pixels, and the 8px gutter starts to dominate the
cell. 24 was the right step; a further doubling buys precision nobody can hit with a
finger.

**A table of contents / jump links for long dashboards.** Notion's recommended fix for
mobile is jump links to sections. That is a workaround for pages that are too long,
and the better answer is the density limit above.

---

## Backlog

Ranked. The first three are done this session and listed so the reasoning is not lost.

| #   | Item                                                         | Size | Status                                              |
| --- | ------------------------------------------------------------ | ---- | --------------------------------------------------- |
| 1   | Deleted blocks resurrecting on every sync                    | M    | **Done** — not from this analysis; found by tracing |
| 2   | Mobile group stacking and clipping                           | S    | **Done**                                            |
| 3   | 12 → 24 columns, with data migration                         | M    | **Done**                                            |
| 4   | Per-kind minimum widths, replacing the global `MIN_W`        | S    | Informed by DataDog                                 |
| 5   | Verify the dashboard on a real phone at 360px and 375px      | S    | Consensus practice                                  |
| 6   | Audit touch targets against 44×44px                          | S    | Consensus practice                                  |
| 7   | Recurring-instance deletion pushed to Google as an exception | M    | Deferred deliberately; see `push.ts`                |
| 8   | A soft density limit, or guidance, on fields per dashboard   | S    | Informed by Notion                                  |
| 9   | Let a block's page outlive its block                         | L    | Speculative; the first thing linking would buy      |

Items 4–6 are the ones worth doing next: all small, all pointed at the half of the
product where the prior art is clearest.

---

## Sources

- [DataDog — effective dashboards guidelines](https://github.com/DataDog/effective-dashboards/blob/main/guidelines.md)
- [Notion — dashboards](https://www.notion.com/help/dashboards)
- [Notion — introducing Notion Calendar](https://www.notion.com/blog/introducing-notion-calendar)
- [Cron — event attachments and Notion pages](https://www.cron.com/changelog/2023-06-26-event-attachments-and-notion-pages)
- [Elastic — arrange dashboard panels](https://www.elastic.co/docs/explore-analyze/dashboards/arrange-panels)
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)
- [Superset — grid granularity discussion](https://github.com/apache/superset/discussions/18499)
- [Morgen — Sunsama vs Motion](https://www.morgen.so/blog-posts/sunsama-vs-motion)
- [Amie](https://amie.so/)
- [Toptal — designing an intuitive mobile dashboard UI](https://www.toptal.com/designers/dashboard-design/mobile-dashboard-ui)
- [Google Calendar API — recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
