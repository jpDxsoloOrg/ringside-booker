using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Draft
{
    /// <summary>
    /// The draft room's state and drawing (one per visit). It leads with the decision: who is on the
    /// clock and what you can do (draft, sim to your pick, auto-pick the rest, finish). The pool is a
    /// paged, sortable table (never more than one page of rows drawn, so a world with thousands of
    /// wrestlers stays quick); your roster and every promotion's counts sit beside it.
    /// </summary>
    public sealed class DraftView
    {
        public const int PageSize = 50;
        public const int RostersPerPage = 16;
        private const int RecentPicks = 10;

        private readonly ScreenContext context;
        private readonly Label subtitle;
        private readonly VisualElement headActions;
        private readonly VisualElement clock;
        private readonly VisualElement ticker;
        private readonly VisualElement body;
        private readonly VisualElement poolColumn;
        private readonly VisualElement toolbar;
        private readonly Label poolCount;
        private readonly VisualElement tableHost;
        private readonly VisualElement pager;
        private readonly VisualElement side;
        private readonly VisualElement finishedHost;
        private readonly Label feedback;
        private readonly DsTable<JToken> table;

        private JToken draft;
        private string search = string.Empty;
        private string gender;
        private string weightClass;
        private string style;
        private string category;
        private string sort = "value";
        private bool descending = true;
        private int page;
        private int rosterPage;
        private int searchTicket;
        private bool animating;
        private bool skipAnimation;

        public DraftView(ScreenContext context)
        {
            this.context = context;
            Root = Ds.Column("dr-page").Named("screen-draft");
            DraftScreen.Style(Root);

            VisualElement head = Ds.Row("dr-head");
            VisualElement titles = Ds.Column("dr-head__titles");
            titles.Add(Ds.Text("THE DRAFT", "ds-type-headline", "dr-head__title"));
            subtitle = Ds.Text(string.Empty, "ds-type-caption", "dr-head__subtitle").Named("draft-subtitle");
            titles.Add(subtitle);
            head.Add(titles);
            head.Add(Ds.Spacer());
            headActions = Ds.Row("dr-head__actions").Named("draft-head-actions");
            head.Add(headActions);
            Root.Add(head);

            clock = Ds.Row("dr-clock").Named("draft-clock");
            Root.Add(clock);
            ticker = Ds.Row("dr-ticker").Named("draft-ticker");
            Root.Add(ticker);
            feedback = Kit.Feedback();
            Root.Add(feedback);
            finishedHost = Ds.Column("dr-finished").Named("draft-finished");
            Root.Add(finishedHost);

            body = Ds.Row("dr-body");
            poolColumn = Ds.Column("dr-pool").Named("draft-pool");
            poolColumn.Add(Ds.SectionHeader("The pool"));
            toolbar = Ds.Row("dr-toolbar").Named("draft-toolbar");
            poolColumn.Add(toolbar);
            poolCount = Ds.Text(string.Empty, "dr-count").Named("draft-pool-count");
            table = new DsTable<JToken>(Columns(), Array.Empty<JToken>()) { name = "draft-pool-table" };
            table.AddToClassList("dr-table");
            table.ShowSort(sort, descending);
            table.ExternalSort = (columnId, down) =>
            {
                sort = columnId;
                descending = down;
                page = 0;
                _ = RenderPool();
            };
            tableHost = Ds.Column("dr-table-host");
            tableHost.Add(table);
            poolColumn.Add(tableHost);
            pager = Ds.Row("dr-pager").Named("draft-pager");
            poolColumn.Add(pager);
            body.Add(poolColumn);
            side = Ds.Column("dr-side").Named("draft-side");
            body.Add(side);
            Root.Add(body);

            DrawToolbar();
            Kit.Live(Root, Render);
        }

        public VisualElement Root { get; }

        /// <summary>The draft as last read (<c>draft.state</c>'s <c>draft</c>), or null.</summary>
        public JToken State => draft;

        /// <summary>The pool rows on screen (one page).</summary>
        public IReadOnlyList<JToken> PoolRows { get; private set; } = Array.Empty<JToken>();

        public string Status => Kit.Str(draft, "status");
        public bool YourTurn => Kit.Bool(draft, "onTheClock.isYou");
        public bool NegotiateAfter => Kit.Bool(draft, "settings.negotiateAfter");

        /// <summary>True while "Sim to my pick" ticks picks by.</summary>
        public bool Busy => animating;

        // ---- Drawing --------------------------------------------------------------------------------

        private async Task Render()
        {
            EngineGame game = Kit.Game;
            await DraftPictures.EnsureAsync(game);
            await RenderState();
            if (animating) return;
            await RenderPool();
        }

        /// <summary>The clock, the ticker, the rosters and the finish panel (not the pool).</summary>
        private async Task RenderState()
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> state = await game.Client.Query("draft.state", new JObject { ["recent"] = RecentPicks });
            if (Root.panel == null) return;
            draft = state.Ok ? state.Data?["draft"] : null;
            if (draft == null || draft.Type == JTokenType.Null)
            {
                draft = null;
                clock.Clear();
                ticker.Clear();
                headActions.Clear();
                finishedHost.Clear();
                body.SetShown(false);
                subtitle.text = string.Empty;
                clock.Add(Ds.Empty("users", "This game has no draft", "A draft happens before day 1 when a new game starts with \"Start with a draft\" on."));
                return;
            }
            string status = Status;
            bool finished = status == "finished";
            subtitle.text = SubtitleText();
            DrawHeadActions(status);
            DrawClock(status);
            DrawTicker();
            DrawSide();
            finishedHost.Clear();
            body.SetShown(!finished);
            if (finished) DrawFinished();
        }

        private string SubtitleText()
        {
            int picks = (int)(Kit.Num(draft, "picksMade") ?? 0);
            int left = (int)(Kit.Num(draft, "poolLeft.wrestlers") ?? 0);
            int staff = (int)(Kit.Num(draft, "poolLeft.staff") ?? 0);
            int promotions = (int)(Kit.Num(draft, "promotions") ?? 0);
            string line = $"{TextFormat.Number(promotions)} promotions · {TextFormat.Number(picks)} picks made · {TextFormat.Number(left)} wrestlers left in the pool";
            if (Kit.Bool(draft, "settings.draftStaff")) line += $" and {TextFormat.Number(staff)} staff";
            return line;
        }

        private int Rounds() => DraftText.Rounds((int)(Kit.Num(draft, "settings.rosterTarget") ?? 0),
            (int)(Kit.Num(draft, "settings.staffTarget") ?? 0), Kit.Bool(draft, "settings.draftStaff"));

        private void DrawHeadActions(string status)
        {
            headActions.Clear();
            if (status != "running") return;
            Button auto = Ds.Button("Auto-pick the rest", ConfirmAutoPick, DsButtonKind.Ghost, "fast-forward");
            auto.name = "draft-auto-pick";
            auto.SetEnabled(!animating);
            DsTooltip.Attach(auto, "The computer makes every remaining pick, yours too, by value and what each roster needs.");
            headActions.Add(auto);
        }

        private void DrawClock(string status)
        {
            clock.Clear();
            JToken onClock = draft["onTheClock"];
            bool hasClock = onClock != null && onClock.Type == JTokenType.Object;
            bool isYou = hasClock && Kit.Bool(onClock, "isYou");
            clock.EnableInClassList("dr-clock--you", isYou && status == "running");
            clock.EnableInClassList("dr-clock--done", status != "running");

            VisualElement badge = Ds.El("dr-clock__badge");
            if (hasClock) PromotionLogos.Prepend(badge, Kit.Str(onClock, "promotionId"), Kit.Str(onClock, "shortName"), "rb-logo--lg");
            else badge.Add(new Icon(status == "finished" ? "check-circle" : "check", "ds-icon--2xl", "dr-clock__icon"));
            clock.Add(badge);

            VisualElement words = Ds.Column("dr-clock__words");
            string label = status == "running" ? (isYou ? "YOUR PICK" : "ON THE CLOCK") : status == "complete" ? "ALL PICKS MADE" : "DONE";
            words.Add(Ds.Text(label, "ds-type-micro", "dr-clock__kicker"));
            words.Add(Ds.Text(TextFormat.Upper(DraftText.ClockHeadline(status, isYou, Kit.Str(onClock, "shortName"))), "ds-type-title", "dr-clock__headline").Named("draft-clock-headline"));
            if (hasClock)
            {
                words.Add(Ds.Text(DraftText.RoundLine((int)(Kit.Num(onClock, "round") ?? 0), Rounds(), (int)(Kit.Num(onClock, "pick") ?? 0)) +
                                  (isYou ? string.Empty : " · " + Kit.Str(onClock, "name")), "dr-clock__line"));
            }
            JToken next = draft["yourNextTurn"];
            bool hasNext = next != null && next.Type == JTokenType.Object;
            string nextLine = status switch
            {
                "running" => DraftText.NextTurnLine(isYou, hasNext ? (int?)(Kit.Num(next, "picksAway") ?? 0) : null, hasNext ? (int?)(Kit.Num(next, "round") ?? 0) : null),
                "complete" => "Every roster is full or the pool is empty. Finish the draft to start the season.",
                _ => NegotiateAfter ? "Sign your draftees: they joined unsigned." : "Your draftees are signed for the season.",
            };
            words.Add(Ds.Text(nextLine, "dr-clock__next").Named("draft-next-turn"));
            clock.Add(words);
            clock.Add(Ds.Spacer());

            VisualElement actions = Ds.Row("dr-clock__actions");
            if (status == "running" && !isYou)
            {
                if (animating)
                {
                    Button skip = Ds.Button("Skip ahead", () => skipAnimation = true, DsButtonKind.Secondary, "fast-forward");
                    skip.name = "draft-skip-ahead";
                    actions.Add(skip);
                }
                else
                {
                    SkewButton sim = Ds.Cta(hasNext ? "Sim to my pick" : "Sim the rest", () => _ = SimToMyPick(), "play");
                    sim.name = "draft-sim";
                    actions.Add(sim);
                }
            }
            else if (status == "running" && isYou)
            {
                actions.Add(Ds.Text("Pick from the pool below.", "dr-clock__hint"));
            }
            else if (status == "complete")
            {
                SkewButton finish = Ds.Cta("Finish the draft", () => _ = Finish(), "check");
                finish.name = "draft-finish";
                actions.Add(finish);
            }
            clock.Add(actions);
        }

        private void DrawTicker()
        {
            ticker.Clear();
            List<JToken> picks = Kit.Arr(draft, "recentPicks").ToList();
            if (picks.Count == 0)
            {
                ticker.SetShown(false);
                return;
            }
            ticker.SetShown(true);
            ticker.Add(Ds.Text("RECENT PICKS", "ds-type-micro", "dr-ticker__label"));
            VisualElement items = Ds.Row("dr-ticker__items");
            foreach (JToken pick in picks)
            {
                bool yours = Kit.Str(pick, "promotionId") == Kit.Game?.PromotionId;
                VisualElement item = Ds.Row("dr-pick");
                item.EnableInClassList("dr-pick--yours", yours);
                item.Add(Ds.Text($"#{Kit.Num(pick, "number")}", "dr-pick__number"));
                item.Add(Ds.Text(Kit.Str(pick, "promotionShortName"), "dr-pick__promotion"));
                item.Add(Ds.Text(Kit.Str(pick, "name"), "dr-pick__name"));
                DsTooltip.Attach(item, $"Round {Kit.Num(pick, "round")}, pick {Kit.Num(pick, "number")}: {Kit.Str(pick, "promotionName")} took {Kit.Str(pick, "name")} (value {Kit.Decimal1(Kit.Num(pick, "value"))}).");
                items.Add(item);
            }
            ticker.Add(items);
        }

        // ---- The side column: your roster and every roster ----------------------------------------

        private void DrawSide()
        {
            side.Clear();
            int target = (int)(Kit.Num(draft, "settings.rosterTarget") ?? 0);
            int staffTarget = (int)(Kit.Num(draft, "settings.staffTarget") ?? 0);
            bool staff = Kit.Bool(draft, "settings.draftStaff");
            List<JToken> picks = Kit.Arr(draft, "roster.picks").ToList();
            int wrestlers = picks.Count(pick => Kit.Str(pick, "category") == "wrestler");

            VisualElement mine = Ds.Column("dr-panel").Named("draft-your-roster");
            mine.Add(Ds.SectionHeader("Your roster"));
            VisualElement counts = Ds.Row("dr-counts");
            counts.Add(Ds.Meter(target > 0 ? Mathf.Clamp01(wrestlers / (float)target) : 0f, wrestlers >= target ? DsState.Good : DsState.Info,
                $"{wrestlers} of {target} wrestlers"));
            mine.Add(counts);
            if (staff)
            {
                int staffCount = picks.Count - wrestlers;
                mine.Add(Ds.Text($"{staffCount} of {staffTarget} staff", "dr-quiet"));
            }
            if (picks.Count == 0)
            {
                mine.Add(Ds.Text("Nobody yet. Your picks land here.", "dr-quiet"));
            }
            else
            {
                VisualElement list = Ds.Column("dr-roster-list");
                foreach (JToken pick in picks) list.Add(PickRow(pick));
                mine.Add(list);
            }
            side.Add(mine);

            List<JToken> rosters = Kit.Arr(draft, "rosters").ToList();
            VisualElement all = Ds.Column("dr-panel").Named("draft-rosters");
            all.Add(Ds.SectionHeader($"Every roster · {rosters.Count}"));
            int pages = Math.Max(1, (int)Math.Ceiling(rosters.Count / (double)RostersPerPage));
            rosterPage = Math.Min(rosterPage, pages - 1);
            VisualElement grid = Ds.Column("dr-rosters");
            foreach (JToken roster in rosters.Skip(rosterPage * RostersPerPage).Take(RostersPerPage)) grid.Add(RosterRow(roster, target));
            all.Add(grid);
            if (pages > 1)
            {
                VisualElement nav = Ds.Row("dr-pager", "dr-pager--small");
                Button prev = Ds.Button("Previous", () => { rosterPage--; DrawSide(); }, DsButtonKind.Ghost, "chevron-left");
                prev.name = "draft-rosters-prev";
                prev.SetEnabled(rosterPage > 0);
                nav.Add(prev);
                nav.Add(Ds.Text($"{rosterPage + 1} / {pages}", "dr-quiet"));
                Button next = Ds.Button("Next", () => { rosterPage++; DrawSide(); }, DsButtonKind.Ghost, "chevron-right");
                next.name = "draft-rosters-next";
                next.SetEnabled(rosterPage < pages - 1);
                nav.Add(next);
                all.Add(nav);
            }
            side.Add(all);
        }

        private VisualElement PickRow(JToken pick)
        {
            VisualElement row = Ds.Row("dr-roster-row");
            string personId = Kit.Str(pick, "personId");
            row.Add(W.Portrait(DraftPictures.ImageRef(personId), null, "ds-portrait--xs", false, Kit.Str(pick, "name")));
            VisualElement words = Ds.Column("dr-roster-row__words");
            words.Add(Ds.Text(Kit.Str(pick, "name"), "dr-roster-row__name"));
            string what = Kit.Str(pick, "category") == "staff" ? W.RoleWord(Kit.Str(pick, "role")) : DraftText.GenderWord(Kit.Str(pick, "gender"));
            words.Add(Ds.Text($"#{Kit.Num(pick, "number")} · {what} · value {Kit.Decimal1(Kit.Num(pick, "value"))}", "dr-roster-row__detail"));
            row.Add(words);
            if (NegotiateAfter || Kit.Str(pick, "contract") != "signed")
            {
                (DsState state, string word) = DraftText.ContractWord(Kit.Str(pick, "contract"));
                row.Add(Ds.Pill(state, word));
            }
            return row;
        }

        private VisualElement RosterRow(JToken roster, int target)
        {
            bool yours = Kit.Bool(roster, "isYou");
            int wrestlers = (int)(Kit.Num(roster, "wrestlers") ?? 0);
            Button row = new Button(() => OpenRoster(roster)) { text = string.Empty };
            row.AddToClassList("dr-roster");
            row.EnableInClassList("dr-roster--yours", yours);
            row.name = "draft-roster-" + Kit.Str(roster, "promotionId");
            VisualElement logo = Ds.Row("dr-roster__logo");
            PromotionLogos.Prepend(logo, Kit.Str(roster, "promotionId"), Kit.Str(roster, "shortName"), "rb-logo--sm");
            row.Add(logo);
            row.Add(Ds.Text(Kit.Str(roster, "shortName") ?? Kit.Str(roster, "name"), "dr-roster__name"));
            row.Add(Ds.Meter(target > 0 ? Mathf.Clamp01(wrestlers / (float)target) : 0f, Kit.Bool(roster, "done") ? DsState.Good : DsState.Info));
            row.Add(Ds.Text($"{wrestlers}/{target}", "dr-roster__count"));
            DsTooltip.Attach(row, $"{Kit.Str(roster, "name")}: {wrestlers} wrestlers{(Kit.Bool(draft, "settings.draftStaff") ? $", {Kit.Num(roster, "staff")} staff" : string.Empty)}{(Kit.Bool(roster, "done") ? ", done" : string.Empty)}. Click to see their picks.");
            return row;
        }

        /// <summary>A promotion's picks in a side sheet (<c>draft.state {rosterOf}</c>).</summary>
        public async void OpenRoster(JToken roster)
        {
            string promotionId = Kit.Str(roster, "promotionId");
            QueryResult<JToken> state = await Kit.Game.Client.Query("draft.state", new JObject { ["recent"] = 0, ["rosterOf"] = promotionId });
            VisualElement content = Ds.Column("dr-sheet").Named("draft-roster-sheet");
            DraftScreen.Style(content);
            List<JToken> picks = state.Ok ? Kit.Arr(state.Data, "draft.roster.picks").ToList() : new List<JToken>();
            if (picks.Count == 0) content.Add(Ds.Text("No picks yet.", "dr-quiet"));
            foreach (JToken pick in picks) content.Add(PickRow(pick));
            DsOverlay.SideSheet(Root, Kit.Str(roster, "name"), content, "DRAFTED SO FAR");
        }

        // ---- The pool -------------------------------------------------------------------------------

        private IEnumerable<DsColumn<JToken>> Columns()
        {
            yield return new DsColumn<JToken>("name", "Name", row =>
                    W.NameCell(Kit.Str(row, "name"), DraftPictures.ImageRef(Kit.Str(row, "personId")), Kit.Str(row, "alignment"), false, Detail(row)))
                { Grow = 3f, MinWidth = 200f, SortKey = row => Kit.Str(row, "name"), Pinned = true };
            yield return new DsColumn<JToken>("value", "Value", ValueCell)
                { Width = 120f, Grow = 0f, SortKey = row => Kit.Num(row, "value") ?? 0, Help = "Draft value, 0 to 100: skill in the job, popularity, and a little for youth." };
            yield return new DsColumn<JToken>("fit", "Fit", FitCell)
                { Width = 130f, Grow = 0f, SortKey = row => Kit.Num(row, "fit") ?? 0, Help = "How well they fill your roster's needs: gender, divisions, style and faces against heels." };
            yield return DsColumn<JToken>.Text("style", "Style", row => Kit.Str(row, "category") == "staff" ? W.RoleWord(Kit.Str(row, "role")) : W.StyleWord(Kit.Str(row, "style")));
            yield return new DsColumn<JToken>("age", "Age", row => W.Cell(W.Int(Kit.Num(row, "age")), number: true))
                { Width = 60f, Grow = 0f, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "age") ?? 0 };
            yield return new DsColumn<JToken>("rating", "Skill", row => W.Cell(Kit.Decimal1(Kit.Num(row, "rating")), number: true))
                { Width = 70f, Grow = 0f, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "rating") ?? 0, Default = false };
            yield return new DsColumn<JToken>("popularity", "Popularity", row => W.Cell(Kit.Decimal1(Kit.Num(row, "popularity.best")), number: true))
                { Width = 90f, Grow = 0f, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "popularity.best") ?? 0, Default = false, Help = "Popularity in their best country." };
            yield return new DsColumn<JToken>("pick", string.Empty, PickCell) { Width = 96f, Grow = 0f, Pinned = true };
        }

        private static string Detail(JToken row)
        {
            if (Kit.Str(row, "category") == "staff") return W.RoleWord(Kit.Str(row, "role"));
            return $"{DraftText.GenderWord(Kit.Str(row, "gender"))} · {DraftText.WeightClassWord(Kit.Str(row, "weightClass"))}";
        }

        private VisualElement ValueCell(JToken row)
        {
            double value = Kit.Num(row, "value") ?? 0;
            (DsState state, string word) = DraftText.Value(value);
            VisualElement cell = Ds.Row("dr-value");
            cell.Add(Ds.Text(Kit.Decimal1(value), "dr-value__number"));
            cell.Add(Ds.Dot(state, word));
            Ds.Why(cell, new WhyBreakdown("Draft value", Kit.Decimal1(value), $"{Kit.Str(row, "name")}'s draft value, from public facts only.",
                DraftText.WhyLines(Kit.Arr(row, "why").Select(line => (string)line))));
            return cell;
        }

        private VisualElement FitCell(JToken row)
        {
            double value = Kit.Num(row, "value") ?? 0;
            double? fit = Kit.Num(row, "fit");
            (DsState state, string word) = DraftText.Fit(value, fit);
            VisualElement cell = Ds.Row("dr-fit");
            cell.Add(Ds.Dot(state, word));
            if (fit != null)
            {
                Ds.Why(cell, new WhyBreakdown("Fit for your roster", Kit.Decimal1(fit), "Their draft value plus what your roster needs.",
                    DraftText.WhyLines(Kit.Arr(row, "fitWhy").Select(line => (string)line))));
            }
            return cell;
        }

        private VisualElement PickCell(JToken row)
        {
            bool can = Status == "running" && YourTurn && !animating;
            Button button = Ds.Button("Draft", () => ConfirmPick(row), can ? DsButtonKind.Primary : DsButtonKind.Ghost);
            button.name = "draft-pick-" + Kit.Str(row, "personId");
            button.SetEnabled(can);
            if (!can) DsTooltip.Attach(button, Status == "running" ? "Not your pick yet: Sim to my pick." : "The picks are over.");
            return button;
        }

        private void DrawToolbar()
        {
            toolbar.Clear();
            toolbar.Add(W.Search("Search the pool…", search, text =>
            {
                search = text;
                page = 0;
                int ticket = ++searchTicket;
                Root.schedule.Execute(() =>
                {
                    if (ticket == searchTicket) _ = RenderPool();
                }).StartingIn(250);
            }, "draft-search"));

            VisualElement genders = Ds.Row("dr-chips").Named("draft-gender");
            foreach ((string value, string label) in new[] { ((string)null, "Everyone"), ("male", "Men"), ("female", "Women") })
            {
                string target = value;
                Button chip = Ds.Chip(label, gender == value, () => SetFilter(() => gender = target));
                chip.name = "draft-gender-" + (value ?? "any");
                genders.Add(chip);
            }
            toolbar.Add(genders);

            Button division = ScreenDs.Picker(weightClass == null ? "Any division" : DraftText.WeightClassWord(weightClass),
                new[] { ("", "Any division", (string)null) }.Concat(DraftText.WeightClasses.Select(entry => (entry, DraftText.WeightClassWord(entry), (string)null))).ToList(),
                picked => SetFilter(() => weightClass = string.IsNullOrEmpty(picked) ? null : picked), name: "draft-division");
            toolbar.Add(division);
            Button styles = ScreenDs.Picker(style == null ? "Any style" : W.StyleWord(style),
                new[] { ("", "Any style", (string)null) }.Concat(W.Styles.Where(entry => entry != "nonWrestler").Select(entry => (entry, W.StyleWord(entry), (string)null))).ToList(),
                picked => SetFilter(() => style = string.IsNullOrEmpty(picked) ? null : picked), name: "draft-style");
            toolbar.Add(styles);
            if (Kit.Bool(draft, "settings.draftStaff"))
            {
                Button kind = ScreenDs.Picker(category == null ? "Wrestlers and staff" : category == "staff" ? "Staff" : "Wrestlers",
                    new List<(string, string, string)> { ("", "Wrestlers and staff", null), ("wrestler", "Wrestlers", null), ("staff", "Staff", null) },
                    picked => SetFilter(() => category = string.IsNullOrEmpty(picked) ? null : picked), name: "draft-category");
                toolbar.Add(kind);
            }
            if (gender != null || weightClass != null || style != null || category != null)
            {
                Button clear = Ds.Button("Clear", () => SetFilter(() => { gender = null; weightClass = null; style = null; category = null; }), DsButtonKind.Ghost);
                clear.name = "draft-clear-filters";
                toolbar.Add(clear);
            }
            toolbar.Add(Ds.Spacer());
            toolbar.Add(poolCount);
            Button columns = Ds.IconButton("columns", "Columns", () => table.OpenColumnPicker(toolbar), quiet: true);
            columns.name = "draft-columns";
            toolbar.Add(columns);
        }

        private void SetFilter(Action change)
        {
            change();
            page = 0;
            DrawToolbar();
            _ = RenderPool();
        }

        /// <summary>Reads and draws one page of the pool (<c>draft.pool</c>, about 150 ms in a huge world).</summary>
        private async Task RenderPool()
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null || Status == "finished") return;
            var args = new JObject
            {
                ["offset"] = page * PageSize,
                ["limit"] = PageSize,
                ["sort"] = sort,
                ["descending"] = descending,
            };
            if (!string.IsNullOrWhiteSpace(search)) args["search"] = search.Trim();
            if (gender != null) args["gender"] = gender;
            if (weightClass != null) args["weightClass"] = weightClass;
            if (style != null) args["style"] = style;
            if (category != null) args["category"] = category;
            QueryResult<JToken> pool = await game.Client.Query("draft.pool", args);
            if (Root.panel == null) return;
            pager.Clear();
            if (!pool.Ok)
            {
                PoolRows = Array.Empty<JToken>();
                table.SetRows(PoolRows);
                pager.Add(Ds.Empty("users", "The pool could not be read", Kit.Reasons(pool.Reasons)));
                return;
            }
            PoolRows = Kit.Arr(pool.Data, "rows").ToList();
            int total = (int)(Kit.Num(pool.Data, "total") ?? PoolRows.Count);
            table.ShowSort(sort, descending);
            table.SetRows(PoolRows);
            int from = total == 0 ? 0 : page * PageSize + 1;
            int to = page * PageSize + PoolRows.Count;
            poolCount.text = total == 0 ? "Nobody matches" : $"{TextFormat.Number(from)}–{TextFormat.Number(to)} of {TextFormat.Number(total)}";
            if (total == 0)
            {
                pager.Add(Ds.Empty("search", "Nobody in the pool matches", "Clear a filter or the search."));
                return;
            }
            int pages = (int)Math.Ceiling(total / (double)PageSize);
            if (pages <= 1) return;
            Button prev = Ds.Button("Previous", () => { page--; _ = RenderPool(); }, DsButtonKind.Secondary, "chevron-left");
            prev.name = "draft-pool-prev";
            prev.SetEnabled(page > 0);
            pager.Add(prev);
            pager.Add(Ds.Text($"Page {page + 1} of {pages}", "dr-quiet"));
            Button next = Ds.Button("Next", () => { page++; _ = RenderPool(); }, DsButtonKind.Secondary, "chevron-right");
            next.name = "draft-pool-next";
            next.SetEnabled(page < pages - 1);
            pager.Add(next);
        }

        // ---- Actions --------------------------------------------------------------------------------

        private OverlayHandle confirm;

        /// <summary>Asks before drafting (Draft in the row); the tour presses the dialog's Draft button.</summary>
        public void ConfirmPick(JToken row)
        {
            string personId = Kit.Str(row, "personId");
            string name = Kit.Str(row, "name");
            VisualElement content = Ds.Column("dr-confirm").Named("draft-confirm");
            DraftScreen.Style(content);
            VisualElement who = Ds.Row("dr-confirm__who");
            who.Add(W.Portrait(DraftPictures.ImageRef(personId), Kit.Str(row, "alignment"), "ds-portrait--md", false, name));
            VisualElement words = Ds.Column("dr-confirm__words");
            words.Add(Ds.Text(name, "ds-type-subtitle"));
            words.Add(Ds.Text($"{Detail(row)} · {W.StyleWord(Kit.Str(row, "style"))} · age {W.Int(Kit.Num(row, "age"))}", "dr-quiet"));
            (DsState fitState, string fitWord) = DraftText.Fit(Kit.Num(row, "value") ?? 0, Kit.Num(row, "fit"));
            VisualElement facts = Ds.Row("dr-confirm__facts");
            facts.Add(Ds.Text($"Value {Kit.Decimal1(Kit.Num(row, "value"))}", "dr-confirm__fact"));
            facts.Add(Ds.Dot(fitState, fitWord));
            words.Add(facts);
            who.Add(words);
            content.Add(who);
            content.Add(Ds.Text(NegotiateAfter
                ? "They join unsigned: you hold their rights for a while and negotiate their contract after the draft."
                : "They sign a one-season contract at their asking price.", "dr-confirm__note"));
            confirm = DsOverlay.Modal(Root, $"Draft {name}?", content,
                ("Cancel", DsButtonKind.Ghost, null),
                ("Draft", DsButtonKind.Primary, () => _ = Pick(personId, name)));
            NameModalButtons(confirm, "draft-confirm-cancel", "draft-confirm-go");
        }

        private static void NameModalButtons(OverlayHandle handle, string cancel, string go)
        {
            List<Button> buttons = handle?.Content?.Query<Button>().ToList() ?? new List<Button>();
            List<Button> footer = buttons.Where(button => button.parent != null && button.parent.ClassListContains("ds-modal__footer")).ToList();
            if (footer.Count >= 2)
            {
                footer[0].name = cancel;
                footer[footer.Count - 1].name = go;
            }
        }

        /// <summary>Drafts one person (the dialog's Draft; the tour calls it too). Null when it worked, else why not.</summary>
        public async Task<string> Pick(string personId, string name = null)
        {
            CommandResult<JToken> result = await Kit.Run("draft.pick", new JObject { ["personId"] = personId }, feedback);
            if (!result.Ok) return Kit.Reasons(result.Reasons);
            DsOverlay.Toast(Root, $"You drafted {name ?? "them"}.", DsState.Good);
            return null;
        }

        /// <summary>
        /// Sim to my pick: the rivals pick a few at a time so the ticker shows them going, about eight
        /// steps however long the wait (Skip ahead jumps to the end).
        /// </summary>
        public async Task SimToMyPick()
        {
            if (animating || draft == null) return;
            animating = true;
            skipAnimation = false;
            try
            {
                for (int step = 0; step < 400 && Root.panel != null; step++)
                {
                    await RenderState();
                    if (draft == null || Status != "running" || YourTurn) break;
                    JToken next = draft["yourNextTurn"];
                    int away = next != null && next.Type == JTokenType.Object ? (int)(Kit.Num(next, "picksAway") ?? 0) : 1000;
                    var args = new JObject();
                    if (!skipAnimation) args["maxPicks"] = DraftText.SimStep(away);
                    CommandResult<JToken> result = await Kit.Run("draft.simToMyPick", args, feedback);
                    if (!result.Ok) break;
                    if (!skipAnimation) await Task.Delay(220);
                }
            }
            finally
            {
                animating = false;
                skipAnimation = false;
            }
            if (Root.panel != null) await Render();
        }

        private void ConfirmAutoPick()
        {
            VisualElement content = Ds.Column("dr-confirm");
            DraftScreen.Style(content);
            content.Add(Ds.Text("The computer makes every remaining pick, yours too: the best value for what each roster needs. You can still finish and sign afterwards.", "dr-confirm__note"));
            confirm = DsOverlay.Modal(Root, "Auto-pick the rest?", content,
                ("Cancel", DsButtonKind.Ghost, null),
                ("Auto-pick", DsButtonKind.Primary, () => _ = AutoPickRest()));
            NameModalButtons(confirm, "draft-auto-cancel", "draft-auto-go");
        }

        /// <summary>Every remaining pick, yours too (<c>draft.autoPickRest</c>). Null when it worked.</summary>
        public async Task<string> AutoPickRest()
        {
            CommandResult<JToken> result = await Kit.Run("draft.autoPickRest", new JObject(), feedback);
            if (!result.Ok) return Kit.Reasons(result.Reasons);
            DsOverlay.Toast(Root, $"{Kit.Num(result.Data, "picksMade")} picks made.", DsState.Good);
            return null;
        }

        /// <summary>Closes the draft (<c>draft.finish</c>). Null when it worked.</summary>
        public async Task<string> Finish()
        {
            CommandResult<JToken> result = await Kit.Run("draft.finish", new JObject(), feedback);
            if (!result.Ok) return Kit.Reasons(result.Reasons);
            return null;
        }

        // ---- Finished ---------------------------------------------------------------------------

        private void DrawFinished()
        {
            List<JToken> picks = Kit.Arr(draft, "roster.picks").ToList();
            List<JToken> unsigned = picks.Where(pick => Kit.Str(pick, "contract") == "reserved").ToList();

            VisualElement summary = Ds.Row("dr-finished__summary");
            summary.Add(Ds.StatTile("Your picks", TextFormat.Number(picks.Count)));
            summary.Add(Ds.StatTile("Signed", TextFormat.Number(picks.Count(pick => Kit.Str(pick, "contract") == "signed")), null, DsState.Good));
            if (NegotiateAfter) summary.Add(Ds.StatTile("Unsigned", TextFormat.Number(unsigned.Count), unsigned.Count > 0 ? "Sign them" : null, unsigned.Count > 0 ? DsState.Warn : DsState.Neutral));
            finishedHost.Add(summary);

            if (NegotiateAfter && unsigned.Count > 0)
            {
                VisualElement sign = Ds.Column("dr-panel").Named("draft-sign");
                sign.Add(Ds.SectionHeader("Sign your draftees"));
                string until = Kit.Str(unsigned[0], "reservedUntil");
                sign.Add(Ds.Text($"You hold their rights{(until != null ? " until " + Kit.Date(until) : string.Empty)}. Offer each one a contract (they can say no), or release them back to the pool.", "dr-quiet", "t-wrap"));
                foreach (JToken pick in unsigned) sign.Add(SignRow(pick));
                Button contracts = Ds.Button("Open Contracts", () => context.Navigator.Go(ShellRoute.With(ContractsScreen.ScreenId, "tab", ContractsScreen.TabOffers)), DsButtonKind.Secondary, "contracts");
                contracts.name = "draft-open-contracts";
                DsTooltip.Attach(contracts, "Your offers and their answers. Answers come in over the next days.");
                sign.Add(contracts);
                finishedHost.Add(sign);
            }

            VisualElement roster = Ds.Column("dr-panel").Named("draft-final-roster");
            roster.Add(Ds.SectionHeader("Your draft class"));
            VisualElement list = Ds.Column("dr-roster-list", "dr-roster-list--wide");
            foreach (JToken pick in picks) list.Add(PickRow(pick));
            roster.Add(list);
            finishedHost.Add(roster);

            VisualElement actions = Ds.Row("dr-finished__actions");
            SkewButton office = Ds.Cta("Go to the office", () => context.Navigator.Go(NavigationModel.HomeItemId), "office");
            office.name = "draft-go-office";
            actions.Add(office);
            finishedHost.Add(actions);
        }

        private VisualElement SignRow(JToken pick)
        {
            string personId = Kit.Str(pick, "personId");
            string name = Kit.Str(pick, "name");
            VisualElement row = PickRow(pick);
            row.AddToClassList("dr-sign-row");
            row.Add(Ds.Spacer());
            Button offer = Ds.Button("Offer contract", async () =>
            {
                string problem = await ContractsScreen.OpenNegotiation(personId, "auto");
                if (problem != null) DsOverlay.Toast(Root, problem, DsState.Warn);
            }, DsButtonKind.Primary, "contracts");
            offer.name = "draft-offer-" + personId;
            row.Add(offer);
            Button release = Ds.Button("Release", () => ConfirmRelease(personId, name), DsButtonKind.Ghost);
            release.name = "draft-release-" + personId;
            row.Add(release);
            return row;
        }

        private void ConfirmRelease(string personId, string name)
        {
            VisualElement content = Ds.Column("dr-confirm");
            DraftScreen.Style(content);
            content.Add(Ds.Text($"{name} goes back to the pool as a free agent. Any promotion can sign them then.", "dr-confirm__note"));
            confirm = DsOverlay.Modal(Root, $"Release {name}?", content,
                ("Keep", DsButtonKind.Ghost, null),
                ("Release", DsButtonKind.Danger, () => _ = Release(personId, name)));
            NameModalButtons(confirm, "draft-release-cancel", "draft-release-go");
        }

        /// <summary>Gives an unsigned pick back (<c>draft.release</c>). Null when it worked.</summary>
        public async Task<string> Release(string personId, string name = null)
        {
            CommandResult<JToken> result = await Kit.Run("draft.release", new JObject { ["personId"] = personId }, feedback);
            if (!result.Ok) return Kit.Reasons(result.Reasons);
            DsOverlay.Toast(Root, $"{name ?? "They"} went back to the pool.", DsState.Neutral);
            return null;
        }
    }
}
