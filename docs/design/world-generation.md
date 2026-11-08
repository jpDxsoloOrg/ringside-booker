# World generation

How the engine builds the people, places and organisations of a world. The map
is in [geography.md](geography.md) and names are in [names.md](names.md); this
doc covers generating people. Potential, traits, vices and regional popularity
(WLD-07) and the default roster (WLD-09) get their own sections when they land.

## Generating people

One function makes a new person from a short spec:

```ts
generatePerson(spec, ctx): Traced<GeneratedPerson>
// GeneratedPerson = { person: Person; talent: number }
```

It decides where they're from, their gender, age, birth and debut dates, ring
style, body type, height and weight, the condition of each body part and every
core attribute. All the distributions come from the `base` pack's generation
records, so the balance lives in data that a pack can change without touching
code. The same function will build the default roster, the newcomers who turn
up during a game and the trainees at training schools.

Code: `packages/engine/src/systems/world/people/` (`spec.ts`, `generate.ts`,
`dates.ts`, `body.ts`, `attributes.ts`, `content.ts`). Data:
`content/base/generation/`. Record formats:
[data-packs.md](data-packs.md#generation).

`generatePerson` is a pure function of the spec, the world date, the content
library and the RNG state. The one side effect is the legal name it adds to the
name generator's registry, so two people never share a name. `PersonGenerator`
is the same thing with the library, map, names, tunables and seeds fixed once,
for callers that make many people.

### The spec

```ts
interface GenerateSpec {
  role: PersonRole; // wrestler, occasionalWrestler, manager, presenter, announcer, referee, producer
  careerStage?: 'rookie' | 'prospect' | 'established' | 'veteran' | 'legend';
  gender?: Gender;
  countryId?: CountryId;
  regionId?: RegionId;
  continentId?: ContinentId;
  style?: RingStyle; // wrestling roles only
  archetype?: ArchetypeKey; // a body archetype key, such as "power-brawler"
  talent?: number; // a z-score, for hand-picked stars
  attributeOverrides?: Partial<Record<AttributeKey, number>>;
}
```

Only the role is required. Anything else the caller sets is used as given and
shows up in the trace as "Set by hand"; anything left out is rolled. A spec that
contradicts its role (a referee with a ring style, a wrestler with
`nonWrestler`) or asks for content the library doesn't have (an unknown
archetype, a role with no profile) throws a `GenerationContentError` that names
the problem.

The context carries the person's ID (minted by the caller), the world date, the
content library, the map, the name generator, the RNG streams, the tunables and
the seed hooks.

### Profiles

Five record kinds in `content/base/generation/` drive the generator:

| File                  | Kind                | What it holds                                                                                                                                |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles.json`          | `generationRole`    | Per role: gender shares, career-stage shares, ages per stage, role skills vs performer attributes, the debut rule, motivation weights        |
| `profiles.json`       | `generationProfile` | Per role and career stage: every attribute's mean, spread and talent weight                                                                  |
| `styles.json`         | `generationStyle`   | Per ring style: global weight, the promotion styles that boost it, attribute modifiers, wear multiplier, mask chance                         |
| `archetypes.json`     | `bodyArchetype`     | 17 body shapes: height and weight ranges, the build they produce, scaling for women and non-binary people, and a weight for every ring style |
| `body-modifiers.json` | `bodyModifier`      | Attributes that move with height or weight: heavy people tire sooner, tall and big people fill the screen                                    |

**Roles.** Wrestlers are 68% men, 30% women and 2% non-binary. Referees and
producers skew further toward men; presenters and announcers are closer to
even. A role's **role skills** are the crew attributes that are its job
(`officiating` for referees, `broadcasting` for announcers and presenters,
`producing` and `booking` for producers). Its **performer attributes** are the
in-ring and character attributes, the pool a natural standout is picked from.
Only the two wrestling roles are `performer: true`: they get a ring style and
can roll a standout. Wrestlers, occasional wrestlers and managers have a debut
date; the other roles don't.

**Career stages.** The default ages:

| Stage       | Ages  |
| ----------- | ----- |
| Rookie      | 18-24 |
| Prospect    | 21-28 |
| Established | 26-36 |
| Veteran     | 33-45 |
| Legend      | 40-58 |

Producers start a few years older at every stage. Experience lives in the
profiles rather than in code: rookies are low on ring work and psychology,
veterans are high on psychology and lower on stamina, legends are the best
talkers and the most worn.

**Non-wrestlers.** A referee, announcer, presenter or producer gets the low
"civilian" numbers for the in-ring and character attributes (so a manager can
still be booked in an angle, and a referee can take a bump), and their role
skill from the role's profile: mean 55, spread 14 when established. Managers
have no crew skill; their profile is strong on mic, charisma and presence
instead.

### Location

A given region is used as it is. Otherwise the generator picks a region inside
the given country, else inside the given continent, else anywhere on the map,
with `pickRegion` weighted by `population × interest / 100` (see
[geography.md](geography.md#picking-a-region)). The pick sets both the birth
region and the based-in region; the default roster builder can move people to
where their promotion is later.

### Age and dates

The career stage is rolled from the role's stage shares unless the spec sets
it. The age is a normal draw around the middle of the stage's ages, with a
spread of a quarter of the range, clamped to the range and rounded to whole
years.

The birth date goes back exactly that many years from the world date, then
back 0-364 more days:

```
birthDate = addDays(addYears(worldDate, −age), −intBetween(0, 364))
```

The generator checks that `ageInYears(birthDate, worldDate) === age`, so the
age on the day the person appears is exactly the age that was drawn. Ages are
always measured at the world date the caller passes in, never at the date the
game started, so someone generated ten years into a game is as old as their
birth date says.

For roles with a debut, the debut age is a normal draw around
`worldgen.people.debutAgeMean` (21) with the role's spread (2.2 for wrestlers),
kept between the role's limits (17-30 for wrestlers) and never later than the
current age. The debut date is the birthday at the whole debut age plus the
fraction of a year in days, and never after the world date. Years since the
debut are the person's experience, which drives body wear.

### Ring style

Non-wrestling roles are always `nonWrestler`. A wrestler's style is a weighted
pick over the global weights in `styles.json` (all-rounder 20, technician 14,
brawler and showman 12, high flyer 11, and so on). The styles that suit the
home region's preferred promotion style (or the country's, when the region has
none) are multiplied by `worldgen.people.homeStyleBoost` (3). A wrestler from
a high-flying region is about three times as likely to be a high flyer.

### Body

The body archetype is a weighted pick over every archetype's weight for the
person's ring style. An archetype that can't work a style has weight 0 for it,
so a super-heavy giant is never a high flyer and nothing has to be rerolled.
Rerolling bad combinations skews the odds in ways that are hard to predict;
weights of 0 are exact and easy to test. A spec can still name an archetype
directly; a poor fit for the style gets a note in the trace.

Height and weight are uniform inside the archetype's ranges. Women and
non-binary people use the archetype's scale table (by default height × 0.93
and weight × 0.80 for women, × 0.96 and × 0.88 for non-binary people), so one
list of archetypes serves everyone. Both are rounded and kept inside the
person's ranges (140-230 cm, 40-250 kg). The archetype sets the person's
`build`.

### Body condition

Every body part (head, neck, back, arms, torso, legs) starts at `100 − wear`,
rolled independently per part:

```
wear = clamp(wearPerYear × experienceYears × styleWearMultiplier + N(0, wearSd), 0, wearMax)
```

With the defaults (1.6 points a year, spread 5, at most 45) a fresh rookie is
close to 100 everywhere and a legend with thirty years in the ring is in the
50s and 60s. Hard-hitting styles wear people down faster: strikers × 1.2,
hardcore wrestlers × 1.4, showmen × 0.85.

### Attributes

Every attribute is rolled the same way:

```
value = mean + sd × (ρ × talent + √(1 − ρ²) × noise)
```

- `mean` and `sd` come from the profile for the person's role and career stage.
- `ρ` is the attribute's **talent weight** in that profile, 0-1.
- `talent ~ N(0, 1)` is drawn once per person.
- `noise ~ N(0, 1)` is drawn once per attribute.

Then the ring style's attribute modifiers are added (a high flyer gets +8
athleticism and −4 safety), then the body modifiers, then a natural standout's
bonus if there is one. The result is clamped to 0-100 and rounded.

**Worked example.** An established wrestler, a technician, with talent 1.2.
Ring work in the established wrestler profile is mean 55, spread 13, talent
weight 0.65; their ring work noise is −0.5.

| Step                          | Sum                      | Value  |
| ----------------------------- | ------------------------ | ------ |
| Profile average (established) |                          | 55.00  |
| Talent                        | 13 × 0.65 × 1.2          | +10.14 |
| Personal variation            | 13 × √(1 − 0.65²) × −0.5 | −4.94  |
| Technician style              |                          | +3.00  |
| Kept between 0 and 100        |                          | 63.20  |
| Rounded                       |                          | **63** |

Their psychology (mean 52, spread 13, weight 0.62, noise +0.3) gets
`13 × 0.62 × 1.2 = +9.67` from the same talent, `13 × 0.78 × 0.3 = +3.06`
variation and +4 for being a technician: 68.73, so **69**. Both are well above
the established average because the same talent lifts both.

### Talent

Rolling each attribute on its own makes everyone average-ish across the board,
and a star only happens by accident. One shared talent value with a weight per
attribute gives believable people: a gifted worker tends to be good at the
related skills, while the noise term still produces specialists (the great
talker who can't go in the ring).

The maths keeps the profile honest. Because `ρ² + (1 − ρ²) = 1`, the talent
term never changes an attribute's spread; it only makes attributes move
together. Two attributes with talent weights ρ₁ and ρ₂ have a correlation of
`ρ₁ × ρ₂` (before clamping): two at 0.6 correlate at 0.36, and an attribute
with weight 0 is independent of everything. The tests pin both.

A spec can set the talent directly for a hand-picked star. The attribute
stream still draws a talent, so a hand-set talent doesn't shift anyone else's
numbers. Talent is not stored on the person: it is handed to the seeds
(potential, traits) and then dropped.

### Body modifiers

`body-modifiers.json` moves attributes with the body, each modifier
`perUnit` points per cm or kg past its threshold, capped at `limit` points:

| Modifier          | Attribute   | Rule                      | Cap |
| ----------------- | ----------- | ------------------------- | --- |
| Heavy stamina     | stamina     | −0.25 per kg above 110 kg | 20  |
| Heavy athleticism | athleticism | −0.12 per kg above 120 kg | 8   |
| Light athleticism | athleticism | +0.15 per kg below 85 kg  | 4   |
| Tall presence     | presence    | +0.25 per cm above 182 cm | 8   |
| Heavy presence    | presence    | +0.08 per kg above 105 kg | 5   |

So a 150 kg wrestler gives up 10 points of stamina and an extra 3.6 points of
presence for their size.

### Natural standouts

With probability `worldgen.people.standoutChance` (1.5%) a wrestler is a
natural standout: one performer attribute, picked at random, gets a bonus drawn
from `N(18, 6)` and kept between 8 and 30, added before the clamp. Non-wrestling
roles never roll one.

### Streams and draw order

The generator draws from three streams so that each part can change without
moving the others:

| Stream                       | Draws, in order                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `worldgen.people.identity`   | Home region (when not given), gender (when not given), career stage (when not given), age, birthday offset, debut age, motivation |
| `worldgen.people.body`       | Ring style (wrestlers without a given style), body archetype (when not given), height, weight, wear per body part, mask           |
| `worldgen.people.attributes` | Talent, one variation per attribute, standout chance, standout attribute, standout bonus                                          |

The legal name comes from `worldgen.names.person` (see
[names.md](names.md#streams-and-traces)). The attributes stream always takes
the same 30 draws per person, whatever comes up, so changing the archetypes or
the style weights never changes anyone's attribute rolls, and a standout never
shifts the next person's numbers. A test changes every archetype's style
weights and checks that the attributes don't move.

### The trace

The result's trace has four groups. **Identity** holds the home region pick,
gender, career stage, the age calculation, the birth date roll, the debut age
and the legal name. **Body** holds the ring style decision (every style with
its weight and boost), the body type decision, height, weight, each body part's
condition with its wear calculation, and the mask roll. **Attributes** holds
the talent and one calculation per attribute: the profile average, the talent
term, the variation roll and term, each modifier with its reason, the clamp and
the rounding. **Seeding** lists each seed's trace, or a note when none is
registered.

### Seeds

After the core person is built, the generator calls `seedPotential`,
`seedTraits`, `seedVices` and `seedPopularity` (WLD-07), in that order, if they
were passed in. Each gets the person so far, the talent, the stage, the spec,
the world date, the RNG and the content, and returns the updated person with
its own trace. Without them a person has potential 0, no ceilings, no traits,
no vices and no regional popularity.

### Fields the generator fills

Every generated person parses with `PersonSchema`, which the generator checks
before it returns (it throws `InvalidGeneratedPersonError` otherwise). It
fills: `status: 'active'`, `motivation` from the role's weights,
`career.canBook` when booking is at least `worldgen.people.canBookFrom` (60),
`career.canOwn: false`, `masked` from the style's mask chance, `fatigue: 0`,
`injury: null`, no restrictions, vices `none`, `imageRef: null` (the
placeholder art), `tags: ['generated']` and the legal name as the default ring
name until a promotion gives them one.

### Tuning through a pack

Everything above that is a distribution lives in `content/base/generation/`.
An add-on or world pack can change any of it with an override (see
[data-packs.md](data-packs.md#overrides)):

- **More women on the roster:** patch the `wrestler` role's `genderShares`.
- **Younger rookies:** patch `stageAges.rookie`.
- **Better promos across the board:** patch the profiles' `mic` means.
- **Stars who are good at everything:** raise the `talentWeight` values; lower
  them for more specialists.
- **A new body type:** add a `bodyArchetype` record with a new key and a
  weight for every style.
- **A hardcore-mad world:** raise the `hardcore` style's `weight`.

Shares must add up to 1, every profile lists every attribute, and every
archetype lists every ring style. A pack that breaks one of those rules fails
when it loads, with the file and field named, rather than when someone is
generated.

## Tunables

The global knobs on top of the pack data, in `systems/world/tunables.ts`:

| Key                                 | Kind    | Default | Range | Unit        | What it does                                                |
| ----------------------------------- | ------- | ------- | ----- | ----------- | ----------------------------------------------------------- |
| `worldgen.people.homeStyleBoost`    | number  | 3       | 0–20  | multiplier  | Weight multiplier for ring styles that suit the home region |
| `worldgen.people.standoutChance`    | number  | 0.015   | 0–1   | probability | Chance a wrestler is a natural standout                     |
| `worldgen.people.standoutBonusMean` | number  | 18      | 0–50  | points      | Average standout bonus                                      |
| `worldgen.people.standoutBonusSd`   | number  | 6       | 0–20  | points      | Spread of the standout bonus                                |
| `worldgen.people.standoutBonusMin`  | number  | 8       | 0–50  | points      | Smallest standout bonus                                     |
| `worldgen.people.standoutBonusMax`  | number  | 30      | 0–50  | points      | Largest standout bonus (the smallest wins if they cross)    |
| `worldgen.people.wearPerYear`       | number  | 1.6     | 0–10  | points      | Expected wear per body part per year since debut            |
| `worldgen.people.wearSd`            | number  | 5       | 0–20  | points      | Spread of the starting wear on each body part               |
| `worldgen.people.wearMax`           | number  | 45      | 0–100 | points      | Most starting wear on one body part                         |
| `worldgen.people.debutAgeMean`      | number  | 21      | 14–30 | years       | Average debut age; the spread and limits come from the role |
| `worldgen.people.canBookFrom`       | integer | 60      | 0–100 | points      | Booking attribute at which a generated person can book      |
