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
aired yet stays whatever its age. The daily phase `aip.pruneDecisionLog` runs
it (see [Jobs](#jobs)).

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

**Wired on main (AIP1-07).** MTCH1 is the only partner on main that acts on a
shortcut. `ratingPolicy.ts` registers the one rating policy provider behind
MTCH1's [policy door](match-rating.md#the-policy-door-d-01): it reads
`ai.scoreBonus`, `ai.simpleBookingInputs` and `ai.skipInMatchInjuries`
through `aiShortcut`, names the policy "Rival shortcuts" when any applies
(else "Full rules", with MTCH1's neutral line "Same rules for every
promotion"), and titles the score's policy line "Rival shortcut: Score bonus
+3" (or "No rival score bonus +0" when only the flags apply), with the
"Rival score bonus" calculation and its "Rival shortcut" line under it. It
registers MTCH1 ("Match ratings") as the consumer of `ai.scoreBonus` and
`ai.simpleBookingInputs`. The Match lab's "Rate as" select rates a segment
as any active promotion, so a player can see the rival rules at work.
`ai.skipInMatchInjuries` (MTCH4, WRK6), `ai.skipResultMorale` (WRK8),
`ai.skipMediaRequests` (SOC1) and `ai.skipWorkerRequests` (SOC5) have no
consumer on main yet; each of those features wires AIP1 from its own pack.

**What the bonus does to rival scores.** A rival show with no card is scored
off screen ([show night](show-night.md#off-screen-score)) and never goes
through a segment rating, so in the default game (no rival cards until AIP4)
the bonus changes nothing. With every show carded (the test system
`cardEveryShowSystem`), measured over 365 days of the default world in
2026-11 (`test/systems/aip/rivalScoreFairness.test.ts`, slow run): before
AIP1-07, and with the Level playing field, the 463 rival shows averaged 47.30
(segments 49.55); with the default Rival rules they average 50.30 (segments
52.55), exactly +3; the player's shows stay at 52.93 either way.

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

The runner does no work for a unit with nothing due: it makes sure the unit
has a profile and moves on, with no turn, no event and no `lastTurnOn` change.
Later jobs add their own shortcuts inside `run` (for example, nothing to
review when the roster has not changed).

## Jobs

Every rival behaviour is a **job**: the weekly roster review (AIP1-05), push
reviews (AIP3), card planning before a show (AIP4), monthly business reviews
(AIP8), hiring (ECO6), brand GM bookings (BRW6). They all run through one
phase, so they visit the promotions in the same order, spread over the week
instead of piling onto one day, and one broken rival never rolls back another
rival's work.

Code: `packages/engine/src/systems/aip/jobs/` and `phases.ts`.

**Adding a job.** One `registerAiJob({ id, cadence, units?, run })` call in the
feature's own system module, with no phase of its own. `id` is an API name
such as `aip.rosterReview`; a duplicate id throws `RegistryError` naming both.
`units` is `promotions` (whole promotions only), `brands` (computer GM brands
only) or `all` (the default). `aiJobs()` lists them sorted by id. A job that
draws random numbers declares its own stream in `streams.ts` (named after the
job), so one job's draws never shift another's.

**The runner.** `aip.runTurns` (group `aiTurns`, order 50, daily, so before
contracts and shows) walks `computerUnits` in key order. For each unit it
calls `ensureProfile` (self-healing: a promotion founded later or a save from
before the rival desk gets its profile on its first turn), then runs each due
job in id order. After the unit's jobs it sets the profile's `lastTurnOn` and
publishes `aip.turnTaken` with the ids of the jobs that ran. Human-controlled
units never run jobs, and a promotion unit's jobs must leave the brands in
`unit.excludedBrandIds` alone (`unitCovers`).

**Cadences.**

| Cadence      | Due on                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `daily`      | every day                                                                                                                        |
| `weekly`     | the unit's weekday: `(toEpochDay(date) - unitOffset(key, 7)) mod 7 = 0`                                                          |
| `monthly`    | the unit's day of the month: `1 + unitOffset(key, 28)`, so 1 to 28 and every month has it                                        |
| `beforeShow` | a day the unit has a `scheduled` or `booked` show (`eventInstances` `byDate`): its promotion's, and for a brand unit its brand's |

`beforeShow` jobs see the day's shows as `job.shows`; they run before the
shows phase (500) runs them. Until a calendar feature stores shows, the
cadence simply never fires.

**Spreading.** `unitOffset(unitKey, modulo)` is `hashString32(unitKey) %
modulo`, the foundation's frozen-output hash (`core/hash.ts`). It is a hash of
the unit's own key and not its position in the list, because a position
shifts whenever a promotion is founded or closes and would move every later
rival's review day; the hash never changes, needs no stored state and draws
no random numbers. `nextDueOn(cadence, unit, from)` gives the first due date
on or after `from` for weekly and monthly jobs (null for the others), so a
screen can say when the next review is; nobody should assume "the 1st of the
month". `isDue(cadence, unit, date, read)` is the runner's own test.

**Savepoints and the buffer.** Each job runs in
`tx.savepoint('aip.job:<jobId>:<unitKey>', ...)`. A savepoint rolls back rows
but not staged events or traces, so the job context's `publish`,
`recordTrace` and `recordDecision` are buffered and handed to the phase's
stagings only when the savepoint returns `ok: true`. A job that throws
therefore changes nothing (no rows, events, traces or decisions); the runner
logs the job, unit and message, publishes `aip.jobFailed` and carries on with
the next job and the next unit. The job context keeps `PhaseContext`'s exact
`publish` and `recordTrace` signatures, so it can be passed straight to the
workers doors (`DoorContext`) and the booking writer.

A rolled-back job has still advanced its random stream. That is
deterministic (same seed, same failure, same draws) and keeps streams simple,
so streams are not snapshotted per job.

**Failure visibility.** A job caught by its savepoint does not fail the
`aip.runTurns` step, so it never reaches the pipeline failure log or the
repeated-failure stop: one broken rival job must not stop the player's skip.
It shows instead in the step's log, as the `aip.jobFailed` event (readable
through `sim.recentEvents`), and in `npm run sim -- --strict`, which fails on
any `aip.jobFailed` (`--fail-on-event` changes the list). A bug in the runner
itself, outside any job, still throws and fails the step as usual.

**Decisions.** `job.recordDecision({ kind, summary, refs?, traced?,
traceKind?, revealOn?, importance? })` refuses a kind nobody registered
(throwing, so the job rolls back), inserts the `aiDecisions` row (`revealOn`
defaults to today, `importance` to 0), stores `traced` summary-only under
`{ kind: traceKind ?? 'aip.<kind>', id: '<unitKey>:<date>:<n>' }` (n counts
the unit's decisions that day) and publishes `aip.decisionRecorded`. It
returns the decision's ID. Setup steps with no job context (AIP2-02's day-one
appointments) call `writeAiDecision(tx, ctx, unit, spec)`, which does the
same. Trace IDs are guessable; who may read them is decided by the queries.

**Decision kinds.** `registerDecisionKind({ kind, chip, icon? })` adds a kind
with the label of its Decision log filter chip (and optionally a Lucide icon
name); a duplicate throws `RegistryError`. `decisionKinds()` lists them by
kind and `decisionKindOf(kind)` looks one up. The rival desk registers
`rosterReview` ("Roster review"); later features register theirs (`push`,
`card`, `title`, `businessReview`, ...) from their own modules.

**Pruning.** `aip.pruneDecisionLog` (group `periodic`, order 42, daily)
deletes expired rows in ID order with the `pruneOnly` delete
([Decision log](#decision-log)). On most days it reads only the rows that can
have expired that day through the indexes: each promotion's rows dated
`today - retentionDays` (`byPromotionDate`) and the rows revealed today
(`byRevealOn`). On the 1st of each month it also sweeps the whole log, which
catches rows a lowered retention left behind.

**What a job must not do.** Write to a human-controlled unit or to a brand in
`excludedBrandIds`; use `Math.random` (use `job.rng(stream)`); read a worker's
hidden `development`; or add a phase of its own.

## Taste

A taste is what a promotion values: eight axes, each 0-100. The axes and
their screen labels are in `systems/aip/taste.ts`: Wrestling focus,
Entertainment focus, Athletic focus, Star focus, Talk share, Title focus,
Youth focus and Risk appetite.

**Style default** (`formulas/defaultTaste.ts`, AIP1-04). Until a booker makes
a taste of their own (AIP2), a promotion's taste comes from its style. Each
axis is one tunable, `aip.styleTaste.<style>.<axis>` (56 in all, category
`Rival taste`, generated in `tasteTunables.ts`), kept within 0-100. Its Why?
is one line per axis: "Style default (Hard-hitting)", naming the tunable. The
taste as a whole is labelled "Style taste: Hard-hitting".

| Style         | Wrestling | Entertainment | Athletic | Star | Talk share | Title | Youth | Risk |
| ------------- | --------- | ------------- | -------- | ---- | ---------- | ----- | ----- | ---- |
| mainstream    | 50        | 60            | 45       | 70   | 35         | 55    | 45    | 35   |
| traditional   | 65        | 45            | 40       | 55   | 25         | 60    | 40    | 35   |
| technical     | 85        | 30            | 45       | 40   | 15         | 55    | 45    | 25   |
| hardHitting   | 80        | 30            | 40       | 50   | 15         | 65    | 40    | 55   |
| hardcore      | 50        | 45            | 45       | 45   | 25         | 45    | 50    | 90   |
| highFlying    | 55        | 40            | 90       | 45   | 20         | 50    | 60    | 55   |
| entertainment | 35        | 85            | 40       | 75   | 50         | 50    | 40    | 30   |

**`tasteOf(read, tunables, promotionId, brandId?)`** (`taste.ts`) is the taste
a unit decides with: the profile's stored `taste` when it has one (labelled
"Booker taste", each axis an input of the stored value; AIP2 replaces this
with its own traces), else the promotion's style default. A brand unit reads
its own profile and falls back to its promotion's style. A human promotion
has no profile, so it gets its style default too: that is how "how would a
rival value this worker" and AIP3's advisory pushes read it.

**Style is bonus-only.** Taste only ever weights things: an axis of 0 leaves
something out, a high axis makes it count more, and no axis is ever
subtracted. A worker whose style the booker does not favour earns less of a
bonus, never a penalty (see the card value blend below).

## Card value

`cardValue(inputs, { tunables })` (`formulas/cardValue.ts`, AIP1-04) is how
much a worker is worth **to this promotion**, 0-100. AIP3 ranks pushes by it,
AIP4 orders cards, ECO6 hires with it and ECO9 ranks budget cuts. It is a
pure formula: AIP1-05's `cardValueInputsFor` reads the inputs from the world
(attributes, regional popularity, the promotion's popularity, the regions,
`employment.momentum`, `ageOn`, `tasteOf`). The inputs object stays open:
AIP2 and AIP3 add optional fields (a booker taste line, a featured boost).

1. **Market popularity** `M`. The promotion's markets are the regions where
   its popularity is at least `aip.cardValue.marketMinPop` (10). Each counts
   by `population × promotion popularity ÷ 100`, through the same
   `fanBaseOf` rule WRK1's expected push uses (one fan-base rule, its own
   threshold). `M = Σ weight × worker popularity ÷ Σ weight`. The Why? lists
   the five heaviest markets and adds the rest as one line. When no region
   reaches the minimum, every region the promotion is known in counts (with
   a note); with none, `M = 0` and the note says "<promotion> has no fans
   yet". Popularity outside the markets never counts (D-03): a star abroad is
   worth only their ability to a regional company.
2. **Attribute blend** `B`, weighted by taste. Four groups, each a mean:
   ring work (ringwork, psychology, stamina, safety) × Wrestling focus;
   character (mic, charisma) × Entertainment focus; athleticism × Athletic
   focus; presence × Star focus. `B = Σ taste × group ÷ Σ taste`. Each line
   names the taste ("Ring work group 71 × Style taste: Hard-hitting 80"). A
   taste of 0 leaves its group out; all four at 0 give `B = 0`, with a note.
3. **Base** `= (popularityWeight × M + abilityWeight × B) ÷ (popularityWeight
   - abilityWeight)`; both weights 0 give 0, with a note.
4. **Momentum**: `+ momentum × aip.cardValue.momentumFactor` (0.1). While
   momentum is null (before WRK5 fills it) the line reads "No momentum yet:
   +0".
5. **Age**: older than `aip.cardValue.declineAge` (36), `× max(ageFloor, 1 −
years past × declinePerYear)` (0.5 and 0.04). Younger than
   `aip.cardValue.youthAge` (26), `+ youth focus ÷ 100 ×
aip.cardValue.youthBonus` (6). Otherwise "Prime age, no change".
6. Kept within 0-100. Not rounded: screens round.

**How the bonus-only rule applies.** Card value does not read a worker's
ring style label at all; style shows only through attributes and the taste.
Every line of the blend is a group score (0 or more) times a taste weight (0
or more), so no line is ever negative, and a test checks that the blend has
no subtracting step. A talker at a technical promotion is not marked down
for talking: Entertainment focus 30 simply counts his character group less
than Wrestling focus 85 counts ring work. The only steps that can lower card
value are momentum below 0 and the age decline, and neither is about style.

**Worked example** (default world, new game, default tunables). Tatsuya Ueno,
30, main eventer at Tessen Pro Wrestling (style hard-hitting, so Wrestling
focus 80, Entertainment 30, Athletic 40, Star 50):

| Step              | Working                                                                                                                                                                                                 | Value |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Market popularity | 8 markets, 88.8 million fans; Kanto 57.6 × 28.28 million, Western Japan 51.4 × 14.08 million, Kansai 55.1 × 13.76 million, Chubu 49.5 × 12.42 million, South Korea 15.3 × 9.31 million, 3 other markets | 48.49 |
| Attribute blend   | Ring work group 67.25 × 80, Character group 65.5 × 30, Athleticism 56 × 40, Presence 67 × 50, ÷ total taste 200                                                                                         | 64.68 |
| Base              | (1 × 48.49 + 1 × 64.68) ÷ 2                                                                                                                                                                             | 56.58 |
| Momentum          | No momentum yet: +0                                                                                                                                                                                     | 56.58 |
| Age               | 30: prime age, no change                                                                                                                                                                                | 56.58 |

Tessen's top five by card value are its three main eventers and two upper
carders (Hideki Yoshida, 23, gets the youth bonus), so the defaults order the
roster the way its pushes do. AIP1-05 adds the calibration log for every
rival.

## Needs

`rosterNeeds(inputs, { tunables })` (`formulas/needs.ts`, AIP1-04) lists what
a unit's roster is short of. AIP1-05's `needsInputsFor` builds the inputs
(the unit's largest active show, its wrestlers with push, alignment, gender
and availability, the gender divisions it has titles for, its champions and
its crew counts). Each need has a `key`, a `kind`, a templated `summary`, a
traced `severity` (0-100) and `refs` (person and title IDs).

- **Slots demanded** `D = (largestShowSlots ?? aip.needs.defaultSlots) ×
aip.needs.workersPerSlot` (6 and 2), traced as "Largest show has 8 slots"
  or "No active shows" (`slotsDemanded`, which AIP1-05's `aip.needs` query
  shows). Needs count show slots, never minutes (D-10).
- **Depth** per push band (main event to enhancement): `target =
round(D × aip.needs.bandShare.<band>)` (0.12, 0.2, 0.33, 0.2, 0.15) against
  the available wrestlers at that push. Short → severity `(target − have) ÷
target × 100`. A target of 0 makes no need. "Thin at main event: 2 of 4".
- **Alignment**: `gap = faces − heels` over pushed wrestlers (push not
  `none`; tweeners left out). `|gap| > aip.needs.maxAlignmentGap` (3) →
  severity `(|gap| − 3) × aip.needs.alignmentSeverityPerWorker` (15). "Short
  on heels" or "Short on faces".
- **Gender**: each division with a title wants
  `aip.needs.minPerGenderDivision` (4) available wrestlers; short → `shortfall
÷ 4 × 100`. "Women's division thin: 2 of 4".
- **Champions**: a holder who has left → 100 ("Champion has left: <title>");
  a holder who cannot defend → `aip.needs.championUnfitSeverity` (80); a
  contract ending within `aip.needs.contractEndingDays` (60) →
  `aip.needs.championEndingSeverity` (60).
- **Crew**: referees, announcers and producers below
  `aip.needs.minReferees`, `minAnnouncers`, `minProducers` (2, 1, 0) →
  `shortfall ÷ min × 100`. A minimum of 0 never makes a need.

Every severity is kept within 0-100 and ends with a line checking it against
`aip.needs.minSeverity` (10); needs below it are dropped. The list is sorted
by severity, then key. Every need's Why? names the tunables it was measured
against.

**Roster review decision.** `rosterReviewDecision(needs)` is the Why? the
weekly roster review job (AIP1-05) stores: a "Weekly roster review" decision
that considers every need with its severity and summary, and chooses the
most pressing key ("Most pressing need"), or `none` ("No needs above the
threshold").

**Summary keys.** Content keys are lowercase with dashes, so the summaries
use `aip.need.depth` (`band`, `have`, `target`), `aip.need.alignment.heels`
and `aip.need.alignment.faces` (`faces`, `heels`), `aip.need.gender`
(`division`, `have`, `target`), `aip.need.champion-gone` (`title`),
`aip.need.champion-unfit` (`title`, `names`, `reason`),
`aip.need.champion-ending` (`title`, `names`, `date`) and `aip.need.crew`
(`role`, `have`, `target`). `needSummaryText(summary)` renders them in
English for the Why?; the web text catalog (AIP1-06) renders the same keys.

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

## Roster review

`aip.rosterReview` (`jobs/rosterReview.ts`, AIP1-05) is the rival desk's
first job: `weekly`, so each computer unit reviews on its own weekday. It
builds the unit's needs inputs (`needsInputsFor`), runs `rosterNeeds` and
records one `rosterReview` decision:

- `summary`: `aip.decision.roster-review` with `count` and, when there is a
  need, `top` (the most pressing need in plain words). Rendered:
  "Weekly roster review: 3 needs, most pressing: Short on heels" or "Weekly
  roster review: no pressing needs" (`rosterReviewSummaryText`).
- `refs`: the person and title IDs the needs name (champions), 12 of each at
  most.
- `traced`: `rosterReviewDecision(needs)`, stored summary-only under
  `aip.rosterReview`; `revealOn` today; `importance` 0.

It writes nothing else: no pushes, no hiring. When a later feature acts on a
need (AIP3 pushes), it changes pushes through `roster.setPush`'s
`applySetPush` with source `'ai'`, never around it.

**Inputs** (`inputs.ts`, read-only, rows in ID order):

- `unitRoster(read, unit, date)` is the one roster rule: the promotion's
  `active` contracts that have started, only the unit's brand for a brand
  unit, and without `excludedBrandIds` for a promotion unit. AIP3, AIP4,
  AIP6 and AIP8 use it too.
- `cardValueInputsFor(read, tunables, employment, date, shared?)`: the
  worker's attributes and regional popularity, the promotion's popularity,
  the regions, `employment.momentum`, `ageOn` and `tasteOf` (a computer GM
  brand's own taste for its contracts, else the promotion's). `shared`
  passes the regions and taste in when valuing a whole roster.
- `needsInputsFor(read, tunables, unit, date)`: the largest `format.slots`
  of the unit's event definitions running on the date (else null), its
  wrestlers (available when WRK1's `availabilityOf` says so), the male and
  female divisions of its titles in use, the holders of those titles (a
  holder with no contract at the promotion makes `employed` false, so for a
  team any one partner leaving counts; the first holder who cannot work
  gives `unfitReason`; the earliest contract end gives `contractEndsOn`) and
  its referees, announcers and producers.
- `unitOf(read, promotionId, brandId?)` is the unit for any promotion or
  brand, the player's included, for "what would a rival desk say about you".

**Text keys** for the web catalog (AIP1-06): `aip.decision.roster-review`
(`count`, `top`), `aip.need.depth`, `aip.need.alignment.heels`,
`aip.need.alignment.faces`, `aip.need.gender`, `aip.need.champion-unfit`,
`aip.need.champion-ending`, `aip.need.champion-gone` and `aip.need.crew`
(params in [Needs](#needs)).

**Cost.** Eleven rivals write 52 reviews a year each. The 365-day
default-world save grows from 9.35 MB to 9.58 MB JSON (0.93 to 0.95 MB
gzipped): 574 decision rows (252 KB, about 440 bytes each) and 54 KB of
review summaries, the ones `sim.traceRetentionPerKind` keeps (200 per kind,
about four months of reviews for 11 rivals; older entries say "Full
breakdown is only kept for recent results").

**Speed** (AIP1-08, one machine shared with other jobs, two runs each). A
headless `npm run sim -- --days 365 --strict --world <state>` on the default
world, started with a founded promotion that has no shows so the show-day gate
never stops it (12 computer rivals, 585 shows): 5.37 and 5.58 s before AIP1
(`ac0ff16`, WRK2-01), 5.84 and 5.74 s with it, about 5% more, for 626
decisions and no `aip.jobFailed`. The fixture world the plain `npm run sim`
uses has no rivals: 0.48 to 0.56 s before, 0.52 to 0.59 s after.

**Calibration** (default world, new game as Longleaf, default tunables):
the top card values match the pushes (Tessen: Tatsuya Ueno 56.6, Hideki
Yoshida 55.6, Gendo Arakawa 55.5; Altura: Calder Voss 66.9), Altura, Cielo
Alto and Tessen have no pressing needs, and the smaller promotions are short
of a second referee and thin at main event and enhancement (severity 33 to
50). `RB_SLOW_TESTS=1` on `test/systems/aip/defaultWorld.test.ts` prints the
full log.

## Promotions queries

The Promotions screens (AIP1-06) read five queries in `queries/`. Every
derived number carries its Why? inline (card values, needs, popularity);
the decision log points at stored traces. Each applies the viewer rules in
[Visibility](#visibility): a rival's cash never leaves the engine exactly for
a `public` viewer, and contract terms, morale and hidden development never
appear in any of them.

| Query                | Args                                                     | What it returns                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promotions.list`    | none                                                     | One row per promotion (every status), by name: name, short name, logo, colour, style, status, home region and country, popularity (home country with its trace, world), prestige, `rosterCount` (wrestlers), `crewCount` (everyone but wrestlers and managers), `brandCount`, champions, `controlledBy` (`you`, `computer`, `otherPlayer`), `controllerName`, `cash`, `size`. |
| `promotions.profile` | `promotionId`                                            | Header (with brands and who runs each), KPIs (home and world popularity with traces, prestige, counts, `showsPerMonth`, `cash`), the popularity drill-down (`popularityRollupView`), shows running today, titles and holders, the Rival rules as they apply to it (`inForce`, `levelPlayingField`, each shortcut's `on`, `value`, trace), `hasProfile`, `hidden`.             |
| `promotions.roster`  | `promotionId`, `brandId?`                                | The taste it values by (label, source, eight axes with traces) and every active contract: ring name, image, gender, role, push, alignment, brand, availability, overall, card value with trace (wrestlers and managers; crew null), `isChampion`, `endsOn`. By role, card position, then card value.                                                                          |
| `aip.needs`          | `promotionId`, `brandId?`                                | `unitName`, `slotsDemanded` with trace, the needs (key, kind, summary, `text`, severity with trace, refs) and `computedOn`. Live, for any promotion.                                                                                                                                                                                                                          |
| `aip.decisionLog`    | `promotionId`, `brandId?`, `limit?`, `before?`, `kinds?` | Visible entries newest first (date, kind, chip, summary, `text`, refs, `traceRef` while the trace is kept, importance), the filter chips (`kinds`, registered kinds with a visible row), `hiddenCount` and `nextBefore` for the next page.                                                                                                                                    |

`showsPerMonth` counts the promotion's dated shows (`eventInstances` that are
not cancelled, one-offs included) in the next 28 days; a day past the
calendar's scheduling horizon (`calendar.scheduleHorizonDays`, after
tomorrow) falls back to the definitions' show dates (`occursOn`). Each
`promotions.list` row carries `size: { label, reach } | null`, ECO1's public
company size (`reachOf`, never cash), through the source in `companySize.ts`;
it is null when no feature supplies one, and the browser's "Company size"
column (card meta on a phone) appears only when some row has a size. The
profile's Overview shows the same Company size card as the Finances screen,
with its Why?. An unknown promotion, or a brand of another promotion, is
refused with `notFound`.

`aip.decisionLog`'s `brandId`: left out, every row of the promotion; null,
only the whole-promotion rows; a brand, only that brand's. `limit` is 1 to
200 (default 50); `before` is the last entry of the previous page (a pruned
one is refused with `notFound`).

**The reveal rule.** `isRevealedTo(read, viewer, promotionId, revealOn)`
(`reveal.ts`) is the only place that decides whether a viewer sees a plan:
true for the all-seeing viewer, in a sandbox game and for the promotion's
own controller, else once `revealOn` is before the current date. The reveal
day itself has to be simulated first, so a show airing on `revealOn` has
aired: on that day the plan is still hidden, the next day it shows. Hidden
rows are counted in `hiddenCount` ("2 plans hidden until they air") and
never described. AIP4's `aip.showCards` and AIP5's `aip.segmentDecision`
call the same function.
