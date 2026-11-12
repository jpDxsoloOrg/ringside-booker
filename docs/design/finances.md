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

Filled by ECO1-03.

## Medical

Filled by ECO1-03.

## Show costs

Filled by ECO1-04.

## Policies

Filled by ECO1-04.

## Queries

Filled by ECO1-05.

## Seams

How later features plug into the economy. The first seam is `postMoney`
itself: a new kind of income or cost posts through it with its own category and
a trace. Others are added by ECO1-02..05.
