# Epic exit checklist

Every epic ends with a dev journal entry, written while the reasons behind its decisions are still
fresh. This file holds the two things that make that happen: the line every epic README carries in
its guardrails, and the closing ticket every epic pack includes. The table at the bottom records
which ticket closes which epic, and `npm run journal:due` reads it.

This file is not a journal entry. The journal tools and `npm run blog:check` skip it.

## Checklist line

Paste this into the guardrails of every new epic README:

```markdown
- [ ] Write the dev journal entry for this epic (docs/dev-journal/YYYY-MM-<epic-topic>.md, see docs/dev-journal/README.md) and update the blog series index if it suggests a post.
```

## Closing ticket

Copy this into every new epic pack when it is drafted. Replace `<EPIC>`, `NN`, `<Epic name>` and
`<topic>`, and list every other ticket in the epic under "Blocked by". Being blocked by the rest
of the epic is what makes the ticket surface on the board exactly when the epic is done.

```markdown
# [<EPIC>-NN] Write the <Epic name> dev journal entry

**Estimate:** S
**Blocked by:** every other <EPIC> ticket, BLOG-01 (the journal template this entry follows)

## Goal

Write the dev journal entry for the <Epic name> epic while the reasons behind its decisions are
still fresh: what shipped, which calls were made and why, what went wrong, and what comes next.

## Scope

**In:** one entry at `docs/dev-journal/YYYY-MM-<topic>.md`, its Index row in
`docs/dev-journal/README.md`, and the planned rows in `docs/blog/README.md` it suggests.
**Out:** writing or publishing a blog post.

## Subtasks

- [ ] Run `npm run journal:new -- <topic> --epic <EPIC>` to scaffold the entry from the epic's
      commits and the journal inbox.
- [ ] Fill every section, following the template and content rules in
      `docs/dev-journal/README.md`. Replace every italic prompt line; write "Nothing this time."
      for a section with nothing to say.
- [ ] Add `blogCandidates`: short working titles for any post the entry suggests (may be empty).
- [ ] Run `npm run blog:check -- --only journal` and fix every error.
- [ ] Add the entry's row to the top of the Index in `docs/dev-journal/README.md`.
- [ ] Update the planned rows in `docs/blog/README.md` for any post the entry suggests.
- [ ] Fill in the Entry file column for this epic in `docs/dev-journal/epic-exit-checklist.md`.

## Acceptance Criteria

- The entry passes `npm run blog:check -- --only journal`.
- The Decisions section has one block per non-obvious choice made in the epic.
- Nothing cites private notes or outside material.
```

## Closing tickets

| Epic | Closing ticket ID | Entry file                                                 |
| ---- | ----------------- | ---------------------------------------------------------- |
| FND  | FND-13            | [2026-11-foundation.md](2026-11-foundation.md)             |
| SIM  | SIM-13            | [2026-11-sim-core.md](2026-11-sim-core.md)                 |
| WLD  | WLD-12            | [2026-11-world-generation.md](2026-11-world-generation.md) |
| UI   | UI-14             | -                                                          |

The Entry file column is filled in when each entry is written. Every later epic adds its row here
when its ticket pack is drafted, along with the closing ticket above.

The BLOG epic has no closing ticket of its own. Its tooling is written up in the BLOG-11 milestone
entry instead.
