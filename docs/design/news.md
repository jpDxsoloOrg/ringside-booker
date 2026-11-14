# News

The news wire is the public feed of the wrestling world: results, title changes,
signings, releases, rumours and the rest. This page is the contract every system
uses to post a story. DAY1-01 builds the posting core; later DAY1 tickets add the
stories themselves, the feed queries and the screen.

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
&lt;name&gt;" step per counted subject (its popularity roll-up as the input,
linked to the person or promotion, and "Each further subject counts 0.25" from
the second on), and "Kept between 0 and 100". Every step names its tunable.

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

**Retention.** News is history, so it follows the owner's history rule
(`history.keepDetailDays`, about 4 weeks of full detail): the feed itself only
lists stories that have not expired, and the `byExpiresOn` index lets DAY1-02
delete expired rows in its expiry clean-up. Front-page stories are
the summaries that stay. Their buzz traces fall back to summaries on their own
through the trace store's per-kind limit.

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
