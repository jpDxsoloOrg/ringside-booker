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
| `appearanceFees` | Appearance fees    | cost   | Per-appearance deals                            |
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

Filled by ECO1-02.

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

Filled by ECO1-04.

## Policies

Filled by ECO1-04.

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
under `cashTraceRef(promotionId)` (kind `finance.cash`): "Cash on 1 <month>"
(the cash less this month's rows), then one line per category with a non-zero
total this month in ledger category order (`LEDGER_CATEGORY_LABELS`), ending
at the cash now. `postMoney` rewrites it after every row it posts for a
human-run promotion, and the new-game step `finance.openingBalance` (order 905) writes it for each of them, starting from "Opening balance", so the top
bar's cash has a Why? from day one. `sim.status` returns its ref as
`promotion.cashTraceRef`. Rivals never get one: nobody can open it.

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
