# Broadcast: TV, pay-per-view and streaming deals

ECO8 turns the world's networks and deals into viewers and money. A **deal**
is a promotion's agreement with a **network** (a TV channel, a pay-per-view
provider or a streaming service) to air its shows. Each show a deal airs is an
**airing**: the viewers it drew against what the network expected, what the
network paid and what the airtime cost.

ECO8-01 lays the ground: the `airings` table, the deal lifecycle fields, the
one rule for which deal airs which show, and the empty `broadcast` system
bundle with its tunables, RNG streams, events and trace kinds. The player sees
nothing yet. Later tickets fill in the sections below marked "ECO8-0n".

Code: `packages/engine/src/systems/broadcast/`, the tables in
`packages/engine/src/model/entities/airing.ts` and `deal.ts`.

## Airings table

One row per show a deal aired, or was due to air and missed (see
[data-model.md](data-model.md), "Airings", for every field). It is the
viewers history the rest of the game reads: show popularity's TV reach
(EVT5), the dashboard (DAY4), the network's renewal talks and rivals' deal
making (ECO10).

- `status` is `aired` or `missed`. A missed row says why (`missReason`:
  `showCancelled` when the show was cancelled, `notRun` when its day passed
  without it running) and has no viewers, no money and no quality.
- `quality` is the show score the audience formula read, with its source:
  `show` (the show's own rating) or `neutral` (a stand-in when the show had no
  rating, as on a world without show night).
- `showName` is copied in when the row is written, so the history keeps the
  name the show had on the night even after it is renamed.
- `eventInstanceId` is null when the show aired straight from its definition
  (a world without the calendar, see below).
- `income` is what the network paid, gross; `sharesPaid` the part passed on to
  workers' broadcast shares; `cost` the airtime charged to the promotion.
- `traceRef` points at the airing's Why?: kind `broadcast.airing` for a
  human-controlled promotion, `broadcast.rivalAiring` for a computer-controlled
  one, so a dozen rival shows a week never push the player's airings out of
  `sim.traceRetentionPerKind`. A deal's latest health verdict is stored under
  `broadcast.health` with the deal id.

Deals gain four lifecycle fields: `endedOn` and `endedReason` (set exactly
when the deal is `expired` or `cancelled`; reasons `expired`, `lowViewers`,
`missedAirings`, `byPromotion`, `networkClosed`), `renegotiatedOn` and
`warnedOn` (the last warning, so warnings are not repeated daily). Packs do
not carry them; older saves load them as null.

**Retention (open for ECO8-04).** An airing row is already a summary (no
per-segment detail), but every aired show of every promotion writes one: a
few hundred a year on the default world, more as rivals sign deals. ECO8-04, which writes the rows, must fit the
owner's history rule: keep `history.keepDetailDays` of rows in full, and
roll older rows up (at least computer-controlled promotions' rows) in the
weekly `history.rollUp`, keeping what deal health and the deal screens read
(the last `broadcast.health.window` airings of each live deal). It reports
the 365-day save size.

## Which deal airs which show

`coverage.ts` holds the one rule settlement (ECO8-04), the calendar sheet
(ECO8-07) and show popularity (EVT5) share.

**In force.** A deal airs shows on a day when its status is `active`,
`startsOn ≤ day < endsOn`, and its network is `active` and has not closed by
that day (`closedOn` null or later) — `dealInForce(deal, network, date)`.

**Which shows.** `dealCoversShow(read, deal, network, show)`:

1. The show belongs to the deal's promotion.
2. A **house** show never airs, whatever the deal.
3. A **definition-bound** deal (`eventDefinitionId` set) airs only that show.
4. A **promotion-wide** deal (`eventDefinitionId: null`) airs a show when the
   show is televised, its importance is one the network kind carries, **and**
   no definition-bound deal of the same promotion and network kind is in
   force for that show on its air date (the specific deal beats the general
   one):

   | Network kind | Importances it airs                     |
   | ------------ | --------------------------------------- |
   | `tv`         | `minor`, `regular`, `major`, `flagship` |
   | `streaming`  | `minor`, `regular`, `major`, `flagship` |
   | `ppv`        | `major`, `flagship`                     |

   So a promotion-wide pay-per-view deal airs only major and flagship shows,
   never the weekly TV (the question EVT5's pack left open). A one-off show
   with no definition counts as televised; its importance decides.

**Dated shows.** Shows are `eventInstances` rows matched by `airDate`: a
taped show airs on its air date, not its taping day. `dealsAiringShow(read,
instance)` lists every deal in force on the instance's air date that covers
it, in deal-id order. A dated show is due whatever its status: a cancelled or
unrun show is still due, and settlement records it as missed.

**Definition fallback.** A world without the calendar has no dated shows. A
definition that has **no** instance at all airs on every date where
`occursOn(recurrence, date)` and `activeFrom ≤ date ≤ activeUntil`. Once a
definition has any instance the calendar owns it, and a date without an
instance means no show that day.

**What airs today.** `airingsDueOn(read, date)` lists both, as `DueAiring`
values (`source: 'instance'` with the instance, or `source: 'definition'`
with the definition), in deal-id then show-id order. It is pure and
read-only; settlement decides aired or missed.

On the default world's first week, Altura Mainstage airs on National Signal
Network on Monday, Altura Overclock on Kestrel Sports on Wednesday, and
Altura Showcase on Turnstile Pay-Per-View on its last-Sunday date; Hardpan has
nothing on air.

### Which networks a promotion can deal with

`promotionMarketRegionIds` is the promotion's home region plus every region
where its popularity is at least `broadcast.networks.minPopularityToList`
(default 1; 0 lists every region in the world). `networksCovering` lists the
active networks whose coverage meets those regions, leaving out other
promotions' own streaming services. The default world has local and regional
channels (reach tier 0–1) so a small promotion has somebody its size to deal
with ([default-world.md](default-world.md#networks)).

### Ledger categories

`incomeCategoryFor(kind)`: `tv` posts to `broadcast`, `ppv` to `ppv`,
`streaming` to `streaming`. Airtime is a production cost of being on TV
(`AIRTIME_COST_CATEGORY = 'production'`); ECO10's own streaming service uses
`networkUpkeep` instead. `hasActiveBroadcastDeal(read, promotionId, date)`
answers ECO7's camera rule.

## Audience

ECO8-02: the audience formula, one formula for deals, airings and rivals.

## Benchmark

ECO8-02: what the network expects a show to draw.

## Valuation

ECO8-03: what a deal is worth, with a traced verdict.

## Settlement

ECO8-04: the daily `broadcast.airings` phase writes an airing row per due
airing and posts the money through `postMoney`.

## Deal health

ECO8-05: the risk of each deal, warnings, network cancellations, expiry and
renewal.

## Commands

ECO8-05: propose, renegotiate and cancel.

## Queries and visibility

ECO8-03..05: the networks, valuation, airings and deals queries, and what the
player may see of rivals' deals.

## Seams

- **Events** (declared in `events.ts`, listed in
  [day-pipeline.md](day-pipeline.md#domain-events)): `broadcast.aired`,
  `broadcast.missed`, `broadcast.dealSigned`, `broadcast.dealRenegotiated`,
  `broadcast.dealEnded`, `broadcast.dealWarned`. `broadcast.dealSigned` is
  declared once here; ECO10's rival deal-making publishes the same event.
- **RNG streams:** `broadcast.viewers` (the airing's viewers roll) and
  `broadcast.health` (the network's verdict on a struggling deal).
- **Deal risks:** `DEAL_RISKS` (`safe`, `watch`, `atRisk`, `cancelling`) is
  the risk `broadcast.dealWarned` carries and deal health returns.
- ECO8-07 wires these into the partner features already on main.
