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
