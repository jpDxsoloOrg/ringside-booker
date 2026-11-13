# Match finishes

How a match ends: whether the win was clean, stolen by cheating, a count-out, a
disqualification or a mess, or whether nobody won at all. A segment already
holds the planned finish (`segments.match.finishKey`, null for "decided on the
night"); this doc covers the finish catalog that key points at and the rule
for which finishes a match may use (MTCH2).

Later tickets build on it: MTCH2-02 turns the effects into rating modifiers
and picks finishes automatically with MTCH2-03, MTCH2-04 shows them in the
Match lab, EVT3 reads `allowsTitleChange` and MTCH3 reads the gain factors.

Code: the schema and readers in `packages/engine/src/model/catalogs.ts`, the
pack record in `persistence/packs/records/catalogs.ts`, the catalog check in
`systems/match/catalog/finishes.ts`, the allowed-finish rule in
`systems/match/finishes/allowed.ts`, the segment check in
`systems/match/catalog/checkSegmentFinishes.ts` and the `match.finishes` query
in `systems/match/queries.ts`.

## Catalog

The base pack ships ten finishes in `content/base/catalogs/finishes.json`
(record kind `finish`). The file holds pack keys without a prefix (`clean`,
`count-out`); the new-game snapshot stores them in `meta.catalogs.finishes`
under content keys `finish.<key>` (`finishContentKey`). Like the other match
catalogs, a finish never becomes an entity and the running game reads it only
through `finishesOf(read)` (catalog order: `order`, then key) and
`finishOf(read, key)`.

**Effects are structured fields, never strings.** A finish says what it does
to a match in numbers the rating can read (`effects.workRate`,
`effects.crowd`), not as modifier text to be parsed.

| Field               | Type                           | Rules                                                                                                                                           |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`               | key                            | Becomes `finish.<key>`                                                                                                                          |
| `name`              | string                         | 1-40 characters                                                                                                                                 |
| `order`             | integer                        | 0-999, display order (lower first, ties by key)                                                                                                 |
| `summary`           | string                         | One line for the player, at most 140 characters                                                                                                 |
| `category`          | enum                           | `clean`, `cheating`, `countOut`, `disqualification`, `controversial`, `draw`, `noContest`                                                       |
| `outcomeKind`       | enum                           | `win`, `draw` or `noContest`: the segment `outcome` kind it produces                                                                            |
| `methods`           | `{ methodKey, weight }[]`      | Win methods by method pack key (a reference the loader checks), weight 1-100. Non-empty exactly when `outcomeKind` is `win`                     |
| `effects`           | `{ workRate, crowd }`          | Whole steps, -10 to 10 each, on the rating's work-rate and crowd parts (MTCH2-02 applies them)                                                  |
| `allowsTitleChange` | boolean                        | A title on the line may change hands. Never true for `draw` or `noContest`                                                                      |
| `gains`             | `{ winner, loser }`            | Popularity gain factors, 0-3 each. Stored and validated here; MTCH3 reads them                                                                  |
| `autoWeight`        | integer                        | 0-100, weight when a finish is picked automatically; 0 means never                                                                              |
| `requiresTwoSides`  | boolean                        | Only for matches with exactly two sides                                                                                                         |
| `matchTypes?`       | `{ only?[] } \| { except?[] }` | Match type pack keys (references). `only` admits just those types, `except` every type but those; at most one of the two. Left out = every type |

At runtime (`FinishEntrySchema`) the references are content keys
(`method.pinfall`, `match.singles`) and `matchTypes` is always present, `{}`
when the record left it out.

The shipped finishes (our own names and numbers):

| key                       | name                 | category         | outcomeKind | methods (weight)                    | workRate | crowd | allowsTitleChange | gains winner / loser | autoWeight | requiresTwoSides |
| ------------------------- | -------------------- | ---------------- | ----------- | ----------------------------------- | -------- | ----- | ----------------- | -------------------- | ---------- | ---------------- |
| `finish.clean`            | Clean finish         | clean            | win         | pinfall 6, submission 3, knockout 1 | 0        | +1    | true              | 1 / 1                | 60         | false            |
| `finish.flash`            | Flash finish         | clean            | win         | pinfall 1                           | −1       | 0     | true              | 0.6 / 0.5            | 10         | false            |
| `finish.cheating`         | Cheating finish      | cheating         | win         | pinfall 3, submission 1             | −1       | −1    | true              | 0.85 / 0.7           | 12         | false            |
| `finish.interference`     | Outside interference | cheating         | win         | pinfall 1                           | −2       | −1    | true              | 0.8 / 0.6            | 6          | false            |
| `finish.count-out`        | Count-out            | countOut         | win         | count-out 1                         | −3       | −2    | false             | 0.6 / 0.4            | 4          | true             |
| `finish.disqualification` | Disqualification     | disqualification | win         | disqualification 1                  | −4       | −3    | false             | 0.5 / 0.3            | 4          | true             |
| `finish.controversial`    | Controversial finish | controversial    | win         | pinfall 1                           | −2       | −4    | true              | 0.7 / 0.5            | 2          | false            |
| `finish.double-count-out` | Double count-out     | draw             | draw        | none                                | −3       | −3    | false             | 1 / 1                | 1          | true             |
| `finish.stalemate`        | Stalemate            | draw             | draw        | none                                | −2       | −3    | false             | 1 / 1                | 1          | false            |
| `finish.no-contest`       | No contest           | noContest        | noContest   | none                                | −5       | −5    | false             | 1 / 1                | 1          | false            |

There is deliberately no "time-limit draw": matches have no minutes (D-10).

**Catalog check.** `checkFinishCatalog(catalogs)` returns one issue per
problem and never throws; validate:world's `segment-keys` rule runs it on the
catalogs the packs build:

- every entry parses (`finishes.invalid`), sits under its own key
  (`finishes.keyMismatch`) and no two share a key (`finishes.duplicateKey`);
- every `methods[].methodKey` is a method (`finishes.unknownMethod`) and every
  `matchTypes` key a match type (`finishes.unknownMatchType`);
- every match type allows at least one `win` finish with `autoWeight > 0`,
  side count taken as the type's minimum, so an automatic finish always exists
  (`finishes.noAutoFinish`);
- a `win` finish with `allowsTitleChange: true` lists at least one method
  whose `changesTitles` is true (`finishes.noTitleMethod`).

**Old saves.** Catalogs are snapshotted at new game, so a game started before
finishes existed has no `meta.catalogs.finishes`. It loads as before;
`match.finishes` refuses with `noFinishCatalog` ("This save was started before
finishes existed. Start a new game to use finishes."), and the segment check
skips it.

## Allowed finishes

`allowedFinishes(catalogs, { matchTypeKey, sideCount?, stipulationKeys? })`
returns the finishes a match may use, in catalog order:

1. keep an entry when its `matchTypes` rule admits the match type;
2. drop `requiresTwoSides` entries when the match has more than two sides;
3. run the registered finish filters, lowest `order` first, ties by id.

`sideCount` is the number of sides actually built (in the lab or on the
card); left out, it is the match type's minimum side count (2 for a type the
catalog does not know).

**Filter seam.** MTCH7 (stipulations) narrows the list through
`registerFinishFilter({ id, order, filter(entries, ctx) })`, which returns an
unregister function, the same shape as `registerNewGameSetting`. `ctx` is
`{ matchTypeKey, sideCount, stipulationKeys }` with the defaults filled in. A
duplicate id throws `RegistryError`. A filter may only remove entries: one
that returns a finish it was not given throws `RegistryError` naming the
filter.

**`match.finishes`.** Arguments `{ matchTypeKey, sideCount? (2-30),
stipulationKeys?, outcomeKind? }`; the result is one `FinishOption` per
allowed finish: `{ key, name, summary, category, outcomeKind,
allowsTitleChange, effects, methods: { key, name, changesTitles }[],
autoPickable }` (`autoPickable` is `autoWeight > 0`). `outcomeKind` narrows the
list. An unknown match type refuses with `unknownMatchType` on the
`matchTypeKey` field. The catalog is public, so every viewer sees the same
answer.

**Stored segments.** `checkSegmentFinishes(read)`, run by validate:world's
`segment-finishes` rule, checks every match segment: `finishKey` is null or a
finish (`segments.unknownFinish`); the finish is allowed for the segment's
match type and its number of competitor sides (`segments.finishNotAllowed`);
a set `outcome` has the finish's `outcomeKind`
(`segments.finishOutcomeMismatch`); and a win's `methodKey` is one of the
finish's methods (`segments.methodNotInFinish`).

## Finish effects

A finish changes how a resolved match is received (MTCH2-02). Its catalog
`effects.workRate` and `effects.crowd` become one line each on the rating's
work rate and crowd stages, such as "Disqualification finish −4", through the
rating modifier seam ([match-rating.md](match-rating.md#pipeline-and-seams)):

```
effect = catalogPoints × match.finish.effectScale
crowd only, draws only: effect −= match.finish.drawCrowdPenalty
```

`finishEffect({ target, finishName, catalogPoints, outcomeKind }, { tunables })`
in `systems/match/formulas/finishEffect.ts` computes it. The trace starts at
the catalog points labelled with the finish ("Disqualification finish"; a
name that already ends in "finish", such as "Clean finish", is kept), then
multiplies by "Finish effect scale" and, for a draw's crowd, subtracts "Draw:
the crowd wanted a winner". Nothing is clamped here: the stages' soft
compression runs after every modifier. With `effectScale` 0 the effects
vanish; with `drawCrowdPenalty` 0 the draw line stays but does nothing.

The modifiers `match.finishWorkRate` (work rate stage) and `match.finishCrowd`
(crowd stage) sit at `RATING_ORDER.normal` in
`systems/match/finishes/modifiers.ts` and are built-ins: they register with
the raters, so `resetMatchRegistriesForTests` keeps them. They apply only to a
match whose rating input carries a `resolution`:

```ts
interface MatchResolution {
  outcome: MatchOutcome; // win (winningSide, methodKey), draw or noContest
  finishKey: ContentKey;
  methodKey: ContentKey | null; // the win's method, null when nobody won
}
```

`MatchResolutionSchema` (`systems/match/finishes/resolution.ts`) checks that
`methodKey` agrees with the outcome. The rater, `match.simulate` and EVT3
share this shape. `match.preview` rates an unresolved match (no `resolution`),
so its results do not change; `ratingInputFromSegment` fills the resolution
from a stored match that has both an `outcome` and a `finishKey`, else null.
A resolution naming a finish the catalogs do not hold leaves a note and no
effect. The outcome must be resolved before the segment is rated, because the
finish feeds the rating.

## Finish on the night

When the booker left the finish open, `autoFinish({ candidates,
winnerAlignment }, { tunables, rng })` (`systems/match/finishes/autoFinish.ts`)
picks one: a decision "Finish decided on the night" with the rule "Only
finishes this match type allows". The caller passes the allowed finishes
(`allowedFinishes`) narrowed to the outcome kind, so a disallowed finish can
never come up.

Each candidate's weight is its `autoWeight`, times
`match.autoFinish.heelCheatingFactor` for a `cheating` finish when the winner
is a heel (a "The winner is a heel" branch records the check). Candidates
that weigh 0 are listed with "Never picked automatically" and left out of the
roll; the pick is one weighted roll labelled "Finish". One candidate is used
without a roll ("Only finish available"); if every candidate weighs 0 the
first in catalog order is used, with a note.

The decision's options are the finishes' names ("Clean finish",
"Disqualification"), so the Why? reads as words; the returned value is still
the content key. Two candidates that share a name show as "name (key)".

`winnerAlignmentOf(alignments)` gives the winning side's alignment: the one
most members have, `tweener` on a tie, null when nobody on the side is
employed by the promotion (pass null for them).

Rolls draw from the stream the caller hands over: `match.simulate` a detached
preview stream, EVT3 the world's `match.finish` stream (`MATCH_FINISH_STREAM`).

## Method

`chooseMethod({ finish, plannedMethodKey, methodNames }, { rng })`
(`systems/match/finishes/chooseMethod.ts`) decides how the match ended:

- a draw or no contest has no method: null, with the note "No method: nobody
  won";
- a booked method the finish lists is kept ("Booked method");
- otherwise a finish with one method uses it without a roll, and one with
  several rolls by the finish's method weights (roll label "Method").

As with the finish, the options are the methods' names ("Pinfall"), and a
booked finish's "Finish" decision chooses the finish's name.

A booked method the finish does not list is the caller's error and throws;
MTCH2-03 checks it first and refuses with a reason.

## Title changes

A title on the line changes hands only when **both** hold:

1. the method can change titles (`changesTitles` in the method catalog);
2. the finish allows a title change (`allowsTitleChange`).

`titleCanChange({ finish, method })` (`systems/match/finishes/titleRule.ts`,
exported from the engine for EVT3) records both as rules of the decision "Can
the title change hands?". A draw or no contest has no method, so it never
moves a title, and neither do a count-out or a disqualification. The reason
names the failing condition, for example "Disqualification: titles can't
change hands on this finish".

## Auto winner

When nobody booked a winner (every match on your shows in
[Random winners](#random-winners) mode, or a rival match whose card was written
before AIP5 booked results; rival bookers plan their own winner and finish
since AIP5-06), the
winner is decided automatically (MTCH2-03). Each side gets a score
(`autoWinnerScore`, `systems/match/formulas/autoWinnerScore.ts`), with means
over the side's competitors:

```
score = match.autoWinner.popularityWeight × mean(popularity in the show's region)
      + mean(match.autoWinner.push.<push>)
      + match.autoWinner.momentumWeight × mean(momentum ?? 0)
      + mean(match.autoWinner.alignment.<alignment>)
```

Each term is one labelled step of the trace: "Popularity in <region>", "Push",
"Momentum" and "Alignment". A null momentum counts 0 with the note "No momentum
yet (counts as 0)"; a null alignment (not employed by the promotion) counts 0
with the note "Not employed here". Nothing is clamped.

The inputs come from the world through `autoWinnerInputsOf(read, { promotionId,
regionId, sides })` (`systems/match/finishes/autoWinnerInputs.ts`): popularity
is `person.regionalPop[regionId]` (0 when absent), and push, momentum and
alignment come from the person's **active** employment with the promotion
running the show. Free agents and other promotions' workers (the lab's
"Everyone" picker) get push `none`, momentum null and alignment null. Only
competitors count; `competitorSidesOf(participants)` drops ringside people and
interferers, who never win. Sides come out in side order and competitors in
person id order.

`autoWinner({ sides, randomness, mode }, { rng })`
(`systems/match/finishes/autoWinner.ts`) then picks the side:

- each side's total is its score plus, when the randomness is above 0, one
  roll `rollFloat(rng, −randomness, randomness)` labelled "Unpredictability,
  Side N"; at randomness 0 there is no roll and the note "No unpredictability
  (0)";
- the rule "Highest score wins" picks the highest total;
- on an exact tie, the rule "Tie broken by lowest person id" picks the side
  whose lowest competitor id sorts first.

It never produces a draw, and a side with nobody competing is never passed in.
The decision is labelled "Winner decided automatically", or "Random winners
mode, winner decided on the night" in Random winners mode, and the randomness
(a tunable read) is its first child. When the winner's score (before the roll)
is below the best score, the decision notes the upset in words: "Upset: Side 2
had a lower score than Side 1" (`upsetNote`).

A third mode, `coinFlip` (a match booked as Random, see
[Auto and Random](#auto-and-random)), ignores the scores and the randomness:
every side scores 0 and draws one `rollFloat(rng, 0, 1)` labelled "Side N
drew" on the same `match.auto-winner` stream, so each side has an equal chance.
The highest draw wins ("Highest draw wins"), with the same tie-break. The
decision is labelled "Random: every side had an equal chance".

The randomness is `match.autoWinner.randomness` (5 by default; 0 makes the
auto-winner fully deterministic) or, in Random winners mode,
`match.randomWinners.randomness` (60, at least 1). The rolls draw on the
`match.auto-winner` stream (`MATCH_AUTO_WINNER_STREAM`); stream names are
lowercase, so it is not `match.autoWinner`.

## Resolving a match

`resolveMatchOutcome(input, deps)` (`systems/match/finishes/resolve.ts`) is the
one entry point the Match lab's Simulate (MTCH2-04) and the show night (EVT3)
call. It is pure: it reads only its input, the catalogs and the tunables, and
draws only on the streams `deps.rng(name)` hands it (`match.auto-winner` and
`match.finish`).

The input is the match type, its stipulations, the sides (as
`autoWinnerInputsOf` returns them), the region's name, the mode (`standard`,
`randomWinners` or `coinFlip`) and the plan: `winner` (`'auto'`, `{ side }` with the
stored 0-based side, or `'draw'`), `finishKey` (null for Auto) and `methodKey`
(null to let the finish decide). The steps:

1. **Allowed finishes**: `allowedFinishes` for the match type, the number of
   sides and the stipulations. A planned finish outside them is
   `finishNotAllowed`.
2. **Outcome kind**: the planned finish's `outcomeKind`, else `draw` for a
   planned Draw, else `win`. A planned side with a finish nobody wins, or a
   Draw with a finish that is not a draw, is `finishOutcomeMismatch`.
3. **Random winners**: in Random winners mode a planned side, Draw, finish or
   method is `randomWinners` ("Results on your shows are decided on the night
   (Random winners).").
4. **Winner** (wins only): the planned side, or `autoWinner` over the sides
   with somebody competing. A planned side the match does not have, or with
   nobody competing on it, is `unknownSide`; a match with nobody competing at
   all is `noCompetitors`.
5. **Finish**: the planned one, or `autoFinish` over the allowed finishes of
   that outcome kind (and, with a planned method, only those listing it), with
   the winner's alignment (`winnerAlignmentOf`; null without a winner). None
   left (a Draw on a match type with no draw finish) is `noFinishAvailable`.
6. **Method**: `chooseMethod`. A planned method the finish does not list (or,
   with an Auto finish, that no candidate lists, or any method on a draw) is
   `methodNotInFinish`.

Every plan problem (steps 1–3, the planned side and the planned method) is
found before anything is rolled, and all of them are returned together, each
with a `field` (`plan.finishKey`, `plan.winner`, `plan.methodKey` or `plan`).
The codes are `RESOLVE_MATCH_REASON_CODES`.

On success the result is a `Traced<MatchResolution>`: the trace is one
decision "Match result" (value "Side 2 wins", "Draw" or "No contest", reason
the finish and method) whose three children are the winner decision ("Who
won", or the auto-winner), the finish decision ("Finish" for a booked one, or
"Finish decided on the night") and the method decision, so one Why? shows the
whole reasoning. Nothing is written to the world: morale, momentum and
popularity belong to EVT3, WRK8 and MTCH3.

## Auto and Random

Per match, the booker can leave the result to the night (MTCH2-08) from the
segment editor's Result list or the card row's Winner ▸ menu, next to the
sides, Draw and No contest:

- **Auto (the match decides)**: the [auto-winner](#auto-winner) in `standard`
  mode, from who is in the match, with `match.autoWinner.randomness`, so the
  favourite usually wins but upsets happen. The Match lab's Winner: Auto is
  the same thing, under the same name.
- **Random (coin flip)**: the auto-winner in `coinFlip` mode, an equal chance
  for every side whoever is in it.

The choice is stored as `match.resultPlan` (`'auto'` or `'random'`) with
`outcome: null` (see [data-model.md](data-model.md)); `noPlannedResult` counts
it as a result, so the card can run on show day. On show night
`match.resolveOutcome` turns Auto into the plan `winner: 'auto'` and Random
into the same plan in `coinFlip` mode, each with the booked finish when there
is one (and without it if that finish is refused). Neither ever gives a draw,
so a booked finish must be one somebody wins (booking.md, Finishes). A title
changes hands only if the finish and method allow it (the
[title rule](#title-changes)), as for a planned result. The result line's Why?
on the results page opens the match result, whose "Who won" child is the
auto-winner (with the upset note) or the coin flip.

This is not the game-wide [Random winners](#random-winners) setting: that one
decides every result on your shows on the night and refuses per-match choices,
Auto and Random included. Both run through the one `autoWinner` with a mode, so
tuning one never drifts from the other. Rival shows never use `resultPlan`;
their bookers plan their own results.

## Random winners

**Random winners** is a new-game setting (`randomWinners`, boolean, off by
default, group Difficulty), registered by `systems/match/settings.ts` and
stored in `WorldMeta.settings.extra`, so a save from before it reads false.
The wizard's Options step shows it from the registry with no web change.

With it on, you still book every match on your shows, but not who wins: each
result is decided on the night through the auto-winner with the larger
`match.randomWinners.randomness`, and the trace starts "Random winners mode".
The rule is strict: a planned winner, Draw, finish or method on your shows is
refused (`randomWinners`), not silently ignored, so the booking screen can say
why.

`randomWinnersActive(read, { promotionId, brandId })`
(`systems/match/finishes/randomWinners.ts`, exported from the engine for EVT2
and EVT3) is true when the setting is on **and** the show's controller is
human: the brand's `controller` when the show's brand has one, else the
promotion's. Rival promotions (computer controllers) keep their own booking
logic. The Match lab is a sandbox: MTCH2-04 uses Random winners mode only
when the lab's winner is Auto in a Random winners game.

## Simulate

Since MTCH2-07 the Match lab's one **Run** simulates every match: it asks
`match.simulate` with the plan from the Winner and finish group (Auto by
default) and a fresh seed the web picks, and with Runs above 1 also
`match.simulateBatch` (below). A talking segment, which has no result, is
rated with `match.preview`; so is a match on a save from before finishes,
where the Winner and finish group says why.

The simulation itself (MTCH2-04) is the query `match.simulate`
(`systems/match/simulateQuery.ts`). Its arguments are `match.preview`'s plus
the plan: `winner` (`'auto'`, `'draw'` or `{ side }` with the stored 0-based
side), `finishKey` (null for Auto) and `methodKey` (null, the default, to let
the finish decide). Only a match can be simulated; an angle is `invalidArgs`,
and a save with no finish catalog is `noFinishCatalog`.

It builds the sides with `autoWinnerInputsOf` for the show's promotion and
region, resolves the plan with `resolveMatchOutcome` (no stipulations until
MTCH7), then rates the match exactly as `match.preview` does, with the
`resolution` on the rating input, so the work rate and crowd traces carry the
finish lines ("Disqualification finish −4", "Draw: the crowd wanted a
winner"). A refusal from `resolveMatchOutcome` comes back unchanged as
`{ ok: false, reasons }`.

Like every preview it never writes, never stores a trace and never draws from
the world's RNG. The winner and finish rolls come from
`detachedStream(meta.seed, 'match.auto-winner', String(previewSeed))` and
`detachedStream(meta.seed, 'match.finish', String(previewSeed))` (the finish
and method share one stream), the rating rolls from the preview's
`match.preview` stream. The same arguments always give the same night;
another seed can change the winner, finish and method. The rating rolls are
the same as `match.preview`'s for the same seed, so the two differ only by the
finish effects.

The result (`SimulateResult`) is the rated `preview`, the `outcome`, the
`finish` (`key`, `name`, `category`, `summary`, `allowsTitleChange`), the
`method` (`key`, `name`, or null without a winner), `winningSide` (0-based, or
null), the winners' names, the "Match result" decision as `resultTrace`, and
`randomWinnersMode`.

`randomWinnersMode` is true when the winner is Auto and Random winners applies
to the viewer's first promotion (`randomWinnersActive` with no brand). Then
the auto-winner uses `match.randomWinners.randomness` and the winner decision
is labelled "Random winners mode, winner decided on the night". The lab is a
sandbox, so a booked side or Draw is still honoured in a Random winners game
(standard mode); only the booking screen refuses it.

`match.simulateBatch` (MTCH2-07) takes `match.simulate`'s arguments plus
`runs` (1–500, like `match.previewBatch`). Run `i` is `match.simulate` with
seed `previewSeed + i`, so run 0 is the single Simulate with the same seed;
the lab sends the batch from seed `s` and the single night on `s + runs − 1`,
so the night shown in full is one of the nights counted. It returns
`match.previewBatch`'s statistics over the simulated nights (rated with their
finishes) plus `sides` (every side in order with its competitors' `names` and
`wins`, even with none), `draws`, `noContests`, `finishes` (`key`, `name`,
`category`, `count`; most common first, ties by name, unused finishes left
out) and `randomWinnersMode`. Side wins, draws and no contests add up to
`runs`, and so do the finish counts. No traces travel; like the preview batch
it never writes, and the tests check the engine state is byte-identical after
a 500-run batch. A plan that one night refuses refuses the whole batch.

`match.resultMode` (args `{}`) returns `{ randomWinners }`: the same check for
the viewer's first promotion, false for a viewer who runs none (the
all-seeing viewer, a computer seat). The lab's Winner choice and MTCH2-05's
booking editor read it so the web never reads world settings itself.

## Integration

MTCH2-05 wires MTCH2 to the features it works with that are on `main`. When
it ran, none of its partners were (EVT2 has since wired booking in EVT2-07): there was no `systems/booking/` (EVT2), no
`systems/shows/` (EVT3), no stipulation catalog (MTCH7) and no rival booking
step (AIP5). Each of them wires MTCH2 from its own integration ticket; the
doors they use are already open:

| Partner              | Status                  | The door it uses                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT2 (booking)       | wired (EVT2-07)         | The booking editor's Finish section reads `match.finishes` (with `outcomeKind`) through the lab's `FinishSelectView`; the `match.finish` booking check uses `allowedFinishes` and `titleCanChange`; `randomWinnersActive` refuses planned results (`randomWinners`), and `booking.card`'s `randomWinners` gives the editor "Decided on the night (Random winners)". See [booking.md](booking.md#integration). |
| EVT3 (show night)    | wired (EVT3-07)         | `match.resolveOutcome` registered with show night's `registerMatchOutcomeResolver` (`finishes/showNight.ts`); see [Show night](#show-night) below.                                                                                                                                                                                                                                                            |
| MTCH7 (stipulations) | wires from its own pack | `registerFinishFilter` with the stipulation keys in `ctx.stipulationKeys`; the lab's list, `match.finishes`, Simulate and `resolveMatchOutcome` all follow the filter.                                                                                                                                                                                                                                        |
| AIP5 (rival winners) | wired (AIP5-06)         | `pickRivalFinish` plans a finish with every rival result: `autoFinish` over `allowedFinishes` of the planned outcome kind, narrowed by `titleCanChange` for a planned change or a forced retention, then `chooseMethod` among the methods left. The finish is written with the result, so show night runs it as booked. See [rival-booking.md](rival-booking.md#how-a-rival-shows-results-are-decided).       |

Until EVT3-07 no real result used a finish, so every finish, auto-winner
and Random winners path is exercised through the Match lab's Run. Its
tests cover the MTCH7 door too: a registered filter that bans
disqualifications removes `finish.disqualification` and `finish.count-out`
from `match.finishes`, refuses them as a booked finish (`finishNotAllowed`)
and never picks them on the night.

### Show night

EVT3-07 registers `showNightOutcomeResolver` (`match.resolveOutcome`,
`systems/match/finishes/showNight.ts`) from the match bundle at module load,
replacing show night's built-in `plannedOrNoContest`. For every match on a
run card it calls `resolveMatchOutcome` with the match type and stipulations
from the stored segment, the competitors' auto-winner inputs
(`autoWinnerInputsOf`) and the world's `match.auto-winner` and `match.finish`
streams:

- **Plan.** The segment's `outcome` and `match.finishKey`: a planned win books
  its side and method (an Auto finish is then picked among the finishes that
  list the method), a planned draw books Draw, and no plan is Auto.
- **No plan.** An unplanned match (a rival card, or any match in a Random
  winners game) gets an automatic winner and finish, never a no contest.
- **Random winners.** Mode `randomWinners` when `randomWinnersActive(read,
{ promotionId, brandId })` is true. A result booked anyway is set aside and
  decided on the night, with the note "Random winners: the booked result was
  set aside and decided on the night"; show night cannot refuse a card it is running.
- **Booked no contest.** Kept, with a no-contest finish picked by `autoFinish`
  (the plan shape has no no-contest winner).
- **A refused plan** (a finish the match no longer allows, a finish that does
  not suit the winner) is tried again with only the winner booked, then falls
  back to the booked result without a finish; each step adds a note with the
  reasons.
- **Title rule.** `titleCanChange({ finish, method })` is returned with the
  resolution, so EVT3-04's title decision reads the method **and** the finish:
  a challenger's disqualification win keeps the reign open with one more
  defence.

The resolver's "Match result" decision is stored under `match.result` (rival
shows: `match.rivalResult`) and is the results page's winner Why?.
