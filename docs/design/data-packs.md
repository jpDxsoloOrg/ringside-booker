# Data packs

Every piece of world content, shipped or modded, is written as a **data pack**:
a folder with a manifest and one JSON file per kind of record. Records point at
each other by readable keys such as `harbour-city-wrestling`, never by engine
IDs. This doc is the format: the manifest, the file layout, every record kind,
the key and reference rules, overrides, and versioning.

Code: `packages/engine/src/persistence/packs/`. The schemas there are the
source of truth; the tables below describe them.

Most of this doc is the authoring format. Turning packs into a `World`
(resolving keys to IDs, merging packs, applying overrides, filling defaults) is
the loader's job; the [Loading](#loading) section at the end describes it. The
pack checker CLI (WLD-03) runs the same schemas over whole packs.

## Why packs have their own format

- **Keys, not IDs.** Engine IDs are minted from the seeded RNG, so the same
  record gets a different ID under a different seed. Keys stay the same across
  seeds, read well in a diff, and let an add-on say "patch
  `harbour-city-wrestling`" without knowing any ID.
- **A stable shape for authors.** Entities can grow internal fields (caches,
  history pointers, transient state). Pack authors shouldn't have to care. The
  loader is the adapter between the two, and it checks its output against the
  engine's entity schemas a second time, so the two formats can't drift apart
  silently.
- **Field names follow the engine.** A record field has the same name as the
  entity field it becomes, except that references are `<thing>Key` instead of
  `<thing>Id`. If an entity field is renamed, the record field follows, so the
  loader stays a thin transform.

## File layout

Each pack is a folder under `content/`, named after the pack ID:

```
content/
└── example-world/
    ├── pack.json                  the manifest
    ├── geography/
    │   ├── continents.json        one JSON array of records per kind
    │   ├── countries.json
    │   └── regions.json
    ├── promotions.json
    ├── people.json
    └── employments.json
```

The manifest's `files` map says which file holds each kind, so the folder
structure inside a pack is up to its author. Paths are relative to the pack
folder, use forward slashes and lowercase names, and end in `.json`. Each file
is a JSON array of records of one kind, and a key appears at most once per
file.

## The manifest

`pack.json` at the root of the pack. Unknown fields are errors, so a typo such
as `dependOn` fails instead of silently dropping a dependency.

| Field           | Type                         | Rules                                                                                                                                                                   |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatVersion` | number                       | The pack format the pack is written in. This build reads format `1`.                                                                                                    |
| `id`            | string                       | 2-40 characters: lowercase letters, digits and hyphens, starting with a letter (`^[a-z][a-z0-9-]{1,39}$`).                                                              |
| `name`          | string                       | 1-80 characters, shown in the mod manager.                                                                                                                              |
| `version`       | string                       | The pack's own semantic version, such as `1.2.0`.                                                                                                                       |
| `kind`          | `base` \| `world` \| `addon` | See below.                                                                                                                                                              |
| `description`   | string                       | Up to 2000 characters; may be empty.                                                                                                                                    |
| `author`        | string                       | 1-80 characters.                                                                                                                                                        |
| `dependsOn`     | array of `{ id, version }`   | Packs this one builds on. `version` is a range: `^1.0.0`, `~1.2`, `>=1.0.0 <2.0.0`, `1.x`, `*`, sets joined with `\|\|`. No repeats, and a pack can't depend on itself. |
| `startDate`     | ISO date                     | The day a new game starts. Required for `world` packs and not allowed on the others.                                                                                    |
| `files`         | object                       | Record kind → file path. Kinds left out have no records in this pack. Two kinds can't share a file.                                                                     |

Pack kinds:

- **`base`**: shared data with no world of its own, such as name lists and
  generation numbers.
- **`world`**: a playable starting world. It sets the start date and usually
  depends on one or more base packs.
- **`addon`**: adds records to the packs it depends on, or changes them.

## Keys and references

- **Every record has a `key`**: 1-64 characters of lowercase letters, digits
  and hyphens, starting with a letter or digit (`^[a-z0-9][a-z0-9-]{0,63}$`).
  A key is unique within its kind across every loaded pack. Two kinds may use
  the same key (a country and its name mix share one on purpose).
- **Every reference field is named `<thing>Key`**, or `<thing>Keys` for a
  list, and holds a reference: a bare key (`harbour-coast`) or a key qualified
  with the pack that defines it (`example-world:harbour-coast`). Qualify a
  reference when the pack it comes from matters, for example in an add-on that
  depends on two packs. Lists of references never repeat an entry; a bare
  key and the same key qualified with a pack count as a repeat.
- **Names are never references.** A reference is always a key, never a display
  name. Mixing names and IDs as links is how a renamed promotion ends up with
  orphaned titles or a wrestler's history points at the wrong person. A value
  with spaces or capitals in a reference field fails validation, and the error
  names the field path, for example
  `promotions.json[0].homeRegionKey: Expected a reference to a record key ...`.
- **Not every `...Key` field is a pack reference.** Two fields point at engine
  data instead: `traitKey` (trait incidence) names an engine trait such as
  `fastLearner`, and `gimmickKey` (employment) names a catalog entry such as
  `gimmick.monster-heel`.
- **Pack keys are not content keys.** A content key (`gimmick.monster-heel`)
  names a catalog entry and stays a key at runtime. A pack key only exists
  until the pack is loaded, when the loader swaps it for an ID. The patterns
  and the type names (`PackKey` and `PackRef` against `ContentKey`) are kept
  apart so neither is mistaken for the other.
- **No `controller` field.** Who runs a promotion or a brand is a new-game
  choice, not content. The loader gives every promotion a computer controller
  and every brand a null controller (run by its promotion's controller), and
  new-game setup hands the player's promotion to the human. A `controller`
  field in a record is an unknown key and fails.

## Overrides

A record whose key already exists in one of the pack's dependencies is an
error, unless it says what to do with the existing record:

| Marker                   | Meaning                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"$override": "replace"` | The record replaces the dependency's record completely. It must be a full, valid record.                                                                                                   |
| `"$override": "patch"`   | A shallow merge: the fields listed replace the same fields of the dependency's record; the rest stay. A patch needs at least one field besides `key`, and the merged record must be valid. |
| `"$remove": true`        | The dependency's record is deleted. The entry holds only `key` and `$remove`.                                                                                                              |

Only `addon` and `world` packs may override or remove; a `base` pack can only
add. The schemas accept the markers wherever they appear; whether a pack is
allowed to use them, and whether the key really exists in a dependency, is
checked by the loader. A shallow merge replaces a nested object as a whole, so
patching `production` means listing every production area.

```json
[
  { "key": "harbour-city-wrestling", "$override": "patch", "prestige": 55, "cash": 400000 },
  { "key": "old-region", "$remove": true }
]
```

## Format versions

`formatVersion` is checked before anything else. A pack written for a newer
format is rejected straight away with
`pack <id> uses format N, this build reads up to 1`, and none of its other
fields are checked, since a newer format may look different.

Older formats will be read through a migration list
(`persistence/packs/migrations.ts`). When the format changes, the version goes
up by one and a migration is added that rewrites a raw pack of the old format
into the new one. The loader runs every migration from the pack's version up to
the current one, in order, before checking the pack. Format 1 is the first, so
the list is empty, and a test checks that it always forms one unbroken chain.

## Shared field rules

- **Strict.** Every record and every nested object rejects unknown fields.
- **Dates** are ISO `YYYY-MM-DD` strings, years 1900-2999.
- **Numbers** are finite (NaN and Infinity always fail). Percentages run
  0-100; chances run 0-1; every multiplier has a stated range.
- **Money** is in whole currency units (the loader converts to cents). Cash
  may be negative; wages, fees and deal terms can't.
- **Regional popularity** is sparse: `{ "<region ref>": 1-100 }`. A region
  left out is 0.
- **Colours** are `#rrggbb`. **Images** (`logoRef`, `imageRef`) are a relative
  asset path or `placeholder:<kind>`; left out or null means a generated
  placeholder.
- **Optional fields** may be left out. The tables mark them with `?` and give
  the default the loader fills in.

## Record kinds

The kinds are listed in dependency order: each kind only refers to kinds above
it, apart from references within one kind (region neighbours, a developmental
promotion's parent).

### Geography

**`continent`**

| Field  | Type   | Rules                         |
| ------ | ------ | ----------------------------- |
| `key`  | key    |                               |
| `name` | string | 1-40 characters               |
| `code` | string | 2-3 uppercase letters, unique |

**`country`**

| Field               | Type                    | Rules                                                                                              |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `key`               | key                     |                                                                                                    |
| `name`              | string                  | 1-60 characters                                                                                    |
| `code`              | string                  | 2-3 uppercase letters, unique                                                                      |
| `continentKey`      | ref → continent         |                                                                                                    |
| `population`        | integer                 | 0 or more                                                                                          |
| `wrestlingInterest` | number                  | 0-100                                                                                              |
| `economy`           | number                  | 0-100; 50 is the reference purchasing power                                                        |
| `preferredStyle`    | promotion style \| null | `mainstream`, `traditional`, `technical`, `hardHitting`, `hardcore`, `highFlying`, `entertainment` |

**`region`**

| Field                | Type                    | Rules                                                                                                               |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `key`                | key                     |                                                                                                                     |
| `name`               | string                  | 1-60 characters                                                                                                     |
| `countryKey`         | ref → country           |                                                                                                                     |
| `population`         | integer                 | 0 or more                                                                                                           |
| `wrestlingInterest?` | number                  | 0-100. Default: the country's value                                                                                 |
| `preferredStyle?`    | promotion style \| null | Default: the country's preferred style                                                                              |
| `neighbourKeys`      | refs → region           | Bordering regions. Not itself. If a neighbour doesn't list this region back, the loader warns and stores both sides |

### Names

**`nameCulture`**: a pool of names to generate people from.

| Field          | Type                                      | Rules                                                      |
| -------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `key`          | key                                       |                                                            |
| `label`        | string                                    | 1-60 characters, for tools                                 |
| `given`        | `{ male, female, neutral }`               | Weighted name lists; `male` and `female` need at least one |
| `surnames`     | weighted name list                        | At least one                                               |
| `surnameStyle` | `single` \| `double` \| `patronymic-free` |                                                            |

A weighted name is `["Name", weight]` with a whole-number weight of 1 or more.
A name appears once per list.

**`countryNameMix`**: which cultures a country's people are named from.

| Field        | Type                              | Rules                                                                     |
| ------------ | --------------------------------- | ------------------------------------------------------------------------- |
| `key`        | key                               | The same as the country's key                                             |
| `countryKey` | ref → country                     |                                                                           |
| `cultures`   | array of `{ cultureKey, weight }` | At least one; `cultureKey` → nameCulture; weight 1-1000; no culture twice |

**`ringNameWords`**: words for generated ring names.

| Field        | Type    | Rules                                                                                                                           |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `key`        | key     |                                                                                                                                 |
| `adjectives` | strings | 1-30 characters each, no repeats                                                                                                |
| `nouns`      | strings | As above                                                                                                                        |
| `nicknames`  | strings | As above                                                                                                                        |
| `patterns`   | strings | At least one. Templates using `{given}`, `{family}`, `{adjective}`, `{noun}`, `{nickname}`; each needs at least one placeholder |

### Generation

**`generationProfile`**: how attributes are rolled for one role and style. The
full shape is settled by the attribute generator (WLD-06).

| Field        | Type                                     | Rules                                                                                        |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `key`        | key                                      |                                                                                              |
| `label`      | string                                   | 1-60 characters                                                                              |
| `role`       | person role                              | `wrestler`, `occasionalWrestler`, `manager`, `presenter`, `announcer`, `referee`, `producer` |
| `style`      | ring style \| null                       | Null for non-wrestlers or any style                                                          |
| `attributes` | attribute → `{ mean, sd, talentWeight }` | Every engine attribute, no others. `mean` 0-100, `sd` 0-50, `talentWeight` 0-1               |

**`traitIncidence`**: how often a generated person holds a trait.

| Field             | Type                 | Rules                           |
| ----------------- | -------------------- | ------------------------------- |
| `key`             | key                  |                                 |
| `traitKey`        | engine trait         | Such as `fastLearner`           |
| `baseChance`      | number               | 0-1                             |
| `roleMultipliers` | person role → number | 0-10 each; roles left out use 1 |
| `minAge?`         | integer              | 0-100. Default: any age         |

Which traits can't be held together is not pack data; it comes from the
engine's exclusive trait pairs.

### People

**`person`**

| Field              | Type                                                      | Rules                                                                                                  |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `key`              | key                                                       |                                                                                                        |
| `givenName`        | string                                                    | 1-40 characters                                                                                        |
| `familyName`       | string                                                    | Up to 40 characters; empty for one-name people                                                         |
| `defaultRingName`  | string                                                    | 1-60 characters                                                                                        |
| `gender`           | `male` \| `female` \| `nonBinary`                         |                                                                                                        |
| `birthDate`        | ISO date                                                  |                                                                                                        |
| `debutDate`        | ISO date \| null                                          | At least 14 years after `birthDate`; null = not debuted                                                |
| `birthRegionKey`   | ref → region                                              |                                                                                                        |
| `basedInRegionKey` | ref → region                                              |                                                                                                        |
| `imageRef?`        | image \| null                                             | Default: placeholder                                                                                   |
| `masked?`          | boolean                                                   | Default: false                                                                                         |
| `tags?`            | strings                                                   | Up to 10, 1-24 characters each. Default: none                                                          |
| `roles`            | person roles                                              | At least one, no repeats. Ring style other than `nonWrestler` needs `wrestler` or `occasionalWrestler` |
| `status?`          | person status                                             | `active`, `semiRetired`, `hiatus`, `retired`, `deceased`, `outOfBusiness`. Default: `active`           |
| `career?`          | `{ canOwn, canBook }`                                     | Default: both false                                                                                    |
| `motivation`       | `money` \| `legacy` \| `power` \| `enjoyment` \| `thrill` |                                                                                                        |
| `heightCm`         | integer                                                   | 140-230                                                                                                |
| `weightKg`         | integer                                                   | 40-250                                                                                                 |
| `build`            | build                                                     | `slim` ... `superHeavy`                                                                                |
| `style`            | ring style                                                | `allRounder`, `technician`, ... `nonWrestler`                                                          |
| `attributes`       | attribute → number                                        | Every engine attribute, 0-100, no others                                                               |
| `condition`        | body part → number                                        | `head`, `neck`, `back`, `arms`, `torso`, `legs`, 0-100 each                                            |
| `development`      | `{ potential, ceilings }`                                 | `potential` -1000..1000 (integer); `ceilings` attribute → 0-100, sparse                                |
| `regionalPop`      | region ref → 1-100                                        | Sparse                                                                                                 |
| `traits`           | engine traits                                             | Up to 8, no repeats, no exclusive pair                                                                 |
| `vices`            | `{ alcohol, substances }`                                 | `none`, `hidden`, `known`, `recovering`                                                                |

Transient state is not pack data. The loader starts everyone with `fatigue` 0,
no injury and no restrictions.

**`employment`**: a contract running when the world starts. There is no status
field: the loader stores every pack employment as `active`, offered on its
`startsOn`, with no leave, no appearances yet this year and a null momentum.

| Field               | Type                          | Rules                                                                            |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `key`               | key                           |                                                                                  |
| `personKey`         | ref → person                  |                                                                                  |
| `promotionKey`      | ref → promotion               |                                                                                  |
| `brandKey?`         | ref → brand \| null           | Default: no brand                                                                |
| `managerPersonKey?` | ref → person \| null          | Not the person themselves. Default: none                                         |
| `role`              | employment role               | `wrestler`, `manager`, `presenter`, `announcer`, `referee`, `producer`, `booker` |
| `ringName`          | string                        | 1-60 characters                                                                  |
| `gimmickKey?`       | content key \| null           | A gimmick catalog entry. Default: none                                           |
| `alignment`         | `face` \| `heel` \| `tweener` |                                                                                  |
| `push`              | push                          | `mainEvent`, `upperCard`, `midCard`, `lowerCard`, `enhancement`, `none`          |
| `terms`             | contract terms                | See below                                                                        |
| `startsOn`          | ISO date                      |                                                                                  |
| `endsOn`            | ISO date \| null              | After `startsOn`; null = open-ended                                              |
| `morale?`           | number                        | -100..100. Default: 0                                                            |

Contract terms are the engine's, with money in whole units: `kind`
(`written`, `perAppearance`, `development`, `tour`), `exclusive`,
`monthlyWage`, `perAppearanceFee`, `signingBonus` (all 0 or more; a
per-appearance contract has no monthly wage), `shares` (`gateBp`, `merchBp`,
`broadcastBp`, basis points 0-10000), `appearanceCap` (1 or more, or null) and
`perks` (`creativeControl`, `noHouseShows`, `ironClad`, `travelCovered`).

**`team`**: a tag team or trio. Teams belong to no promotion.

| Field         | Type                              | Rules                                           |
| ------------- | --------------------------------- | ----------------------------------------------- |
| `key`         | key                               |                                                 |
| `kind`        | `tag` \| `trio`                   |                                                 |
| `name`        | string                            | 1-60 characters                                 |
| `memberKeys`  | refs → person                     | Exactly 2 for `tag`, 3 for `trio`; no repeats   |
| `formedOn`    | ISO date                          |                                                 |
| `experience?` | number                            | 0-100. Default: 0                               |
| `status?`     | `active` \| `inactive` \| `split` | Default: `active`                               |
| `splitOn?`    | ISO date \| null                  | Set exactly when `split`; not before `formedOn` |

**`titleReign`**: a past or current reign, for the title history a world
starts with.

| Field              | Type                     | Rules                                                                             |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------- |
| `key`              | key                      |                                                                                   |
| `titleKey`         | ref → title              |                                                                                   |
| `holderPersonKeys` | refs → person            | 1-3, no repeats                                                                   |
| `teamKey?`         | ref → team \| null       | When the title was won as a team. Default: none                                   |
| `wonOn`            | ISO date                 |                                                                                   |
| `lostOn`           | ISO date \| null         | Not before `wonOn`; null = the current reign                                      |
| `endReason`        | reign end reason \| null | `lost`, `vacated`, `stripped`, `retired`, `unified`; set exactly when `lostOn` is |
| `defences`         | integer                  | 0 or more                                                                         |

The loader fills `holderNamesAtTime` from the holders' ring names with the
title's promotion.

### Organisations

**`promotion`**

| Field                 | Type                              | Rules                                                                                                  |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `key`                 | key                               |                                                                                                        |
| `name`                | string                            | 1-60 characters                                                                                        |
| `shortName`           | string                            | 2-8 uppercase letters or digits                                                                        |
| `logoRef?`            | image \| null                     | Default: generated placeholder                                                                         |
| `foundedOn`           | ISO date                          |                                                                                                        |
| `status`              | `active` \| `dormant` \| `closed` |                                                                                                        |
| `homeRegionKey`       | ref → region                      |                                                                                                        |
| `regionalPop`         | region ref → 1-100                | Sparse                                                                                                 |
| `prestige`            | number                            | 0-100                                                                                                  |
| `cash`                | integer                           | Whole currency units; may be negative                                                                  |
| `style`               | promotion style                   |                                                                                                        |
| `ownerPersonKey?`     | ref → person \| null              | Default: none                                                                                          |
| `bookerPersonKey?`    | ref → person \| null              | Default: none                                                                                          |
| `parentPromotionKey?` | ref → promotion \| null           | A developmental promotion's parent; not itself. Default: none                                          |
| `production`          | area → level                      | Every area (`stage`, `camera`, `editing`, `pyro`, `music`, `writing`, `marketing`, `backOffice`), 0-10 |
| `policies`            | area → tier                       | `catering`, `travel`, `medical`, 0-3 each                                                              |
| `color`               | `#rrggbb`                         |                                                                                                        |

**`brand`**

| Field          | Type            | Rules                             |
| -------------- | --------------- | --------------------------------- |
| `key`          | key             |                                   |
| `promotionKey` | ref → promotion |                                   |
| `name`         | string          | 1-40 characters                   |
| `logoRef?`     | image \| null   | Default: placeholder              |
| `priority`     | integer         | 0 or more; 0 = the flagship brand |
| `active`       | boolean         |                                   |

**`title`**

| Field          | Type                                   | Rules                                                                     |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `key`          | key                                    |                                                                           |
| `promotionKey` | ref → promotion                        |                                                                           |
| `brandKey?`    | ref → brand \| null                    | Default: promotion-wide                                                   |
| `name`         | string                                 | 1-60 characters                                                           |
| `holderCount`  | `1` \| `2` \| `3`                      |                                                                           |
| `division`     | `{ gender, minWeightKg, maxWeightKg }` | `open` \| `male` \| `female`; weights positive or null, min not above max |
| `prestige`     | number                                 | 0-100                                                                     |
| `status`       | `active` \| `retired`                  |                                                                           |
| `introducedOn` | ISO date                               |                                                                           |
| `retiredOn?`   | ISO date \| null                       | Set exactly when `retired`; not before `introducedOn`                     |
| `imageRef?`    | image \| null                          | Default: placeholder belt                                                 |
| `color`        | `#rrggbb`                              |                                                                           |

**`venue`**

| Field                    | Type                    | Rules                                                      |
| ------------------------ | ----------------------- | ---------------------------------------------------------- |
| `key`                    | key                     |                                                            |
| `regionKey`              | ref → region            |                                                            |
| `name`                   | string                  | 1-80 characters                                            |
| `capacity`               | integer                 | 1-200000                                                   |
| `kind`                   | venue kind              | `hall`, `theatre`, `arena`, `stadium`, `studio`, `outdoor` |
| `openedOn?`              | ISO date \| null        | Default: always open                                       |
| `closedOn?`              | ISO date \| null        | After `openedOn`. Default: stays open                      |
| `exclusivePromotionKey?` | ref → promotion \| null | Default: anyone can book it                                |
| `imageRef?`              | image \| null           | Default: placeholder                                       |

**`network`**

| Field                | Type                                         | Rules                                                       |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `key`                | key                                          |                                                             |
| `name`               | string                                       | 1-60 characters                                             |
| `kind`               | `tv` \| `ppv` \| `streaming`                 |                                                             |
| `reachTier`          | integer                                      | 0-4                                                         |
| `coverage`           | `{ continentKeys, countryKeys, regionKeys }` | Refs to each level, no repeats; at least one entry in total |
| `ownerPromotionKey?` | ref → promotion \| null                      | A promotion's own service. Default: independent             |
| `status?`            | `active` \| `closed`                         | Default: `active`                                           |
| `launchedOn`         | ISO date                                     |                                                             |
| `closedOn?`          | ISO date \| null                             | After `launchedOn`. Default: none                           |
| `logoRef?`           | image \| null                                | Default: placeholder                                        |

**`eventDefinition`**: a recurring or one-off show.

| Field                 | Type                      | Rules                                                                                                                                                                                                                 |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                 | key                       |                                                                                                                                                                                                                       |
| `promotionKey`        | ref → promotion           |                                                                                                                                                                                                                       |
| `brandKey?`           | ref → brand \| null       | Default: promotion-wide (supershow)                                                                                                                                                                                   |
| `name`                | string                    | 1-60 characters                                                                                                                                                                                                       |
| `importance`          | importance                | `house`, `minor`, `regular`, `major`, `flagship`                                                                                                                                                                      |
| `recurrence`          | recurrence                | Exactly the engine's: `weekly` (`weekdays`), `everyNWeeks` (`intervalWeeks` 2-8, `weekday`, `anchor` on that weekday), `monthly` (`week`, `weekday`), `annual` (`month`, `week`, `weekday`), `dates` (sorted, unique) |
| `format`              | `{ slots, preShowSlots }` | `slots` 3-12, `preShowSlots` 0-3                                                                                                                                                                                      |
| `televised`           | boolean                   |                                                                                                                                                                                                                       |
| `preferredRegionKey?` | ref → region \| null      | Default: none                                                                                                                                                                                                         |
| `preferredVenueKey?`  | ref → venue \| null       | Default: none                                                                                                                                                                                                         |
| `activeFrom`          | ISO date                  |                                                                                                                                                                                                                       |
| `activeUntil?`        | ISO date \| null          | Not before `activeFrom`. Default: keeps running                                                                                                                                                                       |
| `logoRef?`            | image \| null             | Default: placeholder                                                                                                                                                                                                  |

Weekdays are `0` (Monday) to `6` (Sunday). Shows are built from segment slots,
not minutes (design decision D-10), so there is no length or running-time
field anywhere in the format. A `lengthMinutes` field is an unknown key and
fails.

**`deal`**: a TV deal running when the world starts. The loader stores it as
`active`, offered on `startsOn`.

| Field                 | Type                                              | Rules                                                   |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `key`                 | key                                               |                                                         |
| `promotionKey`        | ref → promotion                                   |                                                         |
| `networkKey`          | ref → network                                     |                                                         |
| `eventDefinitionKey?` | ref → eventDefinition \| null                     | Default: every televised show of the promotion          |
| `startsOn`            | ISO date                                          |                                                         |
| `endsOn`              | ISO date                                          | After `startsOn`; the first day the deal no longer runs |
| `timeslot`            | timeslot                                          | `daytime`, `evening`, `primeTime`, `lateNight`          |
| `weekday`             | 0-6 \| null                                       | Null when the show isn't tied to a weekday              |
| `live`                | boolean                                           |                                                         |
| `terms`               | `{ feePerShow, perThousandViewers, costPerShow }` | Whole currency units, 0 or more each                    |

## A worked example

The smallest useful world: one continent, one country, one region, one
promotion, one wrestler and his contract. The engine's test suite reads these
blocks straight out of this doc and parses them, so the example can't go stale.

<!-- example-pack-file: pack.json -->

```json
{
  "formatVersion": 1,
  "id": "example-world",
  "name": "Example World",
  "version": "1.0.0",
  "kind": "world",
  "description": "One region, one promotion and one wrestler.",
  "author": "Ringside Booker",
  "dependsOn": [],
  "startDate": "2026-01-05",
  "files": {
    "continent": "geography/continents.json",
    "country": "geography/countries.json",
    "region": "geography/regions.json",
    "person": "people.json",
    "promotion": "promotions.json",
    "employment": "employments.json"
  }
}
```

<!-- example-pack-file: geography/continents.json -->

```json
[{ "key": "arden", "name": "Arden", "code": "ARD" }]
```

<!-- example-pack-file: geography/countries.json -->

```json
[
  {
    "key": "cormere",
    "name": "Cormere",
    "code": "CRM",
    "continentKey": "arden",
    "population": 8200000,
    "wrestlingInterest": 62,
    "economy": 55,
    "preferredStyle": "traditional"
  }
]
```

<!-- example-pack-file: geography/regions.json -->

```json
[
  {
    "key": "harbour-coast",
    "name": "Harbour Coast",
    "countryKey": "cormere",
    "population": 1900000,
    "neighbourKeys": []
  }
]
```

<!-- example-pack-file: people.json -->

```json
[
  {
    "key": "jack-marlow",
    "givenName": "Jack",
    "familyName": "Marlow",
    "defaultRingName": "Jack Marlow",
    "gender": "male",
    "birthDate": "1996-04-12",
    "debutDate": "2016-09-03",
    "birthRegionKey": "harbour-coast",
    "basedInRegionKey": "harbour-coast",
    "roles": ["wrestler"],
    "motivation": "legacy",
    "heightCm": 185,
    "weightKg": 102,
    "build": "athletic",
    "style": "technician",
    "attributes": {
      "ringwork": 68,
      "psychology": 61,
      "stamina": 70,
      "safety": 74,
      "athleticism": 63,
      "mic": 45,
      "charisma": 52,
      "presence": 55,
      "officiating": 5,
      "broadcasting": 10,
      "producing": 8,
      "booking": 12
    },
    "condition": { "head": 100, "neck": 95, "back": 90, "arms": 100, "torso": 100, "legs": 92 },
    "development": { "potential": 250, "ceilings": { "ringwork": 85 } },
    "regionalPop": { "harbour-coast": 34 },
    "traits": ["workhorse", "professional"],
    "vices": { "alcohol": "none", "substances": "none" }
  }
]
```

<!-- example-pack-file: promotions.json -->

```json
[
  {
    "key": "harbour-city-wrestling",
    "name": "Harbour City Wrestling",
    "shortName": "HCW",
    "foundedOn": "2012-05-19",
    "status": "active",
    "homeRegionKey": "harbour-coast",
    "regionalPop": { "harbour-coast": 41 },
    "prestige": 38,
    "cash": 250000,
    "style": "traditional",
    "production": {
      "stage": 3,
      "camera": 3,
      "editing": 2,
      "pyro": 1,
      "music": 2,
      "writing": 3,
      "marketing": 2,
      "backOffice": 3
    },
    "policies": { "catering": 1, "travel": 1, "medical": 2 },
    "color": "#1f6f8b"
  }
]
```

<!-- example-pack-file: employments.json -->

```json
[
  {
    "key": "jack-marlow-hcw",
    "personKey": "jack-marlow",
    "promotionKey": "harbour-city-wrestling",
    "role": "wrestler",
    "ringName": "Jack Marlow",
    "alignment": "face",
    "push": "upperCard",
    "terms": {
      "kind": "written",
      "exclusive": true,
      "monthlyWage": 2500,
      "perAppearanceFee": 0,
      "signingBonus": 0,
      "shares": { "gateBp": 0, "merchBp": 500, "broadcastBp": 0 },
      "appearanceCap": null,
      "perks": {
        "creativeControl": false,
        "noHouseShows": false,
        "ironClad": false,
        "travelCovered": true
      }
    },
    "startsOn": "2025-03-01",
    "endsOn": "2027-03-01"
  }
]
```

The region leaves out `wrestlingInterest` and `preferredStyle`, so it takes 62
and `traditional` from Cormere. The promotion has no owner, booker or logo, so
the loader fills in nulls and the UI draws a placeholder logo.

## Loading

Code: `packages/engine/src/persistence/packs/` (`resolve.ts`, `merge.ts`,
`references.ts`, `materialise.ts`, `load.ts`).

The loader turns a set of packs into a validated `World`. It never touches the
file system or the DOM: the caller (the web worker, the tools) reads the JSON
and hands it over as `RawPack`s, each a manifest plus one parsed value per
record kind. `loadWorldFromPacks(packs, rootIds, { seed, startDate?, settings?,
worldName? })` runs every step below and returns either the world or a list of
issues. Bad content never throws; only a bad option from the caller (an
unusable seed, a 3-day season) does.

### Order of operations

1. **Resolve** (`resolvePacks`). Starting from the root packs (the world and
   any add-ons picked), follow every `dependsOn`, check each dependency was
   passed in and that its version is in the range asked for, and sort the packs
   so each comes after its dependencies. When two packs could go next, the
   lower pack ID goes first, so the order never depends on the order the packs
   were passed in. Packs no root reaches are left out. A cycle is reported as
   `a → b → a`.
2. **Merge** (`mergeRecords`). Check that the manifest's `files` and the data
   agree, parse every entry with its kind's schema, then fold the packs in load
   order: plain records add keys, `replace` swaps a record, `patch`
   shallow-merges it, `$remove` deletes it. Only `world` and `addon` packs may
   override or remove, and only records that come from one of their own
   dependencies (direct or indirect). Every surviving record is then parsed
   again with the full schema, so a patch can't leave a record invalid.
3. **Check references** (`checkReferences`). Every reference field, listed per
   kind next to its schema (`regionReferences`, `employmentReferences`, ...),
   must name a record of the right kind. A qualified reference
   (`mini-base:north-ridge`) must name a pack that defined or overrode the
   record. A region whose neighbour doesn't list it back gets a warning, and
   the loader stores the adjacency both ways.
4. **Materialise** (`materialiseWorld`). Create an empty World with the seeded
   ID minter installed, then inside one transaction:
   - mint an ID for every record in the canonical order below;
   - turn each record into its entity: keys to IDs, whole money units to
     cents, defaults filled in (the "Default" notes in the tables above), a
     region's missing `wrestlingInterest` and `preferredStyle` taken from its
     country, every person rested and uninjured, every employment and deal
     `active` and offered on its start date, a reign's `holderNamesAtTime`
     from each holder's ring name with the title's promotion, a computer
     controller on every promotion and a null controller on every brand;
   - parse each entity with its engine schema and insert it;
   - create season 1, active, from the start date, `settings.season.lengthDays`
     long (the last day is `startDate + lengthDays - 1`);
   - store `contentKeys` on the metadata and run `checkWorld`.

   Any error rolls the whole transaction back, so a bad pack never produces a
   half-built world.

Settings the caller leaves out take these defaults: aging on, sandbox off,
generation level `low`, level playing field off, 364-day seasons, no extra
settings. The start date defaults to the last world pack's `startDate`, and
the world's name to that pack's name. New-game setup (WLD-10) passes the
player's own choices.

### What ends up where

- **World metadata.** `contentPacks` lists the loaded packs and versions in
  load order. `contentKeys` maps record kind → key → minted ID for every record
  that became an entity, so later systems, saves and mods can find a pack
  record's entity by key.
- **Content library.** Name cultures, name mixes, ring name words, generation
  profiles and trait incidence never become entities. The loader returns them
  as a frozen `ContentLibrary` for the generators, with references reduced to
  bare keys. A save stores only `contentPacks`; the library is rebuilt from
  the packs when the save is loaded, which keeps name lists out of every save.
- **RNG registry.** The loader returns the `RngRegistry` its IDs were minted
  from, so the game carries on drawing from the same streams and saves their
  state.

### Canonical ID order

IDs are minted kind by kind in this order, and by key (ascending) within a
kind: continent, country, region, promotion, brand, venue, network, title,
person, employment, team, eventDefinition, deal, titleReign, then season 1.
Each kind draws from its own `ids.<prefix>` stream, so the IDs are a pure
function of the seed and the merged content: the same packs and seed always
give the same world, and a different seed gives different IDs for the same
entities.

All IDs are minted before the first row is written, because some records point
forward in that order (a promotion's owner is a person; regions list each
other). Minting first draws exactly the IDs `tx.create` would have drawn row by
row.

### Issue codes

Every issue names its severity, code, pack, file, record kind, record key and
a path such as `['employment', 'emp-x', 'personKey']` (kind, key, then the
field path inside the record).

| Code                      | Severity | Step        | Meaning                                                                                         |
| ------------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `manifest`                | error    | resolve     | A manifest doesn't match the manifest schema.                                                   |
| `duplicate-pack`          | error    | resolve     | Two packs passed in share an ID.                                                                |
| `missing-dependency`      | error    | resolve     | A root or a `dependsOn` entry names a pack that wasn't passed in.                               |
| `version-mismatch`        | error    | resolve     | A dependency's version is outside the range asked for.                                          |
| `dependency-cycle`        | error    | resolve     | Packs depend on each other in a loop.                                                           |
| `missing-file`            | error    | merge       | The manifest lists a file for a kind but no data came with it.                                  |
| `unlisted-file`           | error    | merge       | Data came for a kind the manifest doesn't list.                                                 |
| `schema`                  | error    | merge       | An entry, or a record after merging, doesn't match its kind's schema.                           |
| `duplicate-key`           | error    | merge       | A key appears twice in one file, or two packs add it without `$override`.                       |
| `override-not-allowed`    | error    | merge       | A `base` pack uses `$override` or `$remove`.                                                    |
| `override-target-missing` | error    | merge       | `$override` or `$remove` names a key none of the pack's dependencies defines.                   |
| `unknown-reference`       | error    | references  | A reference names a key no loaded record of that kind has (or a pack that didn't define it).    |
| `wrong-kind-reference`    | error    | references  | A reference names a key that exists only as another kind, such as a country in `homeRegionKey`. |
| `one-sided-neighbour`     | warning  | references  | A region's neighbour doesn't list it back. Both sides are stored.                               |
| `missing-start-date`      | error    | load        | No start date was given and no world pack was loaded.                                           |
| `entity-schema`           | error    | materialise | A record doesn't make a valid entity, or the finished world fails `checkWorld`.                 |
