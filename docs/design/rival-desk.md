# The rival desk

Eleven of the twelve default-world promotions are run by the computer. The
rival desk (the `aip` system) is what acts for them: it decides who to push,
what to book and who to hire, and it remembers what it decided. AIP builds it
in steps. AIP1-01 lays the ground floor described here: which promotions and
brands the computer runs, the profile each one keeps, and the decision log.
Later tickets fill the sections marked "later".

Code: `packages/engine/src/systems/aip/`. Tables: `aiProfiles` and
`aiDecisions` ([data-model.md](data-model.md#rival-desk)).

## Units

A **unit** is what one rival turn acts for. `computerUnits(read)`
(`units.ts`) lists them, sorted by key:

- every `active` or `dormant` promotion whose controller is the computer, as
  a whole (`brandId` null);
- every active brand whose own `controller` is the computer inside a
  promotion the computer does not run (a computer GM brand in a human
  promotion, BRW).

A unit's key is `aiUnitKey(promotionId, brandId)` =
`<promotionId>|<brandId ?? '-'>`. Closed promotions take no turns.

Who runs a brand follows the one rule in
`systems/calendar/control.ts` (`showControllerOf`): the brand's own
controller when it has one, else the promotion's. `unitControllerOf` reuses
it. So:

| Brand's own controller | Promotion's controller | The brand belongs to                                     |
| ---------------------- | ---------------------- | -------------------------------------------------------- |
| null                   | computer               | the promotion's unit                                     |
| computer               | computer               | the promotion's unit                                     |
| human                  | computer               | nobody: it is in the promotion unit's `excludedBrandIds` |
| computer               | human                  | its own unit                                             |
| null or human          | human                  | nobody (the player runs it)                              |

A brand with its own human controller under a computer promotion (a second
seat or a player GM, D-06 and D-07) is off limits: every rival job leaves its
roster, shows and titles alone. `unitCovers(unit, promotionId, brandId)` is
the check jobs use (AIP1-05's `unitRoster` filters with it).

## Profiles

`aiProfiles` holds one row per unit (unique `byUnit` index): its stored
taste, its featured workers and the day of its last turn.

- `taste` is null until AIP2 works it out; until then AIP1-04's `tasteOf`
  falls back to the style default. The eight axes are in `taste.ts`.
- `featured` is null until AIP3 first picks an ace and up to two prospects.
  It stores employment IDs, not person IDs, so a person working for two
  promotions can be featured at one. The shape is final now, so AIP3 needs no
  save change.
- Invariants: a profile's brand belongs to its promotion, and every featured
  employment is in the unit (same promotion, and the same brand for a brand
  unit).

Profiles are made two ways, both through `ensureProfile(tx, read, unit, date)`
(`profiles.ts`), which returns the unit's row or creates a blank one:

1. The new-game step `aip.createProfiles` (order 895, after
   `wld.assignControllers` at 300) gives every computer unit its profile, so
   the human promotion, founded or chosen, gets none.
2. The turn runner (AIP1-03) calls it on every turn, so a promotion founded
   later (DAY8, DAY9) and a save made before the rival desk existed get a
   profile on their first turn.

`profileOf(read, promotionId, brandId)` is the read-only lookup for queries;
it returns null when the unit has no profile yet.

## Decision log

`aiDecisions` is the rival desk's memory of what it decided: one row per
decision, with a templated `summary` (a content key and short params, never a
rendered sentence), capped `refs` (person, employment, title and promotion IDs,
12 of each at most, and one show), a `traceRef` to its Why?, a `revealOn`
date and an `importance` from 0 (routine) to 3 (headline). `kind` is an open
camelCase key (`rosterReview`, later `push`, `card`, `title`, ...), so later
features add kinds through AIP1-03's `registerDecisionKind` with no save
change. `refs.employmentIds` is how AIP3 and AIP8 find a worker's last push,
turn or brand move.

**Never edited, pruned.** The table is `appendOnly: 'pruneOnly'`: the
transaction layer refuses every update (`AppendOnlyError`) but allows a
delete, which is how old rows are pruned. Unlike the ledger, nothing has to
reconcile, so old decisions can go.

**Retention.** `aip.decisionLogRetentionDays` (default 365, 0 keeps none) is
the window. `pruneDecisionLog(tx, today, days)` deletes a row once its date is
on or before `today - days` and it has been revealed; a plan that has not
aired yet stays whatever its age. The turn runner (AIP1-03) runs it once a
day.

**Save size.** Eleven rivals write to the log all year, so a row is kept
small: templated text, capped ID lists, no stored trace body. The Why? behind
`traceRef` is a summary-only trace (POL4-06: rival promotions keep summaries,
the player's promotion keeps full Why? traces). With retention, the table
holds at most a year of rows however long the game runs. Each feature that
adds a decision kind reports the 365-day save size in its ticket.

**Visibility.** Another controller sees a row from its `revealOn` date on (the
day the plan airs; D-07 per-player views). The `byRevealOn` index serves that
filter; the Promotions screens (AIP1-06) read through it.

Indexes: `byPromotion`, `byPromotionDate` (key `<promotionId>|<date>`,
helper `aiDecisionDateKey`) and `byRevealOn`.

## Shortcuts

D-01: computer-run promotions take shortcuts the player does not get, so the
world sim stays cheap. Each shortcut is its own `ai.*` tunable (category
`Rival rules`, in `systems/aip/shortcuts.ts`) that defaults on.

| Key                      | Default | What it does when it applies                                                                   | Acted on by          |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| `ai.skipInMatchInjuries` | on      | Rivals' matches cause no in-match injuries; their injuries come from daily world events        | MTCH4, WRK6          |
| `ai.skipResultMorale`    | on      | Rival workers' morale does not move with match results; small off-screen morale events instead | WRK8                 |
| `ai.scoreBonus`          | 3       | Points added to every rival segment score (0 to 20)                                            | MTCH1 (RatingPolicy) |
| `ai.simpleBookingInputs` | on      | Rival bookings skip production notes and match plans                                           | MTCH1                |
| `ai.skipMediaRequests`   | on      | Rivals receive no media requests                                                               | SOC1                 |
| `ai.skipWorkerRequests`  | on      | Rival workers make no requests of their bosses                                                 | SOC5                 |

**The two rules.** `aiShortcut(read, tunables, promotionId, key, brandId?)`
(`aiShortcut.ts`) is the only code that combines a unit's controller, the
level playing field and an `ai.*` key. A shortcut applies only when:

1. **Run by the computer**: `unitControllerOf(read, promotionId, brandId)` is
   the computer. A computer GM brand inside the player's promotion gets the
   shortcuts; a brand with no controller of its own follows its promotion, so
   the player's own brands never do.
2. **Level playing field is off**: the new-game setting
   `meta.settings.levelPlayingField` turns every shortcut off for everyone.

Then the tunable decides. A flag key returns `Traced<boolean>`: a decision
"Rival shortcut: <label>" with both rules, the tunable read, and the reason
("Rival rules apply", "Run by a player, not the computer", "The level playing
field is on" or "This shortcut is turned off"). `ai.scoreBonus` returns
`Traced<number>`: a calculation "Rival score bonus" from 0 that adds the
tunable only when both rules pass, else notes why; an override of 0 means 0.
`aiShortcutOn` is the flag-only form (`Traced<boolean>`), and
`aiShortcutsFor` returns all six for one unit. Flags are booleans: read
`.value`, never `.value !== 0`.

**No `isAI` branches.** A feature that acts on a shortcut (MTCH1, MTCH4, WRK6,
WRK8, SOC1, SOC5, ECO6) calls `aiShortcut` and never looks at a controller
itself, and puts the returned trace in its Why?, so a rival show's trace
shows the shortcuts it used.

**Consumers.** A feature that acts on a shortcut calls
`registerAiShortcutConsumer({ key, featureId, label })` when its module
loads (the same feature twice for one key throws). Until one does, the rules
screen says "Takes effect when <feature> is in the game", using
`AI_SHORTCUTS[key].consumer`, instead of hiding the key.

**`aip.rules`** (no arguments, the same for every viewer) feeds the "Rival
rules" chip: `levelPlayingField`, `appliesTo: 'computer'` and, per shortcut
in the order above, its `label`, `description`, `offText`, `consumer`,
`kind` (`flag` or `points`), `value`, `defaultValue`, `overridden`,
`inForce` (on, or above 0, and the level playing field is off) and the
registered `consumers`.

## Jobs

Later (AIP1-03): the turn runner, the job registry and each job's own random
stream.

## Taste

Later (AIP1-04): the taste formula. The axes and their screen labels are in
`systems/aip/taste.ts`: Wrestling focus, Entertainment focus, Athletic focus,
Star focus, Talk share, Title focus, Youth focus and Risk appetite, each
0-100.

## Card value

Later (AIP4).

## Needs

Later (AIP1-05).

## Visibility

What a viewer may see of a promotion's private numbers, such as its cash.
The helpers are in `systems/aip/visibility.ts`; every AIP query uses them.
What the player sees of each rival's decisions, and when, comes with the
Promotions screens (AIP1-06); see the decision log's `revealOn` above.

`visibilityOf(read, viewer, promotionId)` is one of:

| Visibility   | When                                                             | Private figures |
| ------------ | ---------------------------------------------------------------- | --------------- |
| `omniscient` | the all-seeing viewer (`OMNISCIENT_VIEWER`) of tools and tests   | exact           |
| `own`        | the viewer runs the promotion (`viewerPromotionIds` includes it) | exact           |
| `sandbox`    | the world's sandbox setting is on                                | exact           |
| `public`     | anyone else                                                      | banded          |

`canSeePrivate(visibility)` is true for all but `public`.

**Banding.** `redactForViewer(visibility, value, bands)` returns
`{ kind: 'exact', value }` when the viewer may see private figures, else
`{ kind: 'band', label }` (the last band whose `min` the value reaches), else
`{ kind: 'hidden' }` when no bands are given. It never returns an exact value
to a `public` viewer. `CASH_DISPLAY_BANDS` labels a rival's money (in cents):
Struggling (below 50,000), Getting by (50,000), Comfortable (250,000),
Wealthy (1,000,000) and Very wealthy (5,000,000). They are display labels,
fixed rather than tunable ("Display bands for a rival's money"), and not
AIP8's runway-based `CASH_BANDS` that rival formulas read as their cash
input.

**Traces.** `privateInputOf(label, value, visibility, bands)` is the trace
input for a formula that reads a private number (ECO6): the figure for a
viewer who may see it, else the band label with the band's lower edge as a
fixed constant, else "Hidden". AIP7 and AIP8 pass only a runway band label
and never the figure.

**Limit.** `trace.get` serves any stored trace by its ref. Redaction here
covers query results and AIP traces built with `privateInputOf`; hardening
`trace.get` per viewer belongs to the multiplayer work (D-07).
