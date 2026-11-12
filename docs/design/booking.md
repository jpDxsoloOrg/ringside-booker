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

| Code            | When                          | Message                          |
| --------------- | ----------------------------- | -------------------------------- |
| `showCompleted` | the show has run              | "This show has already run"      |
| `showCancelled` | the show was cancelled        | "This show was cancelled"        |
| `showPast`      | its date is before today      | "This show has already happened" |
| `cardLocked`    | the card is locked (`booked`) | "Unlock the card to change it"   |

Today's show stays editable until the day runs.

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
own slot, the result it already has, or clearing an empty card. `card.locked`
and `card.unlocked` are declared for EVT2-04's lock commands. Commands are
refused with `busy` while days are advancing.

### Refusals

The UI shows these messages as they are and never re-words them.

| Code                      | When                                                      | Player message                                                    |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `invalidArgs`             | the arguments do not parse (a negative slot, a bad id)    | names the field                                                   |
| `showNotFound`            | the show does not exist                                   | "That show no longer exists"                                      |
| `segmentNotFound`         | the segment does not exist                                | "That segment is no longer on the card"                           |
| `notYourShow`             | the issuer does not run the show                          | "Only the person running {brand or promotion} can book this show" |
| `showCompleted`           | the show has run                                          | "This show has already run"                                       |
| `showCancelled`           | the show was cancelled                                    | "This show was cancelled"                                         |
| `showPast`                | its date is before today                                  | "This show has already happened"                                  |
| `cardLocked`              | the card is locked (`booked`)                             | "Unlock the card to change it"                                    |
| `slotOutsideFormat`       | add or move to a slot the format does not have            | "Slot 7 doesn't exist on this show"                               |
| `slotTaken`               | add to a filled slot                                      | "Slot 3 already has a segment"                                    |
| `notAMatch`               | `setResult` on an angle                                   | "Only a match has a result to plan"                               |
| `winnerWithoutCompetitor` | the planned winning side has no competitor                | "Side 3 has nobody wrestling, so it can't win"                    |
| `unknownMethod`           | the planned way of winning is not offered                 | "That way of winning isn't available"                             |
| other structural codes    | add or update with a draft the writer refuses (see above) | the writer's message, naming the person, title or slot            |

`notYourShow` names whoever runs the show: the brand when it has its own
controller, otherwise the promotion.

## Lifecycle

How a card meets the calendar's show lifecycle ([calendar.md](calendar.md#lifecycle)):

- **A locked card that never runs.** The calendar's `calendar.closePastShows`
  closes `booked` shows as well as `scheduled` ones at the end of their day,
  with reason `notRun`. Until the show night (EVT3) runs cards, a locked show
  is therefore marked Not run when its day ends, so the calendar stays honest.
  Its segments are kept. Once EVT3 ships, its shows phase completes the show
  first and the close rule no longer sees it.
- **A cancelled show keeps its card.** `calendar.cancelShow` on a show with a
  card deletes nothing: the segments stay as read-only history, and every
  booking command is refused with `showCancelled`. The booking show list and
  the show-day gate (EVT2-03) leave cancelled shows out.
