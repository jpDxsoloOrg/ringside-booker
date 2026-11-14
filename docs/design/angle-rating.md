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
