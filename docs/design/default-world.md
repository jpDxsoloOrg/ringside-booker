# The default world

The world the game ships with: twelve fictional promotions in seven countries,
their brands, titles, home venues, the networks that carry them, the TV deals
running on day one and their recurring shows. This doc covers the
organisational half. People, contracts, teams and title reigns come next
(WLD-09).

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
placeholder mark from the ID and short name) and no owner or booker yet;
WLD-09 may fill those from its headliners.

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

28 titles, all active, none with a champion yet (WLD-09 adds reigns). Each
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

46 venues, each in a promotion's home region or a neighbouring one and sized
for the tier that uses it:

| Kind                | Capacity      | Used by                                     |
| ------------------- | ------------- | ------------------------------------------- |
| `studio`, `theatre` | 150-600       | Locals, regionals' weekly rooms             |
| `hall`              | 800-3,500     | Regionals, nationals' TV tapings            |
| `arena`             | 6,000-18,000  | Altura, the nationals, regionals' big cards |
| `stadium`           | 35,000-70,000 | Altura's annual flagship show only          |

Names follow three patterns: "<Region> Civic Hall", "<invented place> Arena"
and "The <invented word> Room". No venue is exclusive to a promotion and none
has a rent: venue costs belong to the economy (ECO).

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
npm run validate:world -- --strict --skip-rule promotion-staffing --skip-rule free-agents --skip-rule geography
```

The world is built in steps, so CI skips the rules that need content not yet
in the pack: `promotion-staffing` and `free-agents` need people (WLD-09), and
`geography` needs the base pack's name mixes (WLD-05). The blocklist rule can
never be skipped. Each skip comes out in the change that makes its rule pass.
