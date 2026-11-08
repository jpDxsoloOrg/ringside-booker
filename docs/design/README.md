# Design docs

Game and technical design for Ringside Booker. Each game system gets its own doc as it is built.

| Doc                                        | What it covers                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Repository layout, stack, engine rules, persistence and UI rules                  |
| [design-decisions.md](design-decisions.md) | The big game design calls, numbered, with the reason for each                     |
| [determinism.md](determinism.md)           | Seeded RNG, named streams and what keeps a replay identical                       |
| [tunables.md](tunables.md)                 | The tunables registry: definitions, units, overrides and validation               |
| [data-model.md](data-model.md)             | Entities, IDs and how the World tables reference each other                       |
| [day-pipeline.md](day-pipeline.md)         | How a day runs: phases, calendar cadences, and domain events with staged delivery |
| save-format.md (to come)                   | The save document, its versioning and the migration rules                         |
| calculation-traces.md (to come)            | The `Traced<T>` shape and how formulas record their steps                         |
