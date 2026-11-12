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
