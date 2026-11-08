---
title: 'Project kickoff'
date: 2026-11-07
epics: []
milestone: 'Kickoff'
tickets: []
blogCandidates: ["Why I'm building a wrestling booking sim"]
---

# Project kickoff

## Summary

Ringside Booker is a wrestling promotion management sim. You book the shows for one promotion and
every other promotion in the world runs itself around you. It runs in the browser with no server,
and saves stay on your machine. Later, friends will be able to join the same world in a turn-based
online mode, each running their own promotion. This entry is the baseline before any game code:
what I decided, why, and what is still open, so later entries can say which calls held up.

## What I built

- **Design docs.** [`architecture.md`](../design/architecture.md) sets the layout, the stack and the
  engine rules. [`design-decisions.md`](../design/design-decisions.md) holds the numbered game
  design calls (D-01 to D-10) and a list of smaller defaults.
- **The epic plan.** Five epics go first: Foundation (FND), Simulation core (SIM), World and
  generation (WLD), App shell and UI (UI), and Dev journal and blog (BLOG). The game system epics
  (match ratings, shows, contracts, money and the rest) come after them. None of those are on the
  board yet, so they have no prefixes at the time of writing.
- **The empty repo.** The workspaces scaffold and the journal and blog conventions are in. The
  engine exports a version number and nothing else.

## Decisions and why

### Architecture

#### One World store, typed tables, undo journal

- **Decision:** All state lives in one `World` of typed tables. Entities point at each other by ID
  only. Systems write through a `Tx` with an undo journal.
- **Alternatives:** Nested object graphs; immutable copies per change.
- **Why:** One place to save, validate and hash, and a failing step rolls back without losing the
  day.
- **Revisit if:** The journal shows up as a hot spot in long skips.

#### Branded IDs

- **Decision:** Each entity type has its own branded ID type (`PersonId`, `PromotionId`) with a
  short prefix, minted from the seeded RNG.
- **Alternatives:** Plain strings; auto-increment numbers.
- **Why:** The compiler catches a title ID passed as a person ID, and a replay mints the same IDs.
- **Revisit if:** Prefixes get in the way of data packs.

#### Seeded RNG with named streams

- **Decision:** No `Math.random()` in the engine. All randomness comes from a seeded, serialisable
  RNG with named streams and exact-odds helpers.
- **Alternatives:** One shared seeded generator.
- **Why:** Same save, seed and inputs give the same result, and a new roll in one system doesn't
  shift another system's rolls.
- **Revisit if:** Stream state bloats saves.

#### Tunables registry where 0 means 0

- **Decision:** Every balance number is a typed tunable with a default, range, unit and
  description. Saves can override them, and 0 always means 0.
- **Alternatives:** Constants in code; a loose settings object.
- **Why:** Balancing should be data, and "0 means use the default" makes a setting impossible to
  switch off.
- **Revisit if:** The registry gets too big to browse.

#### `Traced<T>` on every formula

- **Decision:** Every formula is a pure function returning a value plus a trace of inputs,
  modifiers, clamps and rolls.
- **Alternatives:** Debug logging; explaining only headline numbers.
- **Why:** The "Why?" panel is the point. If I can't explain a number, it doesn't ship.
- **Revisit if:** Tracing makes rival shows too slow in long skips. Then I'd summarise, not drop.

#### Phase pipeline with per-step rollback

- **Decision:** A day is an ordered list of named phases, each with its own transaction and error
  report. Skips loop it and stop at gates.
- **Alternatives:** One big `advanceDay()`.
- **Why:** One broken system shouldn't cancel the day, and named phases make the order testable.
- **Revisit if:** Phases share so much state that the boundaries hurt.

#### Event bus

- **Decision:** Systems publish domain events; news, the feed, achievements and mods subscribe.
- **Alternatives:** Systems calling each other directly.
- **Why:** Systems stay decoupled, and the same events fire for player and rival shows.
- **Revisit if:** Event chains get hard to follow.

#### Controllers, commands and a viewer on every query

- **Decision:** Every promotion and brand has a human or computer controller. Every action is a
  serialisable command in a log, and every query takes the viewer.
- **Alternatives:** Assume one player and retrofit later.
- **Why:** Retrofitting a second human is a rewrite; doing it now is cheap (D-07).
- **Revisit if:** Passing a viewer makes simple single-player queries awkward.

#### The engine as its own package

- **Decision:** A monorepo where the engine is a pure TypeScript package with no DOM or React.
- **Alternatives:** Engine code inside the web app.
- **Why:** The same engine runs in a worker, a headless runner and, later, on a server.
- **Revisit if:** The package boundary slows everyday work.

#### Queries and commands across a Web Worker

- **Decision:** The UI never touches the World. It sends commands and reads queries through a Web
  Worker.
- **Alternatives:** The engine on the main thread.
- **Why:** Skips and rival turns don't freeze the page, and the same boundary works for a server.
- **Revisit if:** Copying results across the worker gets slow.

#### IndexedDB saves with `.rbsave` export

- **Decision:** Versioned, gzip-compressed JSON saves in IndexedDB slots, with autosave, backups,
  tested migrations and `.rbsave` export.
- **Alternatives:** localStorage; cloud saves.
- **Why:** Saves get big, and a file moves a game from desktop to phone without a server.
- **Revisit if:** Phone browsers evict IndexedDB data often enough to lose saves.

#### CSS Modules and design tokens

- **Decision:** CSS Modules plus custom-property tokens. No inline styles.
- **Alternatives:** A utility CSS framework; CSS-in-JS.
- **Why:** Tokens make themes and the phone layout manageable, and plain CSS stays readable.
- **Revisit if:** The tokens stop covering what screens need.

#### Desktop first, with a 390px phone layout

- **Decision:** Screens are designed for desktop first and each gets a phone layout, checked at
  390px by a Playwright phone project.
- **Alternatives:** Desktop only; mobile first.
- **Why:** A booking sim is dense, but I want to check my promotion on my phone.
- **Revisit if:** A screen can't work at phone width without hurting desktop.

#### Content and balance as data

- **Decision:** Workers, promotions, titles, events and balance numbers are JSON packs checked by
  zod. The shipped world is the first pack.
- **Alternatives:** Content in code.
- **Why:** Worlds can be edited and shared without a build, and one schema gives types and runtime
  checks.
- **Revisit if:** Packs need logic that data can't express.

#### The rest of the stack

- **Decision:** Strict TypeScript with no `any`; React, React Router and Vite; Zustand for UI-only
  state; Comlink; Vitest; ESLint and Prettier; Playwright; CI on every PR. Placeholder art goes
  through one `ImageSlot` component.
- **Alternatives:** Something new for each job.
- **Why:** Tools I know keep the risk in the simulation, not the toolchain, and real art can replace
  the placeholders without touching a screen.
- **Revisit if:** One of them fights the worker boundary.

### Game design

#### D-01: Rival promotions on simplified rules

- **Decision:** Computer-run promotions skip some player-only systems. Each shortcut is a named
  tunable, and a "level playing field" option turns them all off.
- **Alternatives:** The full pipeline for everyone; shortcuts hidden in code.
- **Why:** Long skips have to stay fast, and naming every shortcut keeps it honest.
- **Revisit if:** Skips are fast enough with everything on.

#### D-02: Crowds react to expectation, hype links them to money

- **Decision:** Crowd reaction is judged against expectation. Popularity drives the business side,
  and hype connects the two.
- **Alternatives:** Popularity drives both.
- **Why:** Otherwise popular companies snowball and cold ones get punished twice.
- **Revisit if:** The balance harness shows hype swamping everything else.

#### D-03: Countries and regions

- **Decision:** One regional popularity model, rolled up to countries and continents.
- **Alternatives:** One global number; separate national and regional systems.
- **Why:** Touring and local heroes only matter if place matters, and one model can't drift.
- **Revisit if:** Region counts make the world too slow or the screens too busy.

#### D-04: Card flow matters

- **Decision:** A show's score depends on how the card is built: opener, main event last, variety,
  pacing and repetition.
- **Alternatives:** Score the show from its best segments.
- **Why:** Ordering the card is the craft of booking. Otherwise the booking screen is a list.
- **Revisit if:** Flow effects end up as noise next to segment quality.

#### D-05: Brand drafts

- **Decision:** A promotion with two or more brands can schedule a draft that reshuffles its own
  roster, with configurable order, rounds and protected picks.
- **Alternatives:** Moving workers between brands by hand.
- **Why:** A draft is an event in its own right, and GMs with visible preferences make it readable.
- **Revisit if:** Nobody uses it outside brand wars.

#### D-06: Brand wars mode

- **Decision:** An optional mode where brands compete over seasons on a weighted scoreboard. I
  book each brand myself or hand it to a computer GM.
- **Alternatives:** Brands as labels only.
- **Why:** It gives a big roster a goal beyond money.
- **Revisit if:** The scoring weights can't be made to feel fair.

#### D-07: Online multiplayer after single-player, engine ready now

- **Decision:** Turn-based, server-authoritative play with friends, built after the single-player
  core, with the engine ready for it from day one.
- **Alternatives:** Single-player only; lockstep, where every client re-simulates.
- **Why:** Sharing a world with friends is the long-term hook, and floating-point maths differs
  enough between browsers that lockstep would drift.
- **Revisit if:** Single-player takes so long that multiplayer should leave the scope.

#### D-08: Configurable season length

- **Decision:** Seasons of 1, 3, 6 or 12 months, or a custom number of weeks. Aging and contracts
  stay on the real calendar.
- **Alternatives:** A fixed year.
- **Why:** Short seasons suit a quick game with friends, long ones suit a dynasty.
- **Revisit if:** Very short seasons make the season-end screens feel like busywork.

#### D-09: Losing inside a hot storyline doesn't hurt morale

- **Decision:** A loss in a hot storyline costs little or no morale, scaled by heat, and being in a
  hot angle is a small boost.
- **Alternatives:** Every loss costs the same.
- **Why:** Punishing every loss pushes you to book everyone strong, which is bad storytelling.
- **Revisit if:** Hot storylines become a way to dodge morale entirely.

#### D-10: Cards built from segment slots, not minutes

- **Decision:** Shows have a set number of slots. Position gives each segment its role, weight and
  duration class. No minutes anywhere.
- **Alternatives:** A length for every match.
- **Why:** Typing minutes is fiddly. The interesting choices are who, what, in what order and who
  wins.
- **Revisit if:** Stipulations need finer control than a duration class.

#### Defaults taken without a separate decision

- **Decision:** Traces everywhere; momentum and relationships decay; smooth scaling instead of size
  tiers; real negotiation; soft compression at the top of the rating scale; every stat wired up or
  dropped; production shown as a ceiling before the show; safe, sandboxed modding.
- **Alternatives:** Numbering each one, or leaving them vague.
- **Why:** They follow from the goals, so they didn't need a debate.
- **Revisit if:** One turns into a real trade-off. Then it gets a D-number.

### Still open

#### How big the default world is

- **Status:** open
- **Question:** How many promotions and workers ship in the default world.
- **What would decide it:** Skip speed with the D-01 shortcuts on, once the headless runner can
  time a year (SIM-12, WLD-08, WLD-09).

#### How the scripting sandbox works

- **Status:** open
- **Question:** What runs mod scripts safely in a browser: a worker, an embedded interpreter, or a
  small rule language of my own.
- **What would decide it:** What the first real mod needs. Data packs come first.

#### How much trace history a save keeps

- **Status:** open
- **Question:** How many full traces to keep and what the history summary looks like.
- **What would decide it:** Save size after a few simulated years (SIM-06).

#### What multiplayer runs on

- **Status:** open
- **Question:** The shape of the backend (accounts, lobbies, turn sync) and the default turn
  deadline.
- **What would decide it:** The multiplayer epic. Until then the engine only has to stay ready.

## How this differs from other games in the genre

- Every number opens up to show where it came from, rival shows included.
- Computer-run promotions take shortcuts in the open, as settings you can switch off.
- The crowd reacts to what it expected, so an unknown who overdelivers gets noticed.
- The order of the card matters, and cards are built from slots, not minutes.
- A loss in a hot storyline doesn't sour the wrestler.
- Season length is yours, and the world can be shared with friends later.
- It runs in a browser, works on a phone, and keeps saves on your machine.

## Numbers

- Numbered design decisions: 10 (D-01 to D-10), plus 8 defaults
- Epics on the board: 5 (FND, SIM, WLD, UI, BLOG)
- Planned tickets in those epics: 63 (FND 13, SIM 13, WLD 12, UI 14, BLOG 11)
- Open design questions: 4
- Game code: none yet

## What went wrong or surprised me

Nothing has broken, because nothing runs yet. The surprise was how much followed from one goal:
once every number had to explain itself, pure formulas, traces, tunables and the seeded RNG came
with it.

## Open questions

See "Still open" above.

## Blog angle

Part 1, "Why I'm building a wrestling booking sim", for readers who don't program:

- **The itch.** Booking a fantasy card, getting a rating back and having no idea why.
- **The goals.** Every number explains itself; same seed, same result; rivals on visible rules;
  content as data.
- **Why browser and phone.** Nothing to install, saves stay local, a file carries a game from
  desktop to phone, and the simulation never freezes the page.
- **Why build in public.** The repo, this journal and a post per milestone keep me honest, and the
  decisions above are the story: later posts show which ones held.

## Raw notes

Nothing this time.

## Next

Foundation (FND) and Simulation core (SIM): branded IDs, the World store, the seeded RNG and the
tunables registry come first. Blog part 1 gets outlined from this entry (BLOG-08).
