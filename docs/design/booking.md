# Booking

Booking is putting matches and angles on a show's card. The calendar
([calendar.md](calendar.md)) makes the dated shows; this system fills them. The
code is in `packages/engine/src/systems/booking/`.

So far (EVT2-01) this is the engine core every later booking ticket stands on:
the rules for what a card may hold while it is being built, who may read and
edit a card, the segment draft an editor fills in and the **card writer**, the
one way segments are written. The commands, queries and screen come with the
rest of EVT2. Nothing here is random, so the system has no RNG stream.

## The card model

A show's card has a fixed number of slots, copied from its definition's format
when the show is scheduled: `format.slots` on the main card and
`format.preShowSlots` on the pre-show. Every slot exists from the start; any of
them may be **open**. A booker can put the main event in first and leave slot 3
open until later.

- A segment stores only its section (`preShow`) and its `slot`. Each section
  numbers from 0, and open slots are simply absent: there is no row for an open
  slot. The invariant `segments.slotOutsideFormat` keeps every slot below the
  section's slot count, and the unique `bySlot` index refuses two segments in
  one slot.
- A slot's role (opener, midcard, main event) comes from its position in the
  format, never from how many segments the card has (D-10). Filling slot 2
  does not change what slot 5 is.
- **Storage is 0-based, display is 1-based.** `slot: 0` is shown as "Slot 1".
  MTCH1's `slotRoleOf` takes 1-based slots, so the conversion happens in
  exactly one place, the card view (EVT2-03). The writer's messages already
  speak in 1-based slots ("Slot 7 doesn't exist on this show").
- **Moves swap.** Moving a segment to an open slot just moves it; moving it to a
  filled slot makes the two trade places. Moves across sections are allowed when
  the target slot exists. With open slots in the middle of a card, inserting and
  shifting would make a gap travel down the card; a swap is predictable and maps
  one-to-one to Move up / Move down and to a swapping drag.
- Removing a segment leaves its slot open. Nothing is ever renumbered.

`cardSegments(read, eventInstanceId)` lists a card in running order: the
pre-show first, then the main card, each by slot. `hasCard` says whether any
segment is booked. Queries, the show night (EVT3), the results page (EVT8) and
the rival booker (AIP4) all read cards through these two.

Before EVT2-01 a card was only ever written once, whole, after the show, and
the invariant `segments.slotsNotContiguous` asked for slots 0..n-1 with no
gaps. A save holding a card mid-build would have failed to load, so the rule
became `segments.slotOutsideFormat`. The shape of the data did not change, so
old saves still load.

## Planned results

The booker decides who wins. The plan is stored in the match's `outcome`, the
same field the show writes its result to:

- while the show is `scheduled` or `booked`, `outcome` is the **planned
  result**, or `null` when the match is decided on the night;
- once the show is `completed`, it is the result that happened (EVT3 writes it).

One field keeps one source of truth for the show night, MTCH2's planned finish,
the rival booker and the results page. A separate `plannedOutcome` field would
have needed a schema change and a migration for no gain. The invariant
`segments.resultBeforeCompletion` now covers only `rating`, which still exists
only once the show has run. The card writer always writes `rating: null`.

## Who may edit a show

Whose show it is lives in one place, the calendar's `control.ts`
([calendar.md](calendar.md#who-controls-a-show)): a show with a brand that has
its own controller is run by that brand's controller, and every other show by
its promotion's controller. Booking code never reads a `controller` field
itself; `booking/control.ts` adds only the booking rules on top:

- `canReadCard(read, viewer, show)`: the omniscient viewer (tools, tests and the
  sandbox setting) reads every card; a controller reads the cards of the shows
  it runs.
- `editBlockOf(read, show, today)`: why the card cannot change, or `null`. The
  first rule that fails is returned:

| Code            | When                     | Message                          |
| --------------- | ------------------------ | -------------------------------- |
| `showCompleted` | the show has run         | "This show has already run"      |
| `showCancelled` | the show was cancelled   | "This show was cancelled"        |
| `showPast`      | its date is before today | "This show has already happened" |

There is no lock (EVT2-09): a card stays editable until its show has run, today's show included.
A `booked` show, which only a save made before EVT2-09 can hold for a player's show, is as open as
a `scheduled` one.

## The card writer

`booking/writer.ts` is the one way segments and their participants are put on,
changed on and taken off a card. The booking commands (EVT2-02) call it after
checking who is asking; the rival booker (AIP4) calls it from its phase, so
player and computer cards are written the same way. Every function takes a step
transaction (`tx` of a phase, a reaction or a command's `apply`).

**Commands check permission, the writer checks structure.** A command asks the
calendar whether the issuer runs the show and asks `editBlockOf` whether the
card can change. The writer then checks the write itself with
`structuralProblems(read, { instance, draft, target })` and throws
`CardWriteError` (carrying the same player-facing reasons) if anything is
wrong. Commands run `structuralProblems` in their `validate` too, so a player
sees the reasons and the throw is only a safety net. Each write also runs in a
savepoint of its own: a write happens whole or not at all, even if the caller
catches the error and carries on.

| Function                                                                  | What it does                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `writeSegment(tx, { eventInstanceId, preShow, slot, draft, segmentId? })` | Adds a segment, or replaces `segmentId` in place: it keeps its id even when it changes from a match to an angle. Returns the id. |
| `removeSegment(tx, segmentId)`                                            | Deletes the participants, then the segment. The slot becomes open.                                                               |
| `clearCard(tx, eventInstanceId)`                                          | Removes every segment on the card and returns their ids in running order.                                                        |
| `setPlannedOutcome(tx, segmentId, outcome)`                               | Sets a match's planned result, or clears it with `null`.                                                                         |
| `moveSegment(tx, segmentId, { preShow, slot })`                           | Moves with swap semantics and returns `{ swappedWith }`.                                                                         |

Participants are diffed by person, so their row ids are stable: people already
on the segment keep their row (side, role and team are updated if they
changed), people no longer in the draft are deleted, and new people are created
in person id order. The same calls in the same order always give the same ids.

An angle draft without `beats` gets its type's default beat
(`angleTypeOf(read, key).defaultBeatKey`), spoken by the angle's speakers in
side order, then person id order. MTCH5's editor section replaces this.

A move runs in the savepoint `booking.moveSegment`. It first parks the moving
segment at `PARK_SLOT` (10 000, far past any real slot), then sends the occupant
of the target slot (if any) to where the moving segment was, then lands the
moving segment. The unique `bySlot` index never sees two segments in one slot,
and a throw rolls back only the move.

### Drafts

A draft (`booking/draft.ts`) is a segment without its place on the card, its id
or its rating, plus its participants (`{ personId, side, role, teamId }`). It
is a zod union on `kind`. The parts later editor sections own default, so the
first editor can leave them out: `storylineIds` (empty), `crew` (nobody),
`stipulationKeys` and `titleIds` (empty) and `finishKey` (`null`, decided on
the night). `draftFromSegment(read, segmentId)` turns a segment on a card back
into a draft, the editor's starting point; writing it back unchanged leaves the
segment as it was.

### Structural problems

These are the rules the writer refuses, because breaking them would break an
invariant or point at nothing. Softer problems (a wrestler on the card twice,
uneven sides, a title match of the wrong type) are warnings for the booking
checks of EVT2-04, not refusals.

| Code                      | Refused when                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `slotOutsideFormat`       | the slot is not on the show's format                               |
| `slotTaken`               | another segment is in the slot                                     |
| `unknownMatchType`        | the match type is not in the catalog, or is hidden (\*)            |
| `unknownAngleType`        | the angle type is not in the catalog, or is hidden (\*)            |
| `unknownMethod`           | a planned win's method is not in the catalog, or is hidden (\*)    |
| `unknownPerson`           | a participant, crew member or beat speaker is not in the game      |
| `unknownStoryline`        | a storyline the segment is part of does not exist                  |
| `duplicatePerson`         | the same person is in the segment twice                            |
| `notOnRoster`             | a participant has no active contract with the show's promotion     |
| `teamMismatch`            | a participant is listed with a team they are not a member of       |
| `tooFewSides`             | a match has competitors on fewer than two sides                    |
| `winnerWithoutCompetitor` | the planned winning side has no competitor                         |
| `titleNotOurs`            | a title on the line does not exist or belongs to another promotion |
| `titleRetired`            | a title on the line has been retired                               |
| `notAMatch`               | `setPlannedOutcome` was given an angle                             |

(\*) A hidden type or method is allowed when the segment being replaced already
uses it, so an old card stays editable after a pack hides an entry.

Every message is written for the player and names the person, title or slot:
"Slot 7 doesn't exist on this show", "Kid Vega isn't on the Apex Wrestling
roster", "The Crown Title has been retired".

## Commands

Every card change a person makes is one of six commands (EVT2-02, D-07), so it
names the controller that issued it and lands in the command log. The code is
`booking/commands.ts`.

| Command                 | Arguments                                                | Returns           |
| ----------------------- | -------------------------------------------------------- | ----------------- |
| `booking.addSegment`    | `eventInstanceId`, `preShow`, `slot`, `draft`            | `{ segmentId }`   |
| `booking.updateSegment` | `segmentId`, `draft` (the whole draft)                   | `{ segmentId }`   |
| `booking.removeSegment` | `segmentId`                                              | `null`            |
| `booking.moveSegment`   | `segmentId`, `toPreShow`, `toSlot`                       | `{ swappedWith }` |
| `booking.setResult`     | `segmentId`, `result` (win, draw, no contest, or `null`) | `null`            |
| `booking.clearCard`     | `eventInstanceId`                                        | `{ removed }`     |

Slots are 0-based here, as stored. `updateSegment` takes the whole draft on
purpose: the editor sections other features add (finish, beats, stipulations,
crew, storylines) change only their part of the draft and save through it, so
there is one write path. A section that needs a field the draft does not carry
widens `SegmentDraftSchema` rather than adding a command. `setResult` is the
card row's quick winner menu; the segment editor sends the result inside its
draft.

Each command's `validate` asks the same questions in the same order, and the
first that fails is the only reason returned:

1. Does the show (or segment) exist?
2. Does the issuer run the show? This is the calendar's `controlsShow`: the
   brand's controller when the brand has one, otherwise the promotion's. GM
   brands and hot-seat brand wars need nothing extra.
3. Can the card still change? (`editBlockOf`, above.)
4. Is the change sound? (`structuralProblems`, the writer's rules.) A move only
   checks that the target slot exists; a result only checks the winning side
   and the method.

`apply` then calls the writer once, so the change is all or nothing, and
publishes one `card.changed { eventInstanceId, promotionId, brandId, segmentId,
change }`, where `change` is `added`, `updated`, `removed`, `moved`, `result`
or `cleared` (`segmentId` is null for `cleared`). A command that changes
nothing succeeds and publishes nothing: the same draft again, a move onto its
own slot, the result it already has, or clearing an empty card. Commands are
refused with `busy` while days are advancing.

### Refusals

The UI shows these messages as they are and never re-words them.

| Code                      | When                                                      | Player message                                                     |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `invalidArgs`             | the arguments do not parse (a negative slot, a bad id)    | names the field                                                    |
| `showNotFound`            | the show does not exist                                   | "That show no longer exists"                                       |
| `segmentNotFound`         | the segment does not exist                                | "That segment is no longer on the card"                            |
| `notYourShow`             | the issuer does not run the show                          | "Only the person running {brand or promotion} can book this show"  |
| `showCompleted`           | the show has run                                          | "This show has already run"                                        |
| `showCancelled`           | the show was cancelled                                    | "This show was cancelled"                                          |
| `showPast`                | its date is before today                                  | "This show has already happened"                                   |
| `slotOutsideFormat`       | add or move to a slot the format does not have            | "Slot 7 doesn't exist on this show"                                |
| `slotTaken`               | add to a filled slot                                      | "Slot 3 already has a segment"                                     |
| `notAMatch`               | `setResult` on an angle                                   | "Only a match has a result to plan"                                |
| `winnerWithoutCompetitor` | the planned winning side has no competitor                | "Side 3 has nobody wrestling, so it can't win"                     |
| `unknownMethod`           | the planned way of winning is not offered                 | "That way of winning isn't available"                              |
| `randomWinners`           | a planned result or finish on a Random winners show       | "Results on your shows are decided on the night (Random winners)." |
| other structural codes    | add or update with a draft the writer refuses (see above) | the writer's message, naming the person, title or slot             |

`notYourShow` names whoever runs the show: the brand when it has its own
controller, otherwise the promotion.

## Lifecycle

How a card meets the calendar's show lifecycle ([calendar.md](calendar.md#lifecycle)):

- **A card runs when its booker runs the show.** On the show's day the day
  stops (`shows.tonight`) and the player runs it from the show screen with
  `shows.runTonight` ([show-night.md](show-night.md#the-players-shows)), which
  rates its segments and marks it completed, so the calendar's
  `calendar.closePastShows` never sees it. The shows phase never runs a show a
  human runs. The close rule still closes an open show at the end of its day,
  with reason `notRun`, so a show of the player's nobody ran (only possible in a
  game built without the gate, as some tests are) is marked Not run and keeps
  its segments.
- **A cancelled show keeps its card.** `calendar.cancelShow` on a show with a
  card deletes nothing: the segments stay as read-only history, and every
  booking command is refused with `showCancelled`. The booking show list and
  the show-day gate (EVT2-03) leave cancelled shows out.

## Queries

The booking screen reads three queries (EVT2-03, `booking/queries.ts`); the
card view they share is built in `booking/view.ts`.

**Scoping.** A card is private while it is being booked. `booking.card` and
`booking.availableWorkers` answer only for a show the viewer runs (the
calendar's `controlsShow`, so a brand with its own controller counts) or for
the omniscient viewer of tools and tests (`canReadCard`). Anyone else gets
`notYourShow` ("Friday Fury isn't one of your shows"); an unknown id gets
`showNotFound`. A rival's card becomes public only after it airs, through the
results queries (AIP4, EVT8). `booking.shows` lists only the viewer's own
shows; the omniscient viewer runs none, so it gets an empty list.

### `booking.shows`

`{ limit?: 1..60 }` (default 20) →
`{ rows, nextToBookId, available, unavailableReason }`.

The viewer's open shows dated today or later (status `scheduled`, or `booked`
from an old save), by date, then id. They are read through the `byStatus` index (at most the
calendar's horizon) and kept when the viewer runs them, which covers both a
promotion the player runs and a brand they run inside someone else's
promotion, and leaves out a brand the computer runs inside theirs.

| Row field                      | What it is                                        |
| ------------------------------ | ------------------------------------------------- |
| `eventInstanceId`, `name`      | the show                                          |
| `date`, `importance`           | as stored                                         |
| `brandName`                    | the show's brand, or null                         |
| `status`                       | `scheduled` (or `booked` from an old save)        |
| `filledMain` / `slots`         | segments booked on the main card / its slot count |
| `filledPreShow`/`preShowSlots` | the same for the pre-show                         |
| `needsBooking`                 | today's show, not yet run: Next Day stops         |

`nextToBookId` is the first open show (from the whole list, not only the rows
the limit keeps). `available` is false on a save that cannot book
shows: one with no `eventInstances` at all (from before EVT1) or no match
types in `meta.catalogs` (from before MTCH1). `unavailableReason` then says
"This save was made before shows could be booked. Start a new game to book
shows."

### `booking.card`

`{ eventInstanceId }` → `BookingCard`:

- `show`: id, name, date, air date, importance, promotion, brand id and name,
  status, `isToday`, `daysUntil` (0 on the day) and `format`.
- `canEdit`: the viewer runs the show and `editBlockOf` finds nothing.
  `editBlock` is that reason (whoever asks). `runsTonight` is `canEdit` on the
  show's day: the show screen offers Run the show (`shows.runTonight`).
- `sections`: the pre-show first when the format has one, then the main card.
  Every slot of the format is listed, filled or open.
- `titleOptions`: the promotion's active titles by prestige (highest first),
  with holders, holder ring names, `vacant` and `otherBrand` (the title belongs
  to another brand than the show's), for the editor's titles field.

Each **slot** is `{ slot, displayNumber, preShow, role, roleLabel,
durationClass, durationLabel, weight, roleTrace, durationTrace, weightTrace,
segment }`. The role, class and weight are derived on every read with MTCH1's
`slotRoleOf`, `durationClassOf` and `slotWeightOf`
([match-rating.md](match-rating.md#slots)); nothing is stored. The card view is
the one place stored 0-based slots become MTCH1's 1-based ones. The duration
class uses the segment's match type, so a battle royal in a midcard slot reads
Long; a talking segment and an open slot use the slot's own class. Queries
cannot store traces, so each trace travels inline for the screen's `Explained`
panel. No field anywhere in the result is a length or a time (D-10).

A filled slot's **segment** is `{ segmentId, kind, label, typeKey, typeName,
durationShiftNote, titles, sides, result, storylineIds, finishKey,
stipulationKeys, draft }`:

- `durationShiftNote`: "Battle Royal runs a step longer than its slot" for a
  match type that moves the class, else null.
- `sides`: by side, each `{ side, name, teamId, people }`. The name is the
  team's when everyone on the side is listed with the same team, else the ring
  names joined with " & ". Each person has `ringName` (from their contract with
  the show's promotion, else their default ring name), `imageRef`, `role`, an
  availability chip on the show's date and `otherBrand`.
- `result`: the planned result before the show and the real one after
  (`{ kind, winningSide, methodKey, methodName }`), or null.
- `draft`: `draftFromSegment`, the editor's starting point.

### `booking.availableWorkers`

`{ eventInstanceId, kind: 'match' | 'angle', search?: string (≤ 60) }` →
`{ region, people, teams }`, where `region` is the show's region
(`{ regionId, name }`).

`people` holds every active contract of the show's promotion (read through the
`byPromotionStatus` index) in a role that can take part: wrestlers for a match,
and also managers and presenters for an angle. Each row has the ring name,
image, gender, person roles, the contract's role, push and alignment, its
brand, `otherBrand` (contracted to a brand other than the show's), the
availability chip, `bookable`, `onCard` (`{ segmentId, slotLabel }` for each
segment of this card they are already in, such as "Slot 3" or "Pre-show slot
1"), `appearancesThisYear` and `appearanceCap`.

For the picker to judge who to book, each row also carries three of WRK1's
stored values, unrounded, read straight off the person with no roll-up (so the
query stays as cheap on every debounced search as before):

| Field        | What it is                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| `style`      | Their ring style (`RingStyle`); screens word it with WRK1's `STYLE_LABELS` ("High flyer") |
| `popularity` | Popularity in the show's region: `regionalPop[show.regionId]`, 0 where they are unknown   |
| `stamina`    | The in-ring `stamina` attribute                                                           |

Fatigue and body condition belong to WRK6, which is not built yet, so no row
carries them and nothing stands in for them. When WRK6 lands it adds a
`fatigue` field here and one more stat on the picker row (see the segment
editor below).

`bookable` follows WRK1 on the show's date: for a match the person must be
`available`; for an angle they must be able to work talking segments, so an
injured worker whose injury allows it can still be put in a promo.

`teams` holds the active teams whose members all have active contracts here,
with `bookable` when every member is. `search` matches ring names and given and
family names, ignoring case and surrounding spaces; a team matches on its name
or a member. People sort bookable first, then by push (main event first), then
ring name, then id; teams bookable first, then by name, then id.

### Availability chips

`view.ts` words WRK1's statuses the same way on every booking screen; WRK1's
longer `reason` is kept for the tooltip.

| Status          | Chip                   |
| --------------- | ---------------------- |
| `available`     | "Available"            |
| `injured`       | "Injured until 12 Feb" |
| `rehab`         | "Rehab"                |
| `personalLeave` | "Personal leave"       |
| `suspended`     | "Suspended"            |
| `timeOff`       | "Time off"             |
| `notDebuted`    | "Not debuted"          |
| `retired`       | "Retired"              |

The injury date is WRK1's first day back, with the year added when it falls in
another year.

## Show day

The show-day gate moved to the shows system with EVT2-09: `shows.tonight`
stops Next Day and every skip on the day of any open show the player runs,
with "Tonight: <Show>" (or "Your show '<Show>' has no card yet"), and the show
runs only when they press Run the show (`shows.runTonight`). See
[show-night.md](show-night.md#the-players-shows). It replaced EVT2-03's
`booking.showNeedsBooking`, which stopped the day until the card was locked.

Tests about something else that must run through the player's show days (the
calendar's phases, the web shell's skips) use the default systems without this
gate (`SYSTEMS_WITHOUT_SHOW_DAY_GATE` and `systemsWithoutGates` in the
engine's test support, and the web test engine's `showDayGate` option); their
shows of the player's then stay unrun and close as Not run. Tests that need
those shows run use `withMyShowsRun`, a stand-in player that runs them inside
the day through the same `runShowNow`.

## Validation

A card is runnable only when it makes sense. `validateCard(read,
eventInstanceId, { tunables, today? })` (`booking/validate/validateCard.ts`,
exported from the engine for the rival booker and the results page) is the one
answer the booking screen (`booking.validate`), `shows.runTonight` and AIP4's
rival booker share. It returns `{ errors, warnings, runnable, checklist }`:

- **Errors** are availability and structure problems. Any error blocks Run the show.
- **Warnings** are brand, contract, title-division and working-twice questions. They are shown
  in amber and never block: the owner may want a cruiserweight to challenge
  upward as a story, or a worker from the other brand for one night. (The
  reference booker silently drops such titles; we do not.)
- `runnable` is `errors.length === 0`.

Each issue is `{ checkId, code, severity, message, segmentId?, slot?:
{ preShow, slot }, personId?, titleId? }`. The message is player text that
names the slot, person or title it is about; the UI shows it as it is.
Issues are sorted card-wide first (no slot), then the pre-show, then the main
card, each by slot, then by the order of the check that found them, then in
the order found. The same card always gives the same list.

Availability is read on the **show's date** (WRK1's `availabilityOf` against
the person's contract with the show's promotion). Until WRK6 changes injuries
day by day, stored injuries never change.

### Error codes

| Code                 | Check               | Rule                                                                                                            | Message                                                                    |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `personUnavailable`  | `booking.people`    | not `available` on the show's date; someone who only talks (an angle, ringside) is fine if they can work angles | "Kai Moreno can't wrestle: Injured (leg injury) until 12 Feb"              |
| `notOnRoster`        | `booking.people`    | no active contract with the show's promotion any more                                                           | "Kai Moreno is no longer on the Apex Wrestling roster"                     |
| `notAWrestler`       | `booking.people`    | a match competitor without `wrestler` or `occasionalWrestler` among their roles                                 | "Sam Reed isn't a wrestler, so can't compete in a match"                   |
| `alreadyOnCard`      | `booking.cardWide`  | a competitor in more matches than `booking.maxMatchesPerPersonPerShow`                                          | "Kai Moreno is already in 3 matches on this card (Opener, Slot 2, Slot 4)" |
| `tooManyAppearances` | `booking.cardWide`  | in more segments of any kind, in any role, than `booking.maxAppearancesPerShow`                                 | "Kai Moreno is in 5 segments on this card; the most is 4"                  |
| `sideCount`          | `booking.structure` | competitor sides outside the match type's `sides`                                                               | "Slot 2: Two sides in a Three-Way match; it takes 3"                       |
| `sideSize`           | `booking.structure` | a side outside the type's `sideSize`                                                                            | "Slot 2: Side 2 has 1 wrestler; Tag Team takes 2 a side"                   |
| `unequalSides`       | `booking.structure` | uneven sides in an `equalSides` type (only when every side's size is allowed)                                   | "Slot 2: the sides are uneven (2 against 1); … takes equal sides"          |
| `speakerCount`       | `booking.structure` | an angle's `speaker` participants outside the angle type's `speakers`                                           | "Slot 2: One speaker in a Confrontation; it takes 2 to 8"                  |
| `noPlannedResult`    | `booking.structure` | a match's `outcome` is null (skipped on a Random winners show, see [Integration](#integration))                 | "Opener: no result planned; pick a winner, a draw or a no contest"         |
| `tooFewFilled`       | `booking.structure` | filled main-card slots below `minFilledMainSlots`                                                               | "Main card: 2 of 6 slots filled (needs 3)"                                 |
| `emptyMainEvent`     | `booking.structure` | the last main-card slot is open, while `booking.requireMainEvent` is on                                         | "The main event (Slot 6) is empty"                                         |
| `titleNotAllowed`    | `booking.titles`    | a title on a match type with `allowsTitles: false`                                                              | "Slot 2: titles can't be on the line in a Battle Royal"                    |
| `titleTwiceOnCard`   | `booking.titles`    | the title is on the line in an earlier match of the card                                                        | "The Crown Title is already on the line in Slot 2"                         |
| `titleRetired`       | `booking.titles`    | the title was retired after it was booked                                                                       | "The Crown Title has been retired"                                         |
| `championMissing`    | `booking.titles`    | a holder of the title's open reign is not a competitor; a vacant title has no holders to check                  | "The champion Rhea Cortez isn't in this match"                             |
| `titleSideSize`      | `booking.titles`    | a competitor side without exactly the title's `holderCount` people                                              | "The Altura Tag Team Championship needs 2 wrestlers on each side"          |

"Opener", "Semi-main" and "Main event" name a slot with that role; any other
slot is named by number ("Slot 3", "Pre-show slot 1").

### Warning codes

| Code              | Check              | Rule                                                                                     | Message                                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `appearanceCap`   | `booking.warnings` | `terms.appearanceCap` is set and `appearancesThisYear + 1` is above it                   | "Kai Moreno has used 24 of 24 contracted appearances this year"                                |
| `noHouseShows`    | `booking.warnings` | the contract's `noHouseShows` perk is set and the show's importance is `house`           | "Kai Moreno's contract rules out house shows"                                                  |
| `otherBrand`      | `booking.warnings` | the contract's brand is set and is not the show's                                        | "Kai Moreno works for Altura Overclock"                                                        |
| `titleOtherBrand` | `booking.warnings` | the title's brand is set and is not the show's                                           | "The Crown Title belongs to Altura Overclock"                                                  |
| `titleDivision`   | `booking.warnings` | WRK1's `isEligibleForTitle` gender or weight reasons, for each competitor not holding it | "Kai Moreno: The Women's Title is a women's title"                                             |
| `injuredTalking`  | `booking.warnings` | an injured worker who can still work angles, booked to talk                              | "Tia Cruz is injured: can talk but not wrestle"                                                |
| `workingTwice`    | `booking.cardWide` | a competitor in a second or later match, within `booking.maxMatchesPerPersonPerShow`     | "Kai Moreno is also in the Opener: working twice tires them more and raises their injury risk" |
| `checkFailed`     | the failing check  | a registered check threw                                                                 | "A booking check (<id>) failed; the show can still run"                                        |

The first three are given once per person, on the first segment they are in.
`workingTwice` is given on each later match, naming the earlier ones ("is also
in the Opener and Slot 2: working three times …").

**Booking someone more than once.** A person may be booked in several segments
of one card. Talking segments (angles, a match role that only talks or stands at
ringside) never warn: promos cost no stamina. Each extra match a competitor
works gets the `workingTwice` warning, which never blocks Run the show. Past
`booking.maxMatchesPerPersonPerShow` matches (`alreadyOnCard`) or
`booking.maxAppearancesPerShow` segments (`tooManyAppearances`) it is an error,
so a card can't be absurd. The costs themselves are not validation's: extra
stamina loss and injury chance for working twice are MTCH4-01 and MTCH4-02, and
promos letting someone recover less than a night off is WRK6-02. The same
person twice in one segment is still refused by the writer (`duplicatePerson`).
`appearancesThisYear` is counted by the show night (EVT3) after each show;
appearances on other cards that have not run yet are not counted. A
later feature can refine that with a check of its own.

### Thresholds

| Tunable                              | Default | Range | What it does                                                                                           |
| ------------------------------------ | ------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `booking.maxAppearancesPerShow`      | 4       | 1–6   | Most segments of any kind one person may appear in on one show                                         |
| `booking.maxMatchesPerPersonPerShow` | 3       | 1–4   | Most matches one person may wrestle on one show; each match past the first is a `workingTwice` warning |
| `booking.minFilledMainShare`         | 0.5     | 0–1   | Share of main-card slots that must be filled; 0 is no minimum                                          |
| `booking.requireMainEvent`           | true    |       | The last main-card slot must be filled                                                                 |

**`minFilledMainSlots`** (`booking/formulas/minFilledMainSlots.ts`) is
`ceil(slots × booking.minFilledMainShare)`, kept within 0..slots. A tiny
constant is taken off before rounding up so that a whole product such as
10 × 0.3 (3.0000000000000004 in floating point) needs 3 slots, not 4. At the
default, a six-slot card needs 3 filled; at 0 any card passes; at 1 every slot
must be filled. Its trace ("Main card slots", "Share that must be filled",
"Rounded up") rides on the checklist's first line for its Why?.

### The checklist

The booking screen's checklist always lists these lines, in order, each with
`{ id, label, passed, severity, detail?, trace? }`:

1. `mainCardFilled`: "Main card filled (n of N, needs m)", with the
   `minFilledMainSlots` trace;
2. `mainEvent`: "Main event booked";
3. `results`: "Every match has a result";
4. `available`: "Everyone is available" (the people checks and the contract
   warnings);
5. `notTwice`: "Nobody is booked too often" (the card-wide errors and the
   `workingTwice` warning);
6. `sides`: "Sides fit their match types";
7. `titles`: "Title matches are set up correctly" (the title errors and
   warnings);

then one line for each registered feature check that found something, labelled
with the check's `label` (or its id). A line with no issues has `passed: true`;
otherwise `passed` is false, `severity` is `error` when any of its issues is an
error and `warning` when they are all warnings, and `detail` is its first
issue's message ("… (and 2 more)").

### Registering a check

Other features add rules without editing booking's files:

```ts
registerBookingCheck({
  id: 'brands.exclusivity', // system.camelName, unique
  order: 200, // features use 200 and up; EVT2's own checks are 100–190
  label: 'Exclusive workers stay on their brand',
  run: ({ read, instance, segments, participantsBySegment, today, tunables }) => [
    // BookingIssue without checkId: { code, severity, message, segmentId?, slot?, personId?, titleId? }
  ],
});
```

Checks run in `order`, then by id; a duplicate or malformed id throws
`RegistryError` at registration. A check reads only what it is given and never
writes. It should **never throw**: if it does, its issues are replaced by one
`checkFailed` warning, so a bug in a later feature can never block booking.
Use `error` only for a card that cannot run (someone who cannot be there, a
structure the show night cannot play out); use `warning` for anything the
owner may choose to book anyway. `registerBookingCheck` returns a function that
removes the check again (for tests). The built-in checks are
`booking.people` (100), `booking.cardWide` (110), `booking.structure` (120),
`booking.titles` (130) and `booking.warnings` (190).

### No morale here (D-09)

Validation never touches morale. Booking someone to lose never produces a
morale warning: result morale, and the story shield for losses inside a hot
storyline, are WRK8's, applied after the show.

## Running the show

There is no Lock card (EVT2-09, an owner decision: locking was an extra click
with no meaning). `booking.lockCard`, `booking.unlockCard`, the `cardLocked`
edit block, the `cardNotLocked` refusal and the `card.locked` /
`card.unlocked` events are gone. Two parts of the old behaviour stay:

- **The day still stops on every show of the player's** (`shows.tonight`,
  above), and the show only runs when they run it.
- **The card is checked before it runs.** `shows.runTonight { eventInstanceId }`
  runs `validateCard` with the save's tunables; any error refuses it with up to
  10 `cardNotRunnable` reasons (`MAX_RUN_REASONS`), one per error, each with
  the error's message and the segment as its subject (the show for a card-wide
  error). Warnings never block. `booking.validate` and Run the show always
  agree: they run the same function.

The command and its other refusals are in
[show-night.md](show-night.md#the-players-shows). The `booked` status is no
longer written for anyone's show; an old save's `booked` show of the player's
is open (editable, gated and runnable). A feature that has to act just before
a show runs (EVT6-03's venue pick) registers a before-a-show-runs hook
(`registerBeforeShowRuns`) instead of listening for a lock.

### `booking.validate`

`{ eventInstanceId }` → `BookingValidation`. The same viewer rule as
`booking.card`: the show's controller or the omniscient viewer; anyone else
gets `notYourShow`, an unknown id `showNotFound`.

## The booking screen

`/game/booking` (EVT2-05, `apps/web/src/screens/booking/`, see its README) reads `booking.shows`,
`booking.card` and `booking.validate` and issues the commands above. It opens on `?event=`
(the gate's "Go to the show" and the calendar's "Book this show" link there) or `nextToBookId`,
shows every slot of the format by role with the role's and size's Why?, reorders by drag,
keyboard and Move up / Move down with swap semantics, and on the show's day offers Run the show,
on only when the card is runnable; after it runs, the results page opens with the reveal. Refusals are shown as the engine words them. Other features add panels with
`registerBookingPanel`; the segment editor (EVT2-06) opens from the `useSegmentEditor` store.

### The segment editor

Filling or changing a slot happens in one sheet (EVT2-06, `screens/booking/editor/`): Match or
Talking segment, the type, each side built from a roster picker that reads
`booking.availableWorkers`, titles on the line, the planned winner and method (or a draw or no
contest) and a billing line. Each person in the picker reads "High flyer · Pop 54 · Stamina 72"
in visible text: the ring style for a wrestler (a manager or presenter in a talking segment
shows their role instead), popularity in the show's region and, for wrestlers, stamina. Screen
readers hear "Popularity in Greater Lakes 54", and a line under the filters says which region
Pop means. A Most popular chip sorts the people by that popularity. The line starts with the
worker's gender in words ("Woman · High flyer · …"), and Gender and Push chips narrow the list
(a team matches Gender when every member does, Push when any member does, and says "Mixed"
when its members differ); they never stop the player booking any mix. A picked team is never
only its name: the editor's side says "Team: Running Axe" over its wrestlers, and the planned
result, the card row on the board (the wrestlers under the team's name) and its Winner menu read
"Running Axe (Kai Moreno & Rex Hale)". Show results already list every wrestler on a side by
name. It edits a local `SegmentDraft` and saves it whole with one
`booking.addSegment` or `booking.updateSegment`, so nothing half-built reaches the world. It never
adds rules of its own beyond the catalog's limits: whatever the engine refuses is shown in the
engine's words, and softer problems are left to the checklist above. Picking someone to lose
shows no morale warning (D-09). Other features add parts of the editor (finish, beats,
stipulations, crew, storylines) with `registerSegmentEditorSection`; a section patches its part of
the same draft and is saved with it, the one write path. Until MTCH5's beats section exists,
changing a talking segment's speakers drops its beats so the writer gives the type's default beat.

## Integration

EVT2-07 wires booking to the partner features that were on `main` when it ran.
Partners plug in only through `registerBookingCheck` (engine, order 200 and
up, registered when the partner's system module loads),
`registerSegmentEditorSection` and `registerBookingPanel` (web, one import line
each in `screens/booking/sections/index.ts`).

| Partner                | Status                  | How it is wired                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MTCH2 (finishes)       | wired (EVT2-07)         | The editor's **Finish** section (`sections/BookingFinishSection.tsx`, `match.finish`, order 10) and the `match.finish` booking check (`systems/match/finishes/bookingCheck.ts`, order 200). Random winners: the commands refuse a planned result or finish with `randomWinners`, `noPlannedResult` is skipped, `booking.card` carries `randomWinners`, and the editor says "Decided on the night (Random winners)". See below. |
| EVT3 (show night)      | wires from its own pack | EVT3 reads cards through `cardSegments` and the planned `outcome`; it wires booking itself (EVT3-07).                                                                                                                                                                                                                                                                                                                          |
| WRK6 (injuries by day) | wires from its own pack | Not on `main`: no `systems/health/`. Availability is still WRK1's `availabilityOf`, so the chips and `personUnavailable` follow it the day WRK6 changes injuries.                                                                                                                                                                                                                                                              |
| MTCH5 (beats)          | wires from its own pack | Not on `main`: no beat catalog. Talking segments keep the writer's default beat.                                                                                                                                                                                                                                                                                                                                               |
| MTCH7 (stipulations)   | wires from its own pack | Not on `main`: no stipulation catalog. The Finish section and the finish check already pass `stipulationKeys` to `allowedFinishes`, so MTCH7's finish filter applies to booking with no change here.                                                                                                                                                                                                                           |
| MTCH8 (crew)           | wires from its own pack | Not on `main`: no `CrewPicker`. The draft's `crew` stays Auto.                                                                                                                                                                                                                                                                                                                                                                 |
| EVT8 (schedule editor) | wires from its own pack | Not on `main`: the calendar has no one-off or tour commands yet.                                                                                                                                                                                                                                                                                                                                                               |
| ECO11, ECO12           | wires from its own pack | Not on `main`: no development assignments, no tour deals.                                                                                                                                                                                                                                                                                                                                                                      |
| SOC6 (discipline)      | wires from its own pack | Not on `main`: no suspensions.                                                                                                                                                                                                                                                                                                                                                                                                 |
| BRW2 (brand drafts)    | wires from its own pack | Not on `main`: no draft scheduling.                                                                                                                                                                                                                                                                                                                                                                                            |
| MP1, MP2 (seats, tabs) | wires from its own pack | Not on `main`: no hot-seat seats or tab host. Every booking query and command already takes the seat's viewer and `issuedBy`.                                                                                                                                                                                                                                                                                                  |
| POL7 (accessibility)   | wires from its own pack | Not on `main`: no stricter sweep or high-contrast tokens.                                                                                                                                                                                                                                                                                                                                                                      |

### Finishes (MTCH2)

**Finish section.** For a match, the editor shows a Finish select after the
billing line: Auto (decided on the night) first, then the finishes
`match.finishes` allows for the match type, the sides built, the stipulations
and the planned result's kind (a draw offers only the draw finishes). It
patches `match.finishKey` on the draft, saved with the segment by
`booking.addSegment` or `booking.updateSegment`. Picking a finish keeps the
planned way of winning when the finish ends with it, and otherwise switches to
the finish's first one (one that can move a title when a title is on the
line). When a later change leaves the booked finish out (another type, a
draw, a way of winning the finish does not end with) it goes back to Auto and
the section says so.

**Quick Winner menu.** `booking.setResult` (and `setPlannedOutcome`) keeps a
planned finish only while the new result fits it; otherwise the finish goes
back to Auto, so a card never holds a finish that contradicts its result.

**`match.finish` check** (order 200, checklist line "Finishes fit their
matches"); only matches with a booked finish are checked:

| Code                      | Severity | Rule                                                                                        | Message                                                                               |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `finishNotAllowed`        | error    | the finish is gone, or `allowedFinishes` leaves it out for the type, sides and stipulations | "Slot 2: a Disqualification finish can't end this match; pick another finish or Auto" |
| `finishOutcomeMismatch`   | error    | the planned result is not the finish's outcome kind                                         | "Opener: a Disqualification finish ends in a winner, but the plan is a draw"          |
| `methodNotInFinish`       | error    | a planned win by a way the finish does not end with                                         | "Opener: a Disqualification finish can't be won by Pinfall"                           |
| `finishBlocksTitleChange` | warning  | a title match won by a side without the champion where `titleCanChange` is false            | "The title can't change hands on a Disqualification finish"                           |

**Random winners.** When `randomWinnersActive` is true for the show (the
setting is on and a human runs the show), nothing is planned:
`booking.addSegment` and `booking.updateSegment` refuse a draft with a result
or a finish, and `booking.setResult` anything but null, with `randomWinners`
("Results on your shows are decided on the night (Random winners)."); the
`noPlannedResult` error is skipped, so the show runs with no results; the
`match.finish` check turns any planned result or finish left on the card into a
`randomWinners` error. `booking.card` carries `randomWinners`, so the editor
replaces the Result choice with "Decided on the night (Random winners)", the
Finish section says "Decided on the night", and the card row's menu has no
Winner entry. Shows the computer runs are never affected.
