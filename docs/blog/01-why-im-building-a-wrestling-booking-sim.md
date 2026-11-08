---
title: "Why I'm building a wrestling booking sim"
slug: ringside-booker-01-why-im-building-a-wrestling-booking-sim
series: ringside-booker
part: 1
status: outline
excerpt: "I booked a fantasy card, got a rating back and had no idea why. So I'm building a booking sim where every number explains itself."
tags: [gamedev, typescript, react, simulation]
journal: [docs/dev-journal/2026-11-project-kickoff.md]
---

<!--
Outline for part 1. Every section below is bullet beats, not prose. BLOG-09 turns
them into the post. Part 1 is about why and the principles, not code: it should
work for someone who has never written a line of TypeScript. Code-heavy material
waits for part 2.

Each section names what it draws from in a "Draws from" comment:
- the kickoff entry is docs/dev-journal/2026-11-project-kickoff.md
- the architecture doc is docs/design/architecture.md
- design decisions are docs/design/design-decisions.md, cited by D-NN ID
-->

<!--
check at writing time: verify these against the repo before BLOG-09 and describe
anything not built yet as planned, not as done.
- Stack versions. At outline time the repo pins TypeScript 5.9, Vitest 3.2 and
  zod 4.6. React, React Router, Vite, Comlink, idb and Playwright are not
  installed yet. Use the versions in package.json on the day of writing, or
  leave versions out of the table.
- Playwright phone tests. At outline time there is no Playwright config and no
  390px phone project. If that is still true, say the phone layout "will be"
  tested at 390px.
- The Why? panel. At outline time there is no UI and no trace type in the
  engine yet. If the panel still doesn't exist, the 3.5-star example is a
  sketch of the plan, and the post says so.
- The Web Worker host and IndexedDB saves. Not built at outline time. Same rule.
- The .rbsave export. Not built at outline time. Same rule.
- The "level playing field" switch. Planned by D-01, not built at outline time.
- What is actually on main: seeded RNG with named streams (SIM-01), tunables
  registry (SIM-04), branded IDs, game dates and money (FND-03). Only these can
  be described as working, plus whatever has landed since.
- Counts quoted from the kickoff entry (10 decisions, 5 epics, 63 tickets) may
  have moved. Re-count or drop them.
- The diagram file docs/blog/images/01/loop.svg exists, is my own drawing, has
  only fictional or generic labels, and is merged to main before the post is
  pushed (images resolve from the main branch).
- Every link to the repo resolves on main.
-->

<!-- Hook: one paragraph, no heading.
Draws from: kickoff entry, "Blog angle" (the itch) and "Summary". -->

- The moment: I booked a fantasy card in a booking game, a mid-card match came back
  at a rating I didn't expect, and nothing on the screen could tell me why. Was it the
  wrestlers, the order, the crowd, a dice roll? I couldn't learn from it, so I couldn't
  get better at booking.
- That's the itch: I want a booking game where I can always ask "why?" and get an
  answer.
- One-line pitch: Ringside Booker is a wrestling promotion sim where you book one
  promotion, the rest of the world runs itself around you, and it all runs in your
  browser.
- Set expectations: this is part 1 of a series written while I build it. It's about
  why and what I'm aiming for. No code yet.

## What a booking sim actually is

<!-- Draws from: kickoff entry, "Summary" and "Decisions and why" (D-02, D-04, D-10);
architecture doc, opening paragraph and "The day pipeline". -->

- For anyone who has never played one: you're the person backstage deciding who
  wrestles whom, in what order, and who wins. You don't play the matches. You book
  them and watch what happens.
- The loop in plain words, one beat per step:
  - you book a card: who's on it, what they do, in what order, who wins
  - each match and talking segment gets rated
  - the whole show gets a score, and the order of the card matters as much as the
    best match on it (D-04)
  - the show moves popularity: of the wrestlers, of the titles, of the promotion
  - popularity and hype bring crowds, TV viewers and sponsors (D-02)
  - those bring money
  - money buys a better roster and better production
  - which makes better shows possible, and round it goes
- The twist that makes it a world and not a puzzle: every other promotion runs the
  same loop without you. Rivals book their own shows, sign wrestlers, and compete for
  the same fans and the same free agents.
- Cards are built from slots, not minutes: opener, mid-card, main event. Where a
  segment sits decides how much it counts. Mention this lightly here; it comes back in
  "Building it in the open" (D-10).
- Diagram (planned, to draw before BLOG-09): `docs/blog/images/01/loop.svg`, my own
  drawing. A circle of eight boxes with arrows: Book a card → Matches rated → Show
  scored → Popularity moves → Crowds, TV and sponsors → Money → Roster and production
  → Better shows → back to Book a card. A dashed outer ring labelled "Every rival
  promotion runs the same loop". Generic labels only, no names of wrestlers,
  promotions or titles.
  - Alt text: "A loop diagram. Book a card leads to matches being rated, the show
    being scored, popularity moving, crowds, TV and sponsors, money, roster and
    production, and better shows, which leads back to booking the next card. A dashed
    ring around it says every rival promotion runs the same loop."

## What I love about the genre, and what bugs me

<!-- Draws from: kickoff entry, "How this differs from other games in the genre" and
"Defaults taken without a separate decision"; design decisions, "Defaults taken
without a separate decision". Rule for this section: talk about "other games in the
genre" in general and nothing more specific. No names, no formulas, no screenshots. -->

- What I love, briefly: the fantasy of running the show, the stories that come out of
  a long save, the satisfaction of a card that clicks. That's why I keep coming back
  to the genre.
- What bugs me, beat 1: numbers you can't see behind. In other games in the genre a
  rating, an attendance figure or a wage demand often arrives with no way to see what
  went into it. I end up guessing, and guessing isn't booking.
- What bugs me, beat 2: computer-run rivals that bend the rules without telling you.
  Rivals often have to take shortcuts so the game stays fast, and that's fine, but
  when it's hidden it feels like cheating and you can't tell a real rival from a
  rigged one.
- What bugs me, beat 3: stats that look important but do nothing. A number on a
  profile screen that never feeds into anything teaches you to care about the wrong
  things.
- Turn: each of these became a rule for my version (next section). Keep the tone
  fond, not a takedown.

## Five rules for my version

<!-- Draws from: architecture doc, "Goals" (all five, in order); kickoff entry,
"Decisions and why" for the examples (`Traced<T>`, seeded RNG, D-01, desktop first with
a 390px phone layout, content and balance as data). One short paragraph per rule,
each with one example a reader can picture. -->

- Rule 1, every number explains itself. Every rating, crowd figure, popularity change
  and wage demand comes with a breakdown. If I can't explain a number, it doesn't
  ship.
  - Example: a "Why?" button next to a 3.5-star match rating. Tap it and you see how
    good the wrestlers were together, how the crowd reacted against what it expected,
    what the slot on the card did, and the one random roll with its range and result.
- Rule 2, deterministic. Same save, same seed, same choices give the same result,
  every time.
  - Example: book the same card twice from the same save and get the same 3.5 stars
    both times. A bug report becomes "here's my save, press this", and I can watch it
    happen. Randomness is still there, it's just repeatable.
- Rule 3, one engine for everyone, with a lighter path for rivals that's labelled out
  loud. Rival shows run through the same formulas as yours, but skip a few
  player-only systems so long skips stay fast. Every shortcut is a named setting, and
  a "level playing field" switch at new game turns them all off (D-01).
  - Example: open a rival's show and its rating has the same "Why?" panel as yours,
    with a line saying which shortcut applied, like "rival shortcut: no in-match
    injuries (on)".
- Rule 4, desktop first, but playable on a phone. Booking is dense, so screens are
  designed for a desktop window, and every screen also gets a phone layout. Nothing is
  desktop-only.
  - Example: the roster is a wide sortable table on desktop and a stack of cards at
    phone width, so I can check last night's show on the bus.
- Rule 5, data, not code, for content. Wrestlers, promotions, titles, events and
  balance numbers are data files that can be edited and shared as packs. The world
  the game ships with is just the first pack.
  - Example: change how much a loss stings, or rename a fictional champion, by
    editing a file. No rebuild, and you can send a whole world to a friend.
- Close the section with the line from the kickoff entry's "What went wrong or
  surprised me": once every number had to explain itself, a lot of the design
  followed from that one rule.

## Why the browser, and why no server (for now)

<!-- Draws from: kickoff entry, "Queries and commands across a Web Worker", "IndexedDB
saves with .rbsave export", "The engine as its own package", "Controllers, commands
and a viewer on every query" and D-07; architecture doc, "Persistence", "Engine API"
and "Controllers and commands (multiplayer-ready)". -->

- Nothing to install: open a page and play.
- Single-player saves stay on your machine, in the browser's own storage. No account,
  no cloud, nothing of yours on my server, because there is no server.
- Export a save as a file to carry a game from desktop to phone, or to keep a backup.
- Nothing to host for single-player, which also means nothing for me to keep running
  or pay for.
- The heavy simulation runs in a Web Worker, a background thread in the browser, so
  skipping a month or running every rival's show never freezes the page.
- Later: online play with friends, as an extra mode. Turn-based: everyone books, hits
  Ready, and the world moves on. That needs a small backend, and it comes after
  single-player is fun (D-07). Single-player stays fully offline.
- Why that matters now: to be ready for it, the engine has no browser dependencies
  (the same code can run on a server later) and every action you take is a command
  from day one, so a second human player isn't a rewrite.

## The stack, briefly

<!-- Draws from: architecture doc, "Stack"; kickoff entry, "The rest of the stack". Keep
it to six rows and one line of why each. Versions per the check at writing time
comment above. Link: https://github.com/jpDxsoloOrg/ringside-booker/blob/main/docs/design/architecture.md -->

- Lead-in beat: tools I already know, so the risk stays in the simulation and not the
  toolchain.
- The table, six rows:

| Tool                                   | Why                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| TypeScript, strict, no `any`           | The engine is the riskiest code and needs types the most                     |
| React + Vite                           | What I already use, with a fast dev server and Web Worker support built in   |
| Vitest                                 | Fast tests for every formula, at its edges                                   |
| zod                                    | One schema gives types and runtime checks for saves, data packs and settings |
| IndexedDB                              | Room for big saves in the browser, and a file export to move them            |
| Playwright with a phone-sized viewport | The phone layout gets tested, not assumed                                    |

- Link to the architecture doc in the repo for the full list (UI state, worker
  messaging, linting, CI).

## Building it in the open

<!-- Draws from: kickoff entry, "Blog angle" (why build in public) and the decision
headings for D-08 and D-10; docs/blog/README.md and docs/dev-journal/README.md for
the cadence; design decisions for the IDs. -->

- The repo is public, and so is the dev journal I write as I go. Link both:
  https://github.com/jpDxsoloOrg/ringside-booker and its docs/dev-journal folder.
- One post per milestone, plus deep dives on the systems I think are interesting:
  randomness that stays repeatable, calculation traces behind the "Why?" panel, and
  how a match gets its rating.
- The design decisions that shape the game are written down with IDs, so posts can
  point back to them. Link design-decisions.md. Two examples:
  - cards are built from slots, not minutes: you never type a match length, the slot
    decides the time and weight (D-10)
  - season length is yours: one month for a quick game with friends, a full year
    for a dynasty, while aging and contracts stay on the real calendar (D-08)
- Building in public keeps me honest: later posts will show which of these calls held
  up and which didn't.
- Everything in the game is fictional, from the wrestlers' names to the belts and the
  promotions. No real wrestlers and no real promotions, anywhere.

## What's next

<!-- Draws from: kickoff entry, "Next"; docs/blog/README.md, series index row for
part 2. -->

- Part 2 is the foundations: the one World that holds the whole game, days that
  always play out the same way from the same start, and the traces that will power
  the "Why?" panel.
- Link placeholder: the series index (docs/blog/README.md#series-index) until part 2
  has a URL on the blog.
- Sign-off beat: if you've ever booked a card and wondered why it scored what it did,
  this series is for you.
