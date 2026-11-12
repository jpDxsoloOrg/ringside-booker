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

- **Company size (ECO1-02).** A feature that scales with company size calls
  `reachOf` and reads `reach`, never `size`; the label is display only.
