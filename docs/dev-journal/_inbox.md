# Journal inbox

Quick notes between journal entries. One bullet per note:

```
- YYYY-MM-DD [TICKET-ID] note
```

When the next entry is written, these bullets are drained into its
`## Raw notes` section and then deleted from here. This file is public, so the
content rules in [`README.md`](README.md#content-rules) apply here too.

## Notes

- 2026-11-10 [WRK1-07] Integration pass for the workers system found nothing to wire: none of the features that lean on it (match lab, news, season recap, second careers, relationships, world editor) are on main yet, so each will hook in from its own tickets. The one gap was documentation: the profile tab registry was only described in the app README, so workers.md now has a "Hooks for later features" section.
- 2026-11-12 [MTCH2-06] The Why? audit of Simulate only caught three wording slips once the winner's trace was read against a real default-world game: the region name was lower-cased inside "Mean popularity in ...", pushes showed as codes ("mainEvent"), and a finish named after its only method read "Disqualification, Disqualification". The lab's earlier audit never read the result trace, so the new test reads every Why? the result block offers, including content keys like `finish.clean`.
