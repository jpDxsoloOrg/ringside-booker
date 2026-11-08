# Design docs

Game and technical design for Ringside Booker. Each game system gets its own doc as it is built.

| Doc                                            | What it covers                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)             | Repository layout, stack, engine rules, persistence and UI rules                                |
| [design-decisions.md](design-decisions.md)     | The big game design calls, numbered, with the reason for each                                   |
| [determinism.md](determinism.md)               | Seeded RNG, named streams and what keeps a replay identical                                     |
| [tunables.md](tunables.md)                     | The tunables registry: definitions, units, overrides and validation                             |
| [data-model.md](data-model.md)                 | Entities, IDs and how the World tables reference each other                                     |
| [day-pipeline.md](day-pipeline.md)             | How a day runs: phases, step isolation, reports, calendar cadences and domain events            |
| [ui-tokens.md](ui-tokens.md)                   | Design tokens, light and dark themes, breakpoints and UI scale for the web app                  |
| [data-packs.md](data-packs.md)                 | The data-pack format: manifest, record kinds, keys, references, overrides and versioning        |
| [save-format.md](save-format.md)               | The save document, its versioning and the migration rules                                       |
| [calculation-traces.md](calculation-traces.md) | The `Traced<T>` shape, the trace builders, replay checks and formula module conventions         |
| [engine-api.md](engine-api.md)                 | The engine API: queries, commands, controllers and viewers, system bundles and the engine state |
