# Owner test, Sprint U2: every screen on the new design

How to test the Sprint U2 Windows build (UNITY-22). Play it like a player. Note anything that
feels wrong, slow, cluttered or missing, and the screen it was on. The notes become Sprint U3
tickets.

## 1. Get the build

- Zip: `F:\source\rb-wt\UNITY-22\game\Builds\RingsideBooker-<version>-win64.zip` (about 53 MB).
  `<version>` is `0.1.0-u1+<commit>`. The title screen shows it bottom left, and `version.txt` in
  the folder says the same.
- Unzip it anywhere, open the folder and run `RingsideBooker.exe`. Windows may warn about an
  unknown publisher, because the build is not signed. Choose "More info", then "Run anyway".
- Saves live in `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves`. Delete that
  folder to start from nothing.

Start a **new game on the default world** and take over a promotion. Sections 2 to 5 use it.
Section 6 founds a new promotion instead, and section 7 uses your workshop world mod.

## 2. Office (Dashboard)

- [ ] Try: read the page top to bottom, then press each action in **Needs you today** and each
      "Open the card", "All news", "Finances" and "Roster" link.
- Good: the lead story, the next show, top stories, money, power rankings and standings fit
  without overlapping. Each action lands on the right screen. Nothing shows minutes.

## 3. Your promotion

- [ ] **Roster**: switch between cards and table, open a row's details, change columns with the
      column button, filter, then Set push.
  - Good: tidy rows, and the headers sit over their columns.
- [ ] **Roster › Injuries**: when the day button says **Roster** (someone was hurt), press it.
  - Good: you land on the Injuries tab and the day can move again.
- [ ] **Booking**: AUTO-FILL, then press a slot, MORE OPTIONS, EDIT MATCH and the venue picker.
      Drag a slot to reorder, and open the card check pill.
  - Good: lengths say Short, Standard or Long, the Time used bar is filled, and a show night has
    **one Go live button**: the red one top right. The header just says "Go live with the day
    button, top right".
- [ ] **Show night**: Run the next segment, then Sim the rest, then See results.
  - Good: the running order updates and nothing is cut off.
- [ ] **Results**: open the Why? panels, the key changes and Back to the office.
  - Good: the score, stars, crowd and money read clearly.
- [ ] **Calendar**: this month, the next month, Whole world, and open a show.
- [ ] **Match lab**: pick two wrestlers and Run, then run x50. Open "More options" and Angle mode.
  - Good: the results say who won and why, the odds look sensible, and nothing changes in your
    world.

## 4. The world, creative and business screens

- [ ] **Workers** and a worker's profile (Overview, Career, Health, Contract, Form tabs).
- [ ] **Promotions** and a promotion's page (Roster, Shows, Titles, Decisions). **Event
      history**.
- [ ] **Titles**: open a title, award it, vacate it, then make a new one.
  - Good: the lineage table lines up and confirms ask before they act.
- [ ] **Storylines**: create one, add people, follow its timeline and heat, then end one.
- [ ] **Contracts**: try every tab. Make a low offer to a free agent and read the answer, then
      open a contract and Release (cancel at the preview).
  - Good: when a contract stop holds the day, the day button lands here and clears it here.
- [ ] **News**: the front page, the feed, filters and kinds. Open a story, then the alert settings.
  - Good: long headlines wrap and never run under the × button. The News badge clears once read.
- [ ] **Finances**: Overview, Ledger (filter by month and category) and Policies. On the Overview,
      open **Last 12 months** at the bottom.
  - Good: it is closed at first. Open, it shows income, costs, Net and Closing cash for each
    month, with dashes before the game started. Pressing an amount opens those rows in the
    Ledger.
- [ ] **Production**: preview raising or cutting a level (don't confirm unless you want to).
- [ ] **Networks**: a deal's sheet, Renegotiate, Cancel (back out), Available networks and a
      proposal.
- [ ] Every screen: hover the quiet "?" marks for Why?, and collapse the sidebar with Ctrl+B.
  - Good: no text overlaps, nothing is clipped, and no minutes or clock times anywhere.

## 5. Play a month

- [ ] Use Next day and Skip days (») for a month: book and run every show, at least one by hand.
- Good: the day never gets stuck. Every stop's button goes to its screen (Booking, Roster ›
  Injuries, Contracts, News) and clears there. Anything left opens **Needs attention**. If the
  day does get stuck, note the stop's words.

## 6. Found a new promotion

- [ ] New game, choose **Found a new promotion**, name it and start.
- Good: you start with nobody under contract, because signing people is the challenge. The Office
  says **Sign some wrestlers first** with **Find free agents**, and so do Booking (a line under
  the header and the card check) and Auto-fill. Find free agents opens Contracts on the Free
  agents tab. Sign a few people, then book and run the first show.

## 7. Your workshop world mod

- [ ] New game, import your mod With pictures, start, and play a week.
- Good: portraits and logos show on Roster, Booking, Results, Workers, Promotions and News.
  Names are cut with "…" rather than overlapping. Skipping a week takes seconds, not minutes.

## Known missing in this build

- **Placeholders:** Inbox, Teams & Stables, Tournaments and Brands still show a placeholder.
- No sound, no 3D, Windows only.

## What was checked before handing over

- `game/tools/unity-compile.sh` (clean), the new EditMode tests (Business and Screens) and
  `game/tools/package-windows.sh`.
- The packaged build passed `-rbSkipCheck 30` on the default world and on your workshop world.
  Injury stops landed on Roster › Injuries and cleared there.
- Every screen tour on the packaged build at 1920×1080 (default world), checked by eye:
  loop, founded promotion, world, contracts, business, creative, news and Match lab.
