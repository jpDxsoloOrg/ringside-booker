# Design docs

Game and technical design for Ringside Booker. Each game system gets its own doc as it is built.

| Doc                                            | What it covers                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)             | Repository layout, stack, engine rules, persistence and UI rules                                                              |
| [design-decisions.md](design-decisions.md)     | The big game design calls, numbered, with the reason for each                                                                 |
| [determinism.md](determinism.md)               | Seeded RNG, named streams and what keeps a replay identical                                                                   |
| [tunables.md](tunables.md)                     | The tunables registry: definitions, units, overrides and validation                                                           |
| [data-model.md](data-model.md)                 | Entities, IDs and how the World tables reference each other                                                                   |
| [day-pipeline.md](day-pipeline.md)             | How a day runs: phases, step isolation, reports, calendar cadences and domain events                                          |
| [ui-tokens.md](ui-tokens.md)                   | Design tokens, light and dark themes, breakpoints and UI scale for the web app                                                |
| [data-packs.md](data-packs.md)                 | The data-pack format: manifest, record kinds, keys, references, overrides and versioning                                      |
| [save-format.md](save-format.md)               | The save document, its versioning and the migration rules                                                                     |
| [calculation-traces.md](calculation-traces.md) | The `Traced<T>` shape, the trace builders, replay checks and formula module conventions                                       |
| [engine-api.md](engine-api.md)                 | The engine API: queries, commands, controllers and viewers, system bundles and the engine state                               |
| [geography.md](geography.md)                   | The map: continents, countries and regions, the one-regional model, roll-ups and weighted picks                               |
| [names.md](names.md)                           | Name cultures, country name mixes, weighted picks, gender handling, uniqueness and ring names                                 |
| [world-generation.md](world-generation.md)     | Generating people: the spec, roles, profiles, correlated talent, bodies, dates and streams                                    |
| [default-world.md](default-world.md)           | The shipped world's promotions, brands, titles, venues, networks, deals, shows and naming rules                               |
| [new-game.md](new-game.md)                     | Starting a game: the world preview, the new-game input, settings, season length, controllers, setup steps and founding        |
| [calendar.md](calendar.md)                     | The show calendar: the stored horizon, how definitions become dated shows, venue and region placement, and the show lifecycle |
| [workers.md](workers.md)                       | The shared worker model: availability, title eligibility, weight class, grades, employer and main role                        |
| [match-rating.md](match-rating.md)             | Judging one segment: slot roles, duration classes and slot weights (D-10), and the match queries                              |
| [match-finishes.md](match-finishes.md)         | How a match ends: the finish catalog, its checks, which finishes a match allows and the filter seam                           |
| [booking.md](booking.md)                       | Booking a show's card: open slots, planned results, who may edit a show and the card writer                                   |
| [show-night.md](show-night.md)                 | Show night: running a show, segment and show scores, off-screen shows, title outcomes and the events it announces             |
| [finances.md](finances.md)                     | The economy: `postMoney` (the only way cash moves), ledger categories, payroll, show costs, policies and the finance queries  |
