# text

The shared templated-text renderer. The engine never stores rendered words: a news story, a rival
desk decision or a contracts answer is a content key and short params
(`{ key: 'news.reign-milestone.headline', params: { holderIds: 'per_1,per_2', titleId: 'ttl_1', days: 100 } }`).
The web writes the English at display time from catalogs, so a later language pack needs no save
change.

## Files

| File                      | What it holds                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.ts`              | The registry: `registerTextCatalog(namespace, entries)`, `textFor(key)`, the `TemplatedText` types                                                  |
| `renderTemplatedText.tsx` | `renderTemplatedText(text)` (string), `renderTemplatedText(text, { names, renderEntityLink })` (React) and `templatedTextToString(text, { names })` |
| `catalogs/<namespace>.ts` | One feature's English. Importing the module registers it                                                                                            |

## Registering a catalog

A catalog is one namespace (the key's first segment, `news`, `aip`, `contracts`). Every key must
start with `<namespace>.`, and a namespace has one catalog: a second, different catalog for it
throws, so two features can never define the same key. Register from the feature's own module
(`registerTextCatalog('news', NEWS_TEXT_CATALOG)` at the end of `catalogs/news.en.ts`) and import
that module from the screen that shows the text (`screens/news/index.ts` imports the news catalog).

An entry is a template string, or a function of the params for a sentence a placeholder cannot say
(a plural, a verb that agrees with one or two people). What the function returns is itself a
template, so it can return `'{years:count} years'` and let the renderer fill it.

## Template syntax

`{param}` or `{param:format}`.

| Format    | Writes                                                          |
| --------- | --------------------------------------------------------------- |
| `date`    | a game date, long: "Monday, January 5, 2026" (`formatGameDate`) |
| `count`   | a grouped number: "12,500" (`formatNumber`)                     |
| `ordinal` | "1st", "2nd", "11th", "21st"                                    |
| `money`   | integer cents as dollars: "$12,000" (`formatMoney`)             |

With no format, a param whose value is an entity id, or ids joined by commas, renders as the
names from `names` joined "A, B and C", each drawn through `renderEntityLink` (pass
`useEntityLinkRenderer()` so people, promotions and titles link in the game and stay plain text in
the gallery). An id `names` does not hold is "(no longer in the records)", as plain text. Anything
else renders as written; a placeholder with no param stays as written; a value a format cannot read
(a date that is not a date) is shown as is.

## The two outputs

- `renderTemplatedText(text, { names, renderEntityLink })` returns React nodes for headlines, bodies
  and lists.
- `templatedTextToString(text, { names })` returns the same words as one string, for the ticker
  (whose crawl draws every item twice, so it must not hold links), aria labels and the document
  title.

A key no catalog knows renders "[missing text]" (in React inside `<span data-missing-key="…">`) and
logs nothing, so a story whose topic has no words yet shows up on screen without failing the e2e
console check. The older one-argument form `renderTemplatedText(text)` fills raw values and shows
an unknown key as the key itself; the rival desk's lists use it.

## Tests

Each catalog has a coverage test beside it. `catalogs/news.en.test.ts` checks that every topic
`newsTopics()` lists has a headline and a body, that every placeholder is a declared param (a
function entry is called with every param, and with each one left out), and that no line mentions
minutes or hours (D-10). A topic another feature registers fails it until its words are added.
