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
- 2026-11-13 [WRK6-08] The health slice's owner test is now a Playwright flow on a found seed (a dev script plays the browser's skip, cancelling show nights, until a seed's first 30 days stop on an own injury). Reading every Health Why? found a question run into a colon ("Can they work angles?: 80%"), a design decision id in a rival line, and daily chances that read "0.1% → 0.1%" at every step; chances under 1% now show three decimals. The smoke at 150% UI scale found two page-wide overflows that predate WRK6: absolutely placed screen-reader text escaping a wide table's scroller on desktop, and phone card stats wider than their column.
