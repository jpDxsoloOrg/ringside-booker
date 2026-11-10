# Geography

The map every other system reads: six continents, 45 countries and 83 regions,
shipped in the `base` pack (`content/base/`). Popularity is stored per region,
venues and promotions sit in regions, networks cover regions, people are born
in regions, and attendance and TV audiences will scale with each region's
population and interest.

Code: `packages/engine/src/systems/world/geography.ts`. Data:
`content/base/geography/`. Record format: [data-packs.md](data-packs.md#geography).

## One regional model

Design decision [D-03](design-decisions.md#d-03-geography-is-countries-and-regions-2026-11-07):
**popularity lives on regions only.** A wrestler's or promotion's popularity is
a sparse map of region → 1-100. Countries and continents never store a
popularity of their own; when a screen wants "how popular is she in Japan?" it
works it out from the regions, weighted by population.

Why one model and not three:

- **Nothing to keep in sync.** If countries had their own popularity, every
  change to a region would have to be pushed up (and every country change
  pushed down), and the two would drift. A roll-up computed on demand can't
  disagree with the regions underneath it.
- **Place keeps meaning something.** Touring the Southeast or running a TV deal
  in Kansai moves the numbers in those regions, and the country figure follows
  by itself.
- **No special cases.** Every popularity entry, venue, birthplace and network
  coverage reference is a region. Small markets get a single `<cc>-all` region
  named after the country (`ie-all` is "Ireland"), so no system ever needs a
  "country-level" branch.

### Why macro-regions

Regions are deliberately big: the United States is 12 regions, not 50 states.
About 90 regions keeps per-worker popularity small (a few dozen entries at
most for a world-famous star, most workers far fewer) while still letting a
regional promotion feel regional. A pack can split regions further if it wants
to; nothing in the engine assumes the region count.

## The map

| Continent (key, code)    | Countries                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| North America (`na`, NA) | United States, Canada, Greenland                                                                                                     |
| Latin America (`sa`, LA) | Mexico, Puerto Rico, Dominican Republic, Costa Rica, Panama, Colombia, Peru, Brazil, Argentina, Chile                                |
| Europe (`eu`, EU)        | United Kingdom, Ireland, Germany, Austria, Switzerland, France, Spain, Portugal, Italy, Netherlands, Belgium, Sweden, Norway, Poland |
| Asia (`as`, AS)          | Japan, South Korea, Taiwan, China, India, Philippines, Singapore, Malaysia, Indonesia, United Arab Emirates                          |
| Africa (`af`, AF)        | South Africa, Nigeria, Egypt, Kenya, Ghana                                                                                           |
| Oceania (`oc`, OC)       | Australia, New Zealand, Fiji                                                                                                         |

"Latin America" covers Mexico, Central America, the Caribbean and South
America. Country keys are lower-case ISO 3166 alpha-2 codes (`us`, `jp`,
`mx`), and each country's `code` is the same code in upper case.

The list leans toward places where wrestling has an audience, with every
continent represented by at least three countries so a world can have a
foreign tour or an overseas signing from anywhere.

### Detailed countries

The countries where promotions are expected to be based get several regions;
every other country has one `<cc>-all` region.

| Country        | Regions                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| United States  | Pacific Northwest (with Alaska and Hawaii), California, Southwest, Mountain, Texas, Plains, Midwest, Great Lakes, Southeast, Florida, Mid-Atlantic, Northeast |
| Canada         | British Columbia, Prairies and the North (with the territories), Ontario, Quebec, Atlantic Canada                                                             |
| Mexico         | Northwest, Northeast, Western Mexico, Mexico City (with the surrounding states), Southern Mexico, Yucatán Peninsula                                           |
| United Kingdom | London, Southern England, Midlands and Wales, Northern England, Scotland and Northern Ireland                                                                 |
| Germany        | Northern, Eastern, Western and Southern Germany                                                                                                               |
| Japan          | Hokkaido, Tohoku, Kanto, Chubu, Kansai, Western Japan (Chugoku, Shikoku, Kyushu and Okinawa)                                                                  |
| Australia      | New South Wales and the ACT, Victoria and Tasmania, Queensland, Western and Central Australia                                                                 |
| Brazil         | Southeast, Southern, Northeast, North and Centre-West Brazil                                                                                                  |

Region keys are `<cc>-<name>` (`us-southeast`, `jp-kanto`), so a key says
which country it belongs to at a glance.

### Adjacency

Each region lists its neighbours (`neighbourKeys` in the pack, which become
`neighbourRegionIds` on the `Region` entity). A neighbour is a region sharing a
land border or a short hop: a bridge, a tunnel or a short ferry. That includes
cross-border pairs such as Northeast ↔ Quebec, Southwest ↔ Northwest Mexico,
Southern England ↔ France and Western Japan ↔ South Korea. Island countries
with no short hop (Taiwan, the Philippines, New Zealand, Fiji, Greenland) have
none, and so do countries whose bordering countries aren't on the map (the
United Arab Emirates and all five African countries).

Adjacency is always mutual: the engine's `neighboursAreMutual` invariant
rejects a world where A lists B but B doesn't list A, and the pack loader warns
(`one-sided-neighbour`) when a pack does that.

Adjacency exists so popularity spread and touring can use it without a data
migration later. If those systems end up not reading it, the field goes,
rather than staying as decoration.

## The numbers, and where they come from

**Real places, invented wrestling data.** Country and region names are public
geography, so a player knows where they are. Everything else is either a
rounded approximation or a design value:

| Field                    | What it is                                                                                                                                                                              | Source                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `population`             | People living there. Countries are rounded to the nearest 100,000; regions are rounded the same way and add up to their country within 5% (the checker enforces it).                    | Approximate current figures                 |
| `wrestlingInterest`      | 0-100: how much people there care about wrestling. A handful of countries sit at 70-90 (United States, Mexico, Japan, Puerto Rico, Canada), most at 25-55, and some at 5-20.            | **Invented** for gameplay                   |
| region interest override | A hotbed region can sit above its country, typically by 10-15 (Southeast and Texas in the US, Mexico City, Kanto); a cold one below it. Left out, the region takes the country's value. | **Invented**                                |
| `economy`                | 0-100: relative purchasing power. 50 is the reference economy prices are set for. Rounded to 5s.                                                                                        | **Invented**, loosely shaped by real income |
| `preferredStyle`         | The promotion style audiences there like best, or null for no preference. Regions can override it (the Mid-Atlantic likes it hardcore).                                                 | **Invented**                                |

None of the invented values describe a real audience or a real company.
Promotions, people, venues and networks stay fully fictional.

## How the numbers are meant to be used

This ticket ships the data and the helpers; the systems that read the numbers
come later.

- **Popularity (WRK).** Stored per region. Spread from where a worker performs
  and where shows air, along adjacency.
- **Attendance and touring (EVT).** A show's drawing pool scales with the
  venue region's `population × wrestlingInterest`, and the style match between
  the card and the region's `preferredStyle` nudges the crowd.
- **Tickets, merchandise and income (ECO).** Prices and spend per head scale
  with `economy`, so a sell-out in a 30-economy country earns less than one in
  a 75-economy country.
- **TV audiences.** A network's reach is the population of the regions it
  covers, scaled by interest.
- **Generation (WLD-05, WLD-06).** Where new people are born is a weighted
  region pick (below), and the country decides their name mix.
- **Venues (WLD-08).** Every venue sits in a region.

## Aggregation

A country's figure is the population-weighted mean of its regions; a
continent's is the population-weighted mean of its countries; the world's is
the population-weighted mean of its continents. Regions missing from the value
map count as 0, because popularity maps are sparse.

```
country value   = Σ over its regions    (region value × region population ÷ country's region population)
continent value = Σ over its countries  (country value × country's region population ÷ continent's region population)
world value     = Σ over the continents (continent value × continent's region population ÷ every region's population)
```

The weights use the regions' populations (a country's population is the sum of
its regions here), so the continent value is exactly the population-weighted
mean over every region on the continent, and the world value is the same mean
over every region on the map. When nobody lives in a country (every
region has population 0), its regions count equally. A country with no regions
is 0.

**Worked example.** A country has two regions: A with 10 million people and B
with 30 million. A wrestler has popularity 50 in A and 10 in B:

| Region | Population | Share | Value | Value × share |
| ------ | ---------: | ----: | ----: | ------------: |
| A      |       10 M |  0.25 |    50 |          12.5 |
| B      |       30 M |  0.75 |    10 |           7.5 |
|        |            |       |       |      **20.0** |

The country figure is 20. If region B were missing from the map entirely, it
would count as 0 and the country figure would be 12.5. A country with a single
`-all` region has exactly that region's value.

Each aggregate is a `Traced<number>`. The trace starts at 0 and adds one line
per region, largest population first, labelled with the region's name and its
share ("75.0% of the population"). Inside each line are the two inputs: the
region's value (linked to the region) and its population share. A continent's
trace has one line per country, and each country line holds that country's own
trace, so the "Why?" panel can drill from a continent down to a single region.

The world's trace has one line per continent, largest population first, and
inside each continent one line per country. It stops there: a country is a
single input line linked to the country, without its regions. The full tree of
six continents, 45 countries and 83 regions is bigger than one trace is allowed
to be (see [calculation-traces.md](calculation-traces.md)), and a trace that
runs out of room drops its last lines, which here would be whole continents.
The regions are one click away, in the country's or the continent's own Why?.

```ts
const geography = geographyOf(world);
const byCountry = geography.aggregateByCountry(popularity, {
  valueLabel: 'Popularity',
  unit: 'points',
});
byCountry.get(japanId); // { value: 41.2, trace: { label: 'Popularity in Japan', ... } }
```

## Popularity roll-up

Popularity is the value that gets rolled up most, so it has its own file on top
of the aggregates above:
`packages/engine/src/systems/world/formulas/popularityRollup.ts`. It is the
single D-03 roll-up. Every feature that shows or checks popularity above a
region (a worker's profile, a list column, a promotion's fan base, a booking
check, a rival's decision) reads it from here, for people and promotions
alike, since both store the same sparse region → popularity record. No other
file works out a country, continent or world popularity.

The other shared helpers for a person (availability, title eligibility, weight
class, grades) are in [workers.md](workers.md).

### The four levels

| Level     | Where it comes from                               | Has a Why? |
| --------- | ------------------------------------------------- | ---------- |
| Region    | Stored on the person or promotion (`regionalPop`) | No         |
| Country   | Population-weighted mean of its regions           | Yes        |
| Continent | Population-weighted mean of its countries         | Yes        |
| World     | Population-weighted mean of the continents        | Yes        |

**Regions missing count as 0.** A wrestler who has only ever worked the
Southeast has one entry, and every other region reads as 0 at every level. That
is what makes a local hero's country figure small: 60 in one region of twelve
is not 60 in the United States.

### Two ways to ask

```ts
const geography = geographyOf(read);

// One subject, with explanations: a profile, a detail panel.
const rollup = popularityRollup(person.regionalPop, geography);
rollup.world; // Traced<number>, "Popularity worldwide"
rollup.countries.get(japanId); // Traced<number>, "Popularity in Japan"
const view = popularityRollupView(rollup, geography); // plain JSON for the query result

// Many subjects, numbers only: a list.
const roller = createPopularityRoller(geography);
const values = roller.rollValues(person.regionalPop);
values.top; // { countryId, value } or null when they have no fans anywhere
```

- **`popularityRollup`** builds every level with its trace. Use it when the
  screen shows one person or promotion and the player can ask Why?. The trace
  label can be changed with `valueLabel` ("Fan base" gives "Fan base in Japan").
- **`createPopularityRoller(geography).rollValues`** is the fast path. Creating
  the roller works out every population share once (region in country, country
  in continent, continent in world); `rollValues` then only multiplies and
  adds, and builds no trace. Use it for anything that rolls a whole roster or
  the whole world: list columns, sorting, filters, AI checks. Rolling all 286
  people of the default world takes about 2 ms. It also returns `top` (the
  highest country, ties to the lower ID) and `topContinent`, both `null` when
  every value is 0.
- The two agree to within 1e-9 on every person and promotion in the default
  world; a test holds them to it. A list can show the fast number and the
  profile the traced one without the player ever seeing two different figures.

### The view

`popularityRollupView(rollup, geography)` is what a query hands to a screen:

```
{ world: { value, trace },
  continents: [{ id, name, value, trace,
    countries: [{ id, name, value, trace,
      regions: [{ id, name, population, value }] }] }] }
```

Continents and countries are sorted by value, highest first, then by name;
regions by population. Every place on the map is listed, zeros included, so
the screen decides what to hide. The traces travel inline as `TraceNode`s and
are never put in the trace store: a roll-up is worked out on read, has no date
it happened on and changes whenever popularity does, so storing it would only
fill the store with copies. List queries return the numbers only.

The roll-up is pure and never reads the world: callers pass `geographyOf(read)`.

On screen, `PopularityDrilldown` (`apps/web/src/components/PopularityDrilldown`)
draws a view: the worldwide figure, a row per continent that opens into its
countries, and each country into its regions.

## Picking a region

`regionWeight(region) = population × wrestlingInterest ÷ 100` is how much a
region counts when something is spread over the map by audience, such as where
a new wrestler comes from. The region's `wrestlingInterest` is already its
effective value: the pack loader copies the country's interest into any region
that doesn't set its own.

`pickRegion(stream, candidates, weightFn)` chooses one candidate with odds
`weight ÷ total weight`, in a single draw from the given RNG stream, using the
same `weightedPick` as the rest of the engine. Zero-weight regions are never
chosen; an empty list or all-zero weights is a caller bug and throws.

## The helpers

| Helper                                                | Returns                                                 |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `geographyOf(world)`                                  | The lookups below over a world's three geography tables |
| `createGeography({ continents, countries, regions })` | The same over rows you already have (tests, previews)   |
| `regionsOf(countryId)`                                | A country's regions, most populous first                |
| `countriesOf(continentId)`                            | A continent's countries, most populous first            |
| `countryOf(regionId)`, `continentOf(regionId)`        | Where a region is                                       |
| `aggregateByCountry(values, options?)`                | `Map<CountryId, Traced<number>>`, every country         |
| `aggregateByContinent(values, options?)`              | `Map<ContinentId, Traced<number>>`, every continent     |
| `aggregateWorld(values, options?)`                    | `Traced<number>`, the whole map                         |
| `regionWeight(region)`                                | `population × interest ÷ 100`                           |
| `pickRegion(stream, candidates, weightFn)`            | One candidate, weighted                                 |

All of them are pure: they read the rows they were given and never write.
