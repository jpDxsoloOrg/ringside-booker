# Help, screen help and first run

Sprint 13 (POL5-01, POL5-02 and POL5-05, Alpha scope). Code lives in `Assets/Scripts/Help/`
(namespace `RingsideBooker.Help`); styles in `Assets/UI/Help/Resources/Help/Help.uss`.

## Content

Help is plain files shipped with the game in `Assets/StreamingAssets/help/`. There is no editor
screen: change a file and rebuild.

- `index.json`: `{ "version": 1, "sections": [{ id, title, order }], "articles": [{ slug, title,
summary, section, order, keywords, screens }] }`. `screens` lists the nav item or screen ids the
  article is about; their header "?" opens it (the first article that names a screen wins).
- `articles/<slug>.md`: one Markdown file per article. The title comes from `index.json`, so the
  file starts with its first paragraph.

### The Markdown subset

The parser (`HelpMarkdown`) understands only this, and anything else stays literal text:

- `##` and `###` headings, with an optional explicit anchor `## Heading {#my-anchor}`; other
  anchors are made from the words ("The day button" → `the-day-button`), repeats get `-2`.
- Paragraphs, one level of `-` lists and `1.` lists, callouts `> **Tip:** …` and `> **Note:** …`.
- `**bold**`, `*italic*` or `_italic_`, `` `Shift+N` `` for keys, backslash escapes.
- Links: `[text](help:slug#anchor)`, `[text](screen:roster)` (plain text outside a game and for
  screens that are not built), `[text](https://…)`. Any other target becomes its words.
- Term marks `[[id]]` / `[[id|words]]` render as their words until the lexicon lands (Beta, POL5-03).
- Directives `::name` on their own line draw nothing yet (POL5-04 adds `::example-why`).
- No raw HTML, images or tables.

The renderer (`HelpRenderer`, `HelpRichText`) builds UI Toolkit rich text itself and escapes every
piece of article text, so content can never open a rich-text tag (the `<script>` and `<color>` in
the `-rbHelpShots` fixture show as text).

### Writing guide

- The owner's voice: plain words, short sentences, friendly. "You" for the player, "I" for a
  designer's note.
- Describe only what is in the game today. If a screen is not built, leave it out.
- Never mention minutes or real-time lengths (D-10): slots are Short, Standard or Long.
- Never name another game. Fictional names only.
- Run prettier on the files (`prettier --write game/Assets/StreamingAssets/help`).

### Adding an article

1. Add `articles/<slug>.md`.
2. Add its entry to `index.json` (append to its section; set `screens` if a screen's "?" should
   open it).
3. Run the content check: `game/tools/unity-test-editmode.sh RingsideBooker.Tests.Help`.

### The content check

`HelpContentCheck.Run(library, HelpScreen.KnownScreenIds())`, run by `HelpTests`, fails on:

- a bad or repeated slug or title, a summary over 160 characters, an unknown or empty section;
- an index entry without a file, or a file without an entry;
- a `help:` link to an unknown article or heading, or an unknown `screen:` or `screens` id;
- raw HTML outside code, any mention of minutes, `#` headings, images, tables, unknown
  directives, or more than 1,200 words.

## Help center

- Route `help`, `help?slug=<slug>[&anchor=<id>][&q=<words>]` (`HelpLocation.ToRoute()`); the
  sidebar has a Help section last (`NavigationModel`).
- Left: search and the article list; right: the index (with the Getting started card in a game) or
  the article (contents when it has three or more `##` headings, "Go to <screen>" for built screens,
  "More in <section>"). An unknown slug shows "Article not found".
- Search (`HelpSearchIndex`): folded words of two or more characters, prefix matches, every word
  must match; weights title 8, keyword 6, heading 4, body 1. The last search is kept for the session.
- The title screen has a Help menu item (`HelpScreen.BuildOutOfGame()`); screen links are plain
  text there.
- Screen help: `TopBarView.CrumbsDecorator` adds a quiet "?" after the screen title when an
  article names the screen; it opens `HelpSheet` (a side sheet with "Open in Help").

## First run

- `FirstRun.MarkNewGame()` (the new-game wizard) makes the next shell open show the welcome sheet:
  "Welcome to <promotion>", three short paragraphs, the Alpha notice when `ReleaseInfo.IsAlpha`
  (early test build, saves may need a fresh start, Send feedback via `Feedback.Send()`), "Don't
  show this for new games" and "Don't show the Alpha notice again". Loading a save never shows the
  welcome; a machine whose first game is a load sees the Alpha notice alone once.
  `FirstRun.Decide(...)` is the pure rule. Dev tours (`-rb…` arguments) and batch mode skip it.
- **Getting started checklist** (`GettingStarted`): Book your first show, Run it, Read the results,
  Sign someone, Read a help article. Booking, running and signing are read from the engine
  (`shows.lastCompleted`, `booking.shows`, `contracts.offers` closed + `signed`); the results and
  articles are recorded by the UI. It is the Office's first block and the Help index's card,
  per save slot, and hides once seen complete or when the player hides it. To add an item, append a
  `ChecklistItem` and record its id with `GettingStarted.Record(id)` (or read it in
  `RefreshFromEngine`).
- **Settings › Help & tips** (`HelpTipsSettings`): the welcome and Alpha notice switches, "Show the
  Getting started list again" (in a game), "Reset help and tips" (with a confirm) and "Open Help".
- Storage: PlayerPrefs only (`HelpPrefs`, keys `rb.help.*`), never in a save.

## Tour

`RingsideBooker.exe -screen-width W -screen-height H -screen-fullscreen 0 -rbHelpShots "<win dir>"`
(`Help/Dev/HelpShots.cs`, 14 PNGs, exit 0): Help from the title screen, the welcome with the Alpha
notice, the Office checklist, the "?" and its sheet, the Help index, a search, an article and an
anchor, "Article not found", the renderer fixture, the checklist after the first show, and
Settings › Help & tips. It resets help progress first.
