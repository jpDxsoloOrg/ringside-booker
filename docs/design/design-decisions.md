# Design decisions

The big calls that shape the game. Each one has the choice, the reason, and what
it means for the code. New decisions get the next number; changed decisions get
a dated note instead of being rewritten.

## D-01: Rival promotions use simplified rules (2026-11-07)

**Choice:** AI-run promotions keep shortcuts the player doesn't get. They have
no in-match injuries, no morale changes from match results, and simpler booking
inputs (no notes, purposes or match stories). The world sim stays cheap.

**Why:** Dozens of promotions run shows every week. Running the full player
pipeline for all of them makes long skips slow, and most of that detail never
shows up on screen anyway.

**What it means:**

- Each shortcut is its own named tunable (`ai.skipInMatchInjuries`,
  `ai.skipResultMorale`, `ai.scoreBonus`, ...) that defaults on. Nothing is
  hidden in an `if (isAI)` branch.
- A "level playing field" new-game option turns all of them off.
- AI shows still produce full calculation traces, so you can see what a rival
  show scored and why, shortcuts included.
- Off-screen injuries and morale for rival rosters come from the daily world
  events instead, so rival wrestlers still get hurt and unhappy.

## D-02: Crowds react to expectation; popularity drives money; hype links them (2026-11-07)

**Choice:** A segment's crowd reaction is judged against what the crowd expects
from those wrestlers, not mostly by how popular they are. Raw popularity
belongs on the business side (tickets, TV, merch, sponsors). A **hype** value
per promotion and per upcoming event connects the two.

**Why:** If popularity is most of the crowd reaction _and_ most of the revenue,
popular companies snowball and cold ones get punished twice. Scoring against
expectation means a hot act that underdelivers gets a flat reaction, and an
unknown who overdelivers gets noticed. That's what booking is about.

**What it means:**

- Crowd score = performance vs an expectation built from popularity, momentum
  and card position, with diminishing returns at the top.
- Good shows, storyline heat and a hot title picture build hype. Hype decays
  over time and feeds attendance, PPV buys and TV viewers directly, so "book
  well → sell more" shows up in the numbers.
- The Why? panel on attendance shows popularity and hype as separate lines.

## D-03: Geography is countries and regions (2026-11-07)

**Choice:** One regional model. Each wrestler and promotion has popularity per
region. Countries and continents are population-weighted roll-ups for display
and coarse checks.

**Why:** Touring, local heroes and TV reach only mean something if place
matters. A single model avoids keeping two popularity systems in sync.

**What it means:**

- World data defines continents → countries → regions with population and
  wrestling interest.
- Popularity spreads from where a wrestler performs and where shows air.
- Screens default to the continent or country view, with drill-down.

## D-04: Card flow matters (2026-11-07)

**Choice:** A show's score depends on how the card is built, not only on its
best segments.

**Why:** Placing the opener, the main event, variety and pacing is the skill of
booking. If order doesn't matter, the booking screen is just a list.

**What it means:**

- The show score combines segment quality with card-flow effects: opener
  energy, main event in the last slot, variety of match types and segment kinds,
  pacing (too many talking segments in a row), and repetition (same matchup or
  worker overused). Cards are slot-based (see D-10), so flow is judged on slot
  order and roles.
- Each effect is a separate, labelled line in the show's Why? trace, and the
  booking screen previews them live.

## Defaults taken without a separate decision

Calls I made early on, which stay in place unless I change them later:

- **Calculation traces everywhere.** Every derived number can explain itself.
- **Momentum and relationships decay** toward neutral, so they need upkeep.
- **Smooth scaling instead of hard size tiers.** Size labels stay, but prices,
  caps and eligibility scale smoothly with popularity and reach.
- **Real negotiation.** Asking price, counter-offers, competing bids, and a
  severance curve for releases.
- **Soft compression at the top of the rating scale** instead of re-rolling
  high scores, and star ratings that blend work rate with crowd reaction.
- **Cosmetic stats get wired or dropped.** Title prestige raises the stakes,
  storyline heat gives a live crowd bonus, and tag-team experience gives a
  teamwork bonus. Tournament wins earn momentum and a title shot.
- **Production is a visible ceiling.** The booking screen shows it before the
  show, not after.
- **Safe modding.** JSON data packs plus a sandboxed scripting API, with no raw
  file or system access.

## D-05: Brand drafts (2026-11-07)

**Choice:** A promotion with two or more brands can schedule a **draft** that
splits or reshuffles its own roster between its brands. Drafts only pick from
workers already under contract with the promotion. Signing free agents and
poaching from other companies works as normal at any time.

**What it means:**

- A draft is a scheduled calendar event (it can also air as a show segment)
  with settings chosen when you schedule it:
  - **Order:** snake, a lottery weighted toward the brand that lost the last
    brand-war season, or straight rotation.
  - **Rounds** and how many protected (kept) workers per brand.
  - **Units:** whether champions, tag teams and stables are drafted as one pick.
  - **Eligibility:** filters such as excluding injured workers or development
    contracts.
- You make the picks for brands you control. Computer GMs pick for the
  others, each with a visible preference profile (for example "favours high
  flyers" or "wants proven draws"). Any of your turns can be auto-picked.
- Every GM pick has a Why? trace ("needed a midcard heel; best available by
  fit score").
- Titles follow their holder or stay with the brand, as set per title.
- Free agents signed between drafts are assigned to a brand when signed.

## D-06: Brand wars mode (2026-11-07)

**Choice:** An optional mode for a promotion with enough roster for two or more
brands. The brands compete with each other over **seasons**, and a scoreboard
shows the standings.

**What it means:**

- At setup you choose, per brand, whether **you book it** or a **computer GM**
  does. You can book them all for full control, or book one brand and compete
  against the GMs.
- A season has a set length. Brands score on show ratings, attendance, TV
  viewers, hype, and head-to-head results at shared (supershow) events. Each
  category is weighted, and the weights are tunables.
- The season winner is announced, and the result can feed the next draft's
  lottery odds.
- The scoreboard and season history get their own screens, with Why? traces
  showing how each brand's points were earned.
- The rest of the world keeps running normally. Other promotions are still
  competition, and you can still sign their workers.
- A minimum roster check makes sure each brand can fill its shows before the
  mode can start. The check gives warnings rather than blocking.

## D-07: Online multiplayer, turn-based, built after single-player (2026-11-07)

**Choice:** Friends play in the same world from their own devices, each running
their own promotion. They compete for talent, TV deals and fans. Play is
turn-based: everyone books and hits **Ready**, then the world advances. It gets
built after the single-player core is playable, but the engine is designed for
it from day one.

**What it means now (foundation):**

- **Controllers.** Every promotion (and every brand, for D-06) is assigned a
  controller: a human player or the computer. Single-player is just "one human
  controller". Nothing in the engine assumes there is exactly one player.
- **Everything a player does is a command.** Commands are serialisable intents
  (`bookSegment`, `offerContract`, `advanceDays`, ...) recorded in a command
  log with the controller that issued them. The UI never edits the world
  directly.
- **The engine runs in Node as well as the browser.** It has no DOM
  dependencies, so the same package can run on a server.
- **Per-player views.** Queries take a viewer (controller) so each player only
  sees what their promotion would know, such as rival finances or offers to
  other promotions' workers.

**What it means later (multiplayer epic):**

- **Server-authoritative.** A small AWS backend (accounts, lobbies, turn sync)
  runs the engine and owns the save of record. Clients send commands and get
  results back. I'm not doing lockstep (every client re-simulating), because
  floating-point maths functions can differ slightly between browsers, which
  would make games drift apart.
- **Turns:** the world advances when every human is ready, or when a turn
  deadline passes (auto-ready). Days with no human show skip quickly; the game
  stops on any human's show day.
- **Conflicts between humans** (two offers to the same free agent) are resolved
  by the same rules as AI competition, with a Why? trace for both players.
- **Single-player stays fully offline.** Multiplayer is an extra mode, not a
  requirement.

## D-08: Configurable season length (2026-11-07)

**Choice:** The game runs in **seasons** whose length you choose: a preset
(1, 3, 6 or 12 months) or a custom number of weeks. You set it at new game, and
you can change it between seasons.

**What a season drives:**

- **Season end:** awards, rankings snapshot and a season recap screen. This is
  the same machinery that would otherwise run at year end.
- **Brand wars (D-06):** a brand-war season is a game season, so the
  scoreboard resets and a winner is crowned at each season end.
- **Drafts (D-05):** the off-season window between seasons is the default slot
  for a draft. Drafts can still be scheduled mid-season.
- **Multiplayer (D-07):** a game can be set to a number of seasons, with a final
  standings screen. Short seasons suit a quick game with friends; long ones
  suit a dynasty.
- **Optional season goals** (owner goals, job security) are judged at season
  end.

**What stays on the real calendar:** aging, birthdays, contract lengths, injury
recovery and anything else that represents real time. A short season makes the
competitive rhythm faster; it doesn't make wrestlers age faster.

**Implementation:** `season.lengthDays` is a tunable on the world. The day
pipeline gets a `seasonEnd` phase alongside the weekly, monthly and yearly
jobs. Season records (number, start, end, results) are stored so history
screens can show past seasons.

## D-09: Losing inside a hot storyline doesn't hurt morale (2026-11-07)

**Choice:** Wrestlers understand that losing is part of a good story. A loss in
a match that belongs to a **hot storyline** costs little or no morale, and
being featured in a hot storyline makes people happier, whatever the result.

**Why:** Punishing every loss the same pushes you toward booking everyone
strong, which is the opposite of good storytelling. People in a hot angle are
getting TV time, promo time and a story that's going somewhere. That's what
they actually care about.

**How it works:**

- The usual loss penalty (scaled by who they lost to and their push level) is
  multiplied by `1 − storyShield`.
- `storyShield` comes from the storyline's heat: 0 below a minimum heat, rising
  to 1 (no penalty) at a "hot" threshold. Both thresholds are tunables.
- A match counts as part of the angle when it's linked to the storyline and the
  loser is one of the storyline's participants.
- Being in a hot storyline gives a small, separate morale bonus for each
  appearance.
- Personality still matters. Workers with an ego-type trait get a smaller
  shield, so they grumble a little even in a good angle.
- Losing **the storyline's final match** gets half the shield. They accept it
  more easily, but they still feel the loss.
- The morale Why? trace shows it plainly, for example "Loss to X: −8 → −1
  (hot storyline 'Y', heat 82, shield 90%)".

## D-10: Cards are built from segment slots, not minutes (2026-11-07)

**Choice:** You never set how long a match runs. Every show has a set number
of **segment slots**, and you fill each slot with a match or a talking
segment. Where a segment sits on the card decides how much time and weight it
gets.

**Why:** Setting minutes on every match is fiddly and doesn't make booking
better. The interesting choices are who's on the card, what they do, in what
order, and who wins.

**How it works:**

- **Show formats.** Each event type has a slot count. For example, a weekly TV
  show has 6 slots and a big event has 8–10. Bigger production budgets can
  unlock an extra slot. Slot counts are set per event type and are tunables.
- **Slot roles.** Slots have roles that come from their position: opener,
  midcard, semi-main and main event, plus an optional pre-show. The role gives
  the segment an implied **weight** (how much it counts toward the show score)
  and an implied **duration class** (short, standard, long). The main event is
  always the long, heaviest slot.
- **Everything that used minutes uses the duration class instead.** That covers
  stamina and conditioning effects, how much ring psychology a match needs,
  fatigue gain, and how much a great or terrible worker can show. A main event
  is a real test of stamina and psychology; an opener isn't.
- **Card flow (D-04) works on slots.** It looks at the opener, the main event,
  variety, too many talking segments in a row, and repeated matchups.
- **Match type adjusts within the class.** A battle royal or an iron-man style
  stipulation can push its slot's duration class up or down, so stipulations
  still affect stamina without you entering a number.
- No minutes appear on the booking screen. The Why? trace on a rating shows the
  slot role and duration class wherever they mattered, for example
  "Main event (long): stamina check failed for X, −6".

## D-11: Hybrid visual identity, dark only (2026-11-08)

**Choice:** Two visual registers share one palette: a front-office look for
the management screens and a sports-broadcast look for show moments. The theme
is dark only for now. Interactive pieces come from Radix UI, TanStack Table and
Lucide, styled with our own tokens.

**Why:** The game is mostly management, which needs to be readable for long
sessions. The highlights are live events, which should feel like TV.

**What it means:** see [`visual-identity.md`](visual-identity.md) for the
palette, type, shapes and signature components. The reference mockups are in
[`mockups/`](mockups/).
