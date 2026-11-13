# The Office

The Office is the promotion's front page: cash, prestige, popularity, roster
and morale, with how each has moved. DAY2 builds it in steps. This doc starts
with the history behind it (DAY2-01); the headline figure, the deltas and
sparklines (DAY2-02, DAY2-03) and the screen itself (DAY2-04) add their own
sections.

Code: `packages/engine/src/systems/office/`.

## History

Before DAY2 the engine kept no history of a promotion at all, so nothing could
say "up 3 since last week" or draw a line. The `promotionSnapshots` table is
the one place promotion history lives (a person's history is WRK4's
`personSnapshots`). Rows are plain facts: no random draw and no trace is
stored with them. The Office rebuilds the live value's Why? when it reads it,
which keeps the trace store free of hundreds of weekly entries a year.

### Columns

| Column                       | What it holds                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `cash`                       | The promotion's cash at the end of the day, in cents                                       |
| `prestige`                   | The promotion's prestige                                                                   |
| `popularity.world`           | The population-weighted world roll-up of `regionalPop` (D-03, WRK1's roller)               |
| `popularity.byContinent`     | Every continent's roll-up; sparse, a continent at 0 is left out                            |
| `popularity.homeRegionValue` | The stored value in the home region, 0 when none is stored                                 |
| `popularity.headline`        | The figure the Office leads with: the home country's roll-up until DAY2-02 defines its own |
| `rosterSize`                 | People with an active contract that has started (`startsOn` on or before the day)          |
| `averageMorale`              | The mean morale of those contracts, unrounded; null when nobody is under contract          |
| `extra`                      | Registered fields, one number each (see [the registry](#the-registry))                     |

Roll-ups are kept inside 0..100. One roller is built per run and shared by
every promotion.

### Cadence and the baseline

- **Weekly**: the `office.weeklySnapshot` phase runs every Monday in the
  `periodic` group (order 34), after the day's shows, settlement, growth and
  money, so a Monday row already includes that Monday's show and payroll. It
  writes one `week` row for every `active` or `dormant` promotion, in id order,
  and publishes `office.snapshotTaken { date, promotionIds }`. Closed
  promotions stop getting rows but keep the history they have.
- **Baseline**: the `office.baselineSnapshot` new-game setup step (order 990,
  after every other step) writes one `baseline` row dated the start date for
  every active promotion, so the first week already has something to compare
  with. A game that starts on a Monday turns that row into the Monday's `week`
  row when the day is simulated, instead of adding a second row for the same
  day.

At most one row exists per promotion per day: the `byPromotionDate` index is
unique, and the phase updates an existing row rather than creating another.

### Granularity

| Granularity | Meaning                                                     |
| ----------- | ----------------------------------------------------------- |
| `week`      | A Monday within the full-detail window                      |
| `month`     | The last kept row of a calendar month older than the window |
| `baseline`  | The day the game started; never thinned or deleted          |

### Retention

Weekly rows add up over a long career, so old weeks are thinned. After writing,
the same phase looks at every row dated before
`date − 7 × office.history.fullDetailWeeks` days (52 weeks by default). Those
rows are grouped by promotion and calendar month; in each group the latest row
is kept and set to `month`, and the others are deleted. Baseline rows are
never touched. The plan is a pure helper, `planCompaction(rows, cutoff)`, and
running it again changes nothing.

A promotion therefore holds at most `fullDetailWeeks + 1` weekly rows, one row
per older month and its baseline. With the default of 52 weeks, a year of play
holds at most 53 rows per promotion; twenty years hold about 53 + 12 × 19, or
roughly 280. Lowering `fullDetailWeeks` takes effect on the next Monday. The
headless runner's `--strict` checks these limits after every run and prints the
table's size in its summary.

On the default world a year of play writes 636 rows (12 promotions × 53) at
about 330 bytes each: a 365-day save grows from 8.91 MB to 9.12 MB.

### The registry

Other features add a number to every row without a schema change by
registering a field:

```ts
registerPromotionSnapshotField({
  key: 'morale.trend', // lower camelCase words joined by dots
  label: 'Morale trend',
  unit: 'points', // 'points' | 'money' | 'count' | 'percent' | 'ratio'
  visibility: 'owner', // 'public' | 'owner'
  extract: (promotion, read, date) => value, // number, Traced<number> or null
  kpi: { order: 30, goodWhen: 'up', footer: 'Last 8 weeks' }, // optional
});
```

- The value lands in the row's `extra` map under its key from the next
  snapshot on. Rows written before the field was registered lack the key: an
  absent key means "not recorded that week", while 0 is stored as 0.
- `extract` returning null records nothing that week.
- A traced extract stores only its value; the Office re-runs it live for the
  current Why? (DAY2-03).
- A key that is malformed, already registered or clashes with a built-in
  column (`cash`, `prestige`, `popularity` and `popularity.*`, `rosterSize`,
  `averageMorale`) throws a `RegistryError` naming the key.
- `promotionSnapshotFields()` lists the fields in key order; the function
  `registerPromotionSnapshotField` returns removes the field again (for tests).
- **Visibility**: `public` fields may be shown for any promotion; `owner`
  fields only to the player who runs the promotion. The history query that
  hands rows to the UI (DAY2-03) enforces it; the stored row holds every field.

Keep each field a single number. Anything structured, such as a per-region
map, belongs in its owning feature's own table. Features expected to register
fields: SOC3 (morale trend), ECO3 (hype), ECO2 (prestige), AIP5 (hot shots),
DAY4 (rankings) and POL2 (balance charts).

### Tunables

| Key                              | Default | Range | Meaning                                                                    |
| -------------------------------- | ------- | ----- | -------------------------------------------------------------------------- |
| `office.history.fullDetailWeeks` | 52      | 4–520 | Weeks kept at full weekly detail before older weeks are thinned to monthly |
| `office.trend.weeks`             | 8       | 2–52  | Weeks shown in a KPI sparkline (read by DAY2-03)                           |
| `office.delta.lookbackDays`      | 7       | 1–90  | How far back a KPI delta compares (read by DAY2-03)                        |
