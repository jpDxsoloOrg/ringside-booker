# Changelog

What changed in Ringside Booker, build by build. I write these notes myself, for the people
playing the game.

How I write an entry:

- One line per change a player can see, in the first person and the past tense ("I added…").
- Plain words before numbers. No other games and no real wrestling names; the worlds are
  fictional.
- Decisions are cited as `D-NN` when one explains the change.
- New lines go under `## Unreleased`. `game/tools/release.sh` dates that section when I cut a
  release.
- Each release is `## [x.y.z-alpha.N] - YYYY-MM-DD` with any of `### Added`, `### Changed`,
  `### Fixed`, `### Balance` and `### Heads up`.

## Unreleased

### Added

- I turned Ringside Booker into a Windows game. The whole simulation from the web version runs
  inside it, so worlds, shows and results behave the same.
- I added a title screen with New game, Continue, Load and Settings, and saves that live in
  files on your computer instead of the browser.
- I added a new game wizard: take over a promotion in the default world, or found your own and
  pick its name, home and style.
- I added workshop world mods. Point the game at a mod's folder and play in that world, with
  its pictures and logos.
- I added the day button and Skip days. The day stops when something needs you, and its button
  takes you to the screen that clears the stop.
- I added the Office, Roster, Booking, Show night, Results and Calendar screens, so you can run
  a full week of shows from start to finish.
- I added Contracts, Titles, Storylines, News, Finances, Production and Networks, and the world
  screens for workers, promotions and event history.
- I added the Match lab: pick two wrestlers, run the match once or fifty times, and see who wins
  and why. Nothing in your world changes.
- I added Why? on hover for ratings, money and results, so you can see what made a number.
- I added a UI scale setting and window options, so the game reads well from 1280×720 up to
  4K.
- I added an ALPHA badge, the version on the title screen and in Settings › About, and this
  What's new sheet.

### Changed

- I gave every screen a new broadcast look: matchup cards, portrait cards, compact tables with
  a column picker, and a ticker along the top.
- I made match lengths Short, Standard or Long with a Time used bar for the show. There are no
  minutes anywhere (D-10).

### Heads up

- This is an early test build. Saves may need a fresh start between versions.
- The Inbox, Teams & Stables, Tournaments and Brands screens are still placeholders.
