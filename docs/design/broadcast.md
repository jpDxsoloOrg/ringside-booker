# Broadcast: TV, pay-per-view and streaming deals

ECO8 turns the world's networks and deals into viewers and money. A **deal**
is a promotion's agreement with a **network** (a TV channel, a pay-per-view
provider or a streaming service) to air its shows. Each show a deal airs is an
**airing**: the viewers it drew against what the network expected, what the
network paid and what the airtime cost.

ECO8-01 lays the ground: the `airings` table, the deal lifecycle fields, the
one rule for which deal airs which show, and the empty `broadcast` system
bundle with its tunables, RNG streams, events and trace kinds. ECO8-02 adds
the audience formula and the network benchmark. The player sees nothing yet. Later tickets fill in the sections below marked "ECO8-0n".

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
per-segment detail), but every aired show of every promotion writes one: a few
hundred a year on the default world, more as rivals sign deals. ECO8-04, which
writes the rows, must fit the owner's history rule: keep
`history.keepDetailDays` of rows in full, and roll older rows up (at least
computer-controlled promotions' rows) in the weekly `history.rollUp`, keeping
what deal health and the deal screens read (the last `broadcast.health.window`
airings of each live deal). It reports the 365-day save size.

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

ECO8-02. How many people watch a show on a network (on pay-per-view, how many
buy it). It is **one formula** for everything that needs viewers: what a
network will pay (valuation, ECO8-03), what an airing drew (ECO8-04), whether
a deal is in trouble (ECO8-05), and later TV reach for show popularity (EVT5),
streaming sign-ups (ECO10) and the brand war's viewers race (BRW5). The player
and the rivals use the same formula.

Code: `systems/broadcast/formulas/regionAudience.ts`, `audience.ts`; the world
reads in `systems/broadcast/audienceInputs.ts`.

### Region audience

The audience is built region by region over the network's coverage
(`coveredRegionIds`), so a promotion popular in one state draws there and
almost nowhere else (D-03):

- **people who care** = the region's population × its wrestling interest ÷ 100
- **draw** = (the promotion's popularity there ÷ 100) ^ `popularityPower`
- **region audience** = people who care × draw × `baseShare`

The popularity curve is smooth: a little more popularity always brings a few
more viewers, with no thresholds. A region where the promotion has no
popularity gives 0 ("Nobody there knows you yet"). The region audience is not
rounded; the total is rounded once at the end.

### The whole audience

audience = Σ region audiences × reach tier factor × kind factor × timeslot
factor × (1 + marketing level × `marketingPerLevel`) × live bonus (only when
live) × importance factor × hype multiplier × quality factor, rounded down to
whole viewers.

- **Reach tier** (`tier0`..`tier4`): how much of the audience a local,
  regional or national network reaches.
- **Kind** (`kind.tv`, `kind.ppv`, `kind.streaming`): pay-per-view counts
  buyers, not viewers, so its factor is small.
- **Timeslot** (`timeslot.*`): pay-per-view is not tied to a timeslot and
  always uses the prime-time factor (the Why? says so).
- **Marketing**: the promotion's stored marketing level (0..10,
  `promotion.production.marketing`), which ECO7 changes; nothing else to wire.
- **Live**: a live show multiplies by `liveBonus`; a taped one has a note
  instead.
- **Importance** (`importance.minor`..`flagship`): a house show never airs, so
  the formula refuses one (`InvalidArgumentError`).
- **Hype** (D-02, its own line): the seam `broadcastHypeFor` returns null
  until ECO8-07 points it at ECO3's `hypeMultiplierFor`; null multiplies by 1
  with the note "Hype isn't tracked yet".
- **Quality**: 1 + (show score − `neutralQuality`) × `qualityPerPoint`, never
  below 0. The show score is EVT3's slot-weighted score, so there are no
  minutes or durations anywhere (D-10). Without a show result the factor is 1
  with "No show result yet: neutral quality"; ECO8-07 passes the real score.
- **Night-to-night swing** (airings only): one seeded roll on
  `broadcast.viewers`, `rollFloat(1 − s, 1 + s)` with
  `s = broadcast.airing.viewerSwing`. Valuation and the benchmark never roll.

Every factor is a named tunable, and setting a factor to 0 gives 0 viewers
(marketing's and quality's per-step numbers at 0 mean they change nothing).

### Audience Why?

The first line, "Who could watch", lists the countries, biggest audience first
("United States: 2,007,054"), with each country's regions nested beneath. When
more than `AUDIENCE_TRACE_COUNTRY_LINES` (12) countries contribute, the
smallest share one "Other countries (N)" line; regions with no popularity add
no lines and share one note ("No popularity in N regions"). When the regions'
full working would not fit (`AUDIENCE_TRACE_COVERAGE_NODES`, 300 nodes), each
region keeps its number and a "steps not shown" note, so a world-wide network
stays under `TRACE_MAX_NODES` (400) and `TRACE_MAX_DEPTH` (12) and every
multiplier after it keeps its own line. On the default world the largest
audience trace (a world-wide pay-per-view) is about 240 nodes.

### Audience helper

Other features call these, exported from `@ringside/engine`:

- `projectedAudience(read, tunables, { promotionId, networkId, timeslot, live, importance })`:
  today's audience with neutral quality, the current hype and no swing.
- `benchmarkFor(read, tunables, { networkId, timeslot, importance })`: the
  network benchmark below.
- `audienceInputsFor` and `benchmarkInputsFor` build the formulas' inputs, for
  callers that pass a show quality or turn the swing on (airings). Nothing is
  cached between calls.

## Benchmark

ECO8-02. What a network expects a show to draw: the **same audience formula**
run for an imaginary typical promotion for the network's reach tier. Every
covered region gets the reference popularity
`broadcast.benchmark.popularity.tier<N>`, marketing level
`broadcast.benchmark.marketingLevel`, taped, no hype, neutral quality and no
swing. Code: `systems/broadcast/formulas/networkBenchmark.ts`, which calls
`audience`; its Why? starts "What <network> expects from a typical promotion
for a tier-N network" with the audience's own Why? beneath it.

Valuation compares a promotion's projected audience to the benchmark, and deal
health compares an airing's real viewers to it. Because both sides come from
one formula, every factor (tier, kind, timeslot, importance, coverage) cancels
out of the comparison: what is left is how popular the promotion is where the
network reaches, against what the network is used to. A higher tier never
expects fewer viewers on the same coverage.

### Calibration

`test/systems/broadcast/audience-default-world.test.ts` holds these on the
shipped default world with the default tunables:

| Show and network                                                  | Target                             | With the defaults                            |
| ----------------------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| Altura Mainstage on National Signal Network, prime time, live     | 1.5M–4M viewers, ≥ 1.1 × benchmark | 2,781,776 viewers, 1.54 ×                    |
| Altura Overclock on Kestrel Sports, prime time, live              | ≥ 1.0 × benchmark                  | about 10.7 ×                                 |
| Altura Showcase on Turnstile Pay-Per-View (major)                 | 50k–400k buys                      | about 152,000 buys                           |
| Every shipped deal (Tessen Iron Hour on Kazamidori Television, …) | ≥ 0.9 × benchmark, neutral quality | lowest: Longleaf on Tallgrass Stream, 1.05 × |
| Hardpan Friday (minor) on Bluebonnet Cable 7, evening, taped      | 2k–20k viewers, ≥ 1.5 × benchmark  | 3,962 viewers, 2.45 ×                        |
| Hardpan Friday on National Signal Network, evening, taped         | < 0.1 × benchmark                  | 0.017 ×                                      |

To meet them the ticket's starting values moved: `baseShare` 0.01 → 0.012, the
tier 0–2 factors 0.12/0.25/0.5 → 0.3/0.4/0.55 (so a local channel still draws a
few thousand for a small promotion), and the tier 1–2 reference popularity
22/35 → 15/16 (Longleaf's and Ashlar's streaming deals sat under 0.9 ×). The
shipped deals and content were not changed.

**Worked example** (Hardpan Friday on Bluebonnet Cable 7): Texas has
31,300,000 people and wrestling interest 90, so 28,170,000 care. Hardpan's
popularity there is 20: (20 ÷ 100) ^ 1.5 ≈ 0.0894. 28,170,000 × 0.0894 ×
0.012 ≈ 30,235 for a top network. × 0.3 (tier 0) × 1 (TV) × 0.7 (evening) ×
1.04 (marketing level 1) × 0.6 (minor show) ≈ 3,962 viewers, taped, no hype,
neutral quality. The benchmark runs the same steps at popularity 10 and
marketing level 5: about 1,616 viewers, so Hardpan draws 2.45 × what the
channel expects.

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
