using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Promotions (UNITY-15; the web's PromotionsScreen): every promotion in the world from
    /// <c>promotions.list</c> as a compact table with logos, size, home, style, popularity (Why?),
    /// prestige, roster, champions and who runs it. Yours is pinned on top. A row opens
    /// <see cref="PromotionProfileScreen"/>.
    /// </summary>
    public static class PromotionsScreen
    {
        /// <summary>The profile's screen id (not in the sidebar): <c>promotion?id=…&amp;tab=…</c>.</summary>
        public const string ProfileId = ScreenIds.Promotion;

        private static string search = string.Empty;
        private static string scope;

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement page = W.Page("promotions");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("promotions.list");
            host.Clear();
            if (!answer.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            List<JToken> all = Kit.Arr(answer.Data).ToList();
            Remember(all);
            int active = all.Count(p => Kit.Str(p, "status") == "active");
            host.Add(W.Head("Promotions", $"{all.Count} promotions in the world · {active} running shows", out _));

            VisualElement bar = Ds.Row("wl-toolbar");
            var tabs = new DsTabs();
            tabs.Add("all", "All", all.Count)
                .Add("rivals", "Rivals", all.Count(p => Kit.Str(p, "controlledBy") != "you"))
                .Add("closed", "Closed", all.Count(p => Kit.Str(p, "status") != "active"));
            tabs.Select(scope ?? "all", false);
            tabs.name = "promotions-tabs";
            VisualElement body = Ds.Column("wl-body");
            void Redraw() => Draw(body, all, context);
            tabs.Selected += picked =>
            {
                scope = picked;
                Redraw();
            };
            bar.Add(tabs);
            bar.Add(Ds.Spacer());
            bar.Add(W.Search("Search promotions", search, text =>
            {
                search = text;
                Redraw();
            }, "promotions-search"));
            host.Add(bar);
            host.Add(body);
            Redraw();
        }

        private static void Draw(VisualElement body, List<JToken> all, ScreenContext context)
        {
            body.Clear();
            IEnumerable<JToken> list = all;
            if (scope == "rivals") list = list.Where(p => Kit.Str(p, "controlledBy") != "you");
            else if (scope == "closed") list = list.Where(p => Kit.Str(p, "status") != "active");
            if (!string.IsNullOrWhiteSpace(search))
            {
                string needle = search.Trim();
                list = list.Where(p => (Kit.Str(p, "name") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0
                    || (Kit.Str(p, "shortName") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            List<JToken> rows = list.OrderByDescending(p => Kit.Str(p, "controlledBy") == "you")
                .ThenByDescending(p => Kit.Num(p, "size.reach") ?? 0).ToList();
            if (rows.Count == 0)
            {
                body.Add(W.Empty("building", "No promotions match.", "Try another name."));
                return;
            }

            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Promotion", NameCell) { Grow = 2.6f, MinWidth = 260, Pinned = true, SortKey = p => Kit.Str(p, "name") },
                new DsColumn<JToken>("size", "Size", p => SizeCell(p)) { Grow = 1.2f, MinWidth = 140, SortKey = p => Kit.Num(p, "size.reach") ?? 0, Help = "How far its shows and TV reach: Local, Regional, National, Continental, Global." },
                new DsColumn<JToken>("home", "Home", p => W.Cell($"{Kit.Str(p, "homeRegion.name")}, {Kit.Str(p, "homeCountry.name")}")) { Grow = 1.6f, MinWidth = 160, SortKey = p => Kit.Str(p, "homeCountry.name") },
                new DsColumn<JToken>("popularity", "Popularity", p =>
                {
                    double value = Kit.Num(p, "popularity.home.value") ?? 0;
                    (DsState state, string word) = W.Popularity(value);
                    return W.DotNumber(state, word, W.Int(value), Kit.WhyTrace($"{Kit.Str(p, "shortName")} popularity at home", value, Kit.Obj(p, "popularity.home.trace")));
                }) { Grow = 1.3f, MinWidth = 150, SortKey = p => Kit.Num(p, "popularity.home.value") ?? 0, Help = "How well known it is in its home country." },
                new DsColumn<JToken>("prestige", "Prestige", p => W.Cell(W.Int(Kit.Num(p, "prestige")), number: true)) { Width = 90, Align = DsAlign.Right, SortKey = p => Kit.Num(p, "prestige") ?? 0 },
                new DsColumn<JToken>("roster", "Roster", p => W.Cell(W.Int(Kit.Num(p, "rosterCount")), number: true)) { Width = 80, Align = DsAlign.Right, SortKey = p => Kit.Num(p, "rosterCount") ?? 0 },
                new DsColumn<JToken>("champions", "Titles", p => W.Cell(Kit.Arr(p, "champions").Count().ToString(), number: true)) { Width = 70, Align = DsAlign.Right, SortKey = p => Kit.Arr(p, "champions").Count() },
                new DsColumn<JToken>("runby", "Run by", RunByCell) { Grow = 1f, MinWidth = 120, SortKey = p => Kit.Str(p, "controlledBy") },
                new DsColumn<JToken>("style", "Style", p => W.Cell(W.PromotionStyleWord(Kit.Str(p, "style")))) { Grow = 1f, Default = false, SortKey = p => Kit.Str(p, "style") },
                new DsColumn<JToken>("world", "Worldwide", p => W.Cell(W.Int(Kit.Num(p, "popularity.world")), number: true)) { Width = 100, Align = DsAlign.Right, Default = false, SortKey = p => Kit.Num(p, "popularity.world") ?? 0 },
                new DsColumn<JToken>("crew", "Crew", p => W.Cell(W.Int(Kit.Num(p, "crewCount")), number: true)) { Width = 70, Align = DsAlign.Right, Default = false, SortKey = p => Kit.Num(p, "crewCount") ?? 0 },
                new DsColumn<JToken>("brands", "Brands", p => W.Cell(W.Int(Kit.Num(p, "brandCount")), number: true)) { Width = 80, Align = DsAlign.Right, Default = false, SortKey = p => Kit.Num(p, "brandCount") ?? 0 },
                new DsColumn<JToken>("cash", "Cash", p => W.Cell(Kit.Str(p, "cash.kind") == "exact" ? W.Money(Kit.Num(p, "cash.value")) : "Private", number: true)) { Width = 130, Align = DsAlign.Right, Default = false, SortKey = p => Kit.Num(p, "cash.value") ?? -1 },
            };
            var table = new DsTable<JToken>(columns, rows) { name = "promotions-table" };
            table.RowClicked += p => context.Navigator.Go(ShellRoute.With(ProfileId, "id", Kit.Str(p, "promotionId")));
            body.Add(table);
        }

        private static VisualElement NameCell(JToken promotion)
        {
            VisualElement cell = Ds.Row("wl-name-cell");
            cell.Add(W.Logo(Kit.Str(promotion, "logoRef"), Kit.Str(promotion, "shortName"), Kit.Str(promotion, "color"), "wl-logo--row"));
            VisualElement words = Ds.Column("wl-name-cell__words");
            words.Add(Ds.Text(Kit.Str(promotion, "name"), "ds-cell__text", "ds-cell__text--strong", "wl-name-cell__name"));
            cell.Add(words);
            return cell;
        }

        public static VisualElement SizeCell(JToken promotion)
        {
            string label = Kit.Str(promotion, "size.label") ?? Kit.NoValue;
            double reach = Kit.Num(promotion, "size.reach") ?? 0;
            DsState state = reach >= 70 ? DsState.Gold : reach >= 45 ? DsState.Info : DsState.Neutral;
            VisualElement cell = Ds.Row("wl-dot-num");
            cell.Add(Ds.Meter((float)(reach / 100.0), state, label));
            cell.AddToClassList("wl-size-cell");
            return cell;
        }

        private static VisualElement RunByCell(JToken promotion)
        {
            string by = Kit.Str(promotion, "controlledBy");
            if (Kit.Str(promotion, "status") != "active") return Ds.Dot(DsState.Neutral, W.Words(Kit.Str(promotion, "status")));
            return by == "you" ? Ds.Pill(DsState.Live, "You", "user") : by == "human" ? Ds.Dot(DsState.Info, Kit.Str(promotion, "controllerName") ?? "Another player") : Ds.Dot(DsState.Neutral, "Computer");
        }

        // ---- Logos cache ---------------------------------------------------------------------------

        private static EngineGame cachedFor;
        private static readonly Dictionary<string, (string logoRef, string shortName, string color)> Known = new Dictionary<string, (string, string, string)>();
        private static Task<QueryResult<JToken>> pending;

        private static void Remember(IEnumerable<JToken> promotions)
        {
            if (cachedFor != Kit.Game)
            {
                cachedFor = Kit.Game;
                Known.Clear();
            }
            foreach (JToken p in promotions)
            {
                string id = Kit.Str(p, "promotionId");
                if (id != null) Known[id] = (Kit.Str(p, "logoRef"), Kit.Str(p, "shortName"), Kit.Str(p, "color"));
            }
        }

        /// <summary>The promotion's logo (picture, else a monogram on its colour) into <paramref name="slot"/>, once known.</summary>
        public static async void FillLogo(VisualElement slot, string promotionId, string shortName, string sizeClass)
        {
            if (slot == null || promotionId == null || Kit.Game == null) return;
            try
            {
                if (cachedFor != Kit.Game || !Known.ContainsKey(promotionId))
                {
                    pending ??= Kit.Game.Client.Query("promotions.list");
                    QueryResult<JToken> answer = await pending;
                    pending = null;
                    if (answer.Ok) Remember(Kit.Arr(answer.Data));
                }
                (string logoRef, string knownShort, string color) = Known.TryGetValue(promotionId, out var known) ? known : (null, shortName, null);
                slot.Clear();
                slot.Add(W.Logo(logoRef, knownShort ?? shortName, color, sizeClass));
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Promotions] logo: {exception.GetType().Name}");
            }
        }
    }

    /// <summary>
    /// A promotion's profile (UNITY-15; the web's PromotionProfileScreen over <c>promotions.profile</c>):
    /// logo, name and facts, KPI tiles with Why?s, then tabs Roster (<c>promotions.roster</c>), Shows
    /// (its shows and the last ones it ran, each linking to results), Titles, and Decisions (the
    /// rival desk's log, <c>aip.decisionLog</c>, with the Rival rules that apply to it).
    /// </summary>
    public static class PromotionProfileScreen
    {
        private static readonly (string id, string label)[] Tabs =
        {
            ("roster", "Roster"),
            ("shows", "Shows"),
            ("titles", "Titles"),
            ("decisions", "Decisions"),
        };

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement page = W.Page("promotion");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            string id = context.Route.Param("id") ?? Kit.Game.PromotionId;
            string tab = context.Route.Param("tab") ?? "roster";
            QueryResult<JToken> answer = id == null ? null : await client.Query("promotions.profile", new JObject { ["promotionId"] = id });
            host.Clear();
            if (answer == null || !answer.Ok)
            {
                host.Add(W.Head("Promotion", null, out _));
                host.Add(W.Empty("building", "That promotion isn't in the world.", answer == null ? null : Kit.Reasons(answer.Reasons)));
                host.Add(Ds.Button("All promotions", () => context.Navigator.Go(ShellRoute.To("promotions")), DsButtonKind.Secondary, "building"));
                return;
            }
            JToken profile = answer.Data;
            JToken header = Kit.Obj(profile, "header");

            VisualElement crumbs = Ds.Row("wl-crumbs");
            crumbs.Add(Ds.Button("Promotions", () => context.Navigator.Go(ShellRoute.To("promotions")), DsButtonKind.Ghost, "chevron-left"));
            host.Add(crumbs);

            VisualElement hero = Ds.Row("ds-row--top", "wl-hero", "wl-promo-hero");
            hero.Add(W.Logo(Kit.Str(header, "logoRef"), Kit.Str(header, "shortName"), Kit.Str(header, "color"), "ds-logo--xl"));
            VisualElement words = Ds.Column("wl-hero__words");
            words.Add(Ds.Text(TextFormat.Upper(Kit.Str(header, "name")), "ds-type-display", "wl-hero__name"));
            string by = Kit.Str(header, "controlledBy");
            words.Add(Ds.Text($"{W.PromotionStyleWord(Kit.Str(header, "style"))} · {Kit.Str(header, "homeRegion.name")}, {Kit.Str(header, "homeCountry.name")} · founded {Kit.Date(Kit.Str(header, "foundedOn"))}", "ds-type-caption"));
            VisualElement tags = Ds.Row("ds-row--wrap", "wl-hero__tags");
            tags.Add(by == "you" ? Ds.Pill(DsState.Live, "You run it", "user") : by == "human" ? Ds.Pill(DsState.Info, "Another player runs it", "user") : Ds.Pill(DsState.Neutral, "Run by the computer", "settings"));
            if (Kit.Str(header, "status") != "active") tags.Add(Ds.Pill(DsState.Warn, W.Words(Kit.Str(header, "status")), "warning"));
            foreach (JToken brand in Kit.Arr(header, "brands")) tags.Add(Ds.Tag(Kit.Str(brand, "name")));
            words.Add(tags);
            hero.Add(words);
            host.Add(hero);

            JToken kpis = Kit.Obj(profile, "kpis");
            VisualElement tiles = Ds.Row("ds-row--wrap", "wl-tile-row");
            double home = Kit.Num(kpis, "popularityHome.value") ?? 0;
            double world = Kit.Num(kpis, "popularityWorld.value") ?? 0;
            tiles.Add(WorkerProfileScreen.Tile("Popularity at home", W.Int(home), W.Popularity(home).word, W.Popularity(home).state,
                Kit.WhyTrace("Popularity at home", home, Kit.Obj(kpis, "popularityHome.trace"))));
            tiles.Add(WorkerProfileScreen.Tile("Worldwide", W.Int(world), W.Popularity(world).word, DsState.Neutral,
                Kit.WhyTrace("Popularity worldwide", world, Kit.Obj(kpis, "popularityWorld.trace"))));
            tiles.Add(WorkerProfileScreen.Tile("Prestige", W.Int(Kit.Num(kpis, "prestige")), "Out of 100", DsState.Gold, null));
            tiles.Add(WorkerProfileScreen.Tile("Roster", W.Int(Kit.Num(kpis, "rosterCount")), $"{W.Int(Kit.Num(kpis, "crewCount"))} crew · {W.Int(Kit.Num(kpis, "championCount"))} champions", DsState.Neutral, null));
            tiles.Add(WorkerProfileScreen.Tile("Shows", W.Int(Kit.Num(kpis, "showsPerMonth")), "in the next four weeks", DsState.Info, null));
            tiles.Add(Kit.Str(kpis, "cash.kind") == "exact"
                ? WorkerProfileScreen.Tile("Cash", TopBarView.CompactMoney((long)(Kit.Num(kpis, "cash.value") ?? 0)), "in the bank", DsState.Good, null)
                : WorkerProfileScreen.Tile("Cash", "Private", "Only its owner sees it", DsState.Neutral, null));
            host.Add(tiles);

            var tabs = new DsTabs();
            foreach ((string tabId, string label) in Tabs) tabs.Add(tabId, label);
            tabs.Select(tab, false);
            tabs.name = "promotion-tabs";
            tabs.Selected += picked => context.Navigator.Go(ShellRoute.With(PromotionsScreen.ProfileId, "id", id, "tab", picked));
            VisualElement bar = Ds.Row("wl-toolbar");
            bar.Add(tabs);
            host.Add(bar);

            VisualElement body = Ds.Column("wl-tab-body").Named($"promotion-tab-{tab}");
            host.Add(body);
            switch (tab)
            {
                case "shows": await Shows(body, profile, id, context); break;
                case "titles": Titles(body, profile); break;
                case "decisions": await Decisions(body, profile, id); break;
                default: await Roster(body, id, context); break;
            }
        }

        private static async Task Roster(VisualElement body, string id, ScreenContext context)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("promotions.roster", new JObject { ["promotionId"] = id });
            if (!answer.Ok)
            {
                body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            if (Kit.Str(answer.Data, "taste.label") is string taste)
            {
                VisualElement line = Ds.Row("ds-row--wrap", "wl-attention");
                line.Add(W.Label("What they like"));
                line.Add(Ds.Pill(DsState.Info, taste, "sparkles"));
                foreach (JToken axis in Kit.Arr(answer.Data, "taste.axes").Take(4))
                {
                    VisualElement pill = Ds.Pill(DsState.Neutral, $"{Kit.Str(axis, "label")} {W.Int(Kit.Num(axis, "value"))}", "gauge");
                    line.Add(W.QuietWhy(pill, Kit.WhyTrace(Kit.Str(axis, "label"), Kit.Num(axis, "value") ?? 0, Kit.Obj(axis, "trace"))));
                }
                body.Add(line);
            }
            List<JToken> rows = Kit.Arr(answer.Data, "rows").OrderByDescending(r => W.PushRank(Kit.Str(r, "push"))).ThenByDescending(r => Kit.Num(r, "cardValue.value") ?? 0).ToList();
            if (rows.Count == 0)
            {
                body.Add(W.Empty("roster", "Nobody under contract.", null));
                return;
            }
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Name", r => W.NameCell(Kit.Str(r, "ringName"), Kit.Str(r, "imageRef"), Kit.Str(r, "alignment"), Kit.Bool(r, "isChampion"))) { Grow = 2.4f, MinWidth = 220, Pinned = true, SortKey = r => Kit.Str(r, "ringName") },
                new DsColumn<JToken>("role", "Position", r => W.Cell(W.PushWord(Kit.Str(r, "push")) ?? W.RoleWord(Kit.Str(r, "role")))) { Grow = 1.2f, SortKey = r => W.PushRank(Kit.Str(r, "push")) },
                new DsColumn<JToken>("side", "Side", r => W.SideTag(Kit.Str(r, "alignment"))) { Width = 80, SortKey = r => Kit.Str(r, "alignment") },
                new DsColumn<JToken>("overall", "Overall", r => W.Cell(W.Int(Kit.Num(r, "overall.value")), number: true)) { Width = 90, Align = DsAlign.Right, SortKey = r => Kit.Num(r, "overall.value") ?? 0 },
                new DsColumn<JToken>("value", "Card value", r =>
                {
                    double value = Kit.Num(r, "cardValue.value") ?? 0;
                    return W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell(W.Int(value), number: true)), Kit.WhyTrace("Card value", value, Kit.Obj(r, "cardValue.trace")));
                }) { Width = 120, Align = DsAlign.Right, SortKey = r => Kit.Num(r, "cardValue.value") ?? 0, Help = "How much this promotion's booker values them on a card." },
                new DsColumn<JToken>("condition", "Condition", r =>
                {
                    (DsState state, string word) = W.Condition(Kit.Str(r, "availability.status"), Kit.Str(r, "availability.reason"));
                    return Ds.Dot(state, word);
                }) { Grow = 1f, SortKey = r => Kit.Str(r, "availability.status") },
                new DsColumn<JToken>("ends", "Contract", r => W.Cell(Kit.Str(r, "endsOn") is string ends ? Kit.Date(ends) : "Open-ended")) { Grow = 1f, SortKey = r => Kit.Str(r, "endsOn") ?? "9999" },
            };
            var table = new DsTable<JToken>(columns, rows) { name = "promotion-roster" };
            table.RowClicked += r => WorkerSheet.Open(context, Kit.Str(r, "personId"), null);
            body.Add(table);
        }

        private static async Task Shows(VisualElement body, JToken profile, string id, ScreenContext context)
        {
            body.Add(Ds.SectionHeader("Regular shows"));
            if (id == Schedule.ScheduleEditor.OwnPromotionId)
            {
                // EVT8: your own promotion's schedule is edited from here and from the Calendar.
                VisualElement scheduleActions = Ds.Row("wl-toolbar");
                Schedule.ScheduleEditor.Style(scheduleActions);
                scheduleActions.Add(Schedule.ScheduleEditor.NewShowButton(context, "promotion-new-show"));
                scheduleActions.Add(Schedule.ScheduleEditor.ManageButton(context, "promotion-manage-shows"));
                body.Add(scheduleActions);
            }
            List<JToken> shows = Kit.Arr(profile, "shows").ToList();
            if (shows.Count == 0) body.Add(Ds.Text(id == Schedule.ScheduleEditor.OwnPromotionId ? "No regular shows yet. Add a weekly show to start your schedule." : "No regular shows.", "ds-type-caption"));
            VisualElement grid = Ds.Row("ds-row--wrap", "wl-show-tiles");
            foreach (JToken show in shows)
            {
                VisualElement tile = Ds.Column("wl-show-tile");
                tile.Add(Ds.Text(Kit.Str(show, "name"), "wl-show-tile__name"));
                tile.Add(Ds.Text(Kit.Str(show, "recurrenceLabel") ?? Kit.NoValue, "ds-type-caption"));
                VisualElement tags = Ds.Row("ds-row--wrap", "wl-hero__tags");
                tags.Add(Ds.Tag(W.Words(Kit.Str(show, "importance"))));
                if (Kit.Bool(show, "televised")) tags.Add(Ds.Tag("TV", "live"));
                tags.Add(Ds.Text($"{W.Int(Kit.Num(show, "slots"))} slots", "ds-type-caption"));
                tile.Add(tags);
                grid.Add(tile);
            }
            body.Add(grid);

            body.Add(Ds.SectionHeader("Last shows"));
            GameDate today = Kit.Game.ShellData.Snapshot.Date;
            QueryResult<JToken> range = await Kit.Game.Client.Query("calendar.range", new JObject { ["from"] = today.AddDays(-120).Iso, ["to"] = today.Iso, ["scope"] = "world" });
            List<JToken> past = Kit.Arr(range.Data, "shows").Where(s => Kit.Str(s, "promotion.id") == id && Kit.Str(s, "status") == "completed")
                .OrderByDescending(s => Kit.Str(s, "date")).Take(20).ToList();
            if (past.Count == 0)
            {
                body.Add(Ds.Text("No shows in the last four months.", "ds-type-caption"));
                return;
            }
            body.Add(EventHistoryScreen.Table(past, context, showPromotion: false));
        }

        private static void Titles(VisualElement body, JToken profile)
        {
            List<JToken> titles = Kit.Arr(profile, "titles").ToList();
            if (titles.Count == 0)
            {
                body.Add(W.Empty("titles", "No titles in use.", null));
                return;
            }
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Title", t => Ds.Row("wl-dot-num").With(new Icon("crown", "ds-icon--xs", "wl-crown-lead"), W.Cell(Kit.Str(t, "name"), strong: true))) { Grow = 2.2f, MinWidth = 240, SortKey = t => Kit.Str(t, "name") },
                new DsColumn<JToken>("holder", "Champion", t =>
                {
                    List<string> holders = Kit.Arr(t, "holderNames").Select(h => (string)h).ToList();
                    return holders.Count == 0 ? Ds.Pill(DsState.Warn, "Vacant", "warning") : W.Cell(string.Join(" & ", holders));
                }) { Grow = 2f, MinWidth = 200 },
                new DsColumn<JToken>("since", "Since", t => W.Cell(Kit.Str(t, "wonOn") is string won ? Kit.Date(won) : Kit.NoValue)) { Grow = 1f, SortKey = t => Kit.Str(t, "wonOn") ?? string.Empty },
            };
            body.Add(new DsTable<JToken>(columns, titles) { name = "promotion-titles" });
        }

        private static async Task Decisions(VisualElement body, JToken profile, string id)
        {
            if (!Kit.Bool(profile, "hasProfile"))
            {
                body.Add(W.Empty("log", "No decision log.", "Only promotions the computer runs keep one: it is the rival desk's diary."));
                return;
            }
            JToken rules = Kit.Obj(profile, "rules");
            VisualElement strip = Ds.Row("ds-row--wrap", "wl-attention");
            strip.Add(W.Label("Rival rules"));
            if (Kit.Bool(rules, "levelPlayingField")) strip.Add(Ds.Pill(DsState.Good, "Level playing field: no shortcuts", "check"));
            else
            {
                foreach (JToken shortcut in Kit.Arr(rules, "shortcuts").Where(s => Kit.Bool(s, "on")))
                {
                    VisualElement pill = Ds.Pill(DsState.Info, Kit.Str(shortcut, "label"), "info");
                    strip.Add(W.QuietWhy(pill, Kit.WhyTrace(Kit.Str(shortcut, "label"), 1, Kit.Obj(shortcut, "trace"))));
                }
            }
            body.Add(strip);

            QueryResult<JToken> answer = await Kit.Game.Client.Query("aip.decisionLog", new JObject { ["promotionId"] = id });
            if (!answer.Ok)
            {
                body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            List<JToken> entries = Kit.Arr(answer.Data, "entries").ToList();
            if (entries.Count == 0)
            {
                body.Add(W.Empty("log", "Nothing decided lately.", Kit.Str(answer.Data, "keptNote")));
                return;
            }
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("date", "Date", e => W.Cell(Kit.Date(Kit.Str(e, "date")))) { Width = 120, SortKey = e => Kit.Str(e, "date") },
                new DsColumn<JToken>("kind", "Kind", e => Ds.Tag(Kit.Str(e, "chip") ?? W.Words(Kit.Str(e, "kind")))) { Width = 130, SortKey = e => Kit.Str(e, "kind") },
                new DsColumn<JToken>("text", "What they decided", e =>
                {
                    VisualElement cell = Ds.Row("wl-dot-num");
                    cell.Add(W.Cell(Kit.Str(e, "text")));
                    return W.QuietWhy(cell, Kit.WhyRef("Decision", 0, Kit.Obj(e, "traceRef"), null, "Why they decided this"));
                }) { Grow = 4f, MinWidth = 320 },
            };
            body.Add(new DsTable<JToken>(columns, entries) { name = "promotion-decisions" });
            if (Kit.Str(answer.Data, "keptNote") is string kept) body.Add(Ds.Text(kept, "ds-type-caption", "wl-gap-top"));
        }
    }
}
