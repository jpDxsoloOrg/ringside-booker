# Draft

A new game can **start with a draft** (DRF-01). Every wrestler starts in a
free-agent pool and the promotions, yours and the rivals, take turns picking
them before day 1. Every promotion starts level: the same money and popularity,
no TV deal and every title vacant, so the draft decides who is strong. The
same new game can also **choose which promotions are active** (DRF-06), in any
game, with or without a draft, and the draft pool is **cut to size with a
balanced mix** of card levels (DRF-07).

The code is in `packages/engine/src/systems/draft/`. The draft value, the
candidates, the board and the pick order are written to be reused by the
brand drafts (BRW1, #560): see [Reuse](#reuse).

## Settings

Seven new-game settings in the wizard's `draft` group. Settings are booleans
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

- **Roster size.** Wrestlers each promotion drafts. `auto` is
  `draft.rosterTarget` (20), capped at `wrestlers ÷ (promotions ×
draft.pool.ratio.auto)` so the auto pool fits the world, and never below
  `draft.rosterTargetMin` (6).
- **Staff.** With "Draft staff too", managers, announcers, referees,
  presenters and producers are drafted too: `draft.staffTarget` (6) each,
  capped at `staff ÷ promotions`. Off, staff keep their contracts. Bookers are
  never drafted.
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

Every active promotion gets the **median** of the active promotions' cash,
prestige and home popularity. Home popularity is a promotion's mean
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

DRF-03, owner decision 2026-11-20:

- **Default: a season contract at the pick.** The existing contract code
  prices it for the drafting promotion (`askingTermsWith`: kind, exclusivity,
  wage, fee, perks, expected push) and the contract runs from the draft day
  to the day after the active season ends. No signing bonus (cash stays level).
  Written directly, like new-game setup (`session.ts` is a creation path in
  the door-ownership test). Released later at the usual cost.
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
  of its picks.

## Commands

All take JSON args and are issued by a player in the game. Picking commands
answer `DraftAdvanceResult`:
`{ picksMade, picks: DraftPickView[] (the last 50), status, onTheClock: DraftClockView | null }`.

| Command              | Args            | What it does                                                                                                                                                                           |
| -------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft.pick`         | `{ personId }`  | The player on the clock drafts someone from the pool. Refusals: `draft.notYourTurn`, `draft.alreadyDrafted`, `draft.sittingOut`, `draft.notInPool`, `draft.rosterFull`.                |
| `draft.simToMyPick`  | `{ maxPicks? }` | The computer picks for rivals until a player is on the clock, or after `maxPicks` picks (a draft room can show picks a few at a time).                                                 |
| `draft.autoPickRest` | `{}`            | The computer makes every remaining pick, players' too (source `auto`). The draft becomes `complete`.                                                                                   |
| `draft.finish`       | `{}`            | Closes the draft: rivals' remaining picks made, players' remaining turns passed, rivals' unsigned picks signed or released. Answers `{ picksMade, passed, signed, released, status }`. |
| `draft.release`      | `{ personId }`  | Gives an unsigned pick of yours back to the pool (`draft.notReserved` otherwise). Answers `{ personId }`.                                                                              |

`draft.pick`, `simToMyPick` and `autoPickRest` are refused once the draft is
`complete` (`draft.notRunning`); `draft.finish` works on a running or complete
draft. Events: `draft.advanced`, `draft.completed`, `draft.finished`,
`draft.released` (ids and counts only: no event per pick).

## Queries

Public: a draft is a public event. Money is never shown.

- **`draft.state { recent?, rosterOf? }`** → `{ draft: DraftStateView | null }`:
  status, settings, level, pool mix, picks made, pool left, who is on the
  clock (`{ promotionId, name, shortName, isYou, round, pick }`), your next
  turn (`{ round, picksAway }`), the newest `recent` picks (default 12),
  every roster's counts (`rosters`) and one roster's picks (`roster`, default
  yours). `null` in a game without a draft.
- **`draft.pool { offset?, limit?, sort?, descending?, category?, gender?, role?, weightClass?, style?, level?, search? }`**
  → `{ rows: DraftPoolRow[], total, offset, limit, poolLeft }`. Sorts:
  `value` (default), `fit`, `rating`, `popularity`, `age`, `name`, `level`
  (main event first). Each row has its card level (`level`, null for staff),
  the draft value with a short Why? (`why`) and your pick score (`fit`,
  `fitWhy`).
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
  size, sitting-out count, staff, the mix, the level and the equalised lists,
  worked out by the same code the new game runs.

## Save and resume

The draft lives in two tables (see [data-model.md](data-model.md#drafts)):
`drafts` (one row per draft: settings, round-one order, turn, picks, pool
left, level, sit-out list, pool mix) and `draftPicks` (one row per pick).
Every command loads the board fresh from these rows, so a save made
mid-draft resumes exactly; a test checks a reloaded draft drafts the same
picks as one that never stopped.

## Speed

A world copied from the default one 25 times (300 promotions, 13,725 people,
7,500 wrestlers and 1,450 staff in the pool), on a desktop:
new game about 3 s; `draft.pool` page 156 ms; `simToMyPick` 289 picks in
0.5 s; `draft.pick` 140-300 ms; `autoPickRest` 6,910 picks in 1.6 s;
`finish` under 1 ms. The test is `test/systems/draft/bigWorld.test.ts`
(`RB_SLOW_TESTS=1`).

## Reuse

For the brand drafts (BRW1-01 #560, BRW2-03 #566):

- `draftValue` / `draftValueParts` / `draftValueWeights`: the value formula.
- `draftCandidates(read, tunables, options)`: everyone a draft could take,
  with value, rating, popularity, gender, weight class and style.
- `DraftBoard`: rival picks by value and need.
- `nextTurn` / `roundOrder`: the pick order.
- The `drafts` / `draftPicks` tables: add a `kind` (today only `start`).
