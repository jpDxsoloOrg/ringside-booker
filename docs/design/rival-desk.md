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

Later (AIP1-03): when a rival may skip work it doesn't need to do.

## Jobs

Later (AIP1-03): the turn runner, the job registry and each job's own random
stream.

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

Later (AIP1-06): what the player sees of each rival and when. See the decision
log's `revealOn` above.
