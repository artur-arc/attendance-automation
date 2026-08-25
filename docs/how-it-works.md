# How it works

Technical notes for whoever maintains this. For setup and daily use see the [README](../README.md).

## A run, end to end

1. Logs into the portal with `ATTENDANCE_LOGIN_USERNAME` / `ATTENDANCE_LOGIN_PASSWORD`.
2. Steps back through the last `sweepMonthsBack` months, filling each one.
3. Returns to the current month and fills that.
4. On every month, waits for the grid to finish loading before scanning for pink days — days with no
   attendance reported.
5. For each pink day, looks up the weekday in `attendance.json` to get the place.
6. Fills `inTime`/`outTime` from `defaults`, sets remarks to `"office"` if the place is `office`, leaves
   remarks empty for `home`, skips `off` entirely.

## Why it walks backwards

The portal only opens on the current month, and the greyed-out spill-over cells it draws for the
neighbouring month cannot be reported into. So a day left unfilled when the month rolls over — Thursday
the 30th, next run Friday the 1st — becomes invisible. That is how 29 and 30 June 2026 stayed unreported
for over a month. The backward walk also recovers days lost to a run that failed outright.

One step back (`sweepMonthsBack: 1`) is exactly the rollover window and is all that is needed: the run
happens at 00:30 on Friday the 1st, while the previous month is still open. A deeper sweep only re-attempts
months the portal has already closed, every attempt there fails, and the log fills with errors every week.

## Portal quirks the code works around

The grid paints in two passes. Date cells appear seconds before their status circles arrive from
`POST /wcf/service.v3`, and a scan in between sees a calendar where every day looks already reported.
`AttendancePage.waitForCalendarData()` waits for the statuses, not just the cells.

The header is RTL and language-dependent. A fresh browser, which is always the case in CI, shows Hebrew
with the year first — «2026 אוגוסט» — while a profile set to English shows «June 2026». Month names are
matched in both via `monthAliases` in `types/index.ts`. Because of the RTL layout the `right-arrow`
chevron steps backwards; the forward chevron carries the `disable` class while the calendar is on the
current month.

Day-cell weekday classes run `Day0` = Sunday through `Day6` = Saturday, and `Day5`/`Day6` always carry
`off-day`. The `week` map in `types/index.ts` was previously off by one (`Day1`..`Day7`) and is now
corrected.

The day modal opens before it is writable. For about a second the notes textarea carries `maxlength="0"`,
and anything filled in during that window is accepted by the UI and then discarded: remarks truncated to
nothing, times never registered. `waitForModalReady()` polls that attribute before anything is typed.

Times are typed, not `fill()`ed. It is a React form, so `typeTime()` clicks the input, uses
`pressSequentially` and blurs. That is what makes the key handlers run and the attendance-type dropdown
initialise.

## A closed month cannot be fixed by this script

For a day in a month the portal has closed for reporting, the save is accepted and nothing is persisted.
The modal closes, the save button is enabled, no error appears anywhere, and the day stays unreported. The
tell is the hours block in the modal: a genuinely saved entry has edit and delete buttons
(`.reported-attendance .editDeleteButtons`), while a closed-month day shows the 09:00–18:00 pair from the
work-schedule template with no such buttons. Verified on 29 June 2026 with a fully initialised modal and
character-by-character typing.

So 29 and 30 June and 28 and 31 May 2026 cannot be filled by the automation. They need a manual fix by
someone who can reopen the period. In the log the failure reads `stayed unreported — the portal accepted
the entry and dropped it (month closed for reporting?)`, and it counts as a skipped day rather than a
crash.

## Self-healing selectors

Page objects in `src/core` do not hold plain selector strings. `SelfHealingLocator.resolve()` tries the
primary selector, then each fallback in order, then a selector healed on an earlier run and read from the
cache, and only then asks a model to find the replacement in the live DOM. A fresh heal is written to the
cache so the next run skips the model call.

The AI step needs `ANTHROPIC_API_KEY`, and the workflow does not pass it, so scheduled runs work off the
known selectors alone. If none of them match, the resolver saves a full-page screenshot and throws
`SelectorNotFoundError` rather than acting on the wrong element. When the portal markup changes, run the
dry run locally with the key set so the new selectors land in the cache.

## The cron translation

With `time: "00:30"`, `timezone: "Asia/Jerusalem"` and `dayOfWeek: 5`, the generated cron is `30 21 * * 4`.
The cron weekday is Thursday even though the run is on Friday, because 00:30 Friday in Asia/Jerusalem is
21:30 Thursday in UTC and GitHub Actions reads cron in UTC. `src/utils/cron.ts` shifts the weekday for
that, and the comment it writes into the workflow spells out the UTC time.

Friday rather than Thursday for a second reason: the portal rejects an `outTime` that has not happened
yet, so a Thursday 17:00 run left Thursday itself unreported. By Friday the whole Sun–Thu week is in the
past, and Friday and Saturday are `off` anyway.

## Environment variables

Required — locally in `.env`, in CI as GitHub Secrets:

| Variable                    | Description           |
| :-------------------------- | :-------------------- |
| `ATTENDANCE_LOGIN_USERNAME` | Portal login username |
| `ATTENDANCE_LOGIN_PASSWORD` | Portal login password |

Optional, for the selector layer:

| Variable                       | Description                                                       |
| :----------------------------- | :---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Enables the AI heal. Absent means known selectors only            |
| `SELECTOR_CACHE_PATH`          | Where healed selectors are stored, default `.selector-cache.json` |
| `SELECTOR_HEAL_MODEL`          | Model used by the healer                                          |
| `SELECTOR_HEAL_MIN_CONFIDENCE` | Below this, a healed selector is discarded, default `0.5`         |

## Module structure

```text
src/
  attendance/
    attendance.json       ← config (edit this)
    run.ts                ← entry point
    dry-run.ts            ← read-only dry run
    AttendanceService.ts  ← core logic
    pages/
      LoginPage.ts
      AttendancePage.ts
    types/index.ts        ← types, day/place constants, month aliases
  core/
    AutomationRunner.ts   ← browser lifecycle
    BasePage.ts           ← shared page object base
    SelfHealingLocator.ts ← selector specs with fallbacks
    SelectorCache.ts      ← healed selectors, persisted between runs
    SelectorHealer.ts     ← model call that finds a replacement selector
    dom-types.ts          ← DOM shapes used inside page.evaluate
  utils/
    logger.ts
    cron.ts               ← timeToCron(time, timezone, dayOfWeek)
    sync-schedule.ts      ← updates workflow cron from attendance.json
    index.ts
.github/workflows/attendance.yml
```

## Playwright and the container image

The environment needs Node 20 and Playwright 1.62.1 to match the container the workflow runs in
(`mcr.microsoft.com/playwright:v1.62.1-jammy`). Those two versions move together: bumping the Playwright
version in `package.json` without bumping the image tag in `.github/workflows/attendance.yml`, or the other
way round, breaks the scheduled run. Both `playwright` and `@playwright/test` are pinned to exact versions
rather than caret ranges, so a stray `npm install` cannot drift them apart, and CI runs `npm ci` so it
installs exactly what the lockfile says.

A mismatch reads `browserType.launch: Executable doesn't exist at /ms-playwright/`. The message names both
the version it found and the image tag it needs, so the fix is to bump both to the same version.
