# validate-world

`@ringside/validate-world` checks a set of data packs and tells you two things: whether the world
they build is valid, and what that world looks like in numbers. It reads the packs from disk, loads
them through the engine's pack loader (the same code the game runs), runs the content rules below
and the real-name blocklist, and prints a distribution report.

The pack format is in [`docs/design/data-packs.md`](../../docs/design/data-packs.md).

## Commands

Run them from the repo root. Paths are relative to the root.

```sh
npm run validate:world                       # checks content/worlds/default
npm run validate:world -- --strict           # what CI runs: warnings fail too
npm run validate:world -- --report docs/design/default-world-report.md
npm run validate -w @ringside/validate-world -- content/my-world --root my-world
```

```
validate-world <packDir...> [--root <packId>] [--seed <s>] [--report <file.md>]
               [--blocklist <file>] [--strict] [--smoke-days <n>] [--skip-rule <id>]
```

| Option               | What it does                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packDir...`         | One or more pack folders, each with a `pack.json`.                                                                            |
| `--root <packId>`    | The pack(s) to load from, repeatable. Default: every pack passed in.                                                          |
| `--seed <s>`         | The seed IDs are minted from. Default `validate`. The report does not depend on it.                                           |
| `--report <file.md>` | Also writes the report as GitHub-flavoured markdown.                                                                          |
| `--blocklist <file>` | An extra real-name list, repeatable. It is checked on top of the committed list and never replaces it.                        |
| `--strict`           | Warnings fail the run too.                                                                                                    |
| `--smoke-days <n>`   | Advances the loaded world `n` days through the engine API (`createEngine` with `defaultSystems`) and fails on any step error. |
| `--skip-rule <id>`   | Leaves out one content rule by its ID (repeatable), for a world that is still being built. `blocklist` cannot be skipped.     |

Packs named in `dependsOn` that were not passed in are found by pack ID anywhere under `content/`,
so pointing the tool at a world pack is enough.

Exit codes:

| Code | Meaning                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Valid. Warnings are printed but allowed (unless `--strict`).                                                                          |
| 1    | Content errors: broken JSON, schema or loader errors, rule errors, a blocklist hit, warnings under `--strict`, a failed smoke run.    |
| 2    | Usage or I/O errors: bad arguments, a pack folder that does not exist, a missing or empty blocklist, a report that cannot be written. |

Every problem prints as one line with the pack, file, record and field it is about:

```
error champion-eligibility my-world/title-reigns.json titleReign.reign-1.holderPersonKeys.0: Champion jack-marlow has no contract with river-city-wrestling, ...
```

## Content rules

The loader only checks that packs are well formed, because a modder may want a world with one
promotion and no referees. The rules here are policy for the content we ship. Each one lives in
its own file in [`src/rules/`](src/rules/) and is listed in `src/rules/index.ts`; adding a rule is
one new file and one line there.

| Rule                   | Errors                                                                                                                                                                                                                                                      | Warnings                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `promotion-staffing`   | An active promotion has no referee or no announcer under contract on the start date.                                                                                                                                                                        | Fewer than 6 wrestlers.                                  |
| `champion-eligibility` | A current champion has no contract with the title's promotion on the start date, doesn't fit the division (gender, weight limits), the holder count is wrong, or a tag/trios reign's team is missing, the wrong size or made of other people.               |                                                          |
| `reign-chronology`     | Reigns of one title overlap, a reign is not lost after it is won, a title has two open reigns, a reign starts after the start date, or a closed reign ends after it (the reign running on the start date must be the open one).                             |                                                          |
| `employment-dates`     | A contract starts after the start date, ends before it starts, has already ended by the start date, or someone holds two exclusive contracts at once.                                                                                                       | More than 25% of contracts end inside one 30-day window. |
| `unique-names`         | Two people share a legal name, or two people use one ring name in the same promotion.                                                                                                                                                                       | Two people use one ring name anywhere in the world.      |
| `geography`            | A country has no regions, its regions' populations are more than 5% off the country's, or it has no `countryNameMix`.                                                                                                                                       |                                                          |
| `free-agents`          |                                                                                                                                                                                                                                                             | Fewer than 30 active wrestlers start without a contract. |
| `age-sanity`           | Someone is under 16 or over 80 on the start date, or debuted before their 15th birthday.                                                                                                                                                                    |                                                          |
| `blocklist`            | A name matches the real-name blocklist.                                                                                                                                                                                                                     |                                                          |
| `segment-keys`         | A stored segment's match type, win method or angle type is not in the catalogs, no visible match type is singles-like (`sides.min` 2, `sideSize.min` 1), two entries of one catalog share a name, or an angle type's `defaultBeatKey` is not a `beat.` key. |                                                          |

## The real-name blocklist

Ringside Booker contains no real performer, promotion, show, title or network names. The list of
names to guard against is committed at
[`content/blocklist/real-names.txt`](../../content/blocklist/real-names.txt), so the check runs the
same on every machine and in every CI run, including pull requests from forks, with no secret to
forget. The tool always loads it; if the file is missing or has no names in it, the run stops with
exit code 2 instead of passing without the check.

The file is data for the checker only. It sits outside every pack, it is plain text so the game's
pack loading (which reads JSON) never picks it up, and it is never shown in the game.

Format:

- One name per line.
- Blank lines and lines starting with `#` are ignored. Use `#` lines to group names.
- Write the name the way it is usually written; case, accents and punctuation don't matter.
- A one-word name that is also an everyday word ends with the flag `[case]` (`Sting [case]`).
  It then matches only written the way the list writes it or in capitals. Any other flag, or
  `[case]` on a longer name, stops the run with exit code 2.

What gets checked: every person's legal name and default ring name, every contract's ring name,
every promotion's full and short name, and the names of brands, titles, venues, networks, event
definitions and teams.

How names match:

- Case, accents and punctuation are ignored: `Último Dragón`, `ultimo dragon` and `ULTIMO-DRAGON`
  are the same name. Punctuation is tried both as a space and as nothing, so `A.J. Example`
  matches `AJ Example`, and a name written without spaces (`SmackDown` against `Smack Down`)
  matches too.
- A **one-word entry** matches only a name that is exactly that word, ignoring a leading "the"
  and trailing numbers. `Sting` blocks a wrestler called "Sting" or "The Sting" but not
  "Stingray Vance"; `Starrcade` blocks "Starrcade 1987" and "Starrcade XX".
- A one-word entry **written in capitals** (an acronym of two to six letters or digits, such as
  `WWE` or `IWGP`) matches as a whole word anywhere: `NWA` blocks "NWA World Title". Write a
  common word that is also a name in normal case and flag it (`Glow [case]`) so it only blocks
  the exact name.
- A **longer entry** also matches inside a longer name: `Ring of Honor` blocks "Ring of Honor
  Classic". It always ignores case.
- A **`[case]` entry** follows the same rules but compares letters with their case kept (accents
  and punctuation are still ignored): `Sting [case]` blocks "Sting", "STING" and "The Sting" but
  not "sting". Use it for the everyday words on the list so the blog checker can tell the word
  from the name.

The matching lives in [`src/realNameMatcher.ts`](src/realNameMatcher.ts). The blog checker
(`tools/blog`) imports the same module to scan posts and journal entries, so the two tools read
the list, and the `[case]` flag, the same way. In running text a name matches as whole words
anywhere, with case ignored unless the entry is flagged `[case]`.

**Add a name when you spot a near miss.** If a generated or hand-written name comes close to a
real one, add the real name to the list in the same change that renames the content, so the next
generator run cannot bring it back. Prefer the full name over a single common word; a one-word
entry is right only for names that are distinctive on their own.

To check extra names locally without committing them, pass `--blocklist <file>` in the same
format. It adds to the committed list and never replaces it.

## The distribution report

The report is printed as aligned text tables on every run, and written as markdown with
`--report`. It depends only on the packs and their start date: rows are sorted by key and numbers
are rounded the same way everywhere, so two runs on the same content give byte-identical output
and a diff between two content revisions shows exactly what moved.

It covers:

- people by role and gender (someone with several roles counts once in each);
- age on the start date in 5-year buckets, by role;
- ring style counts;
- the mean, standard deviation, minimum and maximum of every attribute, by role and by career
  stage (stage by years since debut: rookie under 3, prospect 3-5, established 6-11, veteran
  12-19, legend 20 or more, plus `undebuted`);
- roster size and push mix per promotion (contracts running on the start date);
- titles per promotion;
- the top 10 regions by mean worker popularity (over every person, unknown counts as 0);
- each promotion's footprint: the regions where its popularity is 20 or more;
- the number of free-agent wrestlers.

## CI

`.github/workflows/ci.yml` runs `npm run validate:world -- --strict` after the tests on every pull
request, including pull requests from forks. The step needs no secrets, so the blocklist check
always runs. The default world is complete, so no rule is skipped. `--skip-rule` stays for worlds
that are still being built.

## Tests

```sh
npm test -w @ringside/validate-world
```

The tests use the loader's fixture packs (`packages/engine/test/fixtures/packs/`) and a small
valid world in `test/fixtures/`. The report snapshot is
`test/__snapshots__/mini-world-report.md`; update it with
`npx vitest run --project validate-world -u` after a deliberate report change.
