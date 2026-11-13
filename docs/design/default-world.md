# The default world

The world the game ships with: twelve fictional promotions in seven countries,
their brands, titles, home venues, the networks that carry them, the TV deals
running on day one and their recurring shows, and the people who work for them:
rosters, staff, a free-agent pool, contracts, tag teams and title histories
([The roster](#the-roster)).

Data: `content/worlds/default/` (pack `default-world`, which depends on `base`
for the map). Record format: [data-packs.md](data-packs.md). Map:
[geography.md](geography.md).

## The premise

One company runs the business, and everybody else is chasing it.

- **One dominant company.** Altura Wrestling Entertainment is the market
  leader: two brands, weekly prime-time TV, a monthly big show, a stadium
  show every spring, and fans everywhere the language and the TV deals reach.
- **Two strong national companies abroad.** Tessen in Japan and Cielo Alto in
  Mexico own their home markets and have small followings next door. They are
  big enough to compete for talent with the leader but can't touch it on money.
- **A ring of territories.** Six regional promotions, four in North America
  and two in Europe, each strong in one region and known in the ones around it.
  None of them can run nationally yet.
- **Scrappy indies.** Three local promotions with one title, a small room and
  no more than 120k in the bank. Every show matters.

The new game screen should offer a real choice: each tier is a different game,
from defending the crown to building something out of nothing.

## Promotions

Every promotion's record key is its slot (`pro-flagship`, `pro-uk`, ...), not
its name. A promotion can be renamed (and the naming rules below say it must be
on any close match with a real company) without touching a single reference in
the roster spec, the reigns or anyone's add-on.

| Slot                  | Name                            | Short  | Tier     | Home                 | Style           | Player experience                                                                    |
| --------------------- | ------------------------------- | ------ | -------- | -------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `pro-flagship`        | Altura Wrestling Entertainment  | ALTURA | Flagship | US Northeast         | `entertainment` | Defend the crown: deep pockets, huge expectations, two brands to keep fed            |
| `pro-jp-major`        | Tessen Pro Wrestling            | TESSEN | National | Japan, Kanto         | `hardHitting`   | Own your country: protect a proud style while the leader circles your stars          |
| `pro-mx-major`        | Cielo Alto Lucha Libre          | CIELO  | National | Mexico City          | `highFlying`    | Own your country: a lucha house with a following across the border                   |
| `pro-us-southeast`    | Longleaf Championship Wrestling | LEAF   | Regional | US Southeast         | `traditional`   | Grow a territory: a streaming deal, a loyal crowd, and a ceiling to break            |
| `pro-us-greatlakes`   | Blast Furnace Wrestling         | BLAST  | Regional | US Great Lakes       | `hardcore`      | Grow a territory: a cult following with no TV and a style that burns through rosters |
| `pro-us-west-women`   | Golden Poppy Wrestling          | POPPY  | Regional | US California        | `technical`     | Rebuild: an all-women company with a small footprint in the biggest market           |
| `pro-ca`              | Boreal Championship Wrestling   | BOREAL | Regional | Canada, Ontario      | `traditional`   | Grow a territory: the biggest regional, living in the leader's shadow                |
| `pro-uk`              | Ashlar Pro Wrestling            | ASHLAR | Regional | UK, Northern England | `technical`     | Grow a territory: a weekly streaming show and the whole of Britain to win            |
| `pro-de`              | Eisenwerk Wrestling             | EISEN  | Regional | Germany, West        | `mainstream`    | Rebuild: thin cash, a fortnightly show and a country with no national company        |
| `pro-us-texas-indie`  | Hardpan Pro Wrestling           | HARDPN | Local    | US Texas             | `hardHitting`   | Hard mode: a 350-seat room in a state the leader already owns                        |
| `pro-jp-kansai-indie` | Hibari Pro Wrestling            | HIBARI | Local    | Japan, Kansai        | `highFlying`    | Hard mode: a high-flying indie in a country with one giant                           |
| `pro-au-indie`        | Wattle Pro Wrestling            | WATTLE | Local    | Australia, Victoria  | `traditional`   | Hard mode: the smallest company in the world, on a continent with no rival           |

That is seven countries on five continents (North America, Latin America,
Europe, Asia and Oceania).

### Tier values

| Tier     | Cash      | Prestige | Popularity                                                                         | Production | Policies (catering / travel / medical) | Founded   |
| -------- | --------- | -------- | ---------------------------------------------------------------------------------- | ---------- | -------------------------------------- | --------- |
| Flagship | 40M       | 80       | 65-75 across the US, 30-45 in Canada and the UK, 10-25 elsewhere in Europe/Oceania | 7-8        | 3 / 3 / 3                              | 1989      |
| National | 5M-8M     | 70-75    | 55-65 at home, 10-25 in neighbouring markets                                       | 4-6        | 2 / 2 / 2-3                            | 1991-1994 |
| Regional | 400k-1.5M | 45-58    | 40-42 in the home region, 15-28 in neighbours                                      | 2-4        | 1-2 / 1-2 / 1-2                        | 2003-2016 |
| Local    | 40k-120k  | 22-32    | 18-20 in the home region only                                                      | 0-2        | 0 / 0-1 / 1                            | 2019-2023 |

Every promotion has a distinct `color`, a null `logoRef` (UI-06 draws the
placeholder mark from the ID and short name) and no owner or booker yet.

The tiers are clearly apart when popularity is rolled up to the home country
(population-weighted, as in [geography.md](geography.md#aggregation)):

| Tier     | Home-country popularity                             |
| -------- | --------------------------------------------------- |
| Flagship | 70.3 (US)                                           |
| National | 60.1 to 61.2                                        |
| Regional | 6.5 (Golden Poppy, US) to 28.4 (Eisenwerk, Germany) |
| Local    | 1.8 (Hardpan, US) to 5.0 (Wattle, Australia)        |

The test `default-world-orgs.test.ts` checks that every tier's lowest value is
above the next tier's highest, so a content edit can't blur the tiers by
accident. The US regionals look small on this measure because the United
States is a big country; in their home regions they sit at 40-42.

## Brands

Only the flagship has brands at the start:

| Key                    | Name             | Priority | What it is                                       |
| ---------------------- | ---------------- | -------- | ------------------------------------------------ |
| `flagship-main-brand`  | Altura Mainstage | 0        | The flagship weekly show, Monday prime time      |
| `flagship-young-brand` | Altura Overclock | 1        | The younger, more athletic show, Wednesday night |

Brand records carry no controller; the loader writes `controller: null`
(run by the promotion's controller). Two brands make Altura the natural test
case for drafts and brand-war seasons later
([D-05](design-decisions.md#d-05-brand-drafts-2026-11-07),
[D-06](design-decisions.md#d-06-brand-wars-mode-2026-11-07)).

## Titles

28 titles, all active, each with a champion and a short history (see
[Title histories](#title-histories)). Each
title's prestige is set from its promotion's by rank, always within 15: the
top title sits 6-13 above the promotion, the lowest rung 5-12 below it. Weight limits appear only on the
junior and light heavyweight titles. Every title has a `color` and a null
`imageRef`, so UI-06 draws a placeholder belt.

| Promotion               | Titles                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Altura                  | World (Mainstage), Grand (Overclock), Keystone (Mainstage), Breakout (Overclock), Women's (female), Tag Team (2) |
| Tessen                  | Heavyweight, Junior Heavyweight (up to 100 kg), Tag Team (2)                                                     |
| Cielo Alto              | Heavyweight, Light Heavyweight (up to 97 kg), Trios (3)                                                          |
| Longleaf                | Heavyweight, Tag Team (2)                                                                                        |
| Blast Furnace           | Championship, Tag Team (2)                                                                                       |
| Golden Poppy            | Championship (female), Tag Team (2, female)                                                                      |
| Boreal                  | Heavyweight, Tag Team (2)                                                                                        |
| Ashlar                  | Championship, Tag Team (2), Women's (female)                                                                     |
| Eisenwerk               | Championship, Tag Team (2)                                                                                       |
| Hardpan, Hibari, Wattle | One title each                                                                                                   |

Golden Poppy is women-only through its titles' `division.gender` and the
WLD-09 roster spec; promotions have no women's-division flag.

## Venues

49 venues, each in a promotion's home region or a neighbouring one and sized
for the tier that uses it:

| Kind                | Capacity      | Used by                                     |
| ------------------- | ------------- | ------------------------------------------- |
| `studio`, `theatre` | 150-600       | Locals, regionals' weekly rooms             |
| `hall`              | 800-3,500     | Regionals, nationals' TV tapings            |
| `arena`             | 6,000-18,000  | Altura, the nationals, regionals' big cards |
| `stadium`           | 35,000-70,000 | Altura's annual flagship show only          |

Names follow three patterns: "<Region> Civic Hall", "<invented place> Arena"
and "The <invented word> Room". None has a rent: venue costs belong to the
economy (ECO).

Three venues are exclusive to one promotion (EVT6-02), so exclusivity can be
seen and tested. Nobody else can book them; see
[box-office.md](box-office.md#venues).

| Venue             | Kind     | Capacity | Region         | Exclusive to                  |
| ----------------- | -------- | -------: | -------------- | ----------------------------- |
| Altura Studio One | `studio` |      600 | `us-florida`   | Altura (`pro-flagship`)       |
| Longleaf Barn     | `hall`   |    1,500 | `us-southeast` | Longleaf (`pro-us-southeast`) |
| Tessen Dojo Hall  | `hall`   |      900 | `jp-kanto`     | Tessen (`pro-jp-major`)       |

## Networks

Sixteen broadcasters, all active, all with a null `logoRef`:

| Market    | Free-to-air TV (reach)      | Pay TV (reach)         | Streaming (reach)                 |
| --------- | --------------------------- | ---------------------- | --------------------------------- |
| US        | National Signal Network (4) | Kestrel Sports (2)     | Tallgrass Stream (2)              |
| Japan     | Kazamidori Television (3)   | Kogarashi Sports (1)   | Hoshinami Stream (2)              |
| Mexico    | Televisora Altiplano (4)    | Cenzontle Deportes (1) | Brisa Play (2)                    |
| UK        | Heathland Television (3)    | Wicketgate Sport (2)   | Larkspur Stream (1)               |
| Worldwide | -                           | -                      | Worldreel (4), Ampersand Plus (3) |

Two pay-per-view providers: Turnstile Pay-Per-View (US and Canada) and
Gatehouse Global PPV (every continent but Africa).

## Deals

Seven deals run on day one. Each started before the start date and has 6-30
months left, so renewals come up at different times.

| Promotion  | Network                 | Show                                             | Slot                       | Months left |
| ---------- | ----------------------- | ------------------------------------------------ | -------------------------- | ----------- |
| Altura     | National Signal Network | Altura Mainstage                                 | Monday prime time, live    | 30          |
| Altura     | Kestrel Sports          | Altura Overclock                                 | Wednesday prime time, live | 15          |
| Altura     | Turnstile Pay-Per-View  | Every televised show (`eventDefinitionKey` null) | Prime time, live           | 9           |
| Tessen     | Kazamidori Television   | Tessen Iron Hour                                 | Saturday late night, taped | 21          |
| Cielo Alto | Televisora Altiplano    | Viernes de Cielo                                 | Friday evening, taped      | 6           |
| Longleaf   | Tallgrass Stream        | Longleaf Saturday Night                          | Saturday evening, taped    | 11          |
| Ashlar     | Larkspur Stream         | Ashlar Thursday                                  | Thursday evening, taped    | 12          |

The pay-per-view deal names no show. Which cards actually go out on
pay-per-view (the major and flagship ones) is for EVT and ECO to decide.

**Every money value in `deals.json` is a placeholder, to be rebalanced by ECO.**
The fees, per-thousand-viewer rates and costs only need the right order of
magnitude for now: Altura's free-to-air show earns 1.2M a show, a regional
streaming show a few thousand. The same goes for promotions' `cash`. Nobody
should read any of these as balanced.

## Event definitions

40 recurring shows. Every one is a rule (`weekly`, `everyNWeeks`, `monthly` or
`annual`); none is a `dates` list, so no schedule runs out after a year.

| Promotion                              | Regular shows                                    | Bigger cards                                                                |
| -------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Altura                                 | Mainstage (Mon), Overclock (Wed), both televised | Altura Showcase (last Sunday monthly), 4 annual majors, Altitude (flagship) |
| Tessen                                 | Tessen Iron Hour (Sat, televised)                | 3 annual majors, Tessen Grand Forge (flagship, December)                    |
| Cielo Alto                             | Viernes de Cielo (Fri, televised)                | 3 annual majors, Gran Vuelo (flagship, September)                           |
| Longleaf, Ashlar                       | Weekly televised show                            | 2 annual majors                                                             |
| Boreal                                 | Weekly non-televised show                        | 3 annual majors                                                             |
| Blast Furnace, Golden Poppy, Eisenwerk | Every other week (`everyNWeeks`, 2)              | 2 annual majors                                                             |
| Hardpan                                | Weekly                                           | -                                                                           |
| Hibari, Wattle                         | Every other week                                 | -                                                                           |

An every-other-week show's `anchor` is its last show on or before the start
date (a Saturday show anchors on 2027-01-02, a Sunday show on 2027-01-03).
Every definition has a preferred venue and region, and its `activeFrom` is
the date the show first ran.

### Show formats

Cards are slot-based ([D-10](design-decisions.md#d-10-cards-are-built-from-segment-slots-not-minutes-2026-11-07)).
These are the starting slot counts; EVT and MTCH may retune them:

| Importance | Main-card slots | Pre-show slots                     |
| ---------- | --------------- | ---------------------------------- |
| `house`    | 5               | 0                                  |
| `minor`    | 5               | 0                                  |
| `regular`  | 6               | 0                                  |
| `major`    | 8               | 0-1                                |
| `flagship` | 10              | 1-2 (Altura's stadium show gets 2) |

No length or minutes appear anywhere. Which slot is the opener or the main
event, and how long a segment runs, is derived from slot position and match
type by MTCH.

## The roster

About 290 people: every promotion's wrestlers, referees, announcers, producers
and managers, plus a pool of free agents for a promotion founded at new game.
A handful of hand-written headliners give each promotion a recognisable top of
the card and hold its singles titles; everyone else comes out of the people
generator ([world-generation.md](world-generation.md)).

The people are generated once, by a build script with a fixed seed, and the
output is committed as plain pack JSON. Generating the world at new-game time
would let every generator tweak silently change the shipped world and break
balance comparisons; committed files are reviewable, can be polished by hand,
and change only when someone rebuilds them on purpose.

| File               | What it is                                                               | Written by         |
| ------------------ | ------------------------------------------------------------------------ | ------------------ |
| `roster.spec.json` | Counts, mixes, the contract table and every build knob (not a pack file) | Hand               |
| `headliners.json`  | The hand-written stars and their contract stubs (not a pack file)        | Hand               |
| `people.json`      | Every person (`person` records)                                          | `worldgen:default` |
| `employments.json` | One running contract per employed person                                 | `worldgen:default` |
| `teams.json`       | Tag teams and trios                                                      | `worldgen:default` |
| `reigns.json`      | Current and past title reigns                                            | `worldgen:default` |

```sh
npm run worldgen:default            # rebuild, validate, refresh the report
npm run worldgen:default -- --force # also overwrite hand edits to the generated files
```

The command refuses to overwrite a generated file that has uncommitted changes
(`git diff --quiet`) unless `--force` is passed. Generated people have keys
`gen-<promotionKey>-<nn>` (or `gen-fa-<nn>` for free agents) and headliners keep
their own keys, so a hand edit to a generated person shows up plainly in a diff
and survives until the next deliberate rebuild. After writing, the command runs
`validate:world --strict` and rewrites
[`default-world-report.md`](default-world-report.md), the age, gender, style,
attribute, roster and popularity distributions reviewers sign off on.

Code: `tools/worldgen/`. The build reads the `base` and `default-world` packs
without the four generated files, so a rebuild never depends on the previous
build: the same spec and seed always give the same bytes.

### Headcount

| Who                  | Count                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Flagship wrestlers   | 44, split evenly between the two brands down the card                                                  |
| National wrestlers   | 26 each                                                                                                |
| Regional wrestlers   | 12-16 (Boreal 13, the rest 12)                                                                         |
| Local wrestlers      | 8 each                                                                                                 |
| Free-agent wrestlers | 35-45 (35), from every continent, weighted toward North America                                        |
| Non-wrestlers        | 55-70 (58): 1-4 referees, 1-3 announcers, 0-3 producers, 0-3 managers per promotion, and 9 free agents |
| Everyone             | 240-290 (286)                                                                                          |

The build checks these ranges and fails if it misses one. Every promotion has
at least one referee and one announcer. Golden Poppy's spec is 100% women; the
others are about 70/28/2 men/women/non-binary (Tessen 82/16/2, Cielo Alto
74/24/2), which makes about 30% of all wrestlers women.

### Headliners

23 hand-written stars in `headliners.json`, each with an original legal name,
ring name, home region, age, career stage, style and talent, a few attribute
overrides and a contract stub (promotion, brand, push, alignment). Every
promotion has at least one main-event headliner, and every singles champion is
a headliner. Each one still goes through the people generator, with the
authored fields pinned, so headliners have bodies, conditions, traits and
popularity built the same way as everyone else; the authored age, name and,
for the two weight-limited champions, height and weight then replace what was
rolled. Two of Altura's headliners come from the UK and Japan, so the flagship
roster spans at least four countries.

Tag and trios champions are not headliners: 9 team titles would need 19 more
authored people, far past the 20-30 the file is meant to hold. Each team title
goes to the best team the build forms in that promotion instead.

### Where generated people come from

People are generated per promotion in promotion-key order, after the
headliners. A promotion's people are born in its home country 80% of the time
and in a neighbouring country (one with a bordering region, or the rest of the
continent for an island) 20% of the time; anyone born abroad is based in the
promotion's home region. Gender and career stage come from exact counts of the
promotion's shares, shuffled. Tessen, Cielo Alto, Blast Furnace and Hibari have
their own ring style weights in the spec (Cielo Alto favours high flyers,
Tessen strikers, Blast Furnace hardcore and brawling); everyone else's style
follows their home region's taste through the generator. Wrestlers and managers
get a ring name from the name generator, which also becomes their default ring
name; staff work under their legal name.

### Card position

Each generated wrestler gets a **card value**: the mean of the wrestler
profile's performer attributes plus 0.5 × their home popularity as generated.
Pushes are handed out in descending card value from the promotion's push mix,
after the slots the headliners fill. The push order correlates with card value
at a Spearman coefficient of 0.6 or more in every promotion (a build test pins
it).

| Tier     | Main event | Upper card | Midcard | Lower card | Enhancement |
| -------- | ---------: | ---------: | ------: | ---------: | ----------: |
| Flagship |        11% |        18% |     32% |        23% |         16% |
| National |        12% |        19% |     35% |        19% |         15% |
| Regional |         9% |        22% |     40% |        17% |         12% |
| Local    |        12% |        20% |     30% |        23% |         15% |

**Alignment** alternates face and heel down the push order, and each face/heel
pair is swapped with a 30% chance, so every tier comes out roughly balanced
without a fixed pattern. Headliners keep their authored push and alignment.
Managers alternate heel and face; other staff are listed as faces.

### Popularity fitting

The generator seeds popularity around where someone grew up. A promotion's
workers should also be known where the promotion is, so for every employed
wrestler, in every region where the promotion's popularity is at least 10:

```
regionalPop = max(regionalPop, promotionPop × pushFactor × (1 ± 10%))
```

| Push        | `pushFactor` |
| ----------- | -----------: |
| Main event  |          0.9 |
| Upper card  |          0.7 |
| Midcard     |          0.5 |
| Lower card  |         0.35 |
| Enhancement |          0.2 |

A value is never lowered. This is what makes the market leader's stars known
across its whole footprint: Altura's main eventers end up around 60-68 across
the US, in the 30s in Canada and Britain and around 20 in Australia, while a
local indie's champion only gets the boost in its home region.

### Contracts

One `active` contract per employed person, for the role they were generated
for. It started 0-4 years before the world start (never before the person's
debut, never before anyone turned 18, and never after a current champion won
their title). It runs out on a day picked uniformly from the promotion's range
in the spec, all inside 2-30 months after the start (2-30 at Altura, 3-24 to
3-30 at the others, 2-14 at the locals), so expiries are spread over the first
two and a half years instead of flooding the market on day one. Someone who
held a title at another promotion in the history below started their current
contract after that reign ended.

**The terms are placeholders.** ECO owns wages, asking prices and contract
value, and its "auto-set contract pricing" new-game step may overwrite these.
They only need the right order of magnitude:

| Tier     | Kind            | Exclusive | Main event |  Upper |    Mid | Lower | Enhancement | Staff |
| -------- | --------------- | --------- | ---------: | -----: | -----: | ----: | ----------: | ----: |
| Flagship | `written`       | yes       |     60,000 | 30,000 | 15,000 | 8,000 |       4,000 | 6,000 |
| National | `written`       | yes       |     20,000 | 10,000 |  5,000 | 2,500 |       1,200 | 2,500 |
| Regional | `written`       | yes       |      4,000 |  2,500 |  1,500 |   900 |         500 |   800 |
| Local    | `perAppearance` | no        |      1,500 |  1,000 |    700 |   450 |         300 |   250 |

Written deals pay that much a month and cover travel; local deals pay that much
per appearance, with no monthly wage. No revenue shares, bonuses, caps or other
perks yet.

### Teams

Every promotion with a tag or trios title gets 3-6 teams of that size, formed
from its upper- and midcard wrestlers (the lower card fills in when there
aren't enough). The best free wrestler anchors a team and takes the best
partners of the same gender whose styles share a group (`aerial`: all-rounder,
high flyer, showman, technician; `ground`: all-rounder, grappler, striker,
technician; `power`: brawler, hardcore, powerhouse, showman, striker), or any
style when none does. Headliners and singles champions are left out. Team names
pair a ring name adjective and noun ("The Copper Titan", "Swift Prowler") and
never repeat a team or a ring name. Teams formed 4-72 months before the start
(earlier when the title history needs it), never before every member had
debuted. Four more teams are made from free
agents, since teams belong to no promotion.

### Title histories

Every title has one open reign and 1-4 past reigns.

- **Current champion.** A singles title goes to the headliner who holds it in
  `headliners.json`; a tag or trios title goes to the promotion's best team
  (by combined card value) that fits the division. The reign began 20-300 days
  before the start, never before the champion debuted, with 0-12 defences.
- **Past reigns** run back from the current one, each ending on the day the
  next began, 45-420 days long, no further back than five years and never
  before the title was introduced. A past singles champion is usually one of
  the promotion's ten best eligible wrestlers (tag team members are left for
  the team titles while anyone else is free); with a 12% chance it is a
  headliner of a promotion the same size or one tier bigger, a star who passed
  through before moving on. An open title's history stays with the current
  champion's gender where it can. Past team champions are the promotion's other
  teams.
- **Nobody holds two titles at once**, current reigns included, and the same
  holder never wins a title straight back from themselves.

All current reigns are settled first so that no past reign can overlap one.

## Naming rules

Every name in the pack is original. Before a name goes in:

1. **No real names.** No real company, show, event, title, venue or network
   name, and nothing one letter away from one.
2. **No three-letter initialisms.** They collide with real companies too
   easily. Short names are 4-6 letters, ideally a word from the name itself
   (`TESSEN`, `POPPY`).
3. **No gimmick borrowing.** No name built on a real wrestler's ring name or
   character.
4. **Prefer invented or unusual words.** Plausible generic names ("Southern
   Championship Wrestling") are exactly the ones most likely to exist already.
   Real places are fine (promotions sit in real regions), but the name around
   them is ours.
5. **Check every name twice.** Run `npm run validate:world`, which checks every
   promotion, brand, title, venue, network and event name against the
   committed blocklist (`content/blocklist/real-names.txt`), and search the web
   for each promotion name before merging.
6. **Rename on any close match.** If a search turns up a promotion, show or
   wrestler with the same or a very similar name, rename ours, and add the real
   name to the blocklist when it is one a generator could plausibly produce.

Two names were changed by rule 6 while building this pack: the UK promotion
(its first name shared a short name with an existing promotion) and the Texas
indie (its first name was close to a real tag team).

## Validation

```sh
npm run validate:world -- --strict
```

CI runs every content rule with no skips: staffing, champion eligibility,
reign chronology, contract dates and expiry spread, unique names, geography,
the free-agent pool, age sanity and the real-name blocklist, which can never
be skipped. Every person's legal name, ring names and team names go through
the blocklist like the organisation names do.
`packages/engine/test/content/default-world.test.ts` runs the same check and
pins the shape of the roster: wrestlers in every five-year age bucket from
18-22 to 43-47, at least a quarter of them women, and a flagship roster from at
least four countries.
