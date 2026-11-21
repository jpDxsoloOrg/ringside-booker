# Draft

A new game can **start with a draft** (DRF-01). Every wrestler starts in a
free-agent pool and the promotions, yours and the rivals, take turns picking
them before day 1. Every promotion starts level: the same money and popularity,
no TV deal and every title vacant, so the draft decides who is strong. The
same new game can also **choose which promotions are active** (DRF-06), in any
game, with or without a draft, and the draft pool is **cut to size with a
balanced mix** of card levels (DRF-07). A pick's **whole season contract is
paid up front** and nobody may go below zero in the draft (DRF-10).

The code is in `packages/engine/src/systems/draft/`. The draft value, the
candidates, the board and the pick order are written to be reused by the
brand drafts (BRW1, #560): see [Reuse](#reuse).

## Settings

Eight new-game settings in the wizard's `draft` group. Settings are booleans
or enums, so the draft's options are flat keys; `draftSettingsOf(world)` reads
them back as one object (`DraftOptions`). Every key except `draftStart` has
`requires: "draftStart"` (a new optional field on `NewGameSettingDef`): the
wizard shows it only while the draft is on. All are stored only when they
differ from the default, so a game without a draft stores what it stored
before.

| Key                   | Kind    | Default  | Options                                    | `DraftOptions` field |
| --------------------- | ------- | -------- | ------------------------------------------ | -------------------- |
| `draftStart`          | boolean | false    |                                            | `enabled`            |
| `draftRosterSize`     | enum    | `auto`   | `auto`, `10`, `15`, `20`, `25`, `30`, `40` | `rosterSize`         |
| `draftPoolSize`       | enum    | `auto`   | `auto`, `small`, `large`, `all`            | `poolSize`           |
| `draftOrder`          | enum    | `snake`  | `snake`, `random`, `bySize`                | `order`              |
| `draftStaff`          | boolean | false    |                                            | `draftStaff`         |
| `draftNegotiateAfter` | boolean | false    |                                            | `negotiateAfter`     |
| `draftSchedule`       | enum    | `weekly` | `weekly`, `open`                           | `schedule`           |
| `draftStartingCash`   | enum    | `1m`     | `median`, `250k`, `500k`, `1m`, `2m`       | `startingCash`       |

- **Roster size.** Wrestlers each promotion drafts. `auto` is
  `draft.rosterTarget` (20), capped at `wrestlers ÷ (promotions ×
draft.pool.ratio.auto)` so the auto pool fits the world, and never below
  `draft.rosterTargetMin` (6).
- **Staff.** With "Draft staff too", managers, announcers, referees,
  presenters and producers are drafted too: `draft.staffTarget` (6) each,
  capped at `staff ÷ promotions`. Off, staff keep their contracts. Bookers are
  never drafted.
- **Starting cash** (DRF-10). The cash every active promotion starts with:
  $1M by default (DRF-11), `median` (World median, the
  [level playing field](#level-playing-field)'s median) or another preset
  amount ($250k, $500k, $2M). A setting holds a
  boolean or an enum, so presets stand in for free number entry. The wizard
  shows them as chips under "Start with a draft"; `previewSetup` answers the
  resulting `level.cash`, the world's `medianCash` and the `startingCash`
  choice, and the plan line says "(the world median)" when World median is
  chosen.
- The resolved numbers are stored on the draft row as `DraftSettings`:
  `{ order, rosterTarget, staffTarget, draftStaff, negotiateAfter, schedule }`.

## World setup

Two new-game steps (see [new-game.md](new-game.md#setup-steps)):

| Order | Step                   | Runs when                    |
| ----- | ---------------------- | ---------------------------- |
| 350   | `wld.activePromotions` | `activePromotionKeys` is set |
| 660   | `draft.setup`          | `draftStart`                 |

`draft.setup`, in order:

1. **Candidates.** Everyone who can work (not retired, debuted) in a drafted
   category, with their draft value and their card position before the draft.
2. **Free-agent pool.** Every contract in a drafted role is removed, along
   with the rows that point at it. Nobody has worked a day yet, so there is no
   history, severance or "released" news to keep.
3. **Pool size and mix** ([Pool](#pool)); the rest sit out.
4. **Titles vacant** (every current reign ends `vacated`), **stables
   disbanded**.
5. **Level playing field** ([below](#level-playing-field)), and **every TV
   deal in the world is removed**.
6. **Schedule** ([below](#schedule)).
7. **The draft row**: round one's order and the targets, at turn 0.

### Level playing field

Every active promotion gets the **median** of the active promotions'
prestige and home popularity, and the cash the Starting cash setting gives
($1M by default; the median cash when it is World median). Home popularity is a promotion's mean
popularity over the regions of its home country; every promotion then gets
that median in every region of its own home country and none elsewhere (the
same shape as Equal start). The level is stored on the draft row (`level`)
and shown by `draft.preview` and the wizard's `previewSetup`, together with
what was equalised and what was not:

- **Equalised**: cash, prestige, home popularity, TV deals (none), titles
  (vacant), rosters (drafted), production (every area at level 0, DRF-09).
- **Not equalised** (listed for the owner to decide): home region and
  country, staff policies, brands, venues and show sizes, and the rival rules
  shortcuts (the separate Level playing field setting, D-01).

Production starts at 0 so the shared cash is not eaten by production the
old world paid for. The player raises levels in Production; rivals raise
them through the rival production budget (one level a month, when they can
afford it and a ceiling is holding them back).

The default world's level is cash 825,000.00, prestige 51 and home popularity 13.

### Schedule

Both schedule settings **start the same way**: each active promotion keeps
exactly one weekly show, its main recurring show (weekly first, then the most
important, televised, oldest), made weekly on one weekday; a promotion with
no recurring show gets "`<SHORT>` Weekly", a regular show on
`draft.weeklyShowDay`. Every other show is retired before the first day. The
player names and sets up their weekly show with the schedule editor.

- **One show a week** (`weekly`): the schedule editor refuses a second
  recurring show, a one-off special, and an edit that is not weekly on one
  day (`draft.oneWeeklyShow`, `scheduleRule.ts`).
  The schedule starts `draft.firstShowDelayDays` (7) after the start date (DRF-08): every weekly
  show's `activeFrom` moves there, so no show runs in the first week and negotiate-after picks can
  answer their offers before the first card has to be filled. Booking's "Call off this show" stays
  as the fallback when too few have signed.

- **Open** (`open`): the editor allows anything the player can afford. Rivals
  stay on their one weekly show until a rival feature schedules shows within
  its budget: there is no rival show creation yet (decision for the owner).

## Pool

`pool.ts` (DRF-07). With "Pool size" `all` every wrestler is in the pool.
Otherwise the pool holds `promotions × roster size × draft.pool.ratio.<auto |
small | large>` wrestlers (1.25, 1.1, 1.6), never more than there are.

- **Card level** is the wrestler's card position before the draft. A free
  agent gets the level whose contracted wrestlers' median draft value is
  nearest theirs. (With no contracted wrestlers at all, levels are cut from
  the value ranking by the shares.)
- **Mix.** Each level gets `draft.pool.share.<level>` of the pool (10 / 20 /
  30 / 25 / 15 by default, largest remainder). Inside a level the slots are
  split by gender and weight class in the proportions of the world's
  wrestlers, each group filled best draft value first. A short group hands its
  slots to the best left in its level, a short level to the best left
  anywhere.
- Wrestlers left out **sit out**: no contract, and not free agents.
  Negotiation eligibility answers `unavailable` (`draft.sittingOut`), so no
  promotion can sign them, and `workers.list`'s free-agent filter and
  `contracts.freeAgents` leave them out. A later living-world feature (U20)
  can bring them in as debuts. Staff are never cut.

The mix is stored on the draft row (`poolMix`: per level `inPool`,
`available`, `female`, `male`, `other`), and so is each pool wrestler's level
(`cardLevels`, DRF-08), which `draft.pool` returns as `level` and can filter
and sort by.

## Draft value

`draftValue.ts`, 0 to 100, from public facts only (never hidden potential):

1. Popularity index `Pi = (1 − b) × best country + b × world`,
   `b = draft.value.breadthWeight` (0.3).
2. `skill = draft.value.skillWeight (0.6) × role rating` in the drafted role.
3. `popularity = draft.value.popularityWeight (0.4) × Pi`.
4. Age: `+ draft.value.youthBonusPerYear` (0.6) a year under
   `draft.value.youthAge` (26), at most `draft.value.youthBonusMax` (5);
   `− draft.value.oldPenaltyPerYear` (1.5) a year over `draft.value.oldAge`
   (38).
5. Kept between 0 and 100.

`draftValueParts` is the untraced arithmetic boards use for thousands of
people; `draftValue` is the same arithmetic with a Why? trace. A test checks
they agree.

## Pick order

`order.ts`. The draft row keeps round one's order and a turn counter: turn
`t` is round `floor(t / n)`, slot `t % n`.

- `snake` (default): round one is a seeded shuffle, and every other round runs
  backwards.
- `random`: a new seeded order every round (stream `draft.order`, one
  detached stream per round, so the order never depends on how the picks were
  split across commands).
- `bySize`: the smallest promotion (fewest wrestlers before the draft, then
  lowest prestige) first, every round.

A promotion that needs nobody the pool has is skipped. The draft is
**complete** when nobody needs anyone: every promotion is full or the pool is
empty.

## Rival picks

`board.ts`. A rival takes the candidate with the best pick score: draft value
plus

- `draft.ai.styleBonus` (5) when the ring style suits the promotion's style
  (`STYLE_FITS`);
- gender need: each gender's fair share is `roster size × that gender's share
of the pool`. Short of it: `+ draft.ai.genderNeedWeight (12) × shortfall ÷
share`; at or over it: `− draft.ai.genderSurplusWeight (12) × (over + 1) ÷
roster size`;
- division need: `+ draft.ai.divisionNeedWeight (8) × missing ÷
draft.ai.divisionNeed (3)` for the neediest of its title divisions (gender
  and weight limits) the wrestler can hold;
- alignment: `+ draft.ai.alignmentWeight` (3) for a natural heel when the
  roster has more faces, or the other way round;
- staff: `+ draft.ai.divisionNeedWeight` for a job nobody on the roster does.

Candidates are grouped into buckets that score alike (category, gender, weight
class, heel or face, ring style or staff job), each sorted by value. A pick
scores only the best untaken candidate of each bucket, so it costs a few
hundred score checks whatever the pool size. Ties go to the lower person id:
the same game always drafts the same picks. "Auto-pick" for a player uses the
same board. The `draft.pool` query shows each candidate's score for your
roster (`fit`, `fitWhy`).

## Contracts

DRF-03 and DRF-10, owner decisions 2026-11-20:

- **Default: a season contract at the pick.** The existing contract code
  prices it for the drafting promotion (`askingTermsWith`: kind, exclusivity,
  wage, fee, perks, expected push) and the contract runs from the draft day
  to the day after the active season ends. No signing bonus (cash stays level).
  Written directly, like new-game setup (`session.ts` is a creation path in
  the door-ownership test). Released later at the usual cost.
- **Paid up front** (DRF-10). The whole [season cost](#season-cost) comes
  off the promotion's cash at the pick: one `wages` ledger row through
  `postMoney`, memo "Season contract: <name>", with the cost's Why?. The pick
  row keeps it (`cost`). The contract is marked `prepaidUntil` its end:
  payroll lists it as `prepaid` (no daily wage) and show costs charge no
  appearance fee for it until then (`finance/payroll.ts` `isPrepaid`,
  `finance/showWorkers.ts`). The terms stay as signed, so morale, pay
  expectations, renewals and trades see the real deal. A traded prepaid
  worker's new contract is paid as usual: the prepayment stays with the
  promotion that paid it.
- **Exclusive** (DRF-12, owner decision 2026-11-20). In a game that started
  with a draft, every contract for a drafted job is exclusive: wrestlers, and
  every staff job but booker when staff were drafted. Per-appearance deals are
  allowed, but exclusive too: the worker only works for the promotion that
  signed them. The rule lives in one place, `draftForcesExclusive(read, role)`
  (`rights.ts`): the asking terms use it (`AskingTerms.exclusiveForced`; the
  exclusive ask is priced, and the reach gate on exclusive deals does not
  apply), so the board's season cost, the picks, the rivals' negotiate-after
  signings and the per-appearance fills at finish all sign the same exclusive
  terms; `signAtAsk` sets it too. A non-exclusive offer for a drafted job is
  refused with `draft.exclusiveOnly`, for the player and for rivals alike, and
  the negotiation sheet locks the Exclusive switch on with "Exclusive (draft)".
  Enforcement is the existing exclusivity: another promotion's talks with the
  worker answer `underContract` ("Under an exclusive contract with …") until
  the approach window before it ends, an exclusive signing cuts any other deal
  short, and only the show's own roster can be booked. Games without a draft
  are unchanged.
- **Never below zero in the draft** (DRF-10). A pick whose season cost is
  more than the promotion's cash is refused (`draft.cantAfford`: "Their
  season contract costs $X; you have $Y."). Rivals, `simToMyPick`,
  `autoPickRest` and `finish` only pick affordable candidates. When a
  promotion cannot afford anyone it still wants, its turns end like a full
  roster's and it is listed on the draft row (`outOfMoney`), so the draft
  still completes. Staff picks follow the same rule. This holds only in the
  draft: per-appearance fees and the rest are charged normally afterwards and
  cash may go negative in play.
- **Short rosters** (DRF-10). When the draft finishes, every rival below its
  targets (out of money, or it released picks under negotiate-after) signs
  free agents left in the pool on per-appearance deals (no wage, no bonus,
  not prepaid), cheapest fee first, round by round in draft order, until it
  is full or the pool runs out (`fillShortRosters` in `flow.ts`; the finish
  result counts them as `filled`). Cash never blocks these. A player short of
  wrestlers is told so in the draft room and on the Contracts free-agent
  list, and offers per-appearance deals through the normal negotiation (any
  promotion may offer that kind).
- **"Negotiate contracts after the draft".** Picks join unsigned
  (`reserved`): the drafting promotion holds their rights for
  `draft.reserveDays` (30). Negotiation eligibility answers `underContract`
  (`draft.rightsHeld`) to every other promotion until then, so you negotiate
  through the normal contract offers (they can refuse). `draft.release` gives
  an unsigned pick back to the pool. After the rights run out the pick is an
  ordinary free agent (`contract: "lapsed"` in the views).
- **Rivals follow the same rule.** Under the default they sign at the pick.
  Under negotiate-after, `draft.finish` has each rival sign its unsigned picks
  at their ask, in pick order, while their monthly cost (wage plus four
  appearances' fees) stays under `draft.ai.payrollShare` (0.15) of its cash,
  and release the rest to the pool. In the default world every rival signs all
  of its picks. Nothing is paid at the pick under negotiate-after: the board
  still shows each candidate's estimated season cost.

### Season cost

`seasonCost.ts` (pure, with a unit test) prices the contract a pick signs
(`pricing.ts`: the same asking terms `signAtAsk` signs) from the pick date to
the contract's end (`seasonContractEnd`):

- **Wages** = monthly wage × `finance.wages.multiplier` × 12 × days ÷ 365.25,
  the daily accrual payroll would have charged.
- **Appearances** = days ÷ 7 × `draft.cost.appearancesPerWeek` (1: one per
  weekly show, the schedule every draft game starts on), rounded, at most the
  contract's appearance cap; only when the deal has a fee.
- **Fees** = per-appearance fee × appearances. **Total** = wages + fees.

Asks depend on the promotion (reach, image, allowed kinds), so prices are
worked out per promotion, lazily, and kept for the command.

**Season costs on the default world** (all 12 promotions, roster 20): every
ask there is a per-appearance deal (reach is below the exclusive-deal line),
so the cost is the fee × one appearance a week. With the wizard's default
**12-month season** (52 appearances), the average season cost by card level
is: main event $89,100 ($15,600–$187,200), upper card $55,000
($18,700–$110,800), midcard $33,000 ($9,400–$104,500), lower card $22,300
($7,800–$106,100), enhancement $10,900 ($6,200–$53,000). A sensible mix (2
main event, 4 upper, 6 mid, 5 lower, 3 enhancement) is about $740,000. A
6-month season halves every cost.

DRF-10 found the old default ($825,000, the median) left rivals spending down
to almost nothing (8 of 12 short, $1,300–$95,000 left). DRF-11 made the
default $1M and added the [rival reserve](#rival-reserve).

### Rival reserve

DRF-11, owner decision 2026-11-20. `reserve.ts`. A rival only takes a pick
that leaves it `draft.ai.reserveMonths` (3) months of **running costs**:

- **overhead**: production, marketing and back office at its levels (nothing
  at level 0);
- **medical**: its medical policy for a full roster (what it keeps plus the
  draft's targets);
- **shows**: its shows in the next 56 days, turned into a month: venue rent
  where the box office's automatic pick would hold each one, travel and
  catering at its policies for the card's headcount, and per-show production.
  Appearance fees are left out (picks are prepaid), and so is income: the
  reserve is what the cash must cover if nobody comes.

When nothing it wants is affordable above the reserve, its turns end
(`outOfMoney`) and it fills the rest per appearance at finish, as before.
Under negotiate-after, `settleRivalPicks` signs a pick only while its wages
stay under `draft.ai.payrollShare` of cash **and** the cash covers
`reserveMonths` × (running costs + those wages a month). The player is not
held to the reserve, only to never going below zero; the draft room turns a
pick's cost amber, with a line in its tooltip and the confirm, when it would
leave less than `reserveMonths` of the player's running costs (`draft.pool`
answers `runningCostMonthly` and `reserveMonths`).

**Venue for the weekly show.** The draft clears the weekly show's preferred
venue, so it is held where its crowd fits instead of the arena the world gave
it (CIELO's 13,500-seat arena cost about $59,000 a show against a few
thousand dollars of tickets). This changes venues only for draft starts.

**No offers to the pool.** While a draft is running or complete, a contract
offer (`contracts.makeOffer`, the player's or a rival's) to someone in its
pool is refused with `draft.inPool` ("In the draft pool: draft them, or wait
until the draft is finished"; `rights.ts` `inOpenDraftPool`). The rivals'
per-appearance signings at finish write contracts directly, so they are not
affected.

**Balance with the new defaults** ($1M, 12-month season, production 0, a 3-
month reserve, `autoPickRest`, then 90 days played with the player not
booking; seed `draft-start`):

- **All 12 promotions:** 4 rivals and the player end their picks for lack of
  money (picks 15 to 18 of 20); the rivals fill up with 12 per-appearance
  signings. Rivals keep $20,000–$270,000 after the draft; after 90 days the
  lowest have $2,500 (WATTLE) and $25,000 (HARDPN), most still have
  $40,000–$180,000, and none is below zero. The player's auto-picks spent down
  to $6,300 (15 wrestlers); the player's own staff wages and medical then put
  it below zero within the first month.
- **The six biggest only:** their reach is 22–32 (7–10 with all 12), so asks
  are about three times higher and their shows are picked into 2,000–13,500
  seat venues, putting running costs at $41,000–$274,000 a month. Every rival
  stops after 2 to 4 picks and fills the rest per appearance (86 signings);
  two of them still go below zero within 90 days. $1M is far too little
  there: the World median ($3.25M) suits a small, big-promotion draft better.

What a draft-start promotion pays at level 0 (DRF-11 audit, first month):
production (per-show areas and the monthly overhead) is $0 at level 0, and
nothing about stipulation matches costs money yet. Everything else is outside
production: venue rent ($250 + $3.50 a seat × the venue kind, per show:
$1,300–$11,000 a show, $5,000–$43,000 a month), travel and catering by policy
level ($0 at level 0; travel up to $9,000 a month at level 3), medical by
policy level ($0–$33,000 a month for a full roster) and the staff wages of
promotions that keep their staff. Income is tickets and merchandise, about
$8,000–$13,000 a month. Policies are not equalised by the draft start yet,
and the venue pick prefers a real venue even when it is ten times the crowd;
both are owner decisions (see the DRF-11 report).

## Commands

All take JSON args and are issued by a player in the game. Picking commands
answer `DraftAdvanceResult`:
`{ picksMade, picks: DraftPickView[] (the last 50), status, onTheClock: DraftClockView | null }`.

| Command              | Args            | What it does                                                                                                                                                                                   |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft.pick`         | `{ personId }`  | The player on the clock drafts someone from the pool. Refusals: `draft.notYourTurn`, `draft.alreadyDrafted`, `draft.sittingOut`, `draft.notInPool`, `draft.rosterFull`, `draft.cantAfford`.    |
| `draft.simToMyPick`  | `{ maxPicks? }` | The computer picks for rivals until a player is on the clock, or after `maxPicks` picks (a draft room can show picks a few at a time).                                                         |
| `draft.autoPickRest` | `{}`            | The computer makes every remaining pick, players' too (source `auto`). The draft becomes `complete`.                                                                                           |
| `draft.finish`       | `{}`            | Closes the draft: rivals' remaining picks made, players' remaining turns passed, rivals' unsigned picks signed or released. Answers `{ picksMade, passed, signed, released, filled, status }`. |
| `draft.release`      | `{ personId }`  | Gives an unsigned pick of yours back to the pool (`draft.notReserved` otherwise). Answers `{ personId }`.                                                                                      |

`draft.pick`, `simToMyPick` and `autoPickRest` are refused once the draft is
`complete` (`draft.notRunning`); `draft.finish` works on a running or complete
draft. Events: `draft.advanced`, `draft.completed`, `draft.finished`,
`draft.released` (ids and counts only: no event per pick).

## Queries

Public: a draft is a public event. Money is the viewer's own only (DRF-10):
their cash and what each candidate would cost them.

- **`draft.state { recent?, rosterOf? }`** → `{ draft: DraftStateView | null }`:
  status, settings, level, pool mix, picks made, pool left, who is on the
  clock (`{ promotionId, name, shortName, isYou, round, pick }`), your next
  turn (`{ round, picksAway }`), the newest `recent` picks (default 12),
  every roster's counts (`rosters`, with `outOfMoney`) and one roster's picks
  (`roster`, default yours; your picks carry the `cost` paid). `you` is
  `{ promotionId, cash, paysUpFront, outOfMoney, wrestlersShort }` (null for a
  spectator). `null` in a game without a draft.
- **`draft.pool { offset?, limit?, sort?, descending?, category?, gender?, role?, weightClass?, style?, level?, search? }`**
  → `{ rows: DraftPoolRow[], total, offset, limit, poolLeft, cash, paysUpFront }`. Sorts:
  `value` (default), `fit`, `rating`, `popularity`, `age`, `name`, `level`
  (main event first), `cost` (prices every match). Each row has its card level (`level`, null for staff),
  the draft value with a short Why? (`why`), your pick score (`fit`,
  `fitWhy`), and its season cost to you (`cost`, `costParts { wages, appearances, fees, days }`,
  `affordable`; only the page is priced unless sorting by cost).
- **`draft.preview {}`** → `{ options, draft, equalised, notEqualised }`: the
  settings summary, with the level and the pool mix.

## Gate

`draft.unfinished` ("Finish the draft"): while a draft is running or
complete, every skip stops before day 1 with the action hint `draft`.

## Active promotions

DRF-06, every game. `NewGameInput.activePromotionKeys` lists the pack keys of
the promotions that stay active; left out, every promotion stays. Your own
promotion is always active. A key the world does not have is refused (field
`activePromotionKeys`). Step `wld.activePromotions` (350) closes every other
active promotion: status `closed`, contracts removed (their people become
free agents, or draft candidates in a draft game), titles retired, shows
retired, deals and stables gone. A closed promotion runs no shows, signs
nobody and books nothing; the calendar, rival desk, finances and contracts
already skip closed promotions. Only active promotions draft. Closing
promotions also makes big imported worlds faster.

## Wizard previews

Before any game exists, the wizard reads two engine functions (host:
`previewPromotions`, `previewSetup`). The packs are loaded once per pack set
with the preview seed and the facts memoised.

- **`previewPromotionPage(packs, rootPackId, args)`**, args
  `{ search?, countryKey?, size?, sort?: wrestlers|reach|prestige|name, descending?, offset?, limit? }`
  → `{ rows: PickerPromotion[], total, offset, limit, countries, sizes, biggestFirst }`.
  `biggestFirst` lists every key by wrestlers, for "Only the biggest N".
- **`previewSetup(packs, rootPackId, args)`**, args
  `{ activePromotionKeys?, playerPromotionKey?, founding?, settings? }` →
  `{ promotions: { total, active, inactive }, alwaysActive, wrestlers: { onActiveRosters, freeAgents, total }, unknownKeys, draft }`.
  `draft` (when `settings.draftStart`) has the resolved settings, the pool
  size, sitting-out count, staff, the mix, the level (with `medianCash` and
  `startingCash`) and the equalised lists, worked out by the same code the new
  game runs.

## Save and resume

The draft lives in two tables (see [data-model.md](data-model.md#drafts)):
`drafts` (one row per draft: settings, round-one order, turn, picks, pool
left, level, sit-out list, pool mix, out-of-money list) and `draftPicks` (one
row per pick, with the season cost paid).
Every command loads the board fresh from these rows, so a save made
mid-draft resumes exactly; a test checks a reloaded draft drafts the same
picks as one that never stopped.

## Speed

A world copied from the default one 25 times (300 promotions, 13,725 people,
7,500 wrestlers and 1,450 staff in the pool), on a desktop:
new game about 3 s; `draft.pool` page 156 ms; `simToMyPick` 289 picks in
0.5 s; `draft.pick` 140-300 ms; `autoPickRest` 6,910 picks in 1.6 s;
`finish` under 1 ms. The test is `test/systems/draft/bigWorld.test.ts`
(`RB_SLOW_TESTS=1`). With picks paid up front (DRF-10) a rival prices only the
candidate it would take, and looks further down a bucket only when that one is
out of reach (after 8 misses it prices every bucket's top at once); in WSL the
same test runs `autoPickRest` in about 3.4 s of CPU time and a pool page in
230 ms.

## Reuse

For the brand drafts (BRW1-01 #560, BRW2-03 #566):

- `draftValue` / `draftValueParts` / `draftValueWeights`: the value formula.
- `draftCandidates(read, tunables, options)`: everyone a draft could take,
  with value, rating, popularity, gender, weight class and style.
- `DraftBoard`: rival picks by value and need.
- `nextTurn` / `roundOrder`: the pick order.
- The `drafts` / `draftPicks` tables: add a `kind` (today only `start`).
