# Finances

The economy core (ECO1): how money moves, how it is recorded and how the player
reads it. Code: `packages/engine/src/systems/finance/`. The ledger table itself
is described in [data-model.md](data-model.md#the-ledger).

## postMoney

During play there is exactly one way a promotion's cash changes:
`postMoney(ctx, input)` in `systems/finance/post.ts`. Every money feature calls
it: wages (ECO1-03), show costs (ECO1-04), box office (EVT6), fines, buyouts,
schools, relocations. It takes the promotion, a ledger category, a signed
amount in cents, an optional date (the step's date by default), a memo, optional
refs and an optional trace.

In order, it:

1. refuses a zero amount, and an amount whose sign the category does not allow
   (`InvalidArgumentError`, naming the category and the expected sign). Callers
   skip zero lines themselves;
2. refuses an unknown promotion (`EntityNotFoundError`) and a closed one;
3. refuses a date after the step's date;
4. trims the memo and refuses one that is empty or longer than 120 characters;
5. appends the ledger row and adds the amount to the promotion's cash, in the
   caller's transaction. The row's ID is minted first (`tx.mintId`), because
   the row's `traceRef` names it;
6. records the row's Why? trace under that `traceRef`. A caller that worked the
   amount out passes its `Traced<number>`, whose value must equal the amount (a
   row never explains a different number). Without one, the row gets a one-line
   trace, "Amount posted: <memo>", so every row has a Why?;
7. publishes `finance.moneyPosted`.

Any refusal throws before anything is written, and the error rolls the caller's
whole step back. It works from phases, subscriptions and commands alike, since
all of them get a `StepContext`.

Because the row and the cash move together, "the sum of a promotion's entries
equals the change in its cash" holds by construction; a seeded property test
checks it. A second test (`cash-seam.test.ts`) scans the engine's source and
fails if anything else writes `promotions.cash`. The only other writers are the
opening balances of a new world (pack materialisation, founding a promotion and
the "Equal start" step): an opening balance is not a movement.

Cash may go negative. `postMoney` never refuses a cost for lack of money;
financial distress belongs to ECO9. A command that needs a cash check (a school
fee, a signing) does it in its own `validate`.

**Trace kinds.** Rows of human-controlled promotions are stored as
`finance.entry`, rows of computer-controlled ones as `finance.rivalEntry`, so
eleven rival payrolls never push the player's rows out of
`sim.traceRetentionPerKind`. The id is the ledger entry's id. `finance.cash`
(id: the promotion) explains a cash balance; ECO1-03 writes it.

**Events.** `finance.moneyPosted` is published only for human-controlled
promotions. With twelve promotions paying wages every day, publishing every row
would fill the recent-event log (`sim.eventLogSize`) with rival payrolls and
push out the events the player cares about. A system that needs rival money
reads the ledger instead. `finance.policyChanged` is published when a promotion
changes a spending policy (ECO1-04).

## Categories

The ledger has 25 categories, every one the economy epic needs, so later
features never change the enum or break saves. Income is positive, costs
negative ([data-model.md](data-model.md#the-ledger) has the sign table).
`LEDGER_CATEGORY_LABELS` in `systems/finance/categories.ts` holds the words the
player reads, and `ledgerCategoryKind` says whether a category is income or a
cost. The web app uses these and never its own wording.

| Category         | Label              | Kind   | Posted by                                       |
| ---------------- | ------------------ | ------ | ----------------------------------------------- |
| `tickets`        | Tickets            | income | Box office (EVT6)                               |
| `liveMerch`      | Live merchandise   | income | Box office (EVT6)                               |
| `merch`          | Merchandise        | income | Merchandise (ECO)                               |
| `broadcast`      | TV rights          | income | TV deals (ECO)                                  |
| `ppv`            | Pay-per-view       | income | Pay-per-view (ECO)                              |
| `streaming`      | Streaming          | income | Streaming network (ECO10)                       |
| `sponsorship`    | Sponsorship        | income | Sponsors (ECO)                                  |
| `otherIncome`    | Other income       | income | Anything else                                   |
| `subsidyIncome`  | Subsidies received | income | A territory supported by a parent (ECO9, ECO11) |
| `wages`          | Wages              | cost   | Payroll (ECO1-03)                               |
| `appearanceFees` | Appearance fees    | cost   | Show costs (ECO1-04)                            |
| `signingBonuses` | Signing bonuses    | cost   | Contracts                                       |
| `severance`      | Severance          | cost   | Releases                                        |
| `venueRent`      | Venue rent         | cost   | Show costs (ECO1-04)                            |
| `production`     | Production         | cost   | Show costs (ECO1-04)                            |
| `travel`         | Travel             | cost   | Show costs (ECO1-04)                            |
| `marketing`      | Marketing          | cost   | Show costs (ECO1-04)                            |
| `backOffice`     | Back office        | cost   | Payroll (ECO1-03)                               |
| `medical`        | Medical            | cost   | Medical (ECO1-03)                               |
| `catering`       | Catering           | cost   | Show costs (ECO1-04)                            |
| `charity`        | Charity            | cost   | Charity (ECO2)                                  |
| `networkUpkeep`  | Network upkeep     | cost   | Streaming network (ECO10)                       |
| `buyout`         | Buyouts            | cost   | Buyouts (ECO9)                                  |
| `subsidy`        | Subsidies paid     | cost   | A parent supporting a territory (ECO9, ECO11)   |
| `otherCost`      | Other costs        | cost   | Anything else                                   |

## Reach and size

"How big is this company?" has one answer, used by every economic number that
depends on size (ticket prices, sponsorship, TV deal value, what workers ask
for). Code: `systems/finance/formulas/promotionReach.ts`,
`formulas/promotionSize.ts`, `reach.ts` and `queries/company.ts`.

**Reach** is a smooth number from 0 to 100, a weighted mean of the promotion's
popularity at four levels:

```
reach = (wRegion × home region + wCountry × home country
         + wContinent × home continent + wWorld × world)
        ÷ (wRegion + wCountry + wContinent + wWorld)
```

kept between 0 and 100. The home region figure is the stored value; the
country, continent and world figures come from WRK1's single roll-up
(`popularityRollup`, [geography.md](geography.md#popularity-roll-up)), so
nothing here computes its own population-weighted figures, and the Why? of
each line drills down through the roll-up to the regions. When every weight
is 0 reach is 0 and the trace says "Every reach weight is 0"; there is no
division by zero. Reach is exact; screens round it to one decimal.

On the shipped map the three roll-up traces together are bigger than one trace
may hold (400 nodes), so each line keeps a share (country 80, continent 120,
world 150 nodes) and ends with "N more steps not shown" when it runs over. That
way the division and the clamp are always in the Why?.

**Size** is a display label read off reach: the largest size whose threshold
reach has reached, otherwise Local. The walk goes from Global down, so if the
thresholds are tuned out of order it still answers, and the trace notes
"Thresholds are out of order".

**Only reach feeds formulas, never the size label.** Reach has no steps, so a
small popularity move makes a small reach move and nothing downstream jumps when
a company crosses a threshold. The label is for screens only.

Reach is never stored or cached: `reachOf(read, promotionId, tunables)` works it
out on every read, so a popularity change (EVT5) shows on the next query.

| Tunable                              | Default | What it is                              |
| ------------------------------------ | ------- | --------------------------------------- |
| `finance.reach.weight.homeRegion`    | 1       | Weight of the home region               |
| `finance.reach.weight.homeCountry`   | 3       | Weight of the home country              |
| `finance.reach.weight.homeContinent` | 2       | Weight of the home continent            |
| `finance.reach.weight.world`         | 2       | Weight of the whole world               |
| `finance.size.regionalAt`            | 6       | Reach at which a company is Regional    |
| `finance.size.nationalAt`            | 25      | Reach at which a company is National    |
| `finance.size.continentalAt`         | 45      | Reach at which a company is Continental |
| `finance.size.globalAt`              | 70      | Reach at which a company is Global      |

A weight of 0 means that level does not count.

**Worked example: Altura** (home region US Northeast). Popularity is 75 in the
Northeast, 70.3 in the United States, 66.9 in North America and 6.0 worldwide:

```
(1 × 75 + 3 × 70.3 + 2 × 66.9 + 2 × 6.0) ÷ 8 = 431.6 ÷ 8 = 54.0
```

54.0 reaches the Continental threshold (45) but not the Global one (70), so
Altura is **Continental**.

**Worked example: Hardpan** (home region US Texas). Popularity is 20 in Texas,
1.8 in the United States, 1.6 in North America and 0.1 worldwide:

```
(1 × 20 + 3 × 1.8 + 2 × 1.6 + 2 × 0.1) ÷ 8 = 29.0 ÷ 8 = 3.6
```

3.6 is below the Regional threshold (6), so Hardpan is **Local**.

The default world with these values (checked by `reach-default-world.test.ts`
against the tiers in [default-world.md](default-world.md#tier-values)):

| Tier     | Promotions and reach                                                                          | Size        |
| -------- | --------------------------------------------------------------------------------------------- | ----------- |
| Flagship | Altura 54.0                                                                                   | Continental |
| National | Cielo Alto 34.9, Tessen 32.1                                                                  | National    |
| Regional | Eisenwerk 17.4, Boreal 16.2, Ashlar 12.9, Longleaf 12.4, Blast Furnace 12.0, Golden Poppy 9.0 | Regional    |
| Local    | Wattle 5.2, Hardpan 3.6, Hibari 3.5                                                           | Local       |

**The query.** `finance.company { promotionId }` returns the promotion's name,
`reach` with `reachTrace`, `size`, `sizeLabel` with `sizeTrace`, and `nextSize`
(the smallest larger size whose threshold is above reach, with that threshold,
or null). The traces are inline, so nothing goes in the trace store. It is
public: company size is common knowledge and is built only from popularity,
which every viewer can already see, so any viewer may ask about any promotion.
It never returns cash or ledger figures. An unknown promotion is refused with
`unknownPromotion`.

## Payroll

Every day, in the `money` group (`finance.payroll`, order 10), every promotion
that is not closed pays its staff: one **Wages** row per promotion per day,
through `postMoney`. Code: `systems/finance/payroll.ts`,
`formulas/monthlyPayroll.ts`, `formulas/dailyWageAccrual.ts`, `phases.ts`.

**Who is paid.** `payrollLinesOf(read, promotion, date, tunables)` reads only
the promotion's `active` employments (the `byPromotionStatus` index), in id
order, so offers, signed contracts waiting to start, and contracts that have
ended are never even looked at: a pending offer can never be paid. Each active
contract becomes a line, paid unless:

| Reason          | When                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `notStarted`    | `startsOn` is after today.                                                                                                                     |
| `unpaidLeave`   | `leave` is set, not paid, and runs through today (`leave.until` on or after today).                                                            |
| `ownerOrBooker` | The person is the promotion's `ownerPersonId` or `bookerPersonId`, or the contract's role is `booker`, and `finance.payOwnerAndBooker` is off. |
| `noWage`        | `monthlyWage` is 0: per-appearance deals, paid per show (ECO1-04).                                                                             |

An `active` contract past its `endsOn` keeps being paid until contract expiry
(ECO4) ends it, which matches it still being worked.

**The formula.** `monthlyPayroll` sums the paid lines' monthly wages (one line
per paid contract, "<name> (<role>)"; past 60 lines the rest fold into one "and
N more contracts" line so the trace stays small), then multiplies by
`finance.wages.multiplier` when it is not 1 or has been changed, rounding to
the cent. Every excluded group gets a note with its count ("2 contracts not
started yet", "1 person on unpaid leave"), and the owner and booker rule is
always stated, so the reader sees it even when nobody is affected.
`dailyWageAccrual` spreads it over the year:

> daily wages = monthly payroll × 12 ÷ 365.25, rounded to the nearest cent

so "Monthly payroll $924,000 × 12 ÷ 365.25 = $30,357.29". The exact quotient
never ends in half a cent (365.25 × 4 is odd), so the rounding agrees with
`mulRatio`. A year of rows comes to twelve months of payroll within half a
cent a day, leap years included. The phase ends the trace with a "Cost" step
(× −1), so the row's Why? ends at the signed amount it posted. A zero payroll
posts nothing and logs one line.

**The owner and booker rule.** The people who run the promotion are not on its
payroll by default: `finance.payOwnerAndBooker` (off) pays their contracts a
wage too. The default world has no owners or bookers under contract, so the
note is there to explain the rule rather than a number.

**Overview and row agree.** `finance.overview` works its payroll figures out on
read with the same lines and formulas (`payrollFiguresOf`), so the Overview
card shows exactly what tomorrow's Wages row posts.

Cash may go negative; payroll never skips a day for lack of money (ECO9 handles
distress). Tunables: `finance.payOwnerAndBooker`, `finance.wages.multiplier`.

## Medical

On the 1st of each month (`finance.monthlyMedical`, `money` group, order 20)
every promotion that is not closed pays one **Medical** row, memo "Medical
(<level>)":

> medical = people under contract × `finance.medical.perContract.level<N>`

where N is the promotion's medical policy (0 None, 1 Basic, 2 Good,
3 Premium; `MEDICAL_LEVEL_LABELS`) and people under contract are every active
contract that has started, the owner and booker included (medical covers
everyone, paid or not). The defaults are 0, $150, $600 and $1,500 per person a
month. Level 0 costs nothing, so no row is posted.

## Show costs

Running a show costs money on the night (ECO1-04). When a show is completed
(`show.completed`, from show night), the reaction `finance.postShowCosts`
posts up to three rows for it through `postMoney`, for every promotion's
shows, player and rival alike: **Appearance fees**, **Travel** and
**Catering**, memo "<show name>: appearance fees" (travel, catering), each with
the show in `refs.eventInstanceId` and a Why? that lists every worker and rate.
A cost that comes to 0 posts nothing. Code: `systems/finance/showWorkers.ts`,
`formulas/showCosts.ts`, `postShowCosts.ts`, `estimateShowCosts.ts`.

**Who worked the show.** `showWorkersOf(read, instance, tunables)` takes every
distinct person on the card: participants in every role and every segment's
referee, producer and announcers (EVT3's `distinctWorkersOf`, the same list
appearance counts use). **A worker is charged once per show**, however many
segments they are in; travel is per worker, never per segment. Each worker is
matched to their active contract with the show's promotion:

- no contract there: a **guest**, who costs this promotion nothing;
- the owner or booker (the payroll rule, `finance.payOwnerAndBooker`): not
  charged;
- everyone else is a paid worker.

**A show with no card** (a rival show scored off-screen) is estimated from the
roster: the first `format.slots × finance.show.offscreenWorkersPerSlot`
(default 2) active wrestler contracts, top of the card first (`mainEvent`
down to `none`), then by id. Its Why? says "Card not booked in detail:
estimated from the roster".

**The formulas**, money in cents:

```
appearance fees = Σ per-appearance fee over paid workers
travel          = Σ over paid workers of travel rate(level)
                  × importance multiplier × distance multiplier, to the cent
catering        = catering rate(level) × importance multiplier, to the cent
```

The level is the promotion's travel or catering policy. **The travel perk:** a
contract with `perks.travelCovered` is paid at the higher of the policy level
and `finance.travel.coveredLevel` (default 3, Premium), and its line says
"travel covered by contract"; the perk is honoured even at level 0. A worker
whose rate is 0 is left out of the sum with one note ("2 workers pay their own
way: None travel"). Nothing depends on segment length (D-10): costs follow
headcount, importance and distance only.

| Level   | Travel per paid worker | Catering per show |
| ------- | ---------------------- | ----------------- |
| None    | $0                     | $0                |
| Basic   | $50                    | $250              |
| Good    | $200                   | $800              |
| Premium | $500                   | $2,500            |

| Importance | Multiplier |     | Where the show is                         | Travel multiplier |
| ---------- | ---------- | --- | ----------------------------------------- | ----------------- |
| House      | 0.5        |     | The home region                           | 1 (no extra)      |
| Minor      | 0.75       |     | The home country, outside the home region | 1.5               |
| Regular    | 1          |     | Another country                           | 3                 |
| Major      | 1.5        |     |                                           |                   |
| Flagship   | 2.5        |     |                                           |                   |

Distance compares the show's `regionId` with the promotion's `homeRegionId`
and that region's country.

**Worked example.** A regular show at home with Basic travel and Good catering.
The card has 14 distinct people: 11 under contract, one of them on a $300
per-appearance deal and one with the travel perk, plus the booker refereeing
and two guests.

```
appearance fees = $300
travel          = (10 × $50 + 1 × $500) × 1 × 1 = $1,000
catering        = $800 × 1 = $800
```

Each Why? lists one line per worker (past 60, the rest fold into one "and N
more workers" line), the rate tunables it read, notes for guests and the owner
or booker, and the multipliers.

**Once per show.** `postShowCosts(ctx, eventInstanceId)` requires a completed
show and skips one that already has an appearance fees, travel or catering row
for it, so a second call posts nothing. A closed promotion posts nothing.

**Estimates.** `estimateShowCosts(read, promotionId, { importance, regionId,
headcount }, tunables, levels?)` runs the same formula on a made-up card of
`headcount` paid workers, each on the promotion's average per-appearance fee
(over its active contracts). It is for planners that price a show that does not
exist yet (EVT8's tour builder, AIP7's calendar fit) and for the policy
preview; `levels` prices it at other policy levels.

**Save size.** The rows' traces are kept lean: one line per paid worker, the
rate tunables once each, and a few notes. Rival shows' rows use the rival trace
kind, so they never push the player's out of `sim.traceRetentionPerKind`.

| Tunable                                | Default                    | What it is                                                  |
| -------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `finance.travel.perWorker.level0..3`   | 0, 5,000, 20,000, 50,000   | Travel per paid worker per show, in cents                   |
| `finance.catering.perShow.level0..3`   | 0, 25,000, 80,000, 250,000 | Catering per show, in cents                                 |
| `finance.travel.domesticMultiplier`    | 1.5                        | Travel × this in the home country, outside the home region  |
| `finance.travel.abroadMultiplier`      | 3                          | Travel × this in another country                            |
| `finance.show.importance.<importance>` | 0.5, 0.75, 1, 1.5, 2.5     | Travel and catering × this, house to flagship               |
| `finance.show.offscreenWorkersPerSlot` | 2                          | Workers per main-card slot on a show with no card           |
| `finance.travel.coveredLevel`          | 3                          | The travel level a contract with the travel perk is paid at |

## Policies

Every promotion has three staff policies on `promotions.policies`, each at a
level from 0 to 3 (ECO1-04). Code: `systems/finance/policies.ts`,
`commands.ts`, `policyEffects.ts`, `queries/policies.ts`.

| Level | Label   |
| ----- | ------- |
| 0     | None    |
| 1     | Basic   |
| 2     | Good    |
| 3     | Premium |

| Policy   | What it pays for (`POLICY_AREA_DESCRIPTIONS`)           | What it costs                                               |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Travel   | Travel: who pays for getting to shows                   | Per paid worker per show (see [Show costs](#show-costs))    |
| Catering | Catering: food backstage on show nights                 | Per show (see [Show costs](#show-costs))                    |
| Medical  | Medical: care for everyone under contract, paid monthly | Per person under contract a month (see [Medical](#medical)) |

`POLICY_LEVEL_LABELS` is the one source of the level words; the medical row's
`MEDICAL_LEVEL_LABELS` is the same array. The web app uses these and never its
own wording.

**Changing a policy.** The command `finance.setPolicy { promotionId, area,
level }` is refused when the promotion does not exist (`notFound`), is closed
(`promotionClosed`), is not run by the issuer (`notYourPromotion`, through
`controlsPromotion` in `core/api/controller.ts`: the same human, or the
computer for a computer-run promotion, the one controller rule every command
uses since AIP1-07), or already has that level
(`samePolicy`, "Medical is already Good"). It writes the level, publishes
`finance.policyChanged { promotionId, area, from, to }` and returns `{ area,
from, to }`. The next costs follow it: travel and catering from the next show,
medical from the next 1st (level 0 posts no Medical row). `setPolicyIn(ctx,
promotionId, area, level)` does the same write and event without the controller
check, for the rival AI (AIP8).

**ECO1 owns the money only.** A policy's other effects (injuries healing faster,
morale) belong to the features that apply them, which describe them in the
preview through `registerPolicyEffect` (see [Seams](#seams)). D-09 is
untouched: nothing here changes morale.

## Queries

**The books access rule.** A promotion's finances are private.
`canSeeBooks(read, viewer, promotionId)` (`systems/finance/access.ts`) allows
the omniscient viewer and a viewer whose `viewerPromotionIds` contains the
promotion; anyone else gets one reason, code `notYourBooks`, "Another
promotion's finances are private". Every finance query that is not public
checks it, after refusing an unknown promotion with `notFound`.

The three read queries the Finances screen is built on
(`systems/finance/queries/books.ts`, all plain JSON, amounts in signed cents):

- `finance.overview { promotionId }` → `{ promotionId, date, cash,
cashTraceRef, thisMonth, lastMonth, monthlyPayroll, monthlyPayrollTrace,
dailyWages, dailyWagesTrace, paidContracts, monthEndCash, policies }`.
  `thisMonth` and `lastMonth` are `{ month, income, costs, net }` (`costs`
  negative); `lastMonth` is null when it is before the game started.
  `monthEndCash` is the last twelve month-ends, oldest first, the last being
  the current month so far (its cash is the cash now), worked back through
  each month's net. The payroll figures are today's, computed with the phase's
  formulas.
- `finance.monthly { promotionId, months?: 1..24 = 12 }` → `{ months,
categories, startMonth }`. Each month is `{ month, byCategory, income, costs,
net, closingCash }`, oldest first; months with no rows are included as
  zeros. `categories` lists the categories with any non-zero month, in ledger
  category order. `startMonth` is the month the game started in, so a screen
  can mark earlier months as before the game.
- `finance.ledger { promotionId, month?, category?, eventInstanceId?, limit?:
1..500 = 100, before? }` → `{ rows, nextCursor }`. Rows are `{ id, date,
category, label, kind, amount, memo, refs, traceRef }`, newest first (date,
  then id, descending). `before` is the last row of the previous page
  (`nextCursor`), and must be a row of this promotion's ledger. `traceRef` is
  null when the row's trace is no longer kept in full: older rows' traces are
  summarised, so the full breakdown is only kept for recent results.

Months are `YearMonth` strings (`YYYY-MM`, `zYearMonth`, `yearMonthOf`,
`addYearMonths` in `core/date.ts`), read through the ledger's
`byPromotionMonth` index, so a month costs only its own rows.

**The cash Why?** `recordCashTrace(ctx, promotionId)` (`cashTrace.ts`) records
under `cashTraceRef(promotionId)` (kind `finance.cash`) how the cash got from
the start of the game to today: "Opening balance" (the cash less every row
since the month the game started), then the net of each earlier month of this
year ("January 2027"), with each earlier year folded into one line ("2026"),
then one line per category with a non-zero total this month in ledger category
order (`LEDGER_CATEGORY_LABELS`), ending at the cash now. Lines that come to
zero are left out. It is one stored trace per promotion, rewritten in place, so
it stays a few lines long however long the game runs. `postMoney` rewrites it
after every row it posts for a human-run promotion, and the new-game step
`finance.openingBalance` (order 905) writes it for each of them, so the top
bar's cash has a Why? from day one. `sim.status` returns its ref as
`promotion.cashTraceRef` (and `finance.overview` and the Office cash card use
the same ref) only while the stored trace ends at the cash
(`currentCashTraceRef`): a promotion run by the computer never has it
rewritten, and a Why? that does not add up to the figure it explains is worse
than none. Rivals never get one: nobody can open it.

**The policy queries** (`systems/finance/queries/policies.ts`), both behind
`canSeeBooks`:

- `finance.policies { promotionId }` → `{ policies: { area, level, label,
description, monthlyEstimate, monthlyEstimateTrace }[] }`, one per policy
  in `POLICY_AREAS` order (catering, travel, medical).
- `finance.policyPreview { promotionId, area }` → `{ area, current, levels }`,
  four levels, each `{ level, label, monthlyCost, monthlyCostTrace, delta,
effects }`. `delta` is the level's cost less today's level's cost (negative:
  cheaper); `effects` are the lines registered policy effects give that level.

Monthly estimates, each with a Why?:

- **Medical**: `monthlyMedical` with the people under contract today.
- **Travel and catering**: the sum over the promotion's shows in the next 30
  days (`POLICY_PREVIEW_DAYS`, today included) of the show-cost formula at the
  level. The shows are its scheduled or booked shows in that window if it has
  any, otherwise the dates its active event definitions give (`occursOn`).
  Each show is sized by the average paid workers of its last
  `finance.preview.recentShows` (default 5) completed shows, or by
  `format.slots × finance.show.offscreenWorkersPerSlot` before any has run.
  Shows of the same importance and size are one line ("4 × Regular show, 12
  workers"). Travel is assumed at home, with the note "Away shows cost more".

**Save size.** One Wages row per paying promotion per day is about 3,300 rows a
year in the default world (nine of its twelve promotions pay monthly wages),
about 1.1 MB of save a year. The player's last 200 rows keep their full trace
(`sim.traceRetentionPerKind`), about 8 KB each for the largest roster; rivals'
rows use their own kind. If the ledger grows too much, a later ticket can fold
rival wages into a weekly row; the player's rows stay daily.

## Seams

How later features plug into the economy. The first seam is `postMoney`
itself: a new kind of income or cost posts through it with its own category and
a trace. Others are added by ECO1-02..05.

- **Company size (ECO1-02).** A feature that scales with company size calls
  `reachOf` and reads `reach`, never `size`; the label is display only.
- **Policy effects (ECO1-04).** `registerPolicyEffect({ id, area, order, lines:
(read, promotionId, level, tunables) => PolicyEffectLine[] })` adds a
  feature's non-money lines to the policy preview, where `PolicyEffectLine` is
  `{ text, tone: 'positive' | 'negative' | 'neutral', trace? }`. Register once
  when the module loads; a duplicate id throws. `listPolicyEffects(area)` lists
  them by order, then id. WRK6 describes medical this way ("Injuries heal ×0.8
  of the time") and SOC3 catering and travel ("+3 morale"); each feature applies
  the effect in its own system, never through ECO1.
- **Show estimates (ECO1-04).** A planner that needs a show's cost before it
  is booked calls `estimateShowCosts`, never its own copy of the formula.

## Integration

ECO1-06 wired ECO1 into the partners that were on `main` when it ran (base
`wave-s5-4`). Partners that land later wire ECO1 from their own integration
tickets through the [seams](#seams) above.

| Partner                                                      | Status                  | Category it posts under                               | How it is wired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT3 (show night)                                            | wired (ECO1-04, -06)    | `appearanceFees`, `travel`, `catering`                | `finance.postShowCosts` subscribes to `show.completed` (ECO1-04). ECO1-06 adds the results page's **Show money** section, `registerResultsSection({ id: 'finance.showMoney', label: 'Show money', order: 60 })` (`apps/web/src/screens/finances/registerShowMoney.ts`): the show's rows from `finance.ledger { eventInstanceId }`, each with its Why?, the net and a link to the month's Ledger. Only the player's own completed shows have it; a rival's books are private. Test: `test/systems/finance/show-money.integration.test.ts`. |
| EVT6 (box office)                                            | wired (EVT6-05)         | `tickets`, `venueRent`, `liveMerch`                   | The box office settles every completed show (see [box-office.md](box-office.md#settlement)) and posts up to three rows through `postMoney`, each with the show in `refs.eventInstanceId`. ECO1-04's show costs never post `venueRent`, so nothing is posted twice; the Show money section and the report's Money line list and add up these rows with the show costs.                                                                                                                                                                     |
| EVT5 (promotion popularity)                                  | wired, no code needed   | none                                                  | `reachOf` reads `regionalPop` on every query, so reach and the size label follow a show's change on the next read (`test/systems/promoPop/finance-reach.integration.test.ts`). In a 365-day default-world run the three Local companies (Wattle, Hardpan, Hibari) become Regional and Longleaf becomes National.                                                                                                                                                                                                                          |
| WRK6, WRK9, MTCH7, EVT8, AIP1/7/8, DAY8, SOC3/6/8, MP7, POL2 | wires from its own pack | fixed by its own pack, from the existing category set | Not on `main` when ECO1-06 ran. Each wires itself through `postMoney`, `registerPolicyEffect`, `estimateShowCosts`, `setPolicyIn`, `reachOf` or `finance.monthly` from its own integration ticket.                                                                                                                                                                                                                                                                                                                                        |

Features that depend on ECO1 hard (EVT6, ECO2, ECO3, ECO4, ECO7, ECO8 and so
on) land after it and wire themselves.
