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

## [0.1.0-alpha.2] - 2026-11-20

### Added

- I added an update check. When a new version is out, a quiet "Update available" chip shows on the
  title screen and in Settings › About. Download and install saves your game, updates it in place
  and keeps your saves. You can turn the check off in Settings › About.
- I added your own shows. On the Calendar (or your promotion's Shows tab), New show adds a weekly
  or recurring show or a one-off special, and Manage shows edits or retires them. Before you save,
  it shows which dates move, and shows you've already booked stay put.
- I added "Offer a different job" in contract talks. Ask a veteran wrestler to become a manager or
  announcer, or a manager to step into the ring. They decide, and the Why? says why.

### Fixed

- Workshop world imports put promotions and people in the right country and region. Before, many
  landed in the biggest region of their continent.
- Workshop world imports keep yearly shows whose dates were in the year before your start date.
  The import report now says why any show was left out.
- Workshop world imports keep part-time wrestlers as wrestlers. Before, some came in as managers.

## [0.1.0-alpha.1] - 2026-11-20

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
- I added my league's wrestlers to the default world. Two promotions are now SLW (Szn League
  Wrestling) and BLX, with the league's titles, weekly shows and PPVs, and each wrestler's
  moves and bio where the league has them.
- I added an installer. It puts the game in your Start menu, updates in place when you run a
  newer one, and keeps your saves when you uninstall.
- I added a crash screen. If the game's engine stops, nothing overwrites your last good save,
  and you can reload, load a backup or start safe.
- I added Send feedback. It packs a bug report and opens an email to me with the version
  filled in.
- I added backups. Every save keeps up to five earlier copies you can go back to, and the top
  bar shows when the game last saved.
- I added Help: short articles for the main screens, a "?" on each screen, a welcome sheet for
  new games and a Getting started list in the Office.
- I added Choose a folder… to the workshop import, so you can play a mod from any folder, not
  just Steam's.
- I gave the game its own ring icon.

### Changed

- I gave every screen a new broadcast look: matchup cards, portrait cards, compact tables with
  a column picker, and a ticker along the top.
- I made match lengths Short, Standard or Long with a Time used bar for the show. There are no
  minutes anywhere (D-10).

### Heads up

- This is an early test build. Saves may need a fresh start between versions.
- The Inbox, Teams & Stables, Tournaments and Brands screens are still placeholders.
- The game isn't signed yet, so Windows may say "Windows protected your PC". Choose More info,
  then Run anyway.
