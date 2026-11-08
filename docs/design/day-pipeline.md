# The day pipeline

Advancing time runs an ordered list of **phases**: housekeeping, world events,
AI turns, contracts, shows, growth, money, and the weekly, monthly and yearly
jobs. Each phase is a named step with its own transaction and its own error
report, so one broken step never cancels the rest of the day.

This doc fills in as the pipeline is built. It starts with the calendar,
because every phase needs to answer "do I run today?" before anything else.

## Calendar

Code: `packages/engine/src/core/calendar/`. Tests:
`packages/engine/test/core/calendar/cadence.test.ts`.

### Dates are `GameDate`s

Every date the pipeline sees is a `GameDate` from `core/date.ts`: an ISO
`YYYY-MM-DD` string with integer calendar maths underneath. That module is the
only place that parses dates or does date arithmetic (`addDays`, `weekday`,
`isLastDayOfMonth`, ...). The calendar code builds on those helpers and has no
date type or arithmetic of its own. It never creates a JS `Date`, never reads
the clock and never slices the date string, so a cadence gives the same answer
in every time zone.

The test script proves that last part. After the normal run, `npm test` runs
the cadence tests again under `TZ=Pacific/Kiritimati` (UTC+14) and
`TZ=America/St_Johns` (UTC−3:30 with daylight saving). Each run hashes every
matching date for a set of cadences over 2023–2025 and must produce the same
frozen value.

### Cadence kinds

A **cadence** says how often a job runs. There are four kinds:

| Cadence                                | Runs                                | Described as                    |
| -------------------------------------- | ----------------------------------- | ------------------------------- |
| `{ kind: 'daily' }`                    | every day                           | "every day"                     |
| `{ kind: 'weekly', weekday: 'mon' }`   | one weekday each week               | "every Monday"                  |
| `{ kind: 'monthly', day: 1 }`          | a fixed day, 1 to 28, of each month | "on the 1st of each month"      |
| `{ kind: 'monthly', day: 'last' }`     | the last day of each month          | "on the last day of each month" |
| `{ kind: 'yearly', month: 1, day: 1 }` | one date each year                  | "every year on 1 January"       |

Weekdays are written as short names (`mon` to `sun`) because they read better
in phase definitions and data packs than numbers. `WEEKDAY_NAMES` is the one
mapping between the names and the `Weekday` numbers that `weekday()` returns
(0 = Monday), with `weekdayFromName` and `weekdayName` to convert.

The functions:

- `defineCadence(cadence)` checks a cadence and returns a frozen copy.
- `matchesCadence(date, cadence)` says whether the job runs on that date.
- `nextOccurrence(from, cadence)` gives the first date on or after `from` when
  it runs, for report lines like "next payroll on 2024-03-29". It looks at most
  366 days ahead, which covers every valid cadence.
- `describeCadence(cadence)` gives the plain-English text above, for day
  reports and traces.
- `cadenceSchema` is the zod schema for cadences in data packs and saved
  schedules. It runs the same checks as `defineCadence` and rejects unknown
  fields, so a misspelt key fails instead of being ignored.

### Why days 29–31 and 29 February are rejected

A monthly job "on the 31st" sounds reasonable and quietly doesn't run in seven
months of the year. On the 30th it misses February; on the 29th it misses
February three years in four. Nothing crashes. The job just doesn't happen, and
you find out months later when the books don't add up. Yearly jobs on
29 February have the same problem, skipping three years out of four.

Rolling the date over (the 31st becomes the 30th in April) would be a guess
about what the author meant: maybe "end of month", maybe "around the 30th". So
the calendar doesn't guess. A monthly day has to be 1 to 28, which exists in
every month, or `'last'`, which says "end of month" outright. A yearly date has
to exist in a common year. Anything else throws `InvalidCadenceError` (code
`INVALID_CADENCE`) when the cadence is defined, and the message names the bad
field:

```
Invalid cadence: monthly.day must be a whole number from 1 to 28, or 'last' for
the final day of the month (...), got 31
```

`matchesCadence`, `nextOccurrence` and `describeCadence` run the same check, so
a cadence built by hand without `defineCadence` still can't skip days silently.

### How a phase declares its cadence

A phase carries its cadence next to its name and its step function. The phase
registry itself comes with the pipeline, but the shape is:

```ts
const payroll = {
  name: 'money.payroll',
  cadence: defineCadence({ kind: 'weekly', weekday: 'fri' }),
  run: runPayroll,
};
```

Each day the pipeline calls `matchesCadence(currentDate, phase.cadence)` and
skips the phase when it returns false. `describeCadence` and `nextOccurrence`
give the day report its schedule lines, such as "Payroll: every Friday, next on
2024-03-08".

Some schedules aren't cadences:

- **Seasons.** Season length is chosen per game (D-08), so a season boundary
  doesn't land on a fixed weekday or day of the month. The `seasonEnd` phase
  uses a `daily` cadence with a condition that compares the current date to the
  active season's end date.
- **Event recurrence.** "Every other week" and tour schedules belong to the
  event calendar, which expands its own recurrence rules on top of the same
  `core/date.ts` helpers.

Step timings in the day report are the only place the pipeline needs wall-clock
time. The host passes in a `now()` function for that, so the engine itself
still never reads the clock.
