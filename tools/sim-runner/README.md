# sim-runner

`@ringside/sim-runner` runs the simulation without any UI: it builds or reads a world, advances it
N days through the public engine API (`createEngine`, `advanceDays`, commands and queries) and
prints a summary with a world hash. Usage, options, exit codes and the speed baseline are in the
[Headless runner](../../README.md#headless-runner) section of the root README.

```sh
npm run sim -- --days 365
npm run sim -- --days 60 --check-determinism --strict   # what CI runs
```

| File               | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `src/args.ts`      | Parses and checks the arguments, including `--tunable` values by their kind |
| `src/run.ts`       | Builds or reads the starting state and runs one simulation                  |
| `src/summary.ts`   | `RunSummary`, the determinism comparison and the text and JSON output       |
| `src/traceText.ts` | Prints a stored calculation trace as an indented tree for `--trace`         |
| `src/cli.ts`       | The entry point: runs once or twice, prints and picks the exit code         |

The fixture world is `rosterWorld(n)` from `@ringside/engine/testing/fixtures`, with the test IDs
reset first so the same size always gets the same IDs, the `--seed` written into `meta.seed` and no
players. Tunable overrides go through the `tunables.setOverride` command, issued as a human
controller called `cli` (or as the first listed player when a state file has players, because only
a player in the game may change its tunables).

Later the balance harness builds on this runner for multi-year reports.
