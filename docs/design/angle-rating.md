# Angle rating

How talking segments (angles) are built and rated. MTCH1 gives every angle
type one default beat and rates an angle with a simple speaker score. MTCH5
replaces that with **beats**: an angle is an ordered list of up to 8 beats,
each scored on its own stat mix.

This doc starts with the data (MTCH5-01): the beat catalog, which beats each
angle type allows, how a stored beat's people split into groups, and the angle
templates. The rater (MTCH5-03) and the Match lab screens (MTCH5-04/05) build
on it.

Code: the schemas and readers in `packages/engine/src/model/catalogs.ts`, the
pack records in `persistence/packs/records/catalogs.ts`, the beat stats in
`systems/match/angles/beatStats.ts`, beat groups in
`systems/match/angles/beatGroups.ts`, templates in
`systems/match/angles/templates.ts` and the checks in
`systems/match/catalog/checkSegmentBeats.ts`.

## Beat catalog

The base pack ships 13 beats in `content/base/catalogs/beats.json` (record
kind `beat`). The file holds pack keys without a prefix (`war-of-words`); the
new-game snapshot stores them in `meta.catalogs.beats` under content keys
`beat.<key>` (`beatContentKey`). The running game reads them only through
`beatsOf(read)` (by key) and `beatOf(read, key)`.

**Beats have no length** (D-10). No beat, group or template field holds
minutes, a length or a duration: the slot's duration class caps how many beats
an angle may have (MTCH5-03).

| Field             | Type    | Rules                                                                                                            |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `key`             | key     | Becomes `beat.<key>`                                                                                             |
| `name`            | string  | 1-40 characters                                                                                                  |
| `description`     | string  | 1-200 characters                                                                                                 |
| `groups`          | array   | 1 or 2 groups (below). Only the second may be optional                                                           |
| `physical`        | boolean | Contact or a fight: wears people like a match does (MTCH5-03)                                                    |
| `repetitionGroup` | enum    | `talk`, `violence`, `faceoff`, `ceremony`, `video`, `spectacle`, `skit` or `announcement`: beats that feel alike |
| `weight`          | number  | 0.1-3, how much the beat counts in the angle's mean                                                              |

A **group** is the people one part of the beat needs:

| Field               | Type    | Rules                                                        |
| ------------------- | ------- | ------------------------------------------------------------ |
| `label`             | string  | 1-24 characters, such as "Speaker" or "Side A"               |
| `stats`             | array   | 1-4 beat stats, each once                                    |
| `weight`            | number  | 0.1-5, how much the group counts inside the beat             |
| `minPeople`         | integer | 1-6                                                          |
| `maxPeople`         | integer | 1-6, at least `minPeople`                                    |
| `optional`          | boolean | The group may be left empty. Never true on the first group   |
| `managerCanStandIn` | boolean | A manager may speak for the group, on the talking stats only |

**Beat stats** (`BEAT_STATS`) are seven person attributes plus popularity:
mic, charisma, presence, athleticism, ring work, psychology, broadcasting and
**popularity here**, the person's popularity in the show's region (D-03),
never their best region anywhere. A star abroad is not a star here. A manager
may stand in only for the talking stats, mic and charisma (`TALKING_STATS`).

The shipped beats (our own stat mixes):

| Beat                    | Groups (stats, weight)                                                                                  | Physical | Repetition   | Weight |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------------ | ------ |
| `beat.promo`            | Speaker: mic, charisma (manager), 1                                                                     | no       | talk         | 1.0    |
| `beat.interview`        | Guest: mic, charisma (manager), 3; Host (optional, 1 person): broadcasting, mic, presence, 1            | no       | talk         | 0.9    |
| `beat.war-of-words`     | Side A: mic, charisma (manager), 1; Side B: mic, charisma (manager), 1                                  | no       | talk         | 1.1    |
| `beat.attack`           | Attackers: presence, athleticism, popularity, 1; Targets: charisma, presence, popularity, 1             | yes      | violence     | 1.0    |
| `beat.brawl`            | Brawlers (2-6): presence, athleticism, ring work, popularity, 1                                         | yes      | violence     | 1.0    |
| `beat.staredown`        | Side A: presence, popularity, 1; Side B: presence, popularity, 1                                        | no       | faceoff      | 0.8    |
| `beat.contract-signing` | Signers: presence, mic, popularity (manager), 1; Witnesses (optional): presence, mic, broadcasting, 0.5 | no       | ceremony     | 0.9    |
| `beat.video-package`    | Featured: charisma, presence, popularity, 1                                                             | no       | video        | 0.7    |
| `beat.celebration`      | Celebrants: popularity, charisma, 1                                                                     | no       | ceremony     | 0.8    |
| `beat.entrance`         | Performers: presence, charisma, popularity, 1                                                           | no       | spectacle    | 0.7    |
| `beat.pull-apart`       | Combatants (2-6): presence, athleticism, popularity, 1                                                  | yes      | violence     | 0.8    |
| `beat.backstage-skit`   | Cast: charisma, mic (manager), 1; Foil (optional): charisma, mic, 1                                     | no       | skit         | 0.9    |
| `beat.announcement`     | Announcer (1-2): mic, presence, broadcasting (manager), 1; Subjects (optional): popularity, 0.5         | no       | announcement | 0.8    |

Group sizes not shown are 1-4 (Featured, Celebrants and Subjects 1-6; Guest,
Witnesses and Foil 1-3).

**Which beats an angle type allows.** An angle type record may list
`beatKeys`: beat content keys, each once, that must include its
`defaultBeatKey`. Left out, every beat is allowed (`isBeatAllowed`). The
shipped types:

| Angle type         | Beats                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `promo`            | promo, war of words, announcement, backstage skit, entrance, celebration  |
| `interview`        | interview, promo, announcement                                            |
| `confrontation`    | staredown, war of words, attack, brawl, pull-apart                        |
| `attack`           | attack, brawl, pull-apart, staredown                                      |
| `contract-signing` | contract signing, staredown, brawl, pull-apart, announcement, celebration |
| `video-package`    | video package                                                             |

`celebration` is on `promo` so the victory lap template has a type that allows
both its beats.

**Older saves.** A game started before beats existed has no `beats` entry in
`meta.catalogs`: `hasBeatCatalog(read)` is false, angles there keep MTCH1's
simple speaker score (MTCH5-03), the lab says so (MTCH5-05) and
`match.catalog` returns empty `beats`, `angleTemplates` and `beatKeys` lists.
Only games started after this deploy have beats.

**Checks.** The loader refuses a bad beat or template with the pack issue
code: `schema` for a record that breaks its schema (a `minutes` field, a third
group, an optional first group, an unknown stat) or a template beat whose
`groupTwo` does not fit the beat, `unknown-reference` for a beat key that names
no beat, and `beat-not-allowed` for a template beat its angle type does not
allow. validate:world's `angle-beats` rule (`checkBeatCatalog` and
`checkSegmentBeats`) checks the angle types' default beats and beat lists and
every stored angle beat: the beat exists and is allowed for the angle type,
its people are participants of the segment, each group is within
`minPeople..maxPeople` and a required group is not empty.

## Beat groups and sides

A stored beat is `{ beatKey, personIds }` and nothing else
([data-model.md](data-model.md#segments-segments-seg_)), with a test enforcing
it, and the owner tests on live saves. So the groups are **derived from the
participants' `side`** instead of stored (`beatGroupsOf`):

- a one-group beat puts everyone in group one;
- a two-group beat puts everyone on the same side as `personIds[0]` in group
  one and everyone else in group two.

`toStoredBeat` writes group one first, so a beat built in the lab round-trips
through the save as long as:

- in a two-group beat, everyone in group one is on one side and nobody in
  group two is on it;
- each person keeps one side for the whole angle.

A one-group beat puts no constraint on sides, so a staredown between sides A
and B can end in a brawl with both of them.

`assignAngleSides(beats)` gives every person a side that meets those rules:
it ties together group one of each two-group beat, checks that no beat then
puts one side in both groups, and also ties group two together when that
breaks nothing (side B of a war of words shares a side; the subjects of an
announcement who face each other later do not). Sides are numbered 0, 1, 2...
in order of first appearance. When no sides work it returns the first
conflict, `{ personA, personB, beatIndex }`: two people who must share a side
but face each other in that beat. The lab warns about it (MTCH5-03). A beat
whose optional second group is left empty can pass `twoGroups: true` so its
group one is tied together too.

## Angle templates

A template is a ready-made angle the lab offers as a starting point and rival
bookers (AIP4) build from. The base pack ships 8 in
`content/base/catalogs/angle-templates.json` (record kind `angleTemplate`),
stored under `template.<key>` (a content-key namespace allows no hyphen, so not
`angle-template`) and read through `angleTemplatesOf(read)` (by key) and
`angleTemplateOf(read, key)`.

| Field          | Type      | Rules                                                                                     |
| -------------- | --------- | ----------------------------------------------------------------------------------------- |
| `key`          | key       | Becomes `template.<key>`                                                                  |
| `name`         | string    | 1-40 characters                                                                           |
| `angleTypeKey` | reference | An angle type, by pack key                                                                |
| `purpose`      | enum      | `promo`, `startFeud`, `buildFeud`, `titleChallenge`, `celebrate`, `introduce`, `announce` |
| `beats`        | array     | 1-8 beats (below); at least one not optional                                              |
| `description?` | string    | Up to 300 characters                                                                      |

Each template beat is `{ beatKey, groupOne, groupTwo, optional }`. `beatKey`
names a beat by pack key, and the beat must be allowed for the angle type.
`groupOne` and `groupTwo` are **cast tokens**: `a` (side A), `b` (side B), `ab`
(both sides together) or `host` (an interviewer or announcer on neither side).
`groupTwo` is null exactly when the beat has one group or its optional second
group is left unused. An `optional` beat is the first to go when the slot is
short.

| Template             | Type             | Purpose        | Beats (optional in brackets)                                  |
| -------------------- | ---------------- | -------------- | ------------------------------------------------------------- |
| `solo-promo`         | promo            | promo          | promo a                                                       |
| `sit-down-interview` | interview        | introduce      | interview a/host, [promo a]                                   |
| `feud-opener`        | confrontation    | startFeud      | [staredown a/b], war of words a/b, brawl ab                   |
| `ambush`             | attack           | buildFeud      | attack a/b, [pull-apart ab]                                   |
| `title-contract`     | contract-signing | titleChallenge | [announcement host/ab], contract signing a/b, [staredown a/b] |
| `victory-lap`        | promo            | celebrate      | [entrance a], celebration a                                   |
| `hype-video`         | video-package    | introduce      | video package a                                               |
| `backstage-plot`     | promo            | buildFeud      | backstage skit a/b, [war of words a/b]                        |

- `fitTemplate(template, maxBeats)` drops optional beats from the front until
  the rest fit, and returns `{ beats, dropped }`, or null when the required
  beats alone are more than `maxBeats`. The feud opener at 2 keeps war of words
  and brawl; the solo promo always fits.
- `angleTemplatesFor(read, { purpose?, maxBeats })` lists the templates that
  fit, by key, with their trimmed beats.
- `castTemplate(template, { a, b, host })` fills each beat's groups with
  people. A beat whose first group would be empty (a host-only group with no
  host) is dropped; an empty second group is left empty.

`match.catalog` returns the beats, the templates (with their `optional` flags
and a derived `requiredBeatCount`) and each angle type's `beatKeys`, so the web
never hard-codes the lists.

## Beat worker value

MTCH5-02. What one person brings to one group of a beat, 0 to 100:
`beatWorkerValue` in
`packages/engine/src/systems/match/angles/formulas/beatWorkerValue.ts`. The
trace is titled with the person's name.

For every stat in the group's mix, in the beat's order:

```text
moraleFactor   = 1 − moralePenaltyMax × max(0, −morale) / 100
momentumFactor = 1 + momentumBonusMax × max(0, momentum) / 100
                   − momentumPenaltyMax × max(0, −momentum) / 100
own            = value × (popularityStatShare if the stat is popularity)
                       × moraleFactor × momentumFactor
managerValue   = manager's value × managerShare × manager's moraleFactor
```

- 100 is the scale constant: morale and momentum run from −100 to 100. At
  morale 0 or above, and at momentum 0, the factor is exactly 1 and the trace
  shows a single line for it. Momentum is null before a worker's first
  appearance; it counts as 0 with the note "No momentum yet".
- `popularity` is popularity in the show's region (D-03), counted at
  `match.angle.popularityStatShare` (0.9): being well known helps, but less than
  actually being good at the beat's work.
- A manager stands in only when the group allows it (`managerCanStandIn`), only
  on the talking stats (mic and charisma) and only when the person has a
  manager. Their candidate is a separate option next to the person's own.

Then the **best stat** is picked: the highest value among every own and
manager candidate (`pickBeatStat` in `angles/pickBeatStat.ts`, shared with the
lab's query). A tie goes to the stat listed earlier in the beat, then to the
person's own value over the manager's. The trace's "Best stat" decision lists
every candidate with its arithmetic, for example "Best stat: Mic 78 (Charisma
64, Presence 51)" or "Manager Rex Halden stands in on Mic: 82 × 85% = 69.7".

Finally a roll of `−statNoise..statNoise` whole points ("Performance on the
night", stream `match.angle`) is added and the value is kept between 0 and 100.
At `statNoise` 0 no roll is drawn and the trace says "No noise (tunable at 0)".

**Why morale and momentum act before the pick.** If the best stat were picked
first and morale applied after, morale would only shrink a number and never
change which stat (or who) carries the beat. Applying it first means a
demoralised talker can lose the mic to their manager, and a worker on a hot
streak can carry a beat on presence instead of a weaker mic. That is the
behaviour the beat system is meant to show.

**Why the manager's share is below 100%.** A manager talking for a worker is a
crutch: the crowd still wants to hear from the wrestler. At 85% a manager
helps a poor talker a lot (a 82-mic manager is worth 69.7, far above a 40-mic
wrestler) but never makes a good talker worse off, and a decent talker still
does their own talking. At 0 a manager never wins; at 1 a manager is as good
as speaking for yourself.

**Rival workers.** When the person is not the viewer's worker, the caller
passes morale 0 and momentum 0 and the formula treats both (and the manager's
morale) as neutral whatever it is given, with the note "Not your worker:
morale and momentum treated as neutral". A preview never shows a rival's
morale or momentum (D-07).

The physical flag of a beat does not change the score; MTCH5-03 uses it for
warnings and MTCH4 for fatigue.

## Beat score

MTCH5-02. How well one beat went, 0 to 100: `beatScore` in
`packages/engine/src/systems/match/angles/formulas/beatScore.ts`, titled
"Beat: <name>".

```text
groupScore = mean of the group's beat worker values
raw        = Σ(group weight × groupScore) / Σ(weights of the groups that counted)
score      = clamp(raw + roll(−beatNoise..beatNoise), 0, 100)
```

- Each person's worker value sits in the trace under their name.
- An empty optional group (an interview with no host) is left out, with the
  note "Host: nobody, not counted"; its weight does not count either, so the
  beat is not dragged down.
- An empty required group gives the beat 0 with a note and draws no roll.
  MTCH5-03's validation refuses such a beat before it is rated.
- The roll is "How the beat landed" on `match.angle`; at `beatNoise` 0 none is
  drawn ("No noise (tunable at 0)").
- The score is not rounded: the angle score (MTCH5-03) rounds once at the end.

The weights come from the beat catalog (an interview's speaker counts 3, the
host 1), not from tunables.

### Angle tunables

Category `Angles`, in `systems/match/angles/tunables.ts`, listed in
[tunables.md](tunables.md#angle-tunables). MTCH5-03 appends the angle score's
keys.

### Random stream

`match.angle` (`angles/streams.ts`). A real show draws it with
`ctx.rng('match.angle')`; a Match lab preview uses
`anglePreviewStream(read.meta.seed, previewSeed)`, a detached stream keyed by
the preview seed, so a preview never moves a world stream. The same inputs and
preview seed always give the same value and trace; another seed moves only the
noise lines.

## Beat limits

MTCH5-03. The slot's duration class (MTCH1's `durationClassOf`, D-10) caps how
many beats an angle may have; angle types never shift the class. Code:
`beatLimitOf` and `beatLimitMessage` in
`packages/engine/src/systems/match/angles/beatLimit.ts`.

| Duration class | Tunable                         | Default | Message                        |
| -------------- | ------------------------------- | ------- | ------------------------------ |
| Short          | `match.angle.maxBeats.short`    | 2       | "Short slot: up to 2 beats"    |
| Standard       | `match.angle.maxBeats.standard` | 4       | "Standard slot: up to 4 beats" |
| Long           | `match.angle.maxBeats.long`     | 6       | "Long slot: up to 6 beats"     |

- The tunables run from 1 to `MAX_ANGLE_BEATS` (8, the schema's limit), so a
  limit never lets an angle hold more than booking can store. At 1 the message
  says "up to 1 beat".
- With MTCH1's defaults the pre-show is short, the opener, midcard and
  semi-main are standard and the main event is long.
- `match.previewAngle` refuses an angle over the limit with the message
  (`tooManyBeats`, field `beats`), and `segmentWarnings` reports it as
  `angle.tooManyBeats`.
- A **stored** angle over its limit (the tunable was lowered after booking) is
  never refused: the rater rates its first N beats and lists the rest as not
  counted, with the note "Only the first 2 beats count in a short slot".

Example: three beats on the pre-show are refused with "Short slot: up to 2
beats"; the same three beats in the main event are fine.

## Angle score

MTCH5-03. One whole score, 0 to 100, for the angle: `angleScore` (and
`angleScoreParts`, which also returns delivered and the crowd) in
`packages/engine/src/systems/match/angles/formulas/angleScore.ts`.

```text
effective weight = beat weight × (closingBeatWeight for the last beat, else 1)
repetition       = repeatFactor ^ earlierInAngle × cardRepeatFactor ^ earlierOnCard
delivered        = Σ(effective weight × beat score × repetition) / Σ effective weight
crowd            = crowdScore(performance = delivered, entertainment, star power, expected)
blended          = delivered × (1 − crowdBlend) + crowd × crowdBlend
banded           = clamp(blended, writing × floorPerLevel,
                         max(floor, ceilingAtZero + writing × ceilingPerLevel))
score            = round(softCompression(banded + policy bonus))
```

- **Delivered** ("Beats delivered") is the weighted mean of the beats. Each
  beat counts with its catalog weight; the closing beat counts
  `match.angle.closingBeatWeight` (1.25) times more. A notes-01-style length
  weighting is not used: beats have no length (D-10).
- **Repetition**: a beat keeps `match.angle.repeatFactor` (0.85) of its score
  for each earlier beat of its repetition group in the angle ("Second talk
  beat in this angle ×0.85"), and `match.angle.cardRepeatFactor` (0.93) for
  each one earlier on the card ("2 talk beats earlier on the card ×0.86").
  Earlier on the card means the talking segments before this one: pre-show
  before the main card, lower slot first. The lab passes none unless it is
  given the card.
- **Crowd**: MTCH1's `crowdScore` with delivered as the performance, the
  side-aggregated entertainment axis of everyone in the angle, MTCH1's star
  power over everyone in the angle and MTCH1's `crowdExpectation` (star power
  and mean momentum over everyone, the slot role, importance and TV), exactly
  the inputs the simple rater passed. The crowd goes through the `crowd`
  rating stage, so it is soft-compressed as for a match.
- **Blend**: `match.angle.crowdBlend` (0.35) of the score comes from the crowd;
  at 0 the beats alone decide it, at 1 the crowd alone.
- **Writing band**: the promotion's writing team (`production.writing`, 0 to 10) sets a floor (`writingFloorPerLevel` 3 per level) and a ceiling
  (`writingCeilingAtZero` 75 plus `writingCeilingPerLevel` 2.5 per level).
  Weak writing caps a great talker; strong writing saves a weak one. The clamp
  reads "Writing team (level 7): floor 21, ceiling 92.5". A ceiling below the
  floor (tunables set that way) is raised to the floor, with a note. If
  playtests say the floor is too generous, `writingFloorPerLevel` is the knob.
- The rating policy's score bonus (D-01; 0 under the full rules) is added
  after the band, then MTCH1's soft compression and a round to a whole number.

The score's trace shows each beat's line (its weight, the closing-beat and
repetition lines), delivered against expected inside the crowd, the writing
band and the compression. Delivered and the crowd have their own full traces;
the score shows them two levels deep so it stays inside the trace depth
limit.

Worked example, a confrontation in the main event of a promotion with writing
7: staredown 64 (weight 0.8), war of words 72 (weight 1.1), brawl 70 (weight
1, the closing beat, so 1.25):

```text
delivered = (0.8 × 64 + 1.1 × 72 + 1.25 × 70) / (0.8 + 1.1 + 1.25)
          = (51.2 + 79.2 + 87.5) / 3.15 = 69.17
crowd     = 66 (say)
blended   = 69.17 × 0.65 + 66 × 0.35 = 44.96 + 23.10 = 68.06
band      = floor 21, ceiling 92.5: 68.06 stays
score     = 68 (below the compression knee at 85)
```

## Stars for angles

An angle has no work rate. Its stars are MTCH1's `starRating` with
**delivered** in the work-rate input (the line reads "Talk") and the crowd in
the crowd input, capped by `match.stars.cap.angle` (4):

```text
base  = delivered × performanceShare (0.7) + crowd × 0.3
stars = clamp((base − zeroAt 15) / pointsPerStar 15, 0, 4), nearest quarter
```

In the worked example: base = 69.17 × 0.7 + 66 × 0.3 = 68.22, (68.22 − 15) / 15
= 3.55, so 3.5 stars.

## The beat rater

MTCH5-03: `beatAngleRater` in
`packages/engine/src/systems/match/angles/angleRater.ts`, registered in
`rating/builtins.ts` with `registerSegmentRater('angle', beatAngleRater,
{ replace: true })`, so it **replaces** the simple speaker rater for every
promotion (a registry reset puts it back too). `rateAngle`
(`angles/rateAngle.ts`) does the rating from plain inputs; the rater gathers
them, for a show and for a preview alike, so both take one path.

What it reads:

- The beats. A stored segment's beats come from the stored-segment adapter
  (`ratingInputFromSegment`): each beat's people split into the catalog beat's
  groups by the speakers' participant sides (`beatGroupsOf`), and the beat keys
  of the talking segments earlier on the card. A preview passes the beats it
  built. MTCH1's `match.preview` passes none: the rater then rates the angle
  type's default beat with every speaker, split by side.
- Each person: attributes, popularity in the show's region (D-03), and their
  contract with the promotion running the show (ring name, morale, momentum,
  `managerPersonId`). A manager's mic, charisma and morale come from the
  manager's own row and contract.
- The show (region, importance, televised), the promotion's writing team, the
  slot role, and the rating policy.

Rules:

- **Every promotion** rates angles with beats. Rival shortcuts (D-01) reach it
  only through MTCH1's rating policy (the score bonus line) and rating
  modifiers (the `performance`, `talk`, `expectation`, `crowd`, `score` and
  `stars` stages run as for a match). There is no branch on who controls the
  promotion.
- **Draw order** on `match.angle` is fixed: beat by beat, group by group,
  person by person, then the beat's own roll; the crowd's roll comes last.
  Show night rolls a talking segment on `match.angle`
  (`shows/runSegment.ts`), matches stay on `match.rating`.
- **Viewer scoping**: on show night everyone's morale and momentum count. In a
  preview only people under contract with one of the viewer's promotions
  count; everyone else is treated as neutral with the note "Not your worker:
  morale and momentum treated as neutral". MTCH1's `match.preview` names no
  viewer promotions, so every worker is neutral there.
- **Never fails a show**: a beat the catalog does not have is left out with
  the note "Beat beat.x is not in the beat catalog: not counted"; a stored
  angle over its limit rates its first beats; a save started before beats
  existed (`hasBeatCatalog` false) is rated by MTCH1's simple rater with the
  note "This save has no beat catalog: rated as a simple talking segment".
- **Trace size**: the score, stars and delivered go through `limitTrace`; the
  score's trace is about 50 nodes for a two-beat angle, so the stored segment
  score stays small (rival shows store summaries only).
- The rated segment's `talk` is delivered; each worker line's `talk` is the
  mean of their values in the beats that counted. The result's `angle` holds
  delivered, every beat (`BeatResult`: each person's chosen stat, its label,
  value with trace and `viaManager`) and the beat limit.

Worked example: a war of words between A (side 0) and B (side 1), closed by a
promo from A, on a rival's weekly show. The war of words splits by side (A in
side A, B in side B), each person is scored on their best of mic and
charisma, the beats score, delivered is their weighted mean with the promo
×1.25, and the rival's policy adds its score bonus line, if any, after the
writing band.

## Warnings

MTCH5-03 adds `angle.*` codes to MTCH1's `segmentWarnings`, same shape, with
`beatIndex` (0-based) on the beat ones. They need the slot's duration class
and the tunables, which `rateSegment` passes.

| Code                          | Severity | Example                                                                          |
| ----------------------------- | -------- | -------------------------------------------------------------------------------- |
| `angle.tooManyBeats`          | error    | "Short slot: up to 2 beats"                                                      |
| `angle.unknownBeat`           | error    | "Beat 2: there is no beat beat.x"                                                |
| `angle.beatNotAllowed`        | error    | "Brawl is not part of a Promo"                                                   |
| `angle.emptyGroup`            | error    | "War of words needs someone on side B"                                           |
| `angle.groupTooBig`           | error    | "Staredown takes at most 4 people on side B"                                     |
| `angle.sidesConflict`         | error    | "X and Y are together in beat 1 but opposed in beat 3; booking can't store that" |
| `angle.injuredInPhysicalBeat` | warning  | "X is hurt: the brawl in beat 2 is physical"                                     |
| `angle.cannotWorkAngles`      | error    | "X: Injured (arm injury) until 1 May"                                            |
| `angle.unavailable`           | error    | "X: On personal leave until 12 Mar"                                              |

`angle.cannotWorkAngles` and `angle.unavailable` replace MTCH1's `injured`,
`inactive` and `unavailable` codes for a talking segment on a save with a
beat catalog. The side conflict comes from `assignAngleSides`.

## Previewing an angle

`match.previewAngle` (`angles/queries.ts`). Arguments (strict): the lab setup
(`importance`, `regionId`, `televised`, and `slotRole` or `slot: { slot,
slots, preShow }`, `promotionId?`), `angleTypeKey`, `beats` (1 to 8 of
`{ beatKey, groupOne, groupTwo }`), `managerOverrides?` (person to manager, or
null for none), `earlierBeatKeysOnCard?` (at most 64) and `previewSeed`.

- Refusals: `noBeatCatalog` ("This save was started before beats existed.
  Start a new game to build angles from beats."), `tooManyBeats`,
  `unknownBeat`, `beatNotAllowed`, `emptyGroup` (a required group with
  nobody), `notAManager` (an override that is not a person with the manager
  role), `unknownPerson`, plus `rateSegment`'s and `invalidArgs`.
- The answer: score, stars, delivered, expected, crowd and star power, each
  beat with its people, their chosen stat labels and values, the beat limit
  `{ max, message }`, the warnings and the policy. Every number carries its
  trace inline.
- The participant sides come from `assignAngleSides`; when no sides fit,
  everyone goes on one side and the `angle.sidesConflict` warning explains.
- Rolls come from `detachedStream(meta.seed, 'match.angle',
String(previewSeed))`: the same arguments and seed give the same answer, and
  the world, its RNG, traces and event log never move.

<a id="talk-roles"></a>

## Talk roles (MTCH5-08)

A talking segment tells interviewers, managers and wrestlers apart. Each
speaker may store the part they play (`participant.talkRole`):

| Part          | Who                                                             |
| ------------- | --------------------------------------------------------------- |
| `wrestler`    | Talks for themselves.                                           |
| `manager`     | Speaks for or stands with a client (`participant.forPersonId`). |
| `interviewer` | Hosts an interview or reads an announcement.                    |
| `authority`   | An on-screen general manager or owner figure.                   |

`subject` stays a participant role of its own (someone an angle is about who
does not speak). A speaker with no stored part plays the one they were hired
for: a presenter or announcer interviews, a manager manages, anyone else is a
wrestler (`talkRoleForEmployment`). Saves from before MTCH5-08 therefore read
their speakers as wrestlers unless they were hired as something else.

**Groups say which parts suit them.** A beat group may list `roles`
(`talkRoleListSchema`); none listed means anyone suits it. The base pack:
interview Guest (wrestler, manager) and Host (interviewer); announcement
Announcer (interviewer, authority) and Subjects (wrestler, manager); and the
six backstage beats below. `match.catalog` returns `roles` on every group
(empty = anyone).

**A wrong part is a warning, never an error, and never a penalty.**
`talkWarnings` (`angles/talkWarnings.ts`) reads the angle's beats split into
groups:

| Code                          | Message                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `angle.wrongRole`             | "Kai Moreno is a wrestler: Host is for an interviewer"          |
| `angle.settingNotAllowed`     | "A Video Package can't happen in the ring"                      |
| `angle.beatSettingNotAllowed` | "Car Park Ambush can't happen in the ring"                      |
| `angle.clientNotInSegment`    | "Victor Crane is here for Lena Park, who isn't in this segment" |

Each person gets at most one `wrongRole` line. The codes are appended to
`SEGMENT_WARNING_CODES` (the lab's warnings; the lab may pass `parts` on
`SegmentAngleInput`, otherwise the hired part is used) and the booking
checklist reads them through the `booking.talk` check (order 260). Nothing in
the rater reads the part: a manager in the Guest group is rated on their own
stats like anyone else, and the contract manager still stands in on mic and
charisma as before.

**Who did what, in one line.** `talkLine(setting, people)`
(`angles/talkLine.ts`) gives "Backstage: Lena Park interviews Kai Moreno (with
Victor Crane)": interviewers interview everyone else (with no interviewer an
authority figure "meets" them), a manager whose client is in the segment is
"with" them, and a setting other than the ring starts the line. A ring segment
of wrestlers only has no line. `booking.card` (`BookingSegmentView.talkLine`,
`BookingPersonView.talkRole`) and the results page
(`SegmentResultView.talkLine`) carry it; live show night reads the results
view.

<a id="settings"></a>

## Settings (MTCH5-08)

A talking segment happens `ring` (the default), `backstage` or `video`
(pre-taped), stored as `angle.setting` (absent = ring, so older saves and
ring angles are unchanged). The writer stores a setting only when it is not
the ring; a draft that names none starts where its type starts
(`defaultSettingOf`: the ring when allowed, else the type's first setting, so
a video package is pre-taped).

- **Angle types** list the settings they allow (`settings`, absent = all):
  promo and interview: ring, backstage, video; confrontation, attack and
  contract signing: ring, backstage; video package: video.
- **Beats** may list theirs too. The backstage beats (original names) are
  `locker-room-interview` (Guest / Interviewer), `backstage-confrontation`
  (Side A / Side B, backstage only), `parking-lot-attack` "Car Park Ambush"
  (Attackers / Targets, physical), `medical-update` (Reporter / Patient),
  `office-meeting` (Authority / Visitors, backstage only) and `arrival`
  (Arrivals). The backstage skit is now backstage or video only, the video
  package video only, the entrance ring or video, the celebration ring or
  backstage.
- **Templates** carry a `setting` (absent = ring): `backstage-interview`,
  `parking-lot-ambush` and `office-summons` are backstage; `backstage-plot` is
  now backstage and `hype-video` video. The pack loader refuses a template
  whose type or beats can't happen in its setting (`setting-not-allowed`).

**Rating by setting.** Away from the live crowd the beats count for more:

- the crowd's share of the angle score is `crowdBlend ×
match.angle.setting.<setting>.crowdShare` (0.35 × 0.4 = 0.14 backstage,
  0.35 × 0.3 = 0.105 pre-taped) and delivered takes the rest, one multiply
  step in the trace ("Crowd blend × 0.4 (backstage)") so the score's reasons
  stay right;
- there is no crowd roll, so nothing swings a backstage segment on the night
  ("Hot crowd" can only come from what the crowd share earns);
- the score's Why? opens with "Backstage: the crowd watches on screen" (or
  "Pre-taped: …");
- the duration class moves by `match.angle.setting.<setting>.durationShift`
  (backstage −1: a standard slot becomes short, so 2 beats; pre-taped 0). The
  card, the results page, `rateSegment`, `match.previewAngle` (`setting?`
  argument) and the rater all read it through `angleDurationClass` /
  `settingDurationShifter`, and the duration class's trace says "Backstage
  pulls it down a step → Short".

| Key                                           | Default | Range | Meaning                                                            |
| --------------------------------------------- | ------- | ----- | ------------------------------------------------------------------ |
| `match.angle.setting.backstage.crowdShare`    | 0.4     | 0–1   | Share of the usual crowd blend the crowd keeps backstage           |
| `match.angle.setting.video.crowdShare`        | 0.3     | 0–1   | Share of the usual crowd blend the crowd keeps for a pre-taped one |
| `match.angle.setting.backstage.durationShift` | −1      | −1–1  | Steps a backstage segment moves its slot's duration class          |
| `match.angle.setting.video.durationShift`     | 0       | −1–1  | Steps a pre-taped segment moves its slot's duration class          |

**Card rules.** A backstage segment still takes a card slot like any other
segment: whether it should stop counting toward the card's slot limit is an
open question for the owner (not built). Rival bookers send a talking segment
backstage with `aip.card.backstageChance` (0.25) when its type can go there,
rolled on its own detached stream (`aip.card.setting`, keyed by show and
segment) so no other pick moves, and put managers and presenters on as
themselves. With `aip.card.order.backstageBreaksTalk` (true) a backstage or
pre-taped segment does not count for "no two talking segments in a row" (see
[rival-booking.md](rival-booking.md#ordering)).

<a id="angle-aftermath"></a>

## Angle aftermath (MTCH5-06)

A talking segment moves the people in it, a little. After a show runs an angle, everyone in a
beat that ran (beats past the slot's limit don't count) gets:

```
share       = beats they were in ÷ beats that ran
momentum   += (angle score − match.angle.momentumPivot) × match.angle.momentumPerPoint × share
popularity += max(0, angle score − match.angle.popularityPivot) × match.angle.popularityPerPoint × share
```

- A good angle builds momentum and a flat one costs a little; popularity only ever goes up.
- Someone named on the segment but in no beat that ran gets nothing.
- The popularity change is the show region's; it spreads to neighbours and reached regions with
  MTCH3's region weights (`segmentRegionWeights`), exactly as a match's does.
- Both changes go through WRK1's doors (reason key `match.angle`), so the doors' taper, limits,
  traces and change events apply. Momentum lives on the contract with the show's promotion:
  someone with no contract there has none to change.
- **Morale is never touched (D-09).** Angles have no losers, and WRK8 owns the story shield.
- Show night: MTCH3's `match.aftermath` result applier (`aftermath/showNight.ts`) sends angles to
  `applyAngleAftermath` (`angles/aftermath.ts`). No `aftermaths` rows are stored for angles (those
  rows are match results that Recent form reads); the door traces are the record.
- The Match lab's Angle mode shows the same numbers in an Aftermath panel: `match.previewAngle`
  with `aftermath: true` returns `aftermath` (`computeAngleAftermath`).

The per-point numbers are deliberately small: matches stay the main way popularity moves.
