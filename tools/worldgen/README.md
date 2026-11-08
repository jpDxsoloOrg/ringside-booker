# worldgen

`@ringside/tool-worldgen` builds the default world's people: every promotion's roster and staff,
the free-agent pool, their contracts, tag teams and title histories. It reads two hand-written
files in `content/worlds/default/` and writes four pack files next to them, which are committed.

The design, the rules each step follows and the numbers it uses are in
[`docs/design/default-world.md`](../../docs/design/default-world.md#the-roster).

## Commands

Run from the repo root:

```sh
npm run worldgen:default            # rebuild, validate, refresh docs/design/default-world-report.md
npm run worldgen:default -- --force # overwrite generated files that have uncommitted hand edits
```

| Reads                                      | Writes                                    |
| ------------------------------------------ | ----------------------------------------- |
| `content/worlds/default/roster.spec.json`  | `content/worlds/default/people.json`      |
| `content/worlds/default/headliners.json`   | `content/worlds/default/employments.json` |
| the `base` and `default-world` packs, less | `content/worlds/default/teams.json`       |
| the four files this tool writes            | `content/worlds/default/reigns.json`      |
|                                            | `docs/design/default-world-report.md`     |

Exit codes: 0 written and valid, 1 the build or the validator failed, 2 a usage error or a refused
overwrite.

## Code

| File                          | What it does                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/specSchema.ts`           | zod schemas for the roster spec and the headliners                  |
| `src/content.ts`              | Reads the packs, the spec and the headliners                        |
| `src/context.ts`              | Loads the organisations and sets up the generator, map and RNG      |
| `src/people.ts`               | Headliners, each promotion's wrestlers and staff, free agents       |
| `src/card.ts`                 | Card value, push, alignment, brand and popularity fitting           |
| `src/teams.ts`                | Tag teams and trios                                                 |
| `src/reigns.ts`               | Current champions and title histories                               |
| `src/contracts.ts`            | One running contract per employed person                            |
| `src/output.ts`               | Pack records, the schema check and byte-stable JSON                 |
| `src/build.ts`                | Runs the steps in order and checks the target totals                |
| `src/build-default-roster.ts` | The command: overwrite guard, build, write, validate, report        |
| `src/streams.ts`              | The RNG streams the build draws from besides the people generator's |

## Tests

```sh
npm test -w @ringside/tool-worldgen
```

`test/build.test.ts` builds twice into temp folders and compares the bytes, then checks the totals,
staffing, champions, title histories, push order against card value and the free-agent pool.
