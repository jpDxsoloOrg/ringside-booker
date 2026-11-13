# App shell and routing

The frame every screen lives in: the route map, the in-game shell, the session store and the
accessibility plumbing that every page shares.

| File                      | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `routes.ts`               | Every URL, as builders (`routes.game.roster()`). No path strings elsewhere |
| `navigation.ts`           | The in-game navigation as data: sections, items, phone tab bar slots       |
| `router.tsx`              | The route tree, built from `routes.ts` and `navigation.ts`                 |
| `RequireWorld.tsx`        | Sends `/game/*` to the title screen when no world is loaded                |
| `session/sessionStore.ts` | Zustand: is a world loaded, and the local seat (whose promotion, if any)   |
| `settings/`               | Viewer settings: schema, store (localStorage), effects on `<html>`         |
| `layouts/OutOfGameLayout` | Title, load, new game and settings: centred, no navigation                 |
| `AppShell/`               | Desktop sidebar and top bar; phone top bar, bottom tab bar and More sheet  |
| `AppShell/day/`           | The day button, Skip days, the progress overlay and the advance summary    |
| `AppShell/status/`        | The status chips (date, cash, popularity) and the chip registry            |
| `a11y/`                   | Skip link, focus on navigation, page titles and the live announcer         |
| `dev/EnterShellRoute.tsx` | Dev and e2e builds only: fake a loaded world and open the shell            |
| `engine/`                 | Engine provider, query cache, status store and the engine hooks            |
| `entityLinks.tsx`         | How names inside "Why?" panels link to profiles in the game                |

## Adding a screen

1. Add its path segment to `GAME_SCREEN_SEGMENTS` and a builder to `routes.game` in `routes.ts`.
2. Add an item to the right section in `navigation.ts`, with `status: 'live'` and `screen` set to
   the component (or `status: 'placeholder'` until it is built).
3. Build the screen. Its heading is a `RouteHeading` (the page's one `h1`, which focus moves to
   after a navigation) and it calls `useDocumentTitle(label)`.
4. Add the path to `apps/web/e2e/routes-under-test.ts` so the smoke sweep checks it.

Nothing in `AppShell/` changes. Detail pages that are not nav items get a route in
`gameDetailRoutes` in `router.tsx`, next to the screen routes, with their pattern in
`routePatterns`; the top bar and sidebar treat them as part of the item they sit under.

## The workers list

World > Workers (`/game/workers`, `screens/workers/WorkersScreen.tsx`) is live: everyone in the
world in one `DataTable`, a table on desktop and cards on a phone. It reads one query,
`workers.list`, which returns:

- `rows`: one plain row per person who passed the filters (names, picture, roles and main role,
  age, style, main-role overall with its grade, top and world popularity, employer or `null` for a
  free agent, push, alignment, availability). Numbers only, no traces;
- `total` and `freeAgents`: the counts before any filter, for the "286 people · 44 free agents"
  line;
- `facets`: the promotions, continents and countries that appear, for the filter selects.

Rows never carry development, vices, morale or contract terms, for any viewer.

- **Filters and sort live in the URL** (`?employer=free&sort=age:desc`), read and written by
  `screens/workers/workersListParams.ts`. Changes replace the history entry, so Back leaves the
  list, and a profile opened from the list comes back to the same URL.
- **The engine filters; the screen sorts.** Only the filters are sent as arguments, so re-sorting
  never refetches. `WORKER_COLUMNS` (`workerColumns.tsx`) holds the columns and their `sortValue`s.
  People the sort leaves equal go by ring name, then id (`compareWorkerTies`), as in `workers.list`.
- **Why? on demand.** The Overall and Top popularity cells use `LazyWhyButton` with
  `workers.explain`, which builds the trace only when the panel opens.
- **Long names and grades.** In the table a ring name stays on one line and is cut with an
  ellipsis (`WorkerLink` with `truncate`); the link text and its tooltip keep the whole name. On a
  phone card the name wraps. Grade chips share one width, so the overall numbers line up.
- **Phone.** Below `--bp-mobile` the filter bar moves into a bottom `Sheet` behind a
  "Filters (n)" button, and the DataTable's own "Sort by" select sits above the cards. A card is
  not a button there: the name's link is stretched over the whole card, so the Why? buttons and
  the availability chip inside it stay separate controls.
- **Refusals.** If the engine cannot answer, the screen shows the reason in an `EmptyState` under
  the heading.

## The worker profile

`/game/workers/:personId` (`routePatterns.worker`, built with `routes.game.worker(id)`) is the
first detail page: `screens/workers/profile/WorkerProfileScreen.tsx`, loaded as its own chunk. It
reads one query, `workers.profile`, and shows the header and a strip of tabs. The selected tab is
in the URL (`?tab=attributes`); a tab that is unknown or hidden falls back to Overview. A person
the engine does not know shows "Worker not found" with the engine's reason and a link back.
While the query is out, the screen shows the profile's shape in quiet blocks (header card, tab
strip, four panels), so nothing jumps when the answer arrives.

The header is `WorkerProfileHeader`. On the profile the ring name is the page's `h1`; with
`heading="section"` it is an `h3`, which is how the component gallery shows it
(`/dev/gallery#worker-profile-header`).

`screens/workers/defaultWorldWhy.test.ts` starts a new game on the shipped default world and
reads every "Why?" the list and the profile offer in the panel's own words: each rating names its
weight settings, each choice reads as words and nothing prints a broken number. A feature that
adds a derived number to the profile adds its breakdown to that test.

Link to it with `WorkerLink` (`components/WorkerLink`), never with a hand-built `Link`. From the
workers list it carries the list's URL in the navigation state, so the profile's "Back to Workers"
returns to the same filters. A screen that navigates to a profile in code passes
`workerLinkState(location)` as the navigation state for the same effect.

### Adding a profile tab

The profile's tabs are a shell extension point, like the status chips. Overview (order 10),
Attributes (20), Popularity (30) and Career (40) are built in. Another feature adds its tab from
its own files, without editing the profile:

```ts
registerProfileTab({
  id: 'health', // also the ?tab= value
  label: 'Health',
  order: 60, // 50 and up; say which in the feature's own docs
  render: ({ profile, personId, viewerPromotionId }) => <HealthTab personId={personId} />,
  visible: ({ profile }) => profile.header.mainRole === 'wrestler', // optional
});
```

`registerProfileTab` (`screens/workers/profile/profileTabs.ts`) returns a function that removes
the tab again, throws for an id that is taken, and every open profile re-renders when the list
changes. `render` only runs while its tab is selected, so a tab can run its own queries.

Registered so far: **Form** (order 55, MTCH3-04), `screens/workers/profile/tabs/recentFormTab.tsx`,
imported once by the router like the results page's calendar hooks; its panel loads with the tab.

### Names in "Why?" panels

`AppShell` provides `gameEntityLink` through `EntityLinkContext` (`entityLinks.tsx`), so inside the
game a person named in any "Why?" breakdown links to their profile, and following the link closes
the panel. Outside the shell (the component gallery, the title and new-game screens) there is no
provider and names stay plain text. Other entity kinds stay plain until their screens exist; they
get their links by extending `gameEntityLink`.

## The calendar

Your promotion > Calendar is live. `/game/calendar` (`screens/calendar/`) is a nav item, not a
detail page: `CalendarScreen` owns the heading and loads the month views as their own chunk. The
month, the scope and the open show are in the URL, so link to it with
`routes.game.calendarAt({ month, scope, show })`, for example straight to a show's sheet from the
Office or from Booking. Other features add to the screen through five slots (sheet actions and sections, chip badges, day markers, toolbar items) instead
of editing it; `screens/calendar/README.md` lists the slots and what is registered in each. What
the screen looks like, and which of its values are stored and which are worked out, is in
`docs/design/calendar.md` under "Screen".

## The Match lab

Your promotion > Match lab is live. `/game/match-lab` (`screens/match-lab/`, link with
`routes.game.matchLab()`) rates a segment that is on no card: setup on the left, sides in the
middle, the result on the right (two columns, then one, as the lab gets narrower; on phones the Run
bar sticks above the tab bar and the worker picker is a bottom sheet). `MatchLabScreen` owns the
heading and loads the rest as its own chunk. The lab's state (`labStore.ts`) lives for the session
and empties when the seat's world changes. The lab has one action, **Run**, with a **Runs** slider
(1–100, 1 by default) beside it (MTCH2-07). Every Run picks a fresh seed (`freshSeed` in
`labStore.ts`, from the browser's random source, low enough that every night's seed is valid), so
there are no seed controls. `useLabRunner` asks the engine directly, so a shown result never
re-rolls behind the player's back after a Next Day. Worker names on the side chips and in the Each worker table go through
`renderWorkerName` (`workerName.tsx`), a `WorkerLink` to the worker's profile; person inputs in the
lab's Why? panels link through `EntityLinkContext` like everywhere else in the game.

For a match, Run always plays the result out: the Winner and finish group at the bottom of the
setup (under the sides on a phone) picks the winner (Auto, a side or Draw) and the finish (Auto or
any the match type allows), and Run asks `match.simulate`. The answer (`MatchResultBlock`) heads
the result panel: who won with a Why? on the winner, the method and finish, then the usual score
bug, rated with the finish's effects. A talking segment is rated with `match.preview` and has no
winner. With Runs above 1, Run also asks `match.simulateBatch` (a talking segment:
`match.previewBatch`) from the same fresh seed; the night shown in full is the batch's last, and
`LabBatchResult` adds who won (a bar per side, draws, no contests), the finishes most common first
and the score histogram and summaries. Changing the setup, the sides or the plan marks the result
"Out of date: run again". Auto reads "Auto (Random winners)" when `match.resultMode` says Random
winners decides the player's results. The result components live in `screens/match-lab/result/`.

`screens/match-lab/defaultWorldLab.test.ts` is the lab's hand-test script against a new
default-world game as Altura: the defaults, every Why? a Run offers read in the panel's own words
(settings named by key, choices as words, no broken numbers, nothing about running time), one
stamina line per worker, the star cap line and the first tuning pass's checks from
`docs/design/match-rating.md`. A feature that adds a number to a lab result adds its breakdown to
that test. `oldSaveLab.test.tsx` loads a save without catalogs from the saved games list and checks
the lab's "start a new game" message. The result's parts, with a made-up sample and no engine, are
in the gallery at `/dev/gallery#match-lab`.

### Adding a Match lab panel

Another feature adds a titled panel to the lab from its own files, without editing the lab:

```ts
registerLabPanel({
  id: 'mtch3.aftermath',
  order: 20,
  title: 'Aftermath',
  placement: 'result', // the default; 'setup' sits at the bottom of the setup column
  render: ({ setup, sides, result, simulation, batch }) => <Aftermath simulation={simulation} />,
  visible: ({ result }) => result !== null, // optional
});
```

`registerLabPanel` (`screens/match-lab/labPanelRegistry.ts`) returns a function that removes the
panel again, throws for an id that is taken, and every open lab re-renders when the list changes.
Panels of one placement are drawn in `order`, then by id. The render props only grow: `result` is
the rating of the night shown in full; MTCH2-04 added `simulation`, that same night's
`match.simulate` answer (null before the first Run and for a talking segment); since MTCH2-07
`batch` is the summary of every night when Runs was above 1 (null at 1), a `SimulateBatchResult`
for a match (`isSimulateBatch` tells) and a `PreviewBatchResult` for a talking segment. Reserved
orders:

| Placement | Order | Panel                 |
| --------- | ----- | --------------------- |
| `setup`   | 10    | Match options (MTCH7) |
| `setup`   | 20    | Crew (MTCH8)          |
| `setup`   | 30    | Stakes (MTCH8)        |
| `result`  | 20    | Aftermath (MTCH3)     |
| `result`  | 30    | Physical toll (MTCH4) |

## Show results

One show's results live at `/game/event-history/:eventInstanceId` (`screens/show-results/`,
link with `routes.game.showResults(eventInstanceId)`), a detail page under Event history, so the
sidebar keeps Event history highlighted. It is its own chunk. The page reads `shows.results` and
nothing else: a lower third whose title is the page's `h1`, a "Final score" score bug (score with
its Why?, stars, and attendance and viewers once EVT6 and ECO8 fill them), then the card, the
pre-show first under its own divider, each segment a `SegmentResultCard`. A rival show scored
off-screen says its card was not booked in detail; a show that has not run says so, with "Book this
show" for your own.

`routes.game.showResults(id, { reveal: true })` adds `?reveal=1`, which the Next Day summary's
"See results" links use: the cards start as "Coming up" placeholders at full height and come out
one per tap (EVT3-10: nothing advances on its own). "Next segment" (Enter or Space on it) or a
click or tap on the next placeholder reveals one card, faded in with `--motion-base`; after the
last card the button reads "Show score" and brings out the score and the show report. "Show
all" reveals everything at once. Both sit in `RevealBar`, sticky at the bottom of the screen (on a
phone it spans the column above the bottom navigation, 44px buttons side by side at 360px), and a
polite live region reads each result. `useRevealSequence` only counts steps, so a live show night
(EVT10) can reuse it and `RevealBar` on its own screen. Reduced motion (the in-game setting or the
OS) shows everything at once, and so does the setting "Reveal results one segment at a time"
(`revealOneAtATime`, Settings > Show nights, on by default) when it is off. When the reveal ends, `?reveal`
is replaced out of the URL, so a reload never plays it again. The parts the page draws are in
`ResultsBroadcast.tsx`, without engine queries, so the gallery shows them at
`/dev/gallery#show-results`.

Other ways in: the advance summary links to up to three of your shows an advance completed
(`shows.completedSince`, then "and N more"), even after a plain one-day Next Day; the calendar's
show sheet has a "Result" section and a "Results" button and completed chips a score badge
(`screens/show-results/calendarHooks.tsx`, registered by the router); Booking shows "This show has
run" for a completed show (`bookingPanel.tsx`, through Booking's feature list).

### The show report

Once the reveal is over, the page opens with a show report (EVT3-09, `ShowReport.tsx`, gallery
`/dev/gallery#show-report`): the verdict, score and stars with the best and worst segment, "How it
was scored" (the engine's `result.breakdown`, one row per slot) and "What changed". Each segment
card's id is `segmentCardAnchor(segmentId)` and each section's panel id is
`resultsSectionAnchor(sectionId)`, so report lines link down the page. The setting "After a show,
open its results" (`openResultsAfterShow`, `app/AppShell/day/useOpenResultsAfterShow.ts`) sends a
Next Day that ran one of your shows to its results with the reveal. See
`docs/design/show-night.md#show-report`.

### Adding a show report line

A feature adds a one-line summary to "What changed" without editing the page:

```ts
import { registerShowReportLine, resultsSectionAnchor } from '@/screens/show-results';

registerShowReportLine({
  id: 'evt6.gate', // feature-prefixed, unique
  order: 40,
  // Called as a hook, so it may use useEngineQuery; return null to leave the line out.
  line: useGateReportLine,
});

function useGateReportLine({ view }: ResultsSectionProps): ShowReportLineContent | null {
  // ...
  return {
    label: 'Gate',
    text: '$48,300',
    tone: 'positive',
    targetId: resultsSectionAnchor('evt6.gate'),
  };
}
```

Lines are drawn with the built-in ones (new champions 10, title defences 11, appearances 15) in
`order`, then by id. A line returns null while its data loads or when it has nothing to say; there
are no placeholders. Register it next to the feature's results section (the same file the page
already imports). Registered so far: `evt5.fans` (25), `mtch3.popularity` (30),
`boxOffice.crowd` (35) and `finance.showMoney` (60).

### Adding a results section

Another feature adds a titled panel under the card, without editing the page:

```ts
import { registerResultsSection } from '@/screens/show-results';

registerResultsSection({
  id: 'mtch3.popularity', // feature-prefixed, unique
  label: 'Popularity & momentum',
  order: 10,
  render: ({ eventInstanceId, view }) => <PopularityChanges view={view} />, // or null
});
```

`registerResultsSection` (`screens/show-results/resultsSectionRegistry.ts`) returns a function
that removes the section again and throws for an id that is taken; `listResultsSections()` gives
them in display order. Sections are drawn in `order`, then by id, each as a broadcast `Panel`
headed by its `label`, only once the reveal has finished; one whose `render` returns null is left
out. `view` is the page's `shows.results` answer. Expected users: MTCH3 (popularity and
momentum), EVT4 (card flow), ECO (show money), CRTV and BRW3.

A feature registers its section from its own folder and adds one import line to
`screens/show-results/ShowResultsScreen.tsx`, so the section loads with the page's own chunk
(UI-21). Registered so far:

| Order | Id                | Label                 | Registered in                              |
| ----- | ----------------- | --------------------- | ------------------------------------------ |
| 25    | `evt5.popularity` | Popularity            | `screens/promotion-popularity/register.ts` |
| 30    | `mtch3.aftermath` | Popularity & momentum | `screens/match-aftermath/register.ts`      |

## Venue and crowd

EVT6-06 puts the box office's venue and forecast queries on two screens, without editing either:

- **Booking panel** `boxOffice.venueCrowd` ("Venue and crowd", side, order 20), registered from
  `screens/booking/venue/register.tsx` through Booking's feature list. It reads
  `boxOffice.forecast` (refetched on every world revision, so it follows card and venue changes)
  and shows the venue's picture, name, region, kind and capacity, the expected range with the
  forecast's Why?, a "Capped by capacity" note when the venue is too small for the top of the
  range, and a `VenueFitBadge`. While the show has no venue (the game picks the player's venue the
  day before the show), it says "Not chosen yet: suggested <venue>" with the pick's Why? ("Why
  this venue?") and offers **Pick for me** (`booking.autoVenue`). A show that can no longer change
  (`booking.card`'s `canEdit` is false) is read-only; a rival's show reads "Crowd forecasts are only
  available for your own shows". No phone summary: on a phone the panel sits in the page.
- **Change venue** opens `VenuePickerSheet` ("Choose a venue"; a full-height bottom sheet on a
  phone), which reads `boxOffice.venues` only while open. Venues are grouped "In <region>",
  "Elsewhere in <country>", "Abroad" (behind "Show venues in other countries", `scope: 'world'`)
  and "Local venues (generic)", each with its expected range, fit and Preferred / Current badges.
  Closed, exclusive and taken venues stay in the list as unavailable `RadioGroup` options: still
  reachable by keyboard, `aria-disabled`, the reason in their description. Picking a row only
  selects it, so moving through the list with the arrow keys sends nothing; **Use this venue**
  sends `booking.setVenue` and the sheet's **Pick for me** `booking.autoVenue`. A refusal shows in
  the sheet, which stays open; success closes it.
- **Calendar sheet line**: the show sheet's `boxOffice.crowd` section ("Crowd", order 5,
  `screens/box-office/ShowCrowdSection.tsx`, registered by the router) shows the expected range,
  its Why? and the fit for your own shows still to run. The venue itself stays in the sheet's facts
  row, which also names a generic local venue from the row's `genericVenue`. For any show that
  has run, the player's or a rival's, the section reads `boxOffice.showCrowd` instead (EVT6-07):
  "4,210 came · 92% full at Harbor Arena" with the attendance Why?, or "Box office not settled
  yet". A crowd is public; money never shows here.

## Finances

Business > Finances is live. `/game/finances` (`screens/finances/`, link with
`routes.game.finances({ tab, month, category })`) shows the seat's books in four tabs: Overview
(KPI cards and this month by category), Monthly (twelve months by category), Ledger (every row,
a page of 100 at a time, filtered by month and category) and Policies (Travel, Catering and Medical
levels, changed with `finance.setPolicy`). The tab and the Ledger's filters are in the URL. Other
features add tabs and KPI cards with `registerFinanceTab` and `registerFinanceKpi`;
`screens/finances/README.md` has the slots. The top bar's cash chip has a Why? from
`sim.status.promotion.cashTraceRef`, the same breakdown the Overview's Cash card opens.

## The Office

`/game/office` (`screens/office/`) shows the seat's key numbers from `office.dashboard`, then
panels other features add without editing the screen (docs/design/office.md#screen). A seat that
runs no promotion gets the world overview instead of key numbers.

### Adding an Office panel

```ts
registerOfficePanel({
  id: 'evt1.nextShow', // unique, prefixed with the feature
  order: 50, // lowest first; ties in registration order
  column: 'main', // 'main' (wide) or 'side' (narrow); one column on a phone, still by order
  requiresPromotion: true, // the default: left out for a seat that runs no promotion
  render: ({ promotionId, dashboard, isPhone }) => <NextShowPanel />, // null leaves it out
});
```

Register from your feature's own `officePanel.tsx` and append one import line to
`screens/office/panels/index.ts` (append only), which `OfficeScreen.tsx` imports once, so the
panel registers whenever the Office loads, lazy routes included. A panel reads its own feature's
query (hooks go in the component `render` returns, not in `render` itself) and never imports
another panel. Each panel is wrapped in `OfficePanelFrame`: a panel that throws shows "This panel
couldn't load" and the rest of the Office keeps working. `registerOfficePanel` throws for an id
that is taken and returns a function that removes the panel again.

| Order | Band                     |
| ----- | ------------------------ |
| 10–29 | The Office itself (DAY2) |
| 30–49 | Roster and people        |
| 50–69 | Shows                    |
| 70–89 | Business                 |
| 90+   | News and social          |

Registered so far: **World clock** (side, 10) and **World overview** (main, 20, seats with no
promotion only), both in `screens/office/panels/`. A panel that wants the Fan base sheet calls the context's
`openFanBase(promotionId)` (the world overview does, once per row) instead of drawing a sheet.

## The shell's look

The shell follows `docs/design/visual-identity.md` and the mockups in `docs/design/mockups/`.
Desktop: the wordmark and the promotion's crest block head the sidebar, the current nav item has
a red-orange rail, and the top bar ends with the game's status and the day control
(`TopBarStatus`, below). While no world answers `sim.status` (the dev helper's faked world, or a
shell rendered without an engine) it shows the sample status strip instead (`StatusStrip`: week,
season, date, cash with its weekly change, popularity) and the unwired Next Day bug
(`NextDaySlot`). The news `Ticker` runs along the bottom of the main column. Phones keep a crest, a short status and Next Day
in the top bar, and the ticker rides just above the bottom tab bar.

Two slots let later epics fill the chrome without restyling it: `renderTopBarEnd` replaces the
end of the top bar, and `ticker` replaces the sample headlines (`null` leaves the strip out).
`AppShell/shellPreview.ts` still supplies the sidebar's sample promotion, the ticker's headlines
and the fallback status strip, and every place that shows them says so.

## Talking to the engine

The engine runs in a Web Worker (`src/worker/engine.worker.ts`). The worker's host owns the world,
works out the local seat when a world is installed (`resolveLocalViewer`) and passes its viewer
and controller into every call, so screens never handle either. React code reaches it only
through the hooks in `engine/`:

| Hook                                | What it gives                                                         |
| ----------------------------------- | --------------------------------------------------------------------- |
| `useEngineQuery(name, args, opts?)` | `{ status, data, error, revision, isStale }`, cached and kept current |
| `useEngineCommand(name)`            | `{ run, pending, lastResult }`; refusals resolve, never throw         |
| `useAdvanceDays()`                  | `{ start, cancel, progress, running }` for multi-day skips            |
| `useEngineStatus(selector)`         | Revision, busy (`idle`, `query`, `command`, `advancing`), last error  |

Every applied command and every simulated day raises the world revision; a mounted query whose
result is older refetches and keeps showing the old data (`isStale`) meanwhile. If the worker
dies, `EngineProvider` shows the "simulation stopped" screen in place of the routes. Only
`src/worker` may import `createEngine` (a lint rule checks it). Tests use
`createInProcessTransport` with `src/test/fakeEngine.ts` instead of a worker.

## Saves

The title screen (`screens/title`) and the saved games list at `/load` (`screens/saves`) are the
way into a game. Loading and saving run in the engine worker, so a save's bytes go from IndexedDB
through the engine's staged checks into a running engine without visiting the main thread:

| Host method                   | What it does                                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| `loadFromSlot(slotId, which)` | Reads `latest` or a backup, runs `loadSave`, installs the engine      |
| `saveToSlot(slotId)`          | `exportState` → `createSaveDocument` → `encodeSave` → manual save     |
| `createSlot(label)`           | The same, into a new slot (the new-game flow)                         |
| `autosave(slotId, options)`   | The same, into the slot's autosave (monthly backup on request)        |
| `inspectSave(bytes)`          | Reads a file's header for an import                                   |
| `unloadWorld()`               | Stops the game; the revision moves on so every cached query refetches |

A load that fails comes back as the stage that refused it and up to 50 issues with document paths;
the screens show the first 20 in `LoadErrorSheet`. Listing, deleting, exporting and importing run
on the main thread through `screens/saves/saveStorage.tsx`, which tests replace with
`src/test/fakeStorage.ts`. "Main menu" in the sidebar and the More sheet saves into the session's
slot, unloads the world and returns to the title screen; a failed save keeps the player in the game.

## Moving time

The end of the top bar (`AppShell/TopBarStatus.tsx`) shows the game's status and the control that
moves time. Status comes from two engine built-ins, `sim.status` (date, season, the seat's cash and
popularity) and `sim.pendingGates` (why Next Day would stop today), read by
`status/useShellStatus.ts`; the web app adds no engine queries of its own. After an advance that
moved the clock, `AdvanceSummary` also asks `shows.completedSince` for the shows of yours it ran,
and links to their results (see [Show results](#show-results)).

- **The day button** (`day/DayControl.tsx`) reads "Next day" until a gate waits. Then
  `day/dayControlState.ts` turns the gates into a button by their route hint: `inbox` ("2 decisions
  waiting", which outranks everything), `booking` ("Go to show"), and anything else "Needs
  attention" with the gate's reason. Shift+N presses it outside text fields and dialogs.
- **Skip days** (`day/SkipDaysSheet.tsx`) takes a length (1 to 3,650 days) and an optional stop
  date, both checked against the engine's rules, with the calendar maths from `@ringside/engine`.
- **One controller** (`day/DayAdvanceProvider.tsx`) runs every advance: the overlay reads its
  progress, `AdvanceSummary` shows the result under the top bar and the live region announces it.
  After each advance that moved a day it asks `shouldAutosave` and, when told to, calls the host's
  `autosave`.
- **Status chips** come from `status/StatusChips.tsx`. Another system adds one with
  `registerStatusChip({ id, order, render })` (`status/statusChipRegistry.ts`) instead of editing
  the shell. Profile tabs work the same way: see [Adding a profile tab](#adding-a-profile-tab).
- **The popularity chip** shows the headline popularity (`sim.status.promotion.popularity.headline`,
  docs/design/office.md#headline-popularity) with its stored Why?, prestige under it, and a map
  button ("Open fan base") that opens the **Fan base sheet** (`status/FanBaseSheet.tsx`). In the
  phone's status sheet the button is a full-width "Fan base" row; the top bar keeps the one sheet,
  opens it while the status sheet is still there and then closes the status sheet, so sheets never
  stack and focus goes back to the date button (`data-return-focus-to`). A world with no headline
  yet (made before DAY2, until its first Monday) keeps the home-region value with the Why? built on
  the spot and no button. The sheet asks `office.fanBase`, `office.series` and `tunables.list` only
  while open; the Office's Popularity card and the world overview rows open the same sheet (one
  per screen, state in the screen). See docs/design/office.md#fan-base.
- **Fan base columns.** Another feature adds a figure to every region row of the Fan base sheet
  with `registerFanBaseColumn({ id, label, render: (regionId, { promotionId }) => node })`
  (`status/fanBaseColumnRegistry.ts`, exported from `status/index.ts`); `render` returning null
  shows nothing on that row. The sheet hands the columns to `PopularityDrilldown` through its
  `regionExtras` prop, so neither changes when a column arrives. EVT5-04's "This month" is the
  expected first user.

## Rules

- **Sections that need a promotion hide while unemployed.** `requiresPromotion` on a section and
  `useHasPromotion()` (the local seat's `promotionId`) decide it; nothing else checks employment.
- **Phone tab bar.** Four slots plus More. An item claims a slot with `mobilePrimary`; when that
  item is hidden, the item marked `mobileFallback` for the slot takes it.
- **Focus.** After a navigation `RouteFocus` focuses the `[data-route-heading]` element, or `#main`.
  It leaves focus alone on the first load, on redirects during start-up and on hash-only changes.
- **Announcements.** `useAnnounce()` speaks short status text (`announce('Advanced to Monday')`),
  politely by default.
- **The dev helper never ships.** `/dev/enter-shell` is registered only when `import.meta.env.DEV`
  is true or the build sets `VITE_E2E=1`, which the Playwright web server does (into `dist-e2e/`,
  never `dist/`). A unit test checks the production route list leaves it out.
