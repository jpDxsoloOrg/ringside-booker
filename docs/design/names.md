# Names

Every generated person needs a legal name that fits where they were born, and
every wrestler needs a ring name. Both come from word lists in the `base` pack
and a seeded generator, so the same seed always names the same people the same
way, and no name is handed out twice in one world.

Code: `packages/engine/src/systems/world/names/` (`weighted.ts`,
`registry.ts`, `generator.ts`). Data: `content/base/names/`. Record format:
[data-packs.md](data-packs.md#names).

## Cultures

A **name culture** is a pool of names that belong together: given names for
men, given names for women, a neutral list anyone can be given, and surnames.
The base pack ships 19:

| Culture            | Where it shows up                                                 |
| ------------------ | ----------------------------------------------------------------- |
| `anglo`            | United States, Canada, the UK, Ireland, Australia, New Zealand    |
| `hispanic`         | Mexico, the Caribbean, Central and South America, Spain           |
| `lusophone`        | Brazil, Portugal                                                  |
| `francophone`      | France, Belgium, Switzerland, Quebec                              |
| `germanic`         | Germany, Austria, Switzerland, the Netherlands, Flanders          |
| `nordic`           | Sweden, Norway, Denmark, Greenland                                |
| `italian`          | Italy, and the Italian families of Argentina and Australia        |
| `slavic`           | Poland, and Slavic minorities across Europe                       |
| `japanese`         | Japan, and Japanese communities in Brazil and Peru                |
| `korean`           | South Korea                                                       |
| `chinese`          | China, Taiwan, Singapore, Malaysia, Chinese communities elsewhere |
| `south-asian`      | India, and South Asian communities in the UK, the Gulf and Fiji   |
| `filipino`         | The Philippines, the Gulf                                         |
| `malay`            | Malaysia, Indonesia, Singapore                                    |
| `arabic`           | Egypt, the UAE, North African communities in Europe               |
| `west-african`     | Nigeria, Ghana, the West African diaspora                         |
| `east-african`     | Kenya                                                             |
| `southern-african` | South Africa                                                      |
| `pacific`          | Fiji, Māori and Pasifika New Zealanders                           |

The six cultures used the most (`anglo`, `hispanic`, `japanese`, `germanic`,
`francophone`, `lusophone`) have at least 150 male, 150 female and 40 neutral
given names and 250 surnames. The others have at least 60, 60, 15 and 100.

The lists are written from everyday knowledge of which names are common where.
Each name has a weight from 1 to 100, set by hand in three broad tiers rather
than copied from any frequency count:

| Tier   | Weights | Meaning                                    |
| ------ | ------- | ------------------------------------------ |
| Common | 60-100  | Names you meet all the time                |
| Usual  | 20-59   | Familiar names, not at the top of any list |
| Rare   | 1-19    | Old-fashioned, regional or unusual names   |

Lists are written in their tiers, most common first, and the weights step down
gently inside each tier, so no single name dominates a roster. Across 20,000
names from the biggest culture, no given name reaches 3% of them (the test pins
this).

Some simplifications, on purpose:

- **Name order.** Every name is shown given name first, including Japanese,
  Korean and Chinese names, the way most English-language wrestling coverage
  writes them.
- **Gendered surnames.** Polish, Czech and Russian surnames often change form
  for women (Górski, Górska). The engine doesn't model that yet, so the
  `slavic` list sticks to surnames that read the same for everyone (Nowak,
  Kowalczyk, Horvat, Shevchenko).
- **Patronymics.** Malay and many Indonesian names have no inherited family
  name. The `malay` culture uses names that work as surnames in English-language
  use, and is marked `patronymic-free`.

## How a country mix works

Countries rarely have one naming tradition. A **country name mix** lists the
cultures a country's people are named from and how often:

```json
{
  "key": "us",
  "countryKey": "us",
  "cultures": [
    { "cultureKey": "anglo", "weight": 70 },
    { "cultureKey": "hispanic", "weight": 18 },
    { "cultureKey": "west-african", "weight": 6 },
    { "cultureKey": "south-asian", "weight": 6 }
  ]
}
```

Writing a culture once and mixing it per country gives far more variety per
byte than a separate list for every country, and it models modern, mixed
countries directly. Every country in the base pack has a mix; the
`validate-world` geography rule fails a country without one.

To name someone born in a country, the generator:

1. picks a culture from the mix by weight (`weightedPick`; the lists are short);
2. picks a given name from that culture (see gender handling below);
3. picks a surname from the same culture, except with probability
   `worldgen.names.mixedHeritageChance` (default 0.08), when the surname comes
   from a second pick of the mix instead, for people with parents from two
   traditions;
4. for cultures whose `surnameStyle` is `double` (`hispanic`, `lusophone`),
   adds a second surname from the same culture with the culture's own
   `doubleSurnameChance` (0.35 for both). A second surname that comes out the
   same as the first is dropped.

The display name is `given family`. It also seeds `defaultRingName` until a
ring name is chosen.

## Weighted picks

Name lists run to hundreds of entries, so they are not picked with the generic
`weightedPick` (which walks its list every time). When the generator first sees
a content library it builds a **weighted table** per list: the running total of
the weights in a `Uint32Array`. A pick draws one whole number from 1 to the
total with `intBetween` and binary-searches for the first running total that
reaches it.

That makes a pick exactly proportional: a name with weight `w` in a list
totalling `W` comes up with probability `w / W`, no more and no less. Weights
`A: 1, B: 3` give B three picks in four, which the tests check over 400,000
draws. A pick always uses one draw, however long the list, so adding names to
a list never shifts the rest of the stream.

## Gender handling

People are `male`, `female` or `nonBinary`, and every path is supported:

- **Men and women** get a name from their own list, except with probability
  `worldgen.names.neutralGivenShare` (default 0.05), when it comes from the
  neutral list.
- **Non-binary people** get a neutral name with probability
  `worldgen.names.nonbinaryNeutralShare` (default 0.5). Otherwise the male and
  female lists are picked 50/50.
- A culture with no neutral names falls back to the gendered lists, and the
  trace says so.

The rolls are always drawn, even when a list is empty, so the number of draws
never depends on the content.

## Uniqueness

No two people in a world share a legal name, and no two share a ring name. The
**name registry** holds every name in use, built from the world (each person's
legal name and default ring name, and the ring name on every contract, past
ones included). Names are compared in a normalised form: lower case, accents
removed, punctuation dropped and spaces collapsed, so "José O'Neil" and
"jose oneil" are the same name.

When a rolled name is taken:

1. roll a completely fresh name, up to `worldgen.names.maxRetries` times
   (default 20);
2. then keep the last name and add a middle initial, trying the letters A-Z in
   an order shuffled from the same stream (the initial joins the given name,
   "Jack R. Marlow");
3. if every one of those is taken too, throw `NameSpaceExhaustedError`
   (`NAME_SPACE_EXHAUSTED`), naming the country.

The error means the content is broken (a country whose lists are far too small
for the world), not a situation the game handles. Every country in the base
pack can name 2,000 people without running out; a test loops over all of them.

## Ring names

Ring names fill a weighted **pattern** from the ring name words:

| Pattern                         | Weight | Example                  |
| ------------------------------- | ------ | ------------------------ |
| `{given} {family}`              | 30     | Sara Simmons             |
| `{adjective} {noun}`            | 22     | Copper Buffalo           |
| `{given} "{nickname}" {family}` | 10     | Taylor "Lightning" White |
| `{nickname} {family}`           | 8      | Sheriff Musa             |
| `The {noun}`                    | 8      | The Spark                |
| `{given} {noun}`                | 7      | Justin Volcano           |
| `{adjective} {given}`           | 5      | Solar Amal               |
| `{given}`                       | 5      | Sakura                   |
| `{nickname}`                    | 5      | Lightning                |

There are 161 adjectives, 173 nouns and 88 nicknames, all generic words.
`{given}` and `{family}` come from the person's legal name, without any middle
initial.

- A ring name never repeats another ring name in the world, and never equals
  another person's legal name. A person may wrestle under their own legal name.
- People with the `nonWrestler` style (managers and other talkers) only get the
  patterns made of `{given}` and `{family}`.
- When a name is taken, the pattern is rolled again up to
  `worldgen.names.maxRetries` times; then the person's own legal name is tried;
  then that name with each middle initial; then the generator throws
  `NameSpaceExhaustedError` for ring names.

The word lists are screened against the real-name blocklist
(`content/blocklist/real-names.txt`): no adjective-noun pair, nickname, or
`The {noun}` spells a real performer, promotion, show or title. A
`validate-world` test also runs the blocklist check over a seeded sample of
5,000 generated legal names and ring names.

## Streams and traces

Legal names draw only from `worldgen.names.person` and ring names only from
`worldgen.names.ring`, so changing the ring name rules, or generating more
ring names, never changes anyone's legal name. A test generates 100 ring names
between legal names and checks the legal names don't move.

`personName` and `ringName` return `Traced` results. A legal name's trace lists
the four tunables it read, the culture picked with its weight and the mix
total, the list the given name came from, every roll with its odds, and each
retry with its reason ("Jack Marlow is already taken, so the name is rolled
again"). A ring name's trace lists the pattern, the words picked and any
retries.

## Tunables

| Key                                    | Kind    | Default | Range | Unit        | What it does                                                        |
| -------------------------------------- | ------- | ------- | ----- | ----------- | ------------------------------------------------------------------- |
| `worldgen.names.neutralGivenShare`     | number  | 0.05    | 0–1   | probability | Chance a man or woman gets a neutral given name                     |
| `worldgen.names.nonbinaryNeutralShare` | number  | 0.5     | 0–1   | probability | Chance a non-binary person gets a neutral given name                |
| `worldgen.names.mixedHeritageChance`   | number  | 0.08    | 0–1   | probability | Chance the surname comes from a second pick of the country's mix    |
| `worldgen.names.maxRetries`            | integer | 20      | 0–200 | count       | Fresh rolls on a taken name before falling back to a middle initial |

The double surname chance is not a tunable: it belongs to each culture, so it
lives in the culture record.

## Adding a culture in a pack

A pack adds names with the same three record kinds the base pack uses
(`nameCulture`, `countryNameMix`, `ringNameWords`; see
[data-packs.md](data-packs.md#names)):

1. Write a `nameCulture` record with a new key: a `label`, `given.male`,
   `given.female` and `given.neutral` (may be empty) as `["Name", weight]`
   pairs, `surnames`, and a `surnameStyle`. A `double` culture also sets
   `doubleSurnameChance`.
2. Use it in a country's mix. To change a base country, override its mix in an
   add-on or world pack: `"$override": "patch"` with a new `cultures` list, or
   `"$override": "replace"` for the whole record. A new country needs its own
   `countryNameMix` with the country's key.
3. To add ring name words, add a `ringNameWords` record with a new key. The
   generator merges every `ringNameWords` record: words are pooled (repeats
   dropped) and patterns added (a pattern already listed keeps its first
   weight).
4. Run `validate-world` on the pack. Keep lists large enough for the world: a
   culture used for a whole country wants at least the minimum sizes above.

Names must be original or ordinary: no real performers, and nothing that, put
together with another list, spells a real name. Add a real name to the
blocklist when you notice a near miss.
