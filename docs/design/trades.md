# Trades

TRD epic (Beta 03). The owner's request (2026-11-20): trade wrestlers with other promotions,
negotiated like contracts.

- **TRD-01** (engine): offers, the rival's answer, the wrestler's say, and the move itself.
- **TRD-02** (Unity trade sheet): built on the API below.
- **TRD-03** (engine part here): rivals now and then offer the player a trade. Until the Inbox
  (U10) exists they arrive as a day stop. Rivals don't trade with each other yet (a follow-up).

Code: `packages/engine/src/systems/trades/`, the table in `model/entities/trade.ts`. Tunables:
[tunables.md#trade-tunables](tunables.md#trade-tunables). Table: [data-model.md#trades](data-model.md#trades).

## The offer

An offer is between exactly two promotions. Each side sends up to five contracts and, optionally,
cash (cash goes one way only). Each worker in the deal may get **one contract change**: a new main
pay (the monthly wage, or the appearance fee of a per-appearance deal) and/or a new length in
months from the trade day. Anything not changed carries over as it is.

Players trade with computer-run promotions for now. One open trade per pair of promotions.

## Rules

Checked when an offer is made, when it is answered, and again when it goes through
(`checks.ts`, `offerProblems`). Each broken rule is a reason with a stable code:

| Code                                                    | Rule                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `trades.champion`                                       | A champion can't be traded: vacate the title or have them drop it first |
| `trades.noTradeClause`                                  | A worker with a no-trade clause who doesn't want to go                  |
| `trades.alreadyInTrade`                                 | The contract is in another open trade                                   |
| `trades.alreadyThere`                                   | The worker already has a contract with the other side                   |
| `trades.notOnRoster`                                    | The contract isn't with the side sending it                             |
| `trades.contractNotActive` / `contractEnding`           | Not a running contract, or it ends today                                |
| `trades.notTradable`                                    | Bookers can't be traded                                                 |
| `trades.empty`, `cashBothWays`, `notEnoughCash`         | At least one worker; cash one way; a player only sends cash they have   |
| `trades.promotionClosed`, `draftRunning`, `showRunning` | Neither side closed, no draft open, no show running live                |
| `trades.talkOpen`                                       | (propose) a trade with them is already open                             |
| `trades.notARival`                                      | (propose) the other side is player-run                                  |

## Valuation

`value.ts`. Everything is in points; a computer promotion values the deal from its side.

Per worker (`workerPoints`):

1. The **draft value** (`systems/draft/draftValue.ts`, the BRW1-01 formula): role rating in their
   contract's role, popularity (best country and world), age. 0–100.
2. × **contract control**: `shortContractFactor` for a contract about to end, rising to 1 at
   `fullControlMonths` months left (open-ended = full).
3. \+ **contract cost**: `(market value − monthly cost) ÷ market value`, kept within ±1,
   × `costWeight` × the control share. Market value is `negotiation/formulas/marketValue.ts`; the
   monthly cost is the wage plus the fee × `appearancesPerMonth`, after any change in the deal.
4. Giving away a **top star** (draft value ≥ `starValue`, or a main eventer): × `starKeepFactor`.

The deal (`valueDeal`):

- \+ every worker it gets, − every worker it gives up;
- \+ **roster needs**: the AIP needs (`aip/formulas/needs.ts`: card-level depth, gender divisions
  with titles, faces against heels, crew) of its roster before and after the trade; the severity
  it loses × `needWeight` (negative when the deal opens a need);
- \+ cash in, − cash out, at the deal's own cash rate (see [Cash](#cash)).

## Cash

Cash is valued against what the workers cost, not at a flat rate, so a rich player can't buy anyone
(the owner's rule: money should bite).

- **Price of a worker**: their yearly pay × a multiple by card position
  (`trades.cash.multiple.*`: main event 2.5, upper card 2, mid card 1.5, lower card 1.2,
  enhancement 1, crew 1; a top star by draft value 3). Pay is the contract's monthly cost (wage, or
  fee × appearances), at least `trades.cash.marketFloor` × their market value.
- **The deal's cash rate** (cents per point): the price of every worker in the deal ÷ their points,
  so cash equal to a worker's price is worth that worker's points.
- **The rival's finances**: the rate is divided by a factor from its runway (cash ÷ monthly
  payroll, against `trades.cash.runwayMonths`, power −`financeExponent`), within `financeMin`
  (rich: cash is worth less) and `financeMax` (cash-poor: worth more).
- **Never for money**: a rival won't sell a top star (draft value ≥ `trades.value.starValue`), its
  ace (its best-valued wrestler), or two or more top-card workers (main event, upper card) at once,
  unless the workers coming back are worth at least `trades.cash.starWorkerShare` of them. The
  answer says "They won't sell their top star for money" and it refuses (no counter).

Needs the sale opens, the accept margin and the finance factor come on top of the price. In the
default world a midcarder costs about 1.5–3× their yearly pay in cash, an enhancement worker
1.2–3.7× (token contracts hit the market floor), and a main eventer who is not the ace about 3×.
The preview's lines say what cash is worth ("Cash is worth 1 point per $…") and the Why? has the
rate's working.

## Answer

`answer.ts`, `rivalAnswer`. Deterministic: the preview and the next day's answer agree unless the
world changed.

- **Accept**: worth at least `acceptMargin`, any cash it sends is within `rivalCashShare` of
  its cash, and no top star goes for money.
- **Counter**: short by no more than `counterRange` (and fewer than `maxRounds` offers so far).
- **Refuse**: anything else.

Answers arrive when the next day runs, like contract offers: an offer made on day D is answered in
day D's `trades.daily` phase, which the player sees after pressing Next Day.

The answer keeps plain lines ("They get Rex Vale: worth 48 points to them", "Helps a need: Thin at
mid card: 2 of 4", "Cash in: $50,000 (2 points)", then the verdict) and a decision trace stored as
`trades.answer` / `<tradeId>:<round>`.

### Counter

When the deal is close, the rival asks for a bit more or offers less, in this order, until the gap
is closed:

1. pay less of its own cash (first down to what it can afford);
2. keep one of its workers, when it gives up more than one;
3. ask for cash, rounded up to `cashRounding`, when the other side has it;
4. ask for one more worker: the other side's tradable wrestler whose value covers the gap with the
   least to spare.

The counter is valued again and only sent when it clears the margin; otherwise the rival refuses.
A counter waits for the player for `counter.expiryDays` days, then lapses.

## Wrestler's say

`say.ts`. How each worker feels about the move, in points (0 or more = willing):

− `uprootCost`, + `prestigeWeight` × (new prestige − old), − `moraleWeight` × current morale
(unhappy workers want out), + `payWeight` × the pay change as a share of their pay.

**Morale on the move**: feeling × `moralePerPoint`, within ± `maxMoraleChange`, through the morale
door on the new contract ("Happy to be traded to …" / "Traded to … against their wishes"). Nothing
here is about losing matches (the D-09 story shield is untouched).

### No-trade clause

Contracts have no clause list yet, so the clause is **derived, not stored**: creative control
means a clause (`noTrade.creativeControl`); otherwise a share of main-event (`chanceMainEvent`) and
upper-card (`chanceUpperCard`) contracts have one, picked by a hash of the save's seed and the
contract id, so it never changes for that contract. A worker with a clause who isn't willing
blocks the trade (`trades.noTradeClause`). A stored clause can replace this when contracts get
clauses.

## Completing a trade

`transfer.ts`, `completeTrade`, the one place a trade moves anything:

1. **Cash** through `postMoney`: the payer's `buyout` cost, the receiver's `otherIncome`, memo
   "Trade with …" (the cash seam holds).
2. For each worker:
   - their bookings on the old promotion's open shows still to come are rewritten without them, or
     removed when the card writer won't take the segment without them (a singles match);
   - they leave the old promotion's stables (one left with fewer than two members disbands); teams
     are global and stay;
   - the old contract ends through `endEmployment` (`released`, reason `trades.traded`, no
     severance, `quiet`: no release story);
   - a new contract with the new promotion starts today with the same terms, role, card position,
     character, morale and momentum (or the deal's new pay/length; no signing bonus; no brand or
     manager). Written directly like a draft pick's contract; the door-ownership test lists the file;
   - morale moves by the wrestler's say through the morale door.
3. **News**: one `trade` story per worker (kind `signing`, topic `trade`, params `personId`,
   `promotionId` (new), `fromPromotionId`), importance from how notable they are. Never cash.

Titles are never touched: champions can't be traded.

## Lifecycle

`lifecycle.ts`. `open` → `completed | refused | withdrawn | lapsed | cancelled`. Each offer is a
round; `awaitingId` is whose answer is next. Computers answer in the day phase; players answer with
`trades.respond` before `expiresOn`.

## Day phase

`trades.daily`, `contracts` group, order 8 (after contract talks, before the contract lifecycle):
answers, lapses, rival offers, pruning of closed trades older than `history.keepDays`.

## Stops

With `trades.stopSkip` on, a change the player didn't make marks the row `stopsSkip`:

- `trades.answered` — "Crown Pro accepted your trade" / "turned down your trade" / "Your trade with
  Crown Pro fell through: …".
- `trades.offerReceived` — "Crown Pro offered you a trade" / "sent a counter-offer for your trade".

Both carry `actionHint: "trades"` and `subject { kind: "trade", id }`. `trades.markSeen` or any
answer clears the stop; the offer itself stays open until it expires.

## Rival offers

`rivalOffers.ts` (TRD-03). Rare on purpose: only on Mondays, only after `rivalOffer.graceDays`, at
most one per player promotion every `rivalOffer.minDaysBetween` days (never while one is open),
then with `rivalOffer.weeklyChance`. Up to `rivalOffer.rivalsTried` rivals are looked at in a
seeded random order (stream `trades.rival-offer`). The first whose most pressing wrestler need one
of the player's tradable wrestlers fills offers a wrestler of its own of about the same value
(never a top star) or cash alone, chosen to clear its own margin, plus `rivalOffer.cashShare` of
what it has to spare as cash. In the default world that is about one to three offers a year.

## Events

`trade.offered { tradeId, by, to, round, rivalInitiated }`, `trade.answered { tradeId, by, answer }`,
`trade.completed { tradeId, promotionIds, workers }`, `trade.closed { tradeId, status }`. Ids only.

## Commands

| Command           | Args                                                                          | Result                       |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `trades.propose`  | `{ promotionId, partnerId, give, get, adjustments? }`                         | `{ tradeId, answerOn }`      |
| `trades.respond`  | `{ tradeId, answer: accept \| refuse \| counter, give?, get?, adjustments? }` | `{ tradeId, status, moves }` |
| `trades.withdraw` | `{ tradeId }`                                                                 | `{ tradeId, status }`        |
| `trades.markSeen` | `{ tradeIds }`                                                                | `{ cleared }`                |

`give`/`get` are `{ employmentIds, cash }` from the caller's side. An adjustment is
`{ employmentId, pay (cents) | null, lengthMonths | null }`.

## Queries

| Query               | Args                                                       | Result                                  |
| ------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `trades.preview`    | as `trades.propose`                                        | `{ problems, offer, rival }`            |
| `trades.list`       | `{ promotionId?, status?: open \| closed \| all, limit? }` | `{ rows: TradeSummaryView[] }`          |
| `trades.get`        | `{ tradeId }`                                              | `TradeView`                             |
| `trades.candidates` | `{ promotionId, partnerId, search?, limit? }`              | `{ rows: TradeCandidateView[], total }` |

A player sees only trades their promotions are in. The view shapes are in `views.ts` and
`queries.ts`; the Unity chain notes (TRD engine) list every field.

## Follow-ups

- Rivals trading with each other (TRD-03).
- The Inbox (U10) taking over the rival-offer stop.
- Stored no-trade clauses once contracts carry clauses.
- Trades with another human player.
