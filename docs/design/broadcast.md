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

ECO8-03. Before signing anything the player needs to know **what a network
would pay and why**, and whether it would say yes. `dealValuation(read,
tunables, { promotionId, networkId, eventDefinitionId, timeslot, live, months,
excludeDealId? })` answers both from the same inputs: it projects the
audience ([Audience](#audience)), compares it to the network's
[benchmark](#benchmark), turns that into terms (`dealTerms`) and runs the
named checks (`dealVerdict`). It is a pure read with no randomness and no trace
store writes, so the preview the player sees is exactly what a proposal
(ECO8-05) signs, and rivals' deal-making (ECO10) calls the same function.

Code: `systems/broadcast/formulas/dealTerms.ts`, `dealVerdict.ts` and
`systems/broadcast/valuation.ts`. All money is in whole cents.

### What is valued

- **Importance:** the show's own. A promotion-wide deal (`eventDefinitionId:
null`) is valued as `major` on pay-per-view ("All major shows") and, on TV
  or streaming, as the promotion's most important weekly televised show
  ("All televised shows"; `minor` when it has none). A house show is valued at
  nobody watching ("House shows aren't televised: nobody watches on TV").
- **Weekday:** the show's weekly weekday (0 = Monday, as in `deals.json`; the
  first for a show on several days, the weekday of an every-N-weeks show),
  else none.
- **Dates:** starts today, ends today + `months` (`addMonths`, clamped to the
  month's end).
- **`becomesTelevised`:** the show is not televised yet (Hardpan Friday);
  signing makes it a TV show (ECO8-05).
- **`excludeDealId`:** the deal being renegotiated, left out of the "already
  on" and "slot taken" checks so it does not collide with itself.

### Deal terms

- **ratio** = projected ÷ benchmark (0, with the note "The network expects
  nobody in this slot, so there is nothing to measure against", when the
  benchmark is 0)
- **valued viewers** = min(projected, benchmark × `valuedViewersCap`)
- **shortfall factor** = min(ratio, 1)

| Kind         | Fee per show                                                                                             | Per thousand                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TV           | valued viewers ÷ 1,000 × `tvPerThousand` × `liveFeeBonus` (live only) × (1 − `tvBonusShare`) × shortfall | `tvPerThousand` × `liveFeeBonus` (live only) × `tvBonusShare` |
| Streaming    | valued viewers ÷ 1,000 × `streamingPerThousand` × `liveFeeBonus` (live only) × shortfall                 | none: "A streaming service pays a flat fee only"              |
| Pay-per-view | none: "Pay-per-view pays per buy, not a flat fee"                                                        | `ppvPerThousandBuys` × shortfall, per thousand buys           |

**Airtime** (cost per show) = people covered ÷ 1,000,000 ×
`airtimePerMillion` × (reach tier + 1), × `streamingAirtimeFactor` on
streaming, rounded down to a whole amount (the odd cents are dropped, a line
of its own in the Why?). Every other amount is rounded down to the cent.

**Income per airing** = fee + per thousand × projected ÷ 1,000 − airtime. It
can be negative: the Why? then ends with "Airtime costs more than this deal
pays: every airing loses money". That is deliberate (production money stays a
real challenge): a small promotion's local TV deal buys exposure, not income,
and the preview says so plainly rather than the rates being softened.

Every rate set to 0 gives 0 (no fee, no per-thousand pay, no airtime).

### The checks

`dealVerdict` is built with `startDecision`: one rule per check, in this
order, each with a stable refusal code and the text the player reads. The
first failing check gives the refusal reason; **every** failing check is
returned in `refusals`, so the player sees everything to fix at once. The Why?
also nests the promotion's reach (when prime time was asked for) and the
ratio's own working.

| Code                 | Refuses when                                                                                                 | Text                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `networkClosed`      | the network is closed or has closed by today                                                                 | "<network> is off the air"                                                         |
| `outsideMarket`      | it covers no region of the promotion's market, or is another promotion's own service                         | "<network> doesn't cover anywhere your fans are"                                   |
| `houseShow`          | the show is a house show                                                                                     | "House shows aren't televised"                                                     |
| `notPpvShow`         | pay-per-view, and the show is not major or flagship                                                          | "Pay-per-view only carries major and flagship events"                              |
| `alreadyOnNetwork`   | the same show (or the same promotion-wide deal) has a live deal on this network                              | "<show> already airs on <network>"                                                 |
| `coverageOverlap`    | the same show airs on another network of the same kind whose coverage overlaps                               | "<show> already airs on <other network> in the same regions"                       |
| `slotTaken`          | TV or streaming: another show airs on this network on the same weekday and timeslot (rival names are public) | "<network> already airs <rival show> in that slot"                                 |
| `timeslotNotAllowed` | prime time on TV or streaming, and ECO1 reach < `primeTimeMinReach`                                          | "Prime time needs a reach of 25.0; yours is 3.6"                                   |
| `cameraTooLow`       | camera level < reach tier × `cameraPerTier`                                                                  | "<network> needs camera level 4; yours is 2. Raise your camera level (Production)" |
| `belowFloor`         | projected < `minViewers.<kind>`                                                                              | "Fewer than 1,000 viewers is too small for TV" (buys for pay-per-view)             |
| `audienceTooSmall`   | ratio < `minBenchmarkRatio` (exactly at it accepts)                                                          | "Your audience would be about 2% of what <network> needs (85%)"                    |
| `badLength`          | months outside `minMonths`..`maxMonths`                                                                      | "A deal runs 6 to 48 months; 60 months is outside that"                            |

A **live** deal is one that is `active` and not yet past its `endsOn` (it may
not have started). `slotTaken` makes a TV channel or streaming service carry
one show per weekday and timeslot; pay-per-view carries every promotion. If
that proves too strict it is one rule to drop. The camera hint "Raise your
camera level (Production)" is there because ECO7's Production screen can raise
it.

### Calibration and worked examples

`test/systems/broadcast/valuation-default-world.test.ts` holds Altura's three
shipped deals, valued in their own slot (each leaving itself out), to
`accept` with a fee per show (per thousand buys on pay-per-view) within ×0.5..×2
of the shipped terms. With the ticket's starting cap of 1.5 Overclock valued at
0.19 × its shipped fee: Kestrel Sports is a tier-2 network whose benchmark
(ECO8-02's tier-2 reference popularity, 16) is small next to Altura's draw, so
`valuedViewersCap` is **5**. Every other rate is the ticket's.

| Deal (default world, 4 Jan 2027)                       | Projected / expected           | Offered                                    | Shipped                  | Airtime | Income per airing |
| ------------------------------------------------------ | ------------------------------ | ------------------------------------------ | ------------------------ | ------- | ----------------- |
| Altura Mainstage, National Signal Network, prime, live | 2,781,776 / 1,800,807 (1.54 ×) | fee 1,101,583.29 (0.92 ×), 44.00 per 1,000 | 1,200,000, 150 per 1,000 | 255,075 | 968,906.43        |
| Altura Overclock, Kestrel Sports, prime, live          | 1,529,977 / 143,505 (10.7 ×)   | fee 284,139.90 (0.63 ×), 44.00 per 1,000   | 450,000, 90 per 1,000    | 153,045 | 198,413.88        |
| All major shows, Turnstile Pay-Per-View                | 152,280 / 78,455 buys (1.94 ×) | 1,800 per 1,000 buys (1.0 ×)               | 1,800 per 1,000 buys     | 228,960 | 45,144.00         |

**Altura Mainstage** worked through: valued viewers = min(2,781,776,
1,800,807 × 5) = 2,781,776. Fee = 2,781.776 × 400.00 × 1.1 (live) × 0.9 (the
flat part) × 1 (no shortfall) = 1,101,583.29. Per thousand = 400.00 × 1.1 ×
0.1 = 44.00. Airtime = about 340.1 million people × 150.00 × 5 (tier 4 + 1) =
255,075. Income per airing = 1,101,583.29 + 44.00 × 2,781.776 − 255,075 =
968,906.43. Altura's reach is 54 (prime time needs 25) and its camera 8 (the
network needs 4): `accept`.

**Hardpan Friday on Bluebonnet Cable 7**, evening, taped, 12 months: 3,962
viewers against 1,616 expected (2.45 ×). Fee = 3.962 × 400.00 × 0.9 =
1,426.32; per thousand 40.00 (158.48 on 3,962 viewers); airtime = 31.3
million × 150.00 × 1 (tier 0) = 4,695. Income per airing = −3,110.20: the
channel would sign (`accept`, `becomesTelevised: true`, weekday Friday, ends
4 Jan 2028), but every airing costs Hardpan more in airtime than it earns, and
the Why? says so.

**Hardpan Friday on National Signal Network**, prime time: refused for
`timeslotNotAllowed` ("Prime time needs a reach of 25.0; yours is 3.6"),
`cameraTooLow` ("National Signal Network needs camera level 4; yours is 2.
Raise your camera level (Production)") and `audienceTooSmall` ("Your audience
would be about 2% of what National Signal Network needs (85%)"). On **Caliche
Country Sports** (the Southwest tier-1 channel), evening: refused for
`audienceTooSmall` at about 80%: Hardpan's fans are in Texas, and the channel
also covers the Southwest and the Plains, so a regional deal can still be too
big.

## Settlement

ECO8-04 (`systems/broadcast/settle.ts`, `phases.ts`). This is where TV pays.
Every show a deal airs today (`airingsDueOn`) is **settled once**, for every
promotion under the same rules: the player's, and every rival's.

**When.** Two ways in, one function (`settleAiring`):

- **`broadcast.airings`** (daily, `settlement` order 40) settles every due
  airing that has no row yet. It runs after the box office
  (`boxOffice.settleShows`, settlement 10), so a show's crowd is settled
  first, and before `calendar.closePastShows` (settlement 90), so a show still
  scheduled on its air date is seen as it stands before the calendar closes
  it. Rival shows run in the `shows` group earlier the same day.
- **`broadcast.settleOnShowNight`** (a reaction to `show.completed`): the
  player runs a show before that day's phases (Run the show, or segment by
  segment on the live show screen, EVT10), so its airings are settled the
  moment the last segment completes and its results page shows its viewers at
  once. A taped show completes on its taping day and is left for the phase on
  its **air date**: the money lands on the day it airs.

Both skip a due airing that already has a row for the same deal and show on
that date, so a re-run or the phase after the reaction never pays twice.

**What the show's state means** (`airingOutcomeOf`, one rule so the ledger
memo, the airing row and the calendar line agree):

| Show on its air date                         | Airing                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| Completed                                    | Aired, with the show's score as its quality           |
| Cancelled                                    | Missed (`showCancelled`): no money, viewers 0         |
| Scheduled or booked (never run)              | Aired, neutral quality, "Aired without a show result" |
| A definition date (a world with no calendar) | Aired, neutral quality, "Aired without a show result" |

ECO8-07 turns "scheduled or booked on its air date" into a missed `notRun`
airing.

**Aired.** The viewers are the [audience](#audience) with the show's quality
and the night-to-night swing (`broadcast.viewers`); the expected viewers are
the [benchmark](#benchmark). The money is worked out on the deal's **stored
terms** (what the deal would be worth today only matters when it is signed or
renegotiated), in cents:

- gross = fee per show + per-1,000 rate × viewers ÷ 1,000 (rounded down);
- workers' shares (below) come off the gross;
- the income row is gross − shares, under the network kind's category: **TV
  rights** (`broadcast`), **Pay-per-view** (`ppv`) or **Streaming**
  (`streaming`); memo "Broadcast: Altura Mainstage on National Signal
  Network", plus " (aired without a show result)" on the neutral path;
- the airtime row is the deal's cost per show under **Production**; memo
  "Airtime: National Signal Network".

Both go through `postMoney` with `refs: { eventInstanceId, dealId }`; a line
that comes to 0 is not posted. The reference game nets the two into one
posting; we post two labelled rows so the Finances ledger shows both, and each
row's Why? explains its own amount (the income row's Why? holds the viewers
working). Rivals' rows keep only a summary, as for all their money (POL4-06).

**Losing money is allowed.** A deal whose airtime costs more than it pays
loses money every airing (the owner's rule: money stays a real challenge).
Nothing caps it; the airing's Why? ends with "This deal costs more in airtime
than the network pays for a show", and `broadcast.airings` rows carry the same
note and a negative `net`.

**Workers' shares.** Each worker on the card (anyone in a segment except a
person only talked about, `cardWorkersOf`) whose contract with the promotion
has `terms.shares.broadcastBp` gets that many basis points of the gross: one
line each ("Rook 2% of TV rights"), capped in total at
`broadcast.shares.maxTotal` (0.5) of the gross, rounded down. It is the box
office's `computeWorkerShare` with the labels "TV rights", "Pay-per-view" and
"Streaming". A definition-date airing has no card ("No card on file: nobody to
pay a share"); a card where nobody has a share says so.

**The airing row** stores the gross as `income`, the shares as `sharesPaid`
and the airtime as `cost`, with the quality and its source. Its Why?
(`broadcast.airing` for the player, `broadcast.rivalAiring` for rivals) is
income less airtime, with "National Signal Network expected 1,800,807
viewers; 1,870,729 watched" and the benchmark beside it. The audience inside
it is kept to 8 levels for the player (about 160 nodes, 23 KB on the default
world) and 3 for rivals (about 45 nodes, 6 KB).

**Viewers on the show.** When the show completed (EVT3), each airing adds its
viewers to `result.viewers` (several deals on one show add up). Settlement
never creates a result.

**Missed.** A row with `status: 'missed'`, the reason, zeros, no quality and
the expected viewers; a one-line Why? ("Show cancelled: nothing aired"); no
money; `broadcast.missed` is published. Deal health (ECO8-05) counts them.

### Retention

`systems/broadcast/retention.ts`. An airing row is already a summary, but
every promotion writes one per televised show, so it follows the owner's
history rule:

- **Rivals:** step 7 of the weekly `history.rollUp` deletes computer-run
  promotions' airings dated before the `history.keepDetailDays` window. What
  they said lives on as totals: the money in the ledger's monthly totals, the
  viewers on each completed show's `result.viewers`.
- **The player:** `broadcast.pruneAirings` (`periodic` order 47, monthly on
  the 1st) deletes airings older than `broadcast.airing.historyDays` (400), so
  the deal screens list over a year of the player's own airings.
- Either way, each deal's newest `broadcast.airing.keepPerDeal` (12) airings
  stay whatever their age, so deal health (`broadcast.health.window`,
  `missedWindow`) and rivals' deal making always read a full window.

**Ledger rows, not airings, are the permanent money record.**

Save size (365 days, default world, `yearSaveBudget` with every show carded):
see the ECO8-04 row in [save-format.md](save-format.md#size-budget).

## Deal health

ECO8-05 (`formulas/dealHealth.ts`, `health.ts`). After every airing a network
looks at how the deal is doing and gives it a **risk**: Safe, Watch, At risk
or Cancelling (`DEAL_RISKS`), with the reasons the player reads and a Why?
(`startDecision`, stored at `dealHealthTraceRef(dealId)`, one trace per deal,
replaced each time).

### The formula

`dealHealth({ networkName, reachTier, daysSinceStart, recent, upcomingMissed })`
reads the deal's newest airings (newest first) and the cancelled shows it is
still due to air. No randomness: the roll happens in the phase. Rules, worst
first; the worst decides the risk and every one that applies is listed:

| Rule                                                                   | Risk       | Reason the player reads                                                        |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| missed ≥ `missedToCancel` in the last `missedWindow` scheduled airings | Cancelling | "3 missed airings: Local TV is pulling the deal"                               |
| missed = `missedToCancel` − 1                                          | At risk    | "One more missed airing and Local TV cancels"                                  |
| missed + cancelled shows still to come ≥ `missedToCancel`              | At risk    | "Cancelled shows coming up would make 3 missed airings: Local TV cancels at 3" |
| ratio < `cancelBelow`                                                  | Cancelling | "Viewers are 48% of what Local TV expects; each airing it may cancel (30%)"    |
| ratio < `warnBelow`                                                    | At risk    | "Viewers are 62% of what Local TV expects; below 55% it may cancel"            |
| any missed airing, past or coming                                      | Watch      | "Missed airing: Mon 18 Jan", "Missed airing coming: Mon 25 Jan"                |
| none of these                                                          | Safe       | "Viewers are 105% of what Local TV expects"                                    |

- **ratio** = Σ viewers ÷ Σ expected viewers over the last `window` airings
  that aired (the Why? keeps it as a calculation).
- **Grace:** fewer than `graceDays` since `startsOn`, or fewer than
  `minAirings` aired, and viewers are not judged (the Why? says so). Missed
  airings count from the first.
- `missedToCancel` 0 turns the missed-airing rules off (0 means 0).
- `window` and `missedWindow` are at most 12 (`HEALTH_MAX_WINDOW`), the
  default of `broadcast.airing.keepPerDeal`, so retention always keeps them.

### Cancellation

- **Missed airings** cancel with no roll: the player caused them and the rule
  is easy to explain. The deal ends `cancelled` / `missedAirings`.
- **Low viewers:** each airing day the deal is Cancelling for viewers, the
  network rolls its patience on the `broadcast.health` stream:
  chance = min(1, `cancelChance` + reach tier × `cancelChancePerTier`) (20% on
  a tier-0 network, 30% on tier 2). A hit ends the deal `cancelled` /
  `lowViewers`. The stored Why? is then "Does Local TV cancel?" with the
  health verdict and the roll inside. The roll happens only on airing days, so
  a long skip with no shows never cancels a deal for low viewers.

### Phase `broadcast.dealHealth`

Daily, `settlement` 45 (after `broadcast.airings` at 40):

1. Every deal with an airing row dated today (`airings.byAirDate`), aired or
   missed, gets a fresh verdict; cancellations as above.
2. Every `active` deal: a network that is off the air ends it `cancelled` /
   `networkClosed`; on or after `endsOn` it expires (below).
3. **Warnings:** for a human-controlled promotion's deal that is At risk or
   Cancelling today, or ends within `broadcast.deal.expiryWarningDays`, and
   whose `warnedOn` is null or at least `warnEveryDays` old: set `warnedOn`
   and publish `broadcast.dealWarned { dealId, promotionId, risk }`. The
   warning never stops the day (no gate); the Networks screen (ECO8-06) shows
   the risk badge and ECO8-07 turns the event into mail when the inbox is on
   main.

Ending a deal always sets `status`, `endedOn` and `endedReason` and publishes
`broadcast.dealEnded` (`endDeal`).

### Expiry and rival renewal

On `endsOn` a human promotion's deal becomes `expired` / `expired`; the
player is warned `expiryWarningDays` ahead and can renew with
`broadcast.renegotiate` before then.

A computer promotion's deal, while `broadcast.rivals.autoRenew` is on, is
valued again (`dealValuation` with `excludeDealId`) for the same network,
show, timeslot and live, for `broadcast.deal.defaultMonths`. If the network
would sign and the deal's health today is not Cancelling, it is renegotiated
in place (new terms at today's valuation, `endsOn` = today + months,
`renegotiatedOn`, `broadcast.dealRenegotiated`); otherwise it expires. The
same valuation the player gets, applied automatically, so rivals do not lose
all TV before ECO10's deal-making exists. **ECO10 switches `autoRenew` off**
when its rivals make their own deals.

On the default world Cielo Alto's shipped deal ends on 5 Jul 2027 and renews
at today's valuation (fee, per-thousand rate and airtime all from the formula,
not its shipped terms; the deal stays signed). The half-year soak test
(`dealHealth-default-world.test.ts`, slow suite) pins that no shipped deal is
cancelled for low viewers or missed airings.

## Commands

ECO8-05 (`commands/`). Every command runs the one controller rule
(`controlsPromotion`): a person acts only for their own promotion, the
computer only for computer-run ones (`notYourPromotion` otherwise). The
network's refusals come back as reasons with the `DealRefusalCode` as `code`,
its message, and the network as `subject`; nothing changes.

- **`broadcast.proposeDeal { promotionId, networkId, eventDefinitionId | null,
timeslot, live, months }`** → `{ dealId }`. Refuses `unknownPromotion`,
  `notYourPromotion`, `unknownNetwork` (no such network, or another
  promotion's own service), `unknownShow`, `notYourShow`, then every refusal
  of `dealValuation` (`networkClosed` … `badLength`). Applies the same
  valuation again in the transaction (identical by construction; a mismatch is
  an engine bug and rolls back), creates the deal (`active`, `offeredOn` =
  `startsOn` = today, `endsOn` = today + months, the valuation's weekday and
  terms in cents), makes the show televised when `becomesTelevised`, records
  the network's "Would it sign?" verdict at `dealHealthTraceRef` as the
  opening note, and publishes `broadcast.dealSigned`. What it signs is exactly
  what `broadcast.valuation` previewed, including a pay-per-view deal's high
  airtime at today's rates.
- **`broadcast.renegotiate { dealId, months }`** → `{ endsOn }`. Own `active`
  deal only (`unknownDeal`, `notYourPromotion`, `dealNotActive`); the
  valuation for the same network, show, timeslot and live with
  `excludeDealId`, refusals as above. Writes the new terms and weekday,
  `endsOn` = max(`endsOn`, today) + months, `renegotiatedOn` = today,
  `warnedOn` = null, and publishes `broadcast.dealRenegotiated`. Terms can go
  down as well as up.
- **`broadcast.cancelDeal { dealId }`** → `{ exitFee }`. Own `active` deal
  only. The exit fee (`formulas/exitFee.ts`) is `exitFeeShows` × (fee per
  show + per-thousand rate × the last aired airing's viewers ÷ 1,000), using
  the projected viewers when nothing has aired yet, rounded down to the cent.
  Posted with `postMoney` as `otherCost`, memo "Early exit: <network>", ref
  the deal (nothing posted when it is 0). The deal ends `cancelled` /
  `byPromotion` (`broadcast.dealEnded`). `broadcast.cancelPreview` shows the
  same fee and Why? for the confirm dialog.

## Queries and visibility

**Rival fees are hidden; that a deal exists is public.** Who airs what, on
which network, weekday and timeslot, is common knowledge; what a network pays,
what it charges and how many viewers it expects belong to the promotion.

ECO8-03 adds three queries (`systems/broadcast/queries/networks.ts`):

- **`broadcast.networks { promotionId }`**: own promotions only (the
  promotion's human, or the omniscient viewer); anyone else is refused
  `notYourPromotion`. One row per network in `networksCovering`, sorted by
  reach tier then name: `networkId`, `name`, `kind`, `reachTier`, `logoRef`,
  `coverageLabel` ("United States", "Texas", "North America, Europe +3":
  continents, then countries, then regions, two names then "+N"),
  `coveredPopulation`, `carries` (every live deal on it: `dealId`,
  `promotionName`, `showName` or "All major shows" / "All televised shows",
  `weekday`, `timeslot`; no money), `yourDeals` and `bestOffer`. `bestOffer`
  values the promotion's current shows the network carries and that are not
  on it yet (plus "All major shows" on pay-per-view) at the network's best
  allowed timeslot (prime time once reach allows it, else evening), taped, for
  `defaultMonths`, biggest draw first, and stops at the first the network would
  sign (the biggest draw pays the most, and the ratio, prime-time and camera
  checks do not depend on the show). With no accepted offer it reports the
  least-bad refusal (fewest failing checks, then the highest ratio). At most
  `BEST_OFFER_MAX_VALUATIONS` (6) valuations per network: keeps the tab under
  50 ms on the default world. The query works out the promotion's reach,
  market and each slot's audience once (`valuationContext`) and shares them
  across its valuations. Measured on the default world: about 20 ms for Altura
  (18 networks) and 6 ms for Hardpan.
- **`broadcast.valuation { promotionId, networkId, eventDefinitionId,
timeslot, live, months, dealId? }`**: own promotions only. The
  `DealValuation`, whose every number is a `{ value, trace }` inline (and the
  verdict's Why? as `verdictTrace`), so the Propose sheet shows Why? without
  the trace store. `dealId` (a renegotiation preview) leaves that deal out of
  its own checks. Refuses `unknownNetwork` (no such network, or another
  promotion's own service), `unknownShow`, `notYourShow` and `unknownDeal`
  (not one of the promotion's deals).
- **`broadcast.publicDeals { promotionId }`**: **any** promotion, any viewer
  (the Promotions browser and ECO10 read it): the live deals as `dealId`,
  `networkName`, `kind`, `showName`, `weekday`, `timeslot`, `live`,
  `startsOn`, `endsOn`. No fees, no viewers expected; the rows are listed
  field by field so a money field added to deals can never leak through.

ECO8-04 adds three airing queries (`systems/broadcast/queries/airings.ts`).
Viewers are public for any promotion (ratings are news); money, `net` and the
Why? ref are `null` for a promotion the viewer does not run:

- **`broadcast.airings { promotionId, dealId?, from?, to?, limit? }`** (limit
  1–200, default 50): newest first, each row `airingId`, `airDate`,
  `showName`, `eventInstanceId`, `dealId`, `networkName`, `status`,
  `missReason`, `qualitySource`, `viewers`, `expectedViewers`, `income`,
  `sharesPaid`, `cost`, `net`, `traceRef` and a plain `note` ("Show
  cancelled: nothing aired", "Aired without a show result", or the airtime
  loss note).
- **`broadcast.showAiring { eventInstanceId }`**: for the calendar sheet and
  the results page: the deals that air (or aired) the show, the airing added
  up over its deals (`status`, `viewers`, `income`, `note`) or null, and
  `upcoming` while a deal is still to air it.
- **`broadcast.incomeSummary { promotionId, days? }`** (own only, days 1–365,
  default 30): the period's broadcast, pay-per-view, streaming and airtime
  ledger rows added up by deal, as `total` and an inline `trace`, and the
  latest airing. A period reaching past the detail window says so ("Details
  are kept for the last 4 weeks. Older money is counted in the monthly
  totals.").

ECO8-05 adds the deals queries (`systems/broadcast/queries/deals.ts`):

- **`broadcast.deals { promotionId, include: 'active' | 'all' }`**: own
  promotions only (`notYourPromotion`). One row per deal: `dealId`,
  `networkId`, `networkName`, `kind`, `logoRef`, `showName` ("All major
  shows" for a promotion-wide pay-per-view deal), `eventDefinitionId`,
  `weekday`, `timeslot`, `live`, `terms` (cents), `startsOn`, `endsOn`,
  `daysLeft`, `status`, `endedReason`, `lastAiring` (`airDate`, `viewers`,
  `expectedViewers`, `traceRef`) or null, `expectedViewers` (today's
  benchmark as an inline `Traced`, null for a house show or an ended deal),
  `recent` (the last `window` airings, oldest first, for a Sparkline), `risk`
  and `riskReasons` (worked out from the stored airings, so they are current
  between airings; null and empty once the deal has ended), `healthTraceRef`
  (the stored verdict or signing note, or null) and `upcomingMissed`.
- **`broadcast.deal { dealId }`**: for the deal's own promotion,
  `{ visibility: 'own', deal }` with the same row plus its full airing
  history (`airings`, newest first, at most 200, as `broadcast.airings` rows).
  For anyone else, `{ visibility: 'public', deal }` with only the
  `broadcast.publicDeals` fields.
- **`broadcast.cancelPreview { dealId }`**: own active deals only; the exit
  fee in cents and its Why?.

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
