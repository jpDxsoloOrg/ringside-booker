# Storylines

Storylines are the feuds and angles that tie segments together across shows.
The storylines system (`packages/engine/src/systems/storylines/`) is the one
place the rest of the engine and the Storylines desk read them from.

CRTV3-01 laid the ground: the two new fields, the read queries, the shared
engine reader, the read-side tunables, the trace kinds and the events. Later
tickets fill in the sections marked below: CRTV3-02 (starting heat, cooling,
starter storylines), CRTV3-03 (the player's commands), CRTV3-04 (the screen)
and CRTV4 (heat after segments, finales and the payoff).

| Piece       | Where             | What it does                                                                                        |
| ----------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Tunables    | `tunables.ts`     | The read-side numbers, category `Storylines` ([Storyline tunables](tunables.md#storyline-tunables)) |
| Streams     | `streams.ts`      | None yet; CRTV3-02 declares the starter stream here                                                 |
| Events      | `events.ts`       | `storyline.started`, `storyline.ended`, `storyline.membersChanged`                                  |
| Trace kinds | `traceKinds.ts`   | `storylines.heat`, `storylines.starter`, `storylines.payoff`                                        |
| Formula     | `formulas/hot.ts` | `isHotHeat`: whether heat shows as Hot                                                              |
| Rows        | `rows.ts`         | `buildStorylineRow` and the viewer rules                                                            |
| Queries     | `queries.ts`      | `storylines.list`, `.detail`, `.forPerson`, `.memberOptions`                                        |
| Reader      | `context.ts`      | `storylineContextFor`, `storylinesOfPerson`, `activeStorylinesOf`                                   |

## What is stored and what is derived

A storyline row (see [data-model.md](data-model.md#storylines-storylines-sty_))
stores its promotion, an optional brand, a name, `active` or `ended` with
`startedOn` and `endedOn`, its heat (0 to 100), 1 to 12 members each on a side,
a summary, and since CRTV3-01:

- `lastProgressOn`: the last day a linked segment moved the story on. Null
  means never, so cooling counts from `startedOn`. It is never before
  `startedOn`.
- `finaleSegmentId`: the linked segment booked as the story's final match, or
  null. The finale must be a match that links the storyline
  (`finaleIsLinkedMatch`, see [Linking](#linking)), and the weekly
  history roll-up never deletes it.

CRTV4-01 adds two more, both empty by default so older saves load:

- `progress`: the linked segments that moved the story on, oldest first, each
  with its show, date, heat before and after and the heat trace (at most 200;
  the oldest is dropped on write). CRTV4-02 writes it and the weekly history
  roll-up drops rows older than `history.keepDetailDays`, so it only holds the
  detail window ([Heat after a linked segment](#heat-after-segment)).
- `payoff`: what happened when the story ended (paid or not, the counted
  segments, the heat, each member's popularity and momentum change). Null
  while the storyline is active. CRTV4-03 writes it.

CRTV4-02 adds `progressTotals`: all-time counts of the segments that counted
(`segments`, of which `matches` and `angles`) and the heat they added
(`heatGained`) and took away (`heatLost`). Each counted segment adds to them
when it is written, so they keep counting after the progress log has dropped
its row. All zero by default.

CRTV4 writes these fields. CRTV3 only stores and reads them; nothing else may
set them. Both default to null, so saves from before CRTV3-01 load unchanged.

Segments point at storylines through `segments.storylineIds` (index
`byStoryline`). Everything else is derived when read: the linked segment
count, days since the story last moved on, the Hot flag, the timeline and how
an ended storyline ended. The linked segments are the ones still kept: the
history roll-up deletes old segments past the detail window (see
[save-format.md](save-format.md#history-retention)), finales aside.

Storylines are ended, never deleted, because segments reference them.

### Sides and alignment

A member's side (`face`, `heel` or `neutral`) is their side in this story, not
their overall alignment. A face can be the heel of one story; the rows show
both, the side from the storyline and the alignment from the member's active
employment at the storyline's promotion.

A member who no longer has an active employment at the storyline's promotion
stays in the storyline and is shown with a warning (`stillEmployed: false`).
They are never removed automatically.

## Hot storylines

A storyline shows as Hot on the heat meter when its heat is at least
`storylines.heat.hotFrom` (70). This is display only. The story shield
(D-09, owned by WRK8; ECO4-03 reads `contracts.quit.storyShieldHeat` until
then) and the rival booker (`aip.card.storylineMinHeat`) keep their own heat
lines.

Owner rule D-09: losing inside a hot storyline doesn't hurt morale, and a
worker in a hot storyline never asks to leave or walks out. Nothing in CRTV3
changes morale.

## Starting heat

CRTV3-02. Every storyline starts through `startStoryline`
(`systems/storylines/lifecycle.ts`): the new-game starters below, CRTV3-03's
`storylines.create` and later AIP6's rival storylines, so starting heat is the
same whoever starts one. It creates the storyline (active, started today, no
progress, no finale), stores the heat's Why? as the storyline's
`storylines.heat` trace and publishes `storyline.started`.

The formula (`formulas/startingHeat.ts`), in plain words:

1. Start from the base starting heat (`storylines.heat.startBase`, 25). This
   is the first line of every starting-heat Why?.
2. Add star power: the average home popularity of the (up to) two best-known
   members, times `storylines.heat.startStarWeight` (0.25). Home popularity is
   the member's popularity in the promotion's home region (0 when they have
   none there). Only the best two count, so a big storyline is not hotter for
   having more people in it. With no members the star line is 0 ("No members
   yet"); with the weight at 0 there is no star line at all.
3. No higher than `storylines.heat.startMax` (60), kept within 0–100 and
   rounded to a whole number.

Two members at 60 and 40 at home: 25 + 0.25 × 50 = 37.5, so 38.

| Tunable                           | Default | Meaning                                                                      |
| --------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `storylines.heat.startBase`       | 25      | Heat every new storyline starts from                                         |
| `storylines.heat.startStarWeight` | 0.25    | Share of the best two members' average home popularity added. 0 turns it off |
| `storylines.heat.startMax`        | 60      | Highest starting heat                                                        |

## Heat decay

CRTV3-02. Heat never rises on its own: only CRTV4's linked segments raise it
(and set `lastProgressOn`, which restarts the grace period). When nothing
happens, it cools.

The daily phase `storylines.heatCooling` (`growth`, order 35, no random
numbers) looks at every active storyline in id order. Days since progress are
counted from `lastProgressOn`, or from `startedOn` when there is none. The
formula (`formulas/heatDecay.ts`), in plain words:

1. Start from yesterday's heat and note the days since progress and what they
   count from ("Started 2027-01-04", "Last linked segment 2027-02-10").
2. Inside the grace period (days since progress at most
   `storylines.heat.decayGraceDays`, 7): no change.
3. Already at or below the floor (`storylines.heat.decayFloor`, 10): no
   change. Cooling never raises heat, so a storyline that starts below the
   floor stays where it is.
4. Otherwise take off `storylines.heat.decayPerDay` (1), no lower than the
   floor, kept within 0–100, with a note of how many days it has been cooling.

So with the defaults a storyline started on day 0 keeps its heat through day
7 and loses 1 a day from day 8: heat 40 is 33 on day 14, and 10 from day 37
on. `decayPerDay` 0 stops cooling.

| Tunable                          | Default | Meaning                                                           |
| -------------------------------- | ------- | ----------------------------------------------------------------- |
| `storylines.heat.decayGraceDays` | 7       | Days without progress before heat starts cooling                  |
| `storylines.heat.decayPerDay`    | 1       | Heat lost each day after the grace period. 0 means it never cools |
| `storylines.heat.decayFloor`     | 10      | Cooling never takes heat below this                               |

`growth` (700) runs after `shows` (500) and `settlement` (600), so a storyline
a segment moves on today never cools on the same day.

A storyline whose heat does not change gets no new trace, so its Why? stays
the latest change: the starting heat or the last cooling step. The phase skips
storylines inside the grace period or on the floor before building a trace,
so a quiet day costs one pass over the storylines. Every storyline in the
world cools every day, so a rival's heat Why? is kept as a summary only (the
player's stay in full). The weekly `storylines.pruneDetail` (`periodic`, order
46, Mondays) turns the heat and starter Why?s of storylines that ended more
than `history.keepDetailDays` ago into summaries; an active storyline keeps
its Why?, because it explains today's heat.

`storylines.detail` gives an active storyline of the viewer's own promotion a
`cooling` block: `graceDays`, `daysSinceProgress`, `perDay`, `floor`,
`coolingNow` (the next day simulated lowers heat) and `startsInDays` (days
until the first day that cools if nothing happens; null when already cooling,
on the floor or with cooling off), so the screen can say "Cools from day 8
without progress" or "Cooling 1 per day". It is null for ended and rival
storylines.

## Starters

CRTV3-02. New-game setup step `storylines.seedStarters` (order 880, see
[new-game.md](new-game.md#setup-steps)) gives every active promotion, in id
order, up to `storylines.starterPerPromotion` (2) starter storylines, so the
Storylines desk has something to show on a fresh game. 0 creates none (the
step logs "Starter storylines turned off").

- **Pool.** Active wrestlers under an active contract with the promotion,
  face or heel (tweeners sit out), who are active and not injured. They are
  ranked by push (main event first), then popularity in the promotion's home
  region, then id.
- **Gender.** Each starter is a face and a heel of the same gender: the group
  with the most face and heel pairs left, ties to the group holding the
  best-ranked worker. Picked again for each starter, so a promotion with both
  men's and women's pairs usually gets one of each.
- **Picks.** The face is rolled among the top 3 unused faces, then the heel
  among the top 3 unused heels (stream `storylines.starters`, two draws per
  starter). Nobody is in two starters. When no pair is left the step stops
  early with a log line.
- **The storyline.** Named "<face> vs. <heel>" (ring names), summary "A
  rivalry already simmering when the season began.", the brand both
  employments share (else none), started through `startStoryline` with source
  `setup`.
- **Why it started.** A "Starter storyline" decision trace lists each gender's
  pool size and pairs, the gender rule, the top 3 on each side and both rolls.
  It is stored as `storylines.starter` under the storyline's id (a summary
  only for a rival's) and served by `storylines.detail` as
  `startedBecauseTraceRef` (null for any storyline that was not a starter).

On the default world every one of the twelve promotions gets two starters,
with starting heat around 26 to 43, well below the Hot line (70), the story
shield (`contracts.quit.storyShieldHeat`, 70) and so on: starters do not
shield anyone's morale at the start. Rivals book them on their cards
(`aip.card.storylineMinHeat` is 0).

Dated note (CRTV3-02, Sprint 11): starters exist only in games started after
this step was added. Older saves keep the storylines they have; nothing adds
starters to a game already under way, and rivals start no new storylines
later (that is AIP6).

## Commands

CRTV3-03. The booker writes their own stories with six commands. Every one is
checked against the controller that issued it (D-07, `controlsPromotion`): a
rival's storyline can't be changed from the player's seat, and the computer's
rival desk uses the same commands on its own promotions. Each command checks
everything before it writes, applies in one transaction and returns plain JSON.
`storylines.memberOptions` lists the people who may join.

| Command                   | Args                                                 | Returns                                   | Event                                              |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `storylines.create`       | `{ promotionId, name, summary?, brandId?, members }` | `{ storylineId, warnings }`               | `storyline.started` (`source: 'player'`)           |
| `storylines.edit`         | `{ storylineId, name?, summary?, brandId? }`         | `null`                                    | none: a rename doesn't change the story            |
| `storylines.addMember`    | `{ storylineId, personId, side }`                    | `null`                                    | `storyline.membersChanged { added: [personId] }`   |
| `storylines.removeMember` | `{ storylineId, personId }`                          | `null`                                    | `storyline.membersChanged { removed: [personId] }` |
| `storylines.setSide`      | `{ storylineId, personId, side }`                    | `null`                                    | `storyline.membersChanged { sideChanged: [...] }`  |
| `storylines.end`          | `{ storylineId }`                                    | `{ linkedSegments, minSegments, payoff }` | `storyline.ended`                                  |

`storylines.create` goes through `startStoryline` (starting heat, its trace and
the event, as for starters). The name and summary are stored trimmed; `brandId`
left out or null means the whole promotion. `storylines.edit` needs at least one
of name, summary and brand. `addMember` appends the person; `setSide` changes
the side in place (member order kept) and is a no-op with no event when the
side is the same; `removeMember` takes only the person out (heat,
`lastProgressOn` and linked segments stay).

A side in a storyline is the story's, not the worker's: no storyline command
changes a worker's morale, momentum or alignment on their employment (D-09).
Turning a worker is CRTV7's `characters.turn`.

### Refusals

The checks live in `systems/storylines/validation.ts`. Reasons are written for
the player, name their subject and, when a form field is at fault, the field.

| Code                             | When                                                                                         | Field                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `storylines.notFound`            | No such storyline                                                                            | `storylineId`                           |
| `storylines.notYours`            | The issuer doesn't run the storyline's promotion ("That storyline belongs to Bravo.")        | `promotionId` on create                 |
| `storylines.ended`               | The storyline has ended ("X has ended; ended storylines can't be changed.")                  |                                         |
| `storylines.promotionNotFound`   | `storylines.create` names a promotion that isn't in the world                                | `promotionId`                           |
| `storylines.nameLength`          | The name is empty or over 80 characters after trimming                                       | `name`                                  |
| `storylines.nameTaken`           | Another **active** storyline of the promotion has that name (ignoring case)                  | `name`                                  |
| `storylines.summaryLength`       | The summary is over 500 characters after trimming                                            | `summary`                               |
| `storylines.brandNotInPromotion` | The brand belongs to another promotion, or no longer runs                                    | `brandId`                               |
| `storylines.noMembers`           | `storylines.create` with nobody                                                              | `members`                               |
| `storylines.tooManyMembers`      | More than 12 people                                                                          | `members`, or `personId` on `addMember` |
| `storylines.duplicateMember`     | Someone listed twice (on the second mention)                                                 | `members[i].personId`                   |
| `storylines.memberNotEmployed`   | Someone without an active contract with the promotion ("X doesn't work for Altura")          | `members[i].personId`, or `personId`    |
| `storylines.alreadyMember`       | `addMember` for someone already in it                                                        | `personId`                              |
| `storylines.notMember`           | `removeMember` or `setSide` for someone not in it                                            | `personId`                              |
| `storylines.lastMember`          | `removeMember` of the only person ("A storyline needs at least one person. End it instead.") | `personId`                              |
| `invalidArgs`                    | `storylines.edit` with nothing to change                                                     | `storylineId`                           |

The storyline checks stop at the first of `notFound`, `notYours` and `ended`.
Someone who leaves the promotion later stays listed (`stillEmployed: false` on
the row); taking them out is the booker's choice, or AIP6's for a rival.

### Warnings

`storylines.create` returns warnings in `data.warnings` (`Reason[]`); they never
block, and the screen shows them after the storyline is created:

- `storylines.manyActive`: the promotion already has at least
  `storylines.activeSoftLimit` (6) active storylines ("You already run 6
  storylines; it gets hard to keep them all hot."); 0 never warns.
- `storylines.oneSided`: nobody is a face or nobody is a heel ("No one on the
  other side yet.").

### Ending

`endStoryline(ctx, storylineId)` in `lifecycle.ts` is the one place a storyline
ends, for `storylines.end` and for AIP6's rival storylines. It sets
`status: 'ended'` and `endedOn` to today, keeps members, heat and links, and
publishes `storyline.ended { storylineId, promotionId, linkedSegments }`. It
returns `{ linkedSegments, minSegments, payoff }`, `payoff` being `tooFew` below
`storylines.payoff.minSegments` counted segments, else `pays`. `linkedSegments`
here is the all-time count, `progressTotals.segments` (CRTV4-03), not the
segments the history roll-up still keeps. The [payoff](#payoff) itself reacts to
`storyline.ended`.

`storylines.endPreview { storylineId }` gives the confirm dialog the same
outcome with a sentence: "Ending now pays nothing: needs 4 linked segments, has
0." or "Ending now pays off: its members gain popularity and momentum if the
story is hot, and lose some if it's cold." It is for the
viewer's own active storylines only (`storylines.notYours`, `storylines.ended`
otherwise; the omniscient viewer runs nothing).

### No delete

There is deliberately no delete command. Segments keep `storylineIds` pointing
at their storylines, and a show's history should still say which story a match
belonged to. Ended storylines stay, read-only.

## Linking

CRTV4-01. A segment on one of your cards counts for a storyline only when it is
**linked** to it: `segments.storylineIds`. Links are always explicit, for the
player and the computer alike (the rival booker writes `storylineIds` itself
through the card writer), so the story shield is never applied by accident.

**Suggestions, never automatic links.** `storylines.linkOptions { segmentId }`
lists, for a segment on a show the viewer runs (anyone else gets
`{ kind: 'unavailable', reason }` with `notYourShow`):

- `linked`: the storylines it is linked to, with who from each is in it
  (`membersHere`), whether it is still active, whether this segment is its
  finale, and where the finale is when it is elsewhere (show name and slot);
- `suggestions`: active storylines of the show's promotion, and of the show's
  brand when the storyline has a brand, with at least one member in the
  segment and not linked yet. Most members present first, then the hottest,
  then id;
- `others`: the remaining active storylines it could be linked to;
- `canSetFinale` (a match on a card that can still change), `maxLinks` and
  `locked` (the show has run, was cancelled or its day has passed).

**Counts only when a member is in it.** A member is in a segment when they are
a participant in any role: competitor, ringside, interferer, speaker or
subject (`membersInSegment`). Linking a segment nobody from the story is in is
allowed, because the card can still change, but booking warns and the heat
step (CRTV4-02) skips it.

**Commands.** Both check the show with the calendar's `controlsShow` against
the controller that issued them, so the computer can't change your card. A
card that can no longer change refuses with booking's `showCompleted`,
`showCancelled` or `showPast`. There is no lock (EVT2-09).

- `storylines.linkSegment { segmentId, storylineIds }` replaces the whole list
  (0 to `storylines.link.maxPerSegment`). Refusals: `notYourShow`,
  `storylines.segmentNotFound`, `storylines.notFound`,
  `storylines.otherPromotion` (a rival's storyline),
  `storylines.storylineEnded` (only for a newly added one: keeping a link to a
  story that has ended since is allowed, it just won't count),
  `storylines.brandMismatch` (the storyline's brand is not the show's) and
  `storylines.tooManyLinks` ("A segment can count for at most 2 storylines").
  Removing a storyline whose finale is this segment clears the finale in the
  same change.
- `storylines.setFinale { storylineId, segmentId | null }` marks one linked
  match as the storyline's finale: the segment must be a match
  (`storylines.notAMatch`), already linked to the storyline
  (`storylines.notLinked`), on a card you can still change. Moving the finale
  from another unplayed match is allowed (the screen confirms first); once the
  finale has been played it can't be moved or cleared
  (`storylines.finaleAlreadyPlayed`). `null` clears it.

**Finale rules.** A storyline has at most one finale, always a linked match
(invariant `finaleIsLinkedMatch`). Booking keeps it so: the
`storylines.clearFinaleOnRemove` segment hook (booking's `registerSegmentHook`)
clears the finale when its segment is removed or the card cleared, when it
becomes a talking segment, or when a rewrite drops the link. The hook runs
inside the card writer, so the rival booker's changes are covered too.

**Warnings.** The `storylines.links` booking check (order 250, checklist line
"Storyline links count") only warns; it never stops a show from running:

| Code                              | Message                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| `storylines.noMemberInSegment`    | "Slot 3 is linked to 'X' but none of its members is in it: it won't count" |
| `storylines.linkedStorylineEnded` | "'X' has ended: this link won't count"                                     |
| `storylines.finaleNotAMatch`      | "'X' finale is in Slot 3, but it is no longer a match" (defensive)         |

**Tunable.** `storylines.link.maxPerSegment` (2, 1 to 12): the most storylines
one segment can be linked to and count for.

**In Booking (CRTV4-04).** The segment editor has a **Storyline** section
(`registerSegmentEditorSection`, id `storylines`, order 50, matches and
talking segments): suggestion chips ("Ashfall Rivalry · 2 here · heat 54",
one tap links), the linked rows with their heat meter ("Hot" from
`storylines.heat.hotFrom`), Unlink and, for a match, a **Finale** switch, and
a **Link another storyline** picker for `others`. Unlike the editor's other
sections it does not wait for Save: each change runs `storylines.linkSegment`
(the whole new list) or `storylines.setFinale` straight away, and the new list
is patched into the draft so the sheet's Save writes the same links back. A
new segment has no id until it is saved, so its section says "Save the
segment first to link a storyline". Moving a finale from another match asks
first ("Move the finale of 'X' here from <show>, Slot 3?"). Refusals show
under the section in the engine's words. At the limit the chips and picker
are off with "A segment can count for at most N storylines"; a show that has
run shows the links read-only with the reason. On the card, a linked slot
shows "Story: <name>" and "Finale" chips (booking's `registerCardSlotChips`).

## Heat after a linked segment

<a id="heat-after-segment"></a>

CRTV4-02. After a segment is rated on show night, each storyline it counts for
moves its heat **toward the segment's score**: a great segment heats the story
up, a poor one cools it. A second linked segment of the same storyline on the
same show counts for less, so heat is built over several shows, not by filling
one card with the same feud.

**When a segment counts.** Only when it is linked to the storyline and at
least one member of the storyline is in it, in any role
([`membersInSegment`](#linking)). A linked segment with nobody from the story
in it, a storyline that ended before the show and a storyline that no longer
exists change nothing: the step writes no row and only logs why (the show's
`storylines.showProgress` says so to the player). Rival promotions follow
exactly the same rule (D-01).

**The formula** (`heatAfterSegment`, `formulas/heatAfterSegment.ts`; no rolls):

- `gap = segment score − heat before` (the segment's `rating.score`, 0 to 100);
- `pull = storylines.heat.pull × storylines.heat.repeatFactor^(k − 1) ×
(pre-show ? storylines.heat.preShowFactor : 1)`, where `k` is 1 for the
  storyline's first counted segment on this show, 2 for its second, and so on;
- `step = gap × pull`, kept within ±`storylines.heat.maxStep` ("Most heat one
  segment can move");
- `heat after = heat before + step`, kept within 0 to 100.

| Tunable                         | Default | Range | What                                                  |
| ------------------------------- | ------- | ----- | ----------------------------------------------------- |
| `storylines.heat.pull`          | 0.4     | 0–1   | Share of the gap one segment closes. 0: never moves   |
| `storylines.heat.repeatFactor`  | 0.5     | 0–1   | Multiplier per further segment on one show            |
| `storylines.heat.preShowFactor` | 0.5     | 0–1   | Multiplier for a pre-show segment                     |
| `storylines.heat.maxStep`       | 15      | 0–100 | Most heat one segment can add or take. 0: never moves |

Worked numbers with the defaults (the formula tests):

| Heat before | Score | Segment                         | Heat after         |
| ----------- | ----- | ------------------------------- | ------------------ |
| 50          | 80    | first tonight                   | 62                 |
| 62          | 80    | the same story's second tonight | 65.6               |
| 50          | 30    | first tonight                   | 42                 |
| 20          | 90    | first tonight                   | 35 (capped at +15) |
| 50          | 80    | pre-show                        | 56                 |
| 0           | 0     | first tonight                   | 0                  |
| 99          | 100   | first tonight                   | 99.4               |

`pull` 0 or `maxStep` 0 leave heat where it is; `repeatFactor` 0 makes a second
segment that night change nothing and 1 counts it in full.

**What it writes.** The step is a segment result applier,
`storylines.heat` at order 60 (after the title outcome at 10, MTCH3's aftermath
at 30, MTCH4's physical toll at 40 and MTCH6's chemistry at 50; see
[show-night.md](show-night.md#segment-result-appliers)), so it runs on every
show that runs a card, the player's and every rival's. For each storyline the
segment links, in id order, it sets `heat`, sets `lastProgressOn` to the show's
date (CRTV3's [cooling grace](#heat-decay) restarts from it), appends a
`progress` row (`heatBefore`, `heatAfter`, `traceId`), adds to
`progressTotals`, and publishes `storyline.progressed`.

**Traces.** The player's storylines keep the step's Why? under
`storylines.heatStep` with the id `<storylineId>/<segmentId>` (the row's
`traceId`), and the same trace as the storyline's current `storylines.heat`,
so the heat meter's Why? shows the latest change. The trace starts at "Heat
before '<segment>'", shows the gap to the segment's score, the pull, any
"Second linked segment for this story tonight" or "Pre-show segment"
reduction, and the "Most heat one segment can move" cap. A rival's heat is
private, so its storylines keep only a summary of the current heat and no step
trace (`traceId` null), which keeps rival show nights lean. Older step traces
drop to summaries under `sim.traceRetentionPerKind` and when the roll-up drops
their row; the screens show a summary's headline.

**History.** Owner rule (POL4-08): the progress log keeps only about the last
28 days (`history.keepDetailDays`). The weekly `history.rollUp` drops older
rows before it prunes old cards, so their segments go with the rest of the
card (a finale stays); `progressTotals` keeps the all-time counts the payoff
(CRTV4-03) and the screens need. A screen reading past the window says
"Details are kept for the last 4 weeks." A year of the default world with
linked weekly segments ends with heats spread between the floor and the high
70s, not pinned at 100.

**Heat before, for the story shield.** `heatBeforeSegment(read, storylineId,
segmentId)` (`card/heatBefore.ts`) is the heat the story had walking into the
segment: the progress row's `heatBefore` once the segment has counted, else the
storyline's current heat (null for an unknown storyline). WRK8's story shield
judges a loss by it (wired in CRTV4-06), not by the heat after the loss's own
segment moved it. Likewise MTCH8's crowd bonus reads heat before the segment
is rated, while this step runs after it: a later segment of the same story on
the same show sees the heat the earlier one left.

**Queries** (own promotion only; a rival's heat stays private):

| Query                     | Args                  | Returns                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storylines.showProgress` | `{ eventInstanceId }` | `{ kind: 'ok', segments, pastDetailWindow }`: per linked segment in running order, `rows` (`storylineId`, `name`, `heatBefore`, `heatAfter`, `traceRef`, `finale`), `notCounted` (`storylineId`, `name`, `reason`; only once run) and `protectedLosers` (losers who are members of a counted storyline). `unavailable` with `notYourShow` or `storylines.showNotFound` |
| `storylines.timeline`     | `{ storylineId }`     | `{ kind: 'ok', rows, totals, keptDays }`: progress rows newest first with show name, date, `slot`, `preShow`, the show's `format`, `kind`, segment label, heat before and after, `traceRef` and `finale`; `totals` is `progressTotals`. `unavailable` with `storylines.notFound` or `storylines.notYours`                                                              |

`traceRef` is null when the trace is gone (`ctx.traces.has`).

## Payoff threshold

CRTV4-03 pays a storyline off when it ends ([Payoff](#payoff)). A storyline
needs at least `storylines.payoff.minSegments` (4) counted segments for that
(`progressTotals.segments`, all time); 0 means any storyline can.
`storylines.detail`'s `ending.payoff` reads the payoff record:

- `paid`: the record says it paid (`payoffTraceRef` is its Why? while kept);
- `tooFew`: the record says it had too few counted segments;
- `notAvailable`: it ended before payoffs existed, so there is no record.

## Payoff

<a id="payoff"></a>

A storyline built over several shows is worth something when it ends; one that
ends cold costs its people. CRTV4-03, code in `formulas/payoffQuality.ts`,
`formulas/memberPayoff.ts`, `card/planPayoff.ts`, `card/payoff.ts` and
`card/payoffQuery.ts`.

### The formula

- **Eligibility** (`payoffEligible`, a decision `pay` / `noPayoff`): at least
  `storylines.payoff.minSegments` counted segments. Fewer pays nothing and says
  "No payoff (needs 4 linked segments, has 3)". The count is
  `progressTotals.segments`, never the kept linked segments: history detail is
  rolled up after 28 days, the totals are not.
- **Quality** (`payoffQuality`): `q = clamp((heat − neutralHeat) ÷ heatSpan,
−1, 1)`, with the heat the storyline ends at.
- **Finale:** when the storyline's finale match (`finaleSegmentId`) was played,
  a positive `q` is multiplied by `finaleFactor` ("Paid off with a finale"). A
  negative `q` is never made worse by a finale.
- **Popularity per member** (`memberPayoff`): `popularityMax × q`. A gain is
  also multiplied by the member's room to grow, `headroom = clamp((heat +
headroomMargin − marketPop) ÷ headroomSpan, 0, 1)`, where `marketPop` is the
  member's footprint popularity among the promotion's fans (WRK1's
  `footprintPopularityAt`, the number expected push uses). A star already
  bigger than the story gains little or nothing ("Already bigger than this
  story"). A loss is never reduced by headroom.
- **Momentum per member:** `momentumMax × q`.
- **Where the popularity lands:** the promotion's regions with popularity of at
  least `minRegionPop`, each weighted by that popularity ÷ 100, in region-id
  order. A promotion with none skips everyone: "The promotion has no fan base
  big enough to notice".
- Members without an active employment at the promotion are skipped: "Left the
  promotion: no payoff".

No rolls and no rounding: WRK1's doors taper, clamp and round what they store.

| Tunable                            | Default | What it does                                 |
| ---------------------------------- | ------- | -------------------------------------------- |
| `storylines.payoff.minSegments`    | 4       | Counted segments needed (CRTV3-01's key)     |
| `storylines.payoff.neutralHeat`    | 50      | Heat that pays nothing either way            |
| `storylines.payoff.heatSpan`       | 40      | Heat from neutral to a full payoff           |
| `storylines.payoff.popularityMax`  | 4       | Popularity at full payoff                    |
| `storylines.payoff.momentumMax`    | 10      | Momentum at full payoff                      |
| `storylines.payoff.finaleFactor`   | 1.25    | Multiplier on a gain with a played finale    |
| `storylines.payoff.headroomMargin` | 10      | Popularity above the heat that gains in full |
| `storylines.payoff.headroomSpan`   | 20      | Popularity over which the gain shrinks to 0  |
| `storylines.payoff.minRegionPop`   | 20      | Promotion popularity a region needs to count |

### Worked numbers

From `test/systems/storylines/formulas/payoff.test.ts`, with the defaults:

| Case                                     | Quality | Popularity | Momentum |
| ---------------------------------------- | ------- | ---------- | -------- |
| Heat 80, no finale                       | 0.75    | 3 × room   | 7.5      |
| Heat 80, finale, member at market pop 50 | 0.9375  | 3.75       | 9.375    |
| Heat 80, finale, member at market pop 85 | 0.9375  | 0.9375     | 9.375    |
| Heat 80, finale, member at market pop 95 | 0.9375  | 0          | 9.375    |
| Heat 30, any member, finale or not       | −0.5    | −2         | −5       |
| Heat 50                                  | 0       | 0          | 0        |
| Heat 90 / 10 (100 / 0 clamp there)       | ±1      | ±4 × room  | ±10      |
| 3 counted segments (min 4)               | 0       | 0          | 0        |

### Decisions

- **Negative payoffs really lower popularity.** A cold storyline costs its
  members popularity and momentum, with no floor that turns a small loss into
  a gain (notes 03 §9.5 had one; ours fixes that on purpose).
- **The payoff goes through WRK1's doors.** Each paid member gets one
  `applyPopularityChange` (subject the person, the plan's region weights, the
  traced delta) and one `applyMomentumChange`, source `player` for a human
  promotion and `ai` otherwise, reason `storyline.payoff` "Storyline payoff:
  '<name>'". A zero delta goes through and the door records nothing.
- **Morale is not part of the payoff**, and a loss inside a hot storyline never
  costs morale here (D-09). The happiness a hot storyline brings is WRK8's
  appearance bonus. Hype from a hot storyline is ECO's (it can subscribe to
  `storyline.paidOff`).
- **One rule for everyone** (D-01): the payoff is the
  `storylines.payOffOnEnd` subscription to `storyline.ended`, so the player's
  `storylines.end` and a rival ending its storylines (AIP6) pay the same way.

### One planner

`planPayoff(read, tunables, storylineId)` works the whole payoff out without
writing: `eligible`, the `outcome` decision, `quality`, `regionWeights` and
each member's `name`, `employmentId`, `marketPopularity`, traced `popularity`
and `momentum` and `skippedReason`. The preview query and the subscription
both call it, so the preview and the real payoff never disagree.

When the storyline ends the subscription applies the plan, then stores the
record `storyline.payoff` (`paid`, `on`, `countedSegments`, `heat`, each
member's `popularityDelta`, `momentumDelta` (the change asked of the doors;
0 when not paid) and `skipped`, and `traceId`), records the trace and
publishes `storyline.paidOff`, also when it paid nothing, so news can say the
story fizzled out. A storyline is paid off once: an ended storyline with a
record is left alone.

### Who sees what

`storylines.payoff { storylineId }` returns:

- `{ kind: 'preview', plan }` while the storyline is active: what ending it
  today would pay, members with names and the traced lines inline;
- `{ kind: 'paid' | 'noPayoff', record, traceRef }` once it ended (`traceRef`
  null when the trace is gone);
- `{ kind: 'unavailable', reason }`: `storylines.notFound`,
  `storylines.notYourStoryline` (a rival's storyline) or
  `storylines.noPayoffRecord` (ended before payoffs).

The numbers, the record and the trace are the storyline's own promotion's
(and the omniscient viewer's). The popularity itself is public through each
worker's profile, like any other popularity change.

## Context

`storylineContextFor(read, storylineId, date)` is the shared engine-side
reader. WRK8 (the story shield), CRTV4 (heat after segments, the payoff) and
AIP4 (rival cards) read it instead of each writing its own reader. It returns
null for an unknown id, otherwise:

| Field               | What                                              |
| ------------------- | ------------------------------------------------- |
| `storylineId`       | The id                                            |
| `promotionId`       | Its promotion                                     |
| `brandId`           | Its brand, or null                                |
| `name`, `status`    | As stored                                         |
| `heat`              | 0 to 100                                          |
| `startedOn`         | As stored                                         |
| `lastProgressOn`    | As stored, or null                                |
| `daysSinceProgress` | Days from `lastProgressOn ?? startedOn` to `date` |
| `members`           | In stored order, with their sides                 |
| `linkedSegmentIds`  | The kept segments that link it, in id order       |
| `finaleSegmentId`   | The finale, or null                               |

`storylinesOfPerson(read, personId, { status? })` lists the storylines a person
is in, in every promotion (every status unless `status` is given), and
`activeStorylinesOf(read, promotionId)` a promotion's active ones. Both are in
id order.

None of these filter by viewer. They are for engine code only; a query that
shows storylines to a player must scope them by the rules below.

## Viewer rules

- A viewer who runs the storyline's promotion, or the omniscient viewer, gets
  the full row.
- Anyone else gets the public row: name, status, dates, brand and members with
  their sides. `heat`, `isHot`, `heatTraceRef`, `linkedSegmentCount`,
  `lastProgressOn` and `daysSinceProgress` are null and `editable` is false.
  `storylines.detail` gives them no summary, an empty timeline and no ending.
- `editable` is true only for an active storyline of a promotion the viewer
  runs. The omniscient viewer sees everything and edits nothing.
- `storylines.memberOptions` is refused with `storylines.notYours` for a
  promotion the viewer does not run.

The queries:

| Query                      | Args                          | Returns                                                                                                                                                              |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storylines.list`          | `{ promotionId?, status? }`   | `{ promotionId, rows, activeCount, softLimit, hotFrom, editable }`; default the viewer's first promotion and `active`; refused `storylines.noPromotion` with neither |
| `storylines.detail`        | `{ storylineId }`             | The row plus `summary`, `timeline` and `ending`; refused `storylines.notFound` for an unknown id                                                                     |
| `storylines.forPerson`     | `{ personId, includeEnded? }` | `{ personId, rows }` across every promotion, each row scoped on its own                                                                                              |
| `storylines.memberOptions` | `{ promotionId? }`            | `{ promotionId, options }`: everyone with an active contract there, wrestlers first, then by push, then name                                                         |

List order: active storylines first, hottest first (public rows after) then by
name; ended storylines after, most recently ended first.

The timeline lists the linked segments by show date, the pre-show before the
main card, then slot: segment, show, date, slot, kind, a label (the billing
line, else who was in it), stars once rated, the rating trace and whether it
is the finale. No entry has a duration, length or minutes (D-10).

## Events

Payloads hold ids and primitives only
([day-pipeline.md](day-pipeline.md#payload-rules)). CRTV3-02 and CRTV3-03
publish them.

| Event                      | Payload                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storyline.started`        | `{ storylineId, promotionId, source: 'player' \| 'setup' \| 'ai' }`                                                                                   |
| `storyline.ended`          | `{ storylineId, promotionId, linkedSegments }`                                                                                                        |
| `storyline.membersChanged` | `{ storylineId, promotionId, added, removed, sideChanged }`                                                                                           |
| `storyline.progressed`     | `{ storylineId, promotionId, segmentId, eventInstanceId, heatBefore, heatAfter }`: once per counted storyline per segment, every promotion (CRTV4-02) |
| `storyline.paidOff`        | `{ storylineId, promotionId, paid, memberCount, quality }`: once per ended storyline, also when `paid` is false (CRTV4-03)                            |

## Traces

All three kinds are stored under the storyline's id.

- `storylines.heat` (`storylineHeatTraceRef`): one current heat trace per
  storyline: the starting heat, then the latest cooling step, then CRTV4's
  progress. Rows show it as `heatTraceRef` when kept.
- `storylines.starter`: why a starter storyline was picked (CRTV3-02),
  served as `startedBecauseTraceRef`.
- A rival's heat and starter traces are kept as summaries only; an ended
  storyline's become summaries once it ended more than
  `history.keepDetailDays` ago ([Heat decay](#heat-decay)).
- `storylines.payoff` (`storylinePayoffTraceRef`, CRTV4-03): the payoff, a
  decision with the eligibility, the quality and one child per member. A
  rival's is a summary only; it is demoted with the heat and starter traces
  once the storyline ended more than `history.keepDetailDays` ago.
- `storylines.heatStep` (`storylineHeatStepTraceRef`, CRTV4-02): one linked
  segment's heat step, id `<storylineId>/<segmentId>`, the player's storylines
  only ([Heat after a linked segment](#heat-after-segment)).

## Wired with

CRTV3-05 checked every partner against the Sprint 11 base (main plus the
CRTV1, CRTV3, CRTV4-01 and MTCH5 work) and wired only the ones there.

| Partner | On main? | Wiring                                                                                                                                                                                                                                                                        |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WRK1    | Yes      | Member names on the desk cards (`StorylineSides`) and the storyline page's member rows are `WorkerLink`s to `routes.game.worker(personId)`. Each starting-heat popularity line carries a person ref, so the heat Why? links the member through the app's entity-link renderer |
| CRTV4   | Partly   | Only CRTV4-01 (links, finale) is there. Heat after segments, the timeline's heat before → after and the `paid` payoff are wired from CRTV4's pack (CRTV4-02 onwards)                                                                                                          |
| WRK8    | No       | Wired from its pack: story shield through `storylineContextFor`, the Reaction preview's Storyline choice, the shield line and the meter's hot threshold                                                                                                                       |
| MTCH8   | No       | Wired from its pack: `match.stakesOptions` rows from `activeStorylinesOf` and CRTV3's row builder                                                                                                                                                                             |
| CRTV7   | No       | Wired from its pack: `turnImpact`'s storyline-heat line from `storylinesOfPerson` / `storylineContextFor`                                                                                                                                                                     |
| AIP3    | No       | Wired from its pack: the "never storyline members" exclusion through `storylinesOfPerson(read, personId, { status: 'active' })`                                                                                                                                               |
| AIP6    | No       | Wired from its pack: rival storylines start and end through `startStoryline` / `endStoryline`                                                                                                                                                                                 |
| ECO3    | No       | Wired from its pack: a storyline-heat hype source over `activeStorylinesOf` (the crowd forecast's hype line is still the constant 1)                                                                                                                                          |

The member picker in the New storyline and Add member sheets keeps plain
names: each option row is one button (a link cannot sit inside a button), and
following a link from a chosen name would close the sheet and lose the
storyline being written. The names on the storyline page link instead.

ECO4-03's `hotStorylineFor` (contracts) and AIP4's `storylinesForShow` still
read the `storylines` table themselves; they are not CRTV3 partners and
keep working. WRK8 and AIP6 may move them onto the readers when they wire.
