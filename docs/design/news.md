# News

The news wire is the public feed of the wrestling world: results, title changes,
signings, releases, rumours and the rest. This page is the contract every system
uses to post a story. DAY1-01 builds the posting core; DAY1-02 adds the
[opening story](#opening-story), the weekly [milestones](#milestones) and the
[expiry clean-up](#expiry); later DAY1 tickets add the other stories, the feed
queries and the screen.

Code: `packages/engine/src/systems/news/` and the `news` table
(`packages/engine/src/model/entities/news.ts`, see
[data-model.md](data-model.md#mail-and-news-templated-text)).

## Posting

`postNews(ctx, input)` is the **only** way a story is written. A system calls it
inside its own step, so everything it does commits or rolls back with that step.

```ts
postNews(ctx, {
  kind: 'titleChange',
  topic: 'title-change',
  params: { title: titleName, winner: winnerName },
  refs: { personIds: [winnerId, loserId], promotionIds: [promotionId] },
  importance: 2,
  dedupeKey: `title-change:${reignId}`,
});
```

| Field           | Meaning                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | One of the 14 `NEWS_KINDS`. `NEWS_KIND_LABELS` names it on screen ("Title change").                                                |
| `topic`         | A registered topic; the headline and body are `news.<topic>.headline` and `news.<topic>.body` (see [content keys](#content-keys)). |
| `params`        | Parameters of the headline, and of the body when `bodyParams` is left out. Every name must be declared by the topic.               |
| `bodyParams`    | Parameters of the body when it needs other ones.                                                                                   |
| `refs`          | People, promotions, a show and an employment the story is about. People and promotions also feed its [buzz](#buzz).                |
| `importance`    | 0 (filler) to 3 (front page).                                                                                                      |
| `expiresInDays` | Left out: the importance's [expiry](#expiry) tunable. A whole number of days: that instead. Null: never expires.                   |
| `dedupeKey`     | "Only once" (1 to 160 characters): when a story with this key is on file, `postNews` returns its ID and posts nothing.             |

What it does, in order:

1. Checks the topic is registered and every parameter is declared. Otherwise
   it throws `InvalidArgumentError`: the step rolls back and the failure is
   logged (`pipeline.stepFailed`).
2. With a `dedupeKey` already on file (the `byDedupeKey` index), returns that
   story's ID. Nothing is written, traced or published.
3. Scores the [buzz](#buzz) with `buzzScore`.
4. Sets `expiresOn` (see [expiry](#expiry)).
5. Writes the row with `ctx.tx.create('news', ...)`, dated `ctx.date`.
6. Stores the buzz trace under `{ kind: 'news.buzz', id: <newsId> }`.
7. Publishes `news.posted` with `newsId`, `kind`, `importance` and `buzz`.

**News is flavour.** Nothing changes morale, popularity or money because a
story was posted. A system that wants a story to have an effect makes the effect
itself, through its own door, and posts the story about it. No system may
subscribe to `news.posted` to change the world.

## Buzz

Buzz (0..100) is how much the wrestling world is talking about a story. It is
our own formula: a base for the kind of story, points per level of importance,
and points for how well known the people and promotions in it are, with
diminishing returns.

```
buzz = clamp(0, 100, kindBase[kind] + importance × importancePoints + Σ share_i × popPoints(p_i))
popPoints(p) = popularityMax × p / (p + popularitySoftCap)
```

- `p_i` is each subject's **worldwide popularity**: the population-weighted
  world value of the shared roll-up
  ([geography.md](geography.md#popularity-roll-up)) of their `regionalPop`. A
  person is labelled by `displayNameOf` (the ring name of their main contract,
  else their default ring name), a promotion by its name.
- Subjects are sorted by popularity, highest first; ties go to the lower ID.
- `share_1 = 1`, `share_i = extraSubjectShare` for i = 2..`maxSubjects`, and 0
  after that. The trace says how many were left out.
- When `p + popularitySoftCap` is 0, the subject adds 0, shown as the branch
  "No popularity, no soft cap".
- People and promotions that no longer exist add nothing; the trace has a note
  for each.
- No rolls: the same story in the same world gets the same buzz.

Buzz is fixed when the story is posted, so it says how big the story was when
it broke. A worker who becomes a star later does not raise the buzz of old
stories. The trace store keeps full traces for the newest
`sim.traceRetentionPerKind` stories; older ones keep the summary.

The Why? trace reads: "Story buzz" starting from "Nothing yet", then "Base for a
&lt;kind&gt; story", "Importance &lt;n&gt; × points per level", one "Popularity of
&lt;name&gt;" step per counted subject (its worldwide popularity as the input,
linked to the person or promotion, and "Each further subject counts 0.25" from
the second on), and "Kept between 0 and 100". Every step names its tunable.

The input carries only the world value and where it comes from (the
popularity roll-up, [geography.md](geography.md#popularity-roll-up)), not the
continents, countries and regions under it: the subject's own popularity Why?
shows that breakdown, one click away through the link. Nesting the full roll-up
made each stored buzz trace about 49 KB in the default world (DAY1-03).

**Worked example.** A signing (base 20) of importance 1 (12) about a worker at
worldwide popularity 70 and their new promotion at 40, with the defaults:

| Step                             | Points                            |
| -------------------------------- | --------------------------------- |
| Base for a signing story         | 20                                |
| Importance 1 × points per level  | 12                                |
| Popularity of the worker (70)    | 40 × 70 / (70 + 30) = 28          |
| Popularity of the promotion (40) | 0.25 × 40 × 40 / (40 + 30) ≈ 5.71 |
| Kept between 0 and 100           | **65.71**                         |

### Buzz tunables

Category News, docRef `news.md#buzz`. Every number is 0-means-0.

| Key                              | Kind    | Default | Range | Unit   | Meaning                                                                                    |
| -------------------------------- | ------- | ------- | ----- | ------ | ------------------------------------------------------------------------------------------ |
| `news.buzz.kindBase.result`      | number  | 20      | 0–100 | points | Buzz every result story starts with                                                        |
| `news.buzz.kindBase.titleChange` | number  | 35      | 0–100 | points | Title change                                                                               |
| `news.buzz.kindBase.signing`     | number  | 20      | 0–100 | points | Signing                                                                                    |
| `news.buzz.kindBase.release`     | number  | 15      | 0–100 | points | Release                                                                                    |
| `news.buzz.kindBase.injury`      | number  | 15      | 0–100 | points | Injury                                                                                     |
| `news.buzz.kindBase.retirement`  | number  | 30      | 0–100 | points | Retirement                                                                                 |
| `news.buzz.kindBase.rumour`      | number  | 5       | 0–100 | points | Rumour                                                                                     |
| `news.buzz.kindBase.business`    | number  | 15      | 0–100 | points | Business                                                                                   |
| `news.buzz.kindBase.milestone`   | number  | 10      | 0–100 | points | Milestone                                                                                  |
| `news.buzz.kindBase.backstage`   | number  | 10      | 0–100 | points | Backstage                                                                                  |
| `news.buzz.kindBase.personal`    | number  | 10      | 0–100 | points | Personal                                                                                   |
| `news.buzz.kindBase.season`      | number  | 30      | 0–100 | points | Season                                                                                     |
| `news.buzz.kindBase.award`       | number  | 30      | 0–100 | points | Award                                                                                      |
| `news.buzz.kindBase.rivalry`     | number  | 20      | 0–100 | points | Rivalry                                                                                    |
| `news.buzz.importancePoints`     | number  | 12      | 0–40  | points | Buzz per level of importance                                                               |
| `news.buzz.popularityMax`        | number  | 40      | 0–100 | points | Most buzz one subject's popularity can add                                                 |
| `news.buzz.popularitySoftCap`    | number  | 30      | 0–100 | points | Popularity at which a subject adds half of `popularityMax` (0: any popularity adds it all) |
| `news.buzz.extraSubjectShare`    | number  | 0.25    | 0–1   | ratio  | Share each subject after the best known adds                                               |
| `news.buzz.maxSubjects`          | integer | 3       | 1–10  | count  | Most subjects whose popularity counts                                                      |

## Expiry

`expiresOn` is the **first day the story is gone** from the feed:
`addDays(postedOn, days)`. So 14 days means the story shows on the day it was
posted and the 13 days after, and 0 means it never shows on a day after the one
it was posted on.

| Importance | Days                                |
| ---------- | ----------------------------------- |
| 0          | `news.expiry.importance0Days` (14)  |
| 1          | `news.expiry.importance1Days` (60)  |
| 2          | `news.expiry.importance2Days` (180) |
| 3          | Never (`expiresOn: null`)           |

Importance 3 never expiring is a design rule, not a tunable: front-page stories
are kept as history (`FRONT_PAGE_KEPT_REASON`). An explicit `expiresInDays`
replaces the tunable for importance 0 to 2; `null` keeps the story.

The three expiry tunables are integers, 0–3650, unit `days`, category News,
docRef `news.md#expiry`.

**The clean-up.** The daily phase `news.expire` (`housekeeping`, order 24,
DAY1-02) deletes every story whose `expiresOn` is on or before the day. It walks
the `byExpiresOn` index keys (`ReadonlyTable.indexKeys`, sorted) from the oldest
up to the day and stops at the first later key, so it never scans the table;
the stories are deleted in id order and the step logs "Expired N stories".
Overdue stories go the same way: a 0-day story posted after the phase ran is
gone the next day (or the same day, when it runs again), and an old save is
caught up on its first day. Stories with `expiresOn: null` (every front-page
story) are not in the index and are never touched.

**Retention.** News is history, so it follows the owner's history rule
(`history.keepDetailDays`, about 4 weeks of full detail): the feed itself only
lists stories that have not expired, and `news.expire` deletes the rest, so a
10-year skip does not fill the save with old filler. Front-page stories are
the summaries that stay. Their buzz traces fall back to summaries on their own
through the trace store's per-kind limit.

## Opening story

Every new game starts with one front-page story, "Season one begins", dated the
start day. The new-game setup step `news.openingStory` (order 950, after every
other band in the setup-step list and before the office baseline at 990) reads
the active season (`seasons` `activeSeason`, created by `materialise`) and
posts:

```ts
postNews(ctx, {
  kind: 'season',
  topic: 'season-start',
  importance: 3,
  params: { seasonNumber: 1 },
  bodyParams: { seasonNumber: 1, startDate, endDate, worldName },
  dedupeKey: 'season-start:1',
});
```

The catalog says this story comes "on world.created". It is a setup step and
not a reaction to `world.created` because `createNewGame` builds its own event
bus with no system subscriptions (`setupRuntime` in
`systems/newgame/createNewGame.ts`), so a reaction would never run there. Its
`news.posted` lands in the new game's event log between the opening schedule's
`calendar.horizonExtended` and `world.created`. The dedupe key is the one the
weekly [seasons source](#milestones) and DAY3's own season story use, so a
season is never announced twice.

## Milestones

Until shows and contracts produce news, the foundation data already holds
stories: title reigns with their won dates, debut dates and founding dates.
The weekly phase `news.milestones` (`periodic`, order 12, Mondays, DAY1-02)
turns them into milestone stories.

**Window.** From `max(date − 6 days, meta.startDate)` to the Monday itself,
both ends included. Nothing before the game's start is ever reported, so a
milestone that fell before day one (a record passed last year) never appears.

**Sources.** A source (`registerMilestoneSource({ id, collect })` in
`systems/news/milestones/registry.ts`) lists the milestones that fell on a day
inside the window as candidates
(`{ onDate, topic, kind, importance, params, bodyParams, refs, dedupeKey }`).
Later features (DAY5 records, CRTV2 prestige bands) add a source without
editing the phase. The built-in sources, in registration order:

| Source         | Topic                   | Kind        | When                                                                                                                                                                     | Importance                                                                                                              | Params                                                        | Dedupe key                                    |
| -------------- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `reigns`       | `reign-milestone`       | `milestone` | An open reign of an active title reaches 100, 200 or 300 days held (`REIGN_MILESTONE_DAYS`, story beats, not balance), or a whole year since `wonOn`                     | 1 for a day mark, 2 for a year; +1 (up to 3) when the title's prestige is at least `news.milestones.majorTitlePrestige` | `titleId`, `holderIds`, `days` or `years`                     | `reign-milestone:<reignId>:<days or years>`   |
| `reignRecords` | `reign-record`          | `milestone` | An open reign passes the longest finished reign of its title (days held = longest + 1), when the title has at least `news.milestones.recordMinReigns` finished reigns    | 3                                                                                                                       | `titleId`, `holderIds`, `previousHolderIds`, `days`           | `reign-record:<reignId>`                      |
| `careers`      | `career-anniversary`    | `milestone` | An `active` or `semiRetired` person's debut anniversary, when the years are a multiple of `news.milestones.careerYearStep` and at least `news.milestones.careerMinYears` | 1, or 2 from 25 years (`CAREER_MAJOR_YEARS`)                                                                            | `personId`, `years`                                           | `career:<personId>:<years>`                   |
| `promotions`   | `promotion-anniversary` | `business`  | An active promotion's founding anniversary: the first, then every `news.milestones.promotionYearStep` years                                                              | 2, or 3 from 25 years (`PROMOTION_MAJOR_YEARS`)                                                                         | `promotionId`, `years`                                        | `promotion-anniversary:<promotionId>:<years>` |
| `seasons`      | `season-start`          | `season`    | A season with number 2 or more starts (season one is the [opening story](#opening-story))                                                                                | 3                                                                                                                       | `seasonNumber`; body also `startDate`, `endDate`, `worldName` | `season-start:<number>`                       |

Whole-year anniversaries use `addYears`, so a reign won or a debut made on 29
February has its anniversary on 28 February in common years. Holders are
person ids joined by commas in one string parameter (templated parameters are
strings or numbers); the screen turns them into "A and B" with links at display
time. Ring names never go in parameters: they change.

Refs: reign stories name the holders (a record also the previous holders) and
the title's promotion; a career story the person and the promotions they have
an active contract with; a promotion story the promotion.

**Sort and cap.** Candidates from every source are sorted by importance (highest
first), then `onDate`, then `dedupeKey`, and the first
`news.milestones.maxPerWeek` are posted (0 posts none). The step logs how many
it posted, how many were already on file and how many it dropped over the cap.

**Dating.** Each story is dated the Monday. Its body gets the headline
parameters plus `onDate`, the real day ("on Thursday 14 January"), so nothing
is lost by posting once a week. Every milestone topic declares `onDate`.

**Only once.** Every candidate has a dedupe key, and the cap is applied before
the dedupe check, so running the same Monday again posts nothing new. A record
is posted once per reign. Windows of successive Mondays do not overlap.

No random numbers are drawn and every table is read in id order, so the
milestones are a pure function of the world. Why weekly and not daily: one
Monday batch keeps the feed readable and the cost tiny.

Milestones are ours: the private notes (05 §9.1, §9.3) have no anniversary
stories. They exist so the news wire can be tried before shows run.

## Content keys

A story stores content keys and parameters, never English; the web catalog
writes the words at display time (like mail). A **topic** owns two keys:

- `news.<topic>.headline`
- `news.<topic>.body`

`registerNewsTopic(topic, { params })` declares a topic and the parameter names
its text may use; `newsTopics()` lists them, so the catalog test (DAY1-04) can
check there is text for every topic and that it uses only declared parameters.

Keys must match `CONTENT_KEY_PATTERN` (`core/content-key.ts`): lowercase
letters, digits and hyphens per segment. So a topic is kebab case:
`news.reign-milestone.headline`, never `news.reignMilestone.headline`.
Parameter names are camelCase (`titleName`). Registering a topic twice with the
same parameters does nothing; with other parameters it throws.

## Visibility

News is public (D-07): every promotion and every viewer can read every story.
So a caller must **never** put hidden facts in a story, in its parameters or in
its references:

- a worker's `development` or any other hidden attribute;
- hidden vices or private problems the player has not discovered;
- a rival's finances (cash, wages, ledger);
- contract terms (money, length, clauses).

Say what the wrestling world could see: who won, who signed where, who got
hurt on screen. When in doubt, leave it out.
