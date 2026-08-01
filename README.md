# Attendance automation

Fills unfilled attendance days on the Priority Connect portal using Playwright. Runs every Friday at
00:30 Asia/Jerusalem through GitHub Actions, which reads the schedule as the cron `30 21 * * 4` — a
Thursday in UTC.

Friday, not Thursday: the portal rejects an `outTime` that has not happened yet, so a Thursday 17:00 run
left Thursday itself unreported. By Friday the whole Sun–Thu week is in the past, and Friday and Saturday
are `off` anyway.

## Setup

Node 20 and Playwright 1.59 to match the container the workflow runs in.

```bash
npm install
npx playwright install chromium
cp env_example .env
```

Fill `.env` with the portal credentials:

```text
ATTENDANCE_LOGIN_USERNAME=
ATTENDANCE_LOGIN_PASSWORD=
```

For CI, add the same two names as GitHub Secrets on the repository. The workflow passes nothing else.

## How it works

1. Logs into the portal with credentials from environment variables.
2. Steps back through the last `sweepMonthsBack` months, filling each one.
3. Returns to the current month and fills that.
4. On every month, waits for the grid to finish loading before scanning for "pink days" — days where
   attendance has not been filled.
5. For each pink day, looks up the day of the week in `attendance.json` to get the scheduled place.
6. Fills `inTime`/`outTime` from `defaults`, sets remarks to `"office"` if place is `office`, leaves remarks empty for `home`, skips entirely for `off`.

## Why it walks backwards

The portal only opens on the current month, and the greyed-out spill-over cells it draws for the
neighbouring month cannot be reported into. So a day left unfilled when the month rolls over — Thursday
the 30th, next run Friday the 1st — becomes invisible. That is how 29 and 30 June 2026 stayed unreported
for over a month. The backward walk also recovers days lost to a run that failed outright.

## Portal quirks

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

The day modal opens before it is writable. For about a second the notes textarea carries
`maxlength="0"`, and anything filled in during that window is accepted by the UI and then discarded:
remarks truncated to nothing, times never registered. `waitForModalReady()` polls that attribute before
anything is typed.

Times are typed, not `fill()`ed. It is a React form, so `typeTime()` clicks the input, uses
`pressSequentially` and blurs. That is what makes the key handlers run and the attendance-type dropdown
initialise.

## A closed month cannot be fixed by this script

For a day in a month the portal has closed for reporting, the save is accepted and nothing is persisted.
The modal closes, the save button is enabled, no error appears anywhere, and the day stays unreported.
The tell is the hours block in the modal: a genuinely saved entry has edit and delete buttons
(`.reported-attendance .editDeleteButtons`), while a closed-month day shows the 09:00–18:00 pair from the
work-schedule template with no such buttons. Verified on 29 June 2026 with a fully initialised modal and
character-by-character typing.

So 29 and 30 June and 28 and 31 May 2026 cannot be filled by the automation. They need a manual fix by
someone who can reopen the period. In the log the failure reads `stayed unreported — the portal accepted
the entry and dropped it (month closed for reporting?)`, and it counts as a skipped day rather than a
crash.

## Configuration

`src/attendance/attendance.json` is the only file you need to edit.

```json
{
  "automation": {
    "time": "00:30",
    "timezone": "Asia/Jerusalem",
    "dayOfWeek": 5
  },
  "baseUrl": "https://p.priority-connect.online/attendance/portal/PP001#/attendance",
  "defaults": {
    "inTime": "09:00",
    "outTime": "18:00"
  },
  "sweepMonthsBack": 1,
  "schedule": {
    "sun": "home",
    "mon": "home",
    "tue": "home",
    "wed": "home",
    "thu": "home",
    "fri": "off",
    "sat": "off"
  }
}
```

| Field                  | Description                                           |
| :--------------------- | :---------------------------------------------------- |
| `automation.dayOfWeek` | Cron weekday, 0 = Sunday, so `5` is Friday            |
| `sweepMonthsBack`      | How many past months to walk back through on each run |

One step back is exactly the rollover window, and it is all that is needed: the run happens at 00:30 on
Friday the 1st, while the previous month is still open. A deeper sweep only re-attempts months the portal
has already closed, every attempt there fails, and the log fills with errors every week.

| Place    | Behavior                                     |
| :------- | :------------------------------------------- |
| `office` | Fills attendance, sets remarks to `"office"` |
| `home`   | Fills attendance, no remarks                 |
| `off`    | Day is skipped entirely                      |

After changing `time` or `dayOfWeek`, regenerate the GitHub Actions cron:

```bash
npm run sync-schedule
```

With the values above the generated cron is `30 21 * * 4`. The cron weekday is Thursday even though the
run is on Friday, because 00:30 Friday in Asia/Jerusalem is 21:30 Thursday in UTC and GitHub Actions reads
cron in UTC. `src/utils/cron.ts` shifts the weekday for that, and the comment it writes into the workflow
spells out the UTC time.

## Environment variables

Required, locally in `.env` and in CI as GitHub Secrets:

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

## Running manually

Trigger the workflow from the GitHub Actions UI, or run locally:

```bash
npm run attendance
```

The dry run walks the exact same path but never opens the modal and never saves. It prints what it would
fill for each day:

```bash
npm run attendance:dry
```

Run it before any schedule or selector change.

## Self-healing selectors

Page objects in `src/core` do not hold plain selector strings. `SelfHealingLocator.resolve()` tries the
primary selector, then each fallback in order, then a selector healed on an earlier run and read from the
cache, and only then asks a model to find the replacement in the live DOM. A fresh heal is written to the
cache so the next run skips the model call.

The AI step needs `ANTHROPIC_API_KEY`, and the workflow does not pass it, so scheduled runs work off the
known selectors alone. If none of them match, the resolver saves a full-page screenshot and throws
`SelectorNotFoundError` rather than acting on the wrong element. When the portal markup changes, run the
dry run locally with the key set so the new selectors land in the cache.

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
