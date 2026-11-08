---
title: "Why I'm building a wrestling booking sim"
slug: ringside-booker-01-why-im-building-a-wrestling-booking-sim
series: ringside-booker
part: 1
status: draft
excerpt:
  "I booked a fantasy card, got a rating back and had no idea why. So I'm building a booking sim
  where every number explains itself."
tags: [gamedev, typescript, react, simulation]
journal: [docs/dev-journal/2026-11-project-kickoff.md]
---

I booked a fantasy wrestling show in a management game, ran it, and watched a mid-card match come
back with a rating I didn't expect. Was it the wrestlers? The order of the matches? The crowd? A bad
dice roll? Nothing on the screen could tell me, so I couldn't learn from it, and I couldn't get
better at the game. That's the itch: I want a booking game where I can always ask "why?" and get an
answer. So I'm building one. Ringside Booker is a wrestling promotion sim where you run one
promotion, the rest of the world runs itself around you, and it all happens in your browser.

This is part 1 of a series I'm writing while I build it. It's about why, and what I'm aiming for.
There's no code in this one.

## What a booking sim actually is

First, some words. A **promotion** is a company that puts on wrestling shows. A **card** is the list
of matches and talking segments on one show. The **booker** is the person backstage who decides who
wrestles whom, in what order, and who wins. In a booking sim you are the booker. You don't play the
matches. You book them and watch what happens.

The loop goes like this:

1. You book a card: who's on it, in what order, and who wins.
2. Each match and talking segment gets a rating.
3. The whole show gets a score, and the order of the card matters as much as the best match on it.
4. The show moves popularity: the wrestlers', the titles' and the promotion's.
5. Popularity and hype bring in crowds, TV viewers and sponsors.
6. Those bring in money.
7. Money buys a better roster and better production.
8. Which makes better shows possible, and round it goes.

![A loop diagram. Book a card leads to matches being rated, the show being scored, popularity moving, crowds, TV and sponsors, money, roster and production, and better shows, which leads back to booking the next card. A dashed ring around it says every rival promotion runs the same loop.](images/01/loop.svg)

Two of those steps are written-down design decisions. Card order matters (D-04): placing the opener
and the main event is the skill of booking, or the booking screen is just a list. And hype links the
crowd to the money (D-02): a crowd judges a match against what it expected, popularity sells
tickets, and hype connects the two, so booking well turns into selling more.

The twist that makes it a world and not a puzzle is that every other promotion runs the same loop
without you. Rivals book their own shows, sign wrestlers, and compete with you for the same fans and
free agents.

One more thing: cards are built from slots, not minutes. Where a segment sits, from the opener to
the main event, decides how much it counts.

## What I love about the genre, and what bugs me

I keep coming back to booking sims for the same reasons: the fantasy of running the show, the
stories that come out of a long save, and the feeling when a card just clicks. A wrestler you signed
cheap ends up in your main event years later, and you remember every step.

Three things bug me, though.

First, numbers I can't see behind. In other games in the genre, a rating, a crowd figure or a wage
demand often arrives with no way to see what went into it. I end up guessing, and guessing isn't
booking.

Second, computer-run rivals that bend the rules without telling me. Rivals need shortcuts to keep
the game fast, but hidden ones feel like cheating, and I can't tell a strong rival from a rigged
one.

Third, stats that look important but do nothing. A number on a profile screen that never feeds into
anything teaches me to care about the wrong things.

I still love the genre. Each of those just became a rule for mine.

## Five rules for my version

**1. Every number explains itself.** Every rating, crowd figure, popularity change and wage demand
comes with a breakdown. If I can't explain a number, it doesn't ship. The plan for a match: next to
a 3.5-star rating there'll be a "Why?" button. Tap it to see how well the wrestlers worked together,
how the crowd reacted against what it expected, what the slot on the card did, and the one random
roll, with its range and result. The panel doesn't exist yet, but its plumbing does: the engine has
a type for a value that carries a record of how it was worked out, and every formula will return
one.

**2. Deterministic.** The same save, the same seed (the starting number all the game's randomness
grows from) and the same choices give the same result. Book the same card twice from the same save
and you get the same 3.5 stars both times. Randomness is still there; it's just repeatable. A bug
report becomes "here's my save, press this", and I can watch the bug happen. The seeded randomness
was one of the first things I built, and it works.

**3. One engine for everyone, with a lighter path for rivals that's labelled out loud.** Rival shows
go through the same formulas as yours, but skip a few player-only systems, like injuries during a
match, so long skips stay fast (D-01). Every shortcut is a named setting, and a "level playing
field" switch at new game will turn them all off. A rival's show rating gets the same Why? panel as
yours, with a line saying which shortcut applied, such as "rival shortcut: no in-match injuries
(on)".

**4. Desktop first, but playable on a phone.** Booking is dense, so screens are designed for a
desktop window first, but every screen also gets a phone layout. The roster will be a wide sortable
table on a desktop and a stack of cards on a phone, so I can check last night's show on the bus. The
table component behind it is built, and automated tests check it at 390 pixels wide.

**5. Data, not code, for content.** Wrestlers, promotions, titles, events and balance numbers are
data files that can be edited and shared as packs. The world the game ships with will just be the
first pack. Want a loss to sting less, or a fictional champion with a new name? Edit a file. No
rebuild, and you can send a whole world to a friend.

Writing these down surprised me. Once every number had to explain itself, a lot of the design
followed: pure formulas, traces, a setting for every balance number, and randomness I can replay.

## Why the browser, and why no server (for now)

You open Ringside Booker in a browser tab and play. Nothing to install.

Single-player saves will stay on your machine, in the browser's own storage. No account, no cloud,
and nothing of yours on my server, because there is no server. To move a game from desktop to phone,
or keep a backup, you'll export the save as a file. The save file format is written; the storage and
the export button arrive with the save screens.

No server also means nothing for me to host or pay for, which matters for a side project.

The heavy simulation will run in a Web Worker, a background thread in the browser, so a month-long
skip won't freeze the page.

Later, I want online play with friends as an extra mode (D-07). It'll be turn-based: everyone books,
hits Ready, and the world moves on. That needs a small backend, and it comes after single-player is
fun. Single-player stays fully offline.

Planning for it already shapes the code. The engine has no browser dependencies, so it can run on a
server later. Every promotion has a controller, a human or the computer, and every action a player
takes will be a command that records who issued it. A second human player shouldn't mean a rewrite.

## The stack, briefly

I picked tools I already know, so the risk stays in the simulation and not in the toolchain.

| Tool                                   | Why                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| TypeScript, strict, no `any`           | The engine is the riskiest code and needs types the most                     |
| React + Vite                           | What I already use, with a fast dev server and Web Worker support built in   |
| Vitest                                 | Fast tests for every formula, at its edges                                   |
| zod                                    | One schema gives types and runtime checks for saves, data packs and settings |
| IndexedDB (arrives with saves)         | Room for big saves in the browser, and a file export to move them            |
| Playwright with a phone-sized viewport | The phone layout gets tested, not assumed                                    |

In plain words: a typed language, a UI library, a test runner, a data checker, the browser's
storage, and a robot that clicks through the game at phone size. The full list is in the
[architecture doc](../design/architecture.md).

## Building it in the open

The [repo](https://github.com/jpDxsoloOrg/ringside-booker) is public, and so is the
[dev journal](../dev-journal/README.md) I keep as I go.

The plan is one post per milestone, plus deep dives on the systems I find interesting: randomness
that stays repeatable, the calculation traces behind the Why? panel, and how a match gets its
rating.

The design decisions are written down with IDs in
[design-decisions.md](../design/design-decisions.md), so posts can point back to them. Two examples:

- **Cards are built from slots, not minutes (D-10).** You never type a match length. The slot
  decides the time and the weight, and the main event is always the longest and heaviest.
- **Season length is yours (D-08).** One month for a quick game with friends, a full year for a
  dynasty. Aging and contracts stay on the real calendar, so a short season doesn't make anyone get
  old faster.

Building in public keeps me honest: later posts will show which of these calls held up.

Everything in the game is fictional: the wrestlers, the belts and the promotions. No real wrestlers
or promotions, anywhere.

## What's next

Part 2 is the foundations: the one World that holds the whole game, days that always play out the
same way from the same start, and the traces that will power the Why? panel. It'll be on the
[series index](/blog/ringside-booker-series) when it's ready.

If you've ever booked a card and wondered why it scored what it did, this series is for you.
