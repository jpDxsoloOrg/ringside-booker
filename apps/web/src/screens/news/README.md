# screens/news

Office > News (DAY1-04, docs/design/news.md#queries): the front page, the feed and one story, plus
the shell's live news crawl.

| File                 | What it is                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NewsScreen.tsx`     | The screen: h1 "News" and today's date, the front page (`news.top` hero), the feed (`news.feed`), the story sheet                                                                                         |
| `NewsHeroCard.tsx`   | A front-page story in the broadcast kit: kind tag, date, headline link, two lines of body, picture, buzz with Why?                                                                                        |
| `NewsAlertSheet.tsx` | "News alerts" (DAY1-05): a switch per `news.alertRules` rule, then "Stop long skips for these stories"; Save sends only the changes (`news.setAlertRules`). `NewsAlertSheetView` is the engine-free part. |
| `NewsStorySheet.tsx` | One story (`news.item`): side sheet on desktop, bottom sheet on a phone; `notFound` shows the engine's reason                                                                                             |
| `newsColumns.tsx`    | The feed's `DataTable` columns: Date, Kind, Headline, Who, Importance, Buzz                                                                                                                               |
| `NewsFilterBar.tsx`  | Kind chips (none pressed = every kind), Period, "My promotion only" and "Front page only"                                                                                                                 |
| `newsListParams.ts`  | The filters in the URL (`?kind=`, `?mine=1`, `?period=`, `?front=1`) and the open story (`?story=`)                                                                                                       |
| `NewsTicker.tsx`     | `useNewsTicker()`: the shell's crawl from `news.top`, or null                                                                                                                                             |
| `NewsKindTag.tsx`    | A story's kind as the ticker draws it, in its tone                                                                                                                                                        |
| `newsTone.ts`        | Kind → tone (titles, awards, seasons prestige; results, rivalries, injuries action; the rest data), importance words                                                                                      |
| `newsStory.ts`       | Who a story is about (from its refs and `names`) and the picture it leads with                                                                                                                            |

## Text

Stories are content keys plus params. Every headline and body is written by the shared renderer in
`text/` from `text/catalogs/news.en.ts`, which `index.ts` (and the ticker) import so the catalog is
registered before anything draws. Links inside a headline would nest inside the headline's own
link, so headlines are drawn as text (`templatedTextToString`); bodies and the "Who" lists link
names through `useEntityLinkRenderer()`. A topic with no words yet shows "[missing text]".

## URL

Filter changes replace the history entry, so Back leaves the screen. Opening a story pushes
`?story=<newsId>`, so Back closes it; Close removes the param. The sheet stays mounted on the last
story after it closes, so focus returns to the link that opened it.

## Alerts

The header's Alerts button (and the Skip days sheet's "Alert settings") opens `NewsAlertSheet`.
Without a promotion every switch is off with "Alerts are for players". When a news alert stops a
skip, the day button's "Open news" comes here with `?story=<newsId>&alert=1`: the screen runs
`news.ackAlerts` once, drops `alert` from the URL (replacing the entry) and leaves the story open.
Opening News any other way while an alert waits clears it too; an alert that arrives while the
screen stays open is left for the day button, so the player sees which story it was.

## Ticker

The in-game shell (`app/router.tsx`, `GameShell`) passes `useNewsTicker()` to `AppShell`'s
`ticker`. It is a hook, not a component that renders nothing, because the shell only drops the
strip (and its room above the phone tab bar) for a `null` prop. With no engine, no world, an error
or no stories there is no strip; the sample crawl is only for `AppShell` on its own (its tests and
the gallery). The label is "Breaking" when the lead story is front-page news, else "News". Items
are text only: the crawl draws every item twice. UI-34's phone stepping mode is unchanged.

## Not here yet

- People link through the shell's entity links; DAY1-06 swaps in WRK1's `WorkerLink` where needed.
- The feed asks for 200 stories at a time ("Show older stories"), up to the engine's 500 per call;
  the archive holds about 40 stories at a year's end, so no windowing is needed.
