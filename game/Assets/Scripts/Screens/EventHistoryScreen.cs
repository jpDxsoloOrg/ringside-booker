using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Event history (UNITY-15): the shows the world has run, newest first, from
    /// <c>calendar.range</c> (scope world, completed only) over the last 30 days, 90 days or year.
    /// Search by show or promotion, filter yours or one promotion, and every row opens that show's
    /// results (<c>show-results?event=…</c>, which reads <c>shows.results</c> for any promotion).
    /// The web has this page as a placeholder; the data is the calendar's.
    /// </summary>
    public static class EventHistoryScreen
    {
        private static readonly (string id, string label, int days)[] Ranges =
        {
            ("30", "Last 30 days", 30),
            ("90", "Last 90 days", 90),
            ("365", "Last year", 365),
        };

        private static string range = "90";
        private static string scope = "all";
        private static string promotionFilter;
        private static string search = string.Empty;

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement page = W.Page("event-history");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            GameDate today = Kit.Game.ShellData.Snapshot.Date;
            int days = Ranges.First(r => r.id == range).days;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.range",
                new JObject { ["from"] = today.AddDays(-days).Iso, ["to"] = today.Iso, ["scope"] = "world" });
            host.Clear();
            if (!answer.Ok)
            {
                host.Add(W.Head("Event history", null, out _));
                host.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            List<JToken> shows = Kit.Arr(answer.Data, "shows").Where(s => Kit.Str(s, "status") == "completed").ToList();
            int promotions = shows.Select(s => Kit.Str(s, "promotion.id")).Distinct().Count();

            var rangeSwitch = new DsTabs(segmented: true);
            foreach ((string id, string label, int _) in Ranges) rangeSwitch.Add(id, label);
            rangeSwitch.Select(range, false);
            rangeSwitch.name = "history-range";
            rangeSwitch.Selected += picked =>
            {
                range = picked;
                context.Navigator.Go(ShellRoute.To("event-history"));
            };
            host.Add(W.Head("Event history", $"{shows.Count} shows by {promotions} promotions · {Ranges.First(r => r.id == range).label.ToLowerInvariant()}", out _, rangeSwitch));

            VisualElement bar = Ds.Row("wl-toolbar");
            var tabs = new DsTabs();
            tabs.Add("all", "All shows", shows.Count).Add("mine", "Yours", shows.Count(s => Kit.Bool(s, "isOwn")))
                .Add("big", "Big shows", shows.Count(s => IsBig(Kit.Str(s, "importance"))));
            tabs.Select(scope, false);
            tabs.name = "history-tabs";
            VisualElement body = Ds.Column("wl-body");
            void Redraw() => Draw(body, shows, context);
            tabs.Selected += picked =>
            {
                scope = picked;
                Redraw();
            };
            bar.Add(tabs);
            bar.Add(Ds.Spacer());
            bar.Add(W.Search("Search shows", search, text =>
            {
                search = text;
                Redraw();
            }, "history-search"));
            Button filter = Ds.Button("Promotion", null, DsButtonKind.Secondary, "filter");
            filter.name = "history-filter";
            filter.clicked += () =>
            {
                VisualElement content = Ds.Column("wl-filters");
                var options = shows.GroupBy(s => Kit.Str(s, "promotion.id"))
                    .Select(g => (g.Key, Kit.Str(g.First(), "promotion.shortName") ?? Kit.Str(g.First(), "promotion.name")))
                    .OrderBy(o => o.Item2).ToList();
                OverlayHandle handle = null;
                content.Add(W.FilterGroup("Promotion", options, promotionFilter, value =>
                {
                    promotionFilter = value;
                    handle?.Close();
                    Redraw();
                }));
                handle = DsOverlay.Popover(filter, content);
            };
            bar.Add(filter);
            host.Add(bar);
            host.Add(body);
            Redraw();
        }

        private static bool IsBig(string importance) => importance == "major" || importance == "flagship";

        private static void Draw(VisualElement body, List<JToken> shows, ScreenContext context)
        {
            body.Clear();
            IEnumerable<JToken> list = shows;
            if (scope == "mine") list = list.Where(s => Kit.Bool(s, "isOwn"));
            else if (scope == "big") list = list.Where(s => IsBig(Kit.Str(s, "importance")));
            if (promotionFilter != null) list = list.Where(s => Kit.Str(s, "promotion.id") == promotionFilter);
            if (!string.IsNullOrWhiteSpace(search))
            {
                string needle = search.Trim();
                list = list.Where(s => (Kit.Str(s, "name") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0
                    || (Kit.Str(s, "promotion.name") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            List<JToken> rows = list.ToList();
            if (promotionFilter != null)
            {
                string name = shows.Where(s => Kit.Str(s, "promotion.id") == promotionFilter).Select(s => Kit.Str(s, "promotion.name")).FirstOrDefault();
                body.Add(W.ActiveFilters(new (string, Action)[] { (name, () => { promotionFilter = null; Draw(body, shows, context); }) },
                    () => { promotionFilter = null; Draw(body, shows, context); }));
            }
            if (rows.Count == 0)
            {
                body.Add(W.Empty("history", shows.Count == 0 ? "No shows have run yet." : "No shows match.",
                    shows.Count == 0 ? "Shows land here once they've run. Try a longer range." : "Try another name or clear the filter."));
                return;
            }
            body.Add(Table(rows, context, showPromotion: true));
        }

        /// <summary>The history table: date, show (logo), promotion, importance, venue, score, and a Results link.</summary>
        public static VisualElement Table(List<JToken> shows, ScreenContext context, bool showPromotion)
        {
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("date", "Date", s => W.Cell(Kit.Date(Kit.Str(s, "date"), true))) { Width = 140, SortKey = s => Kit.Str(s, "date") },
                new DsColumn<JToken>("show", "Show", ShowCell) { Grow = 2.4f, MinWidth = 240, Pinned = true, SortKey = s => Kit.Str(s, "name") },
                new DsColumn<JToken>("importance", "Kind", s =>
                {
                    string importance = Kit.Str(s, "importance");
                    return IsBig(importance) ? Ds.Tag(W.Words(importance), "gold") : Ds.Tag(W.Words(importance));
                }) { Width = 110, SortKey = s => Kit.Str(s, "importance") },
                new DsColumn<JToken>("venue", "Where", s => W.Cell((Kit.Str(s, "venue.name") ?? Kit.Str(s, "genericVenue.name")) is string venue
                    ? $"{venue}, {Kit.Str(s, "region.name")}" : Kit.Str(s, "region.name"))) { Grow = 1.8f, MinWidth = 180, SortKey = s => Kit.Str(s, "region.name") },
                new DsColumn<JToken>("score", "Score", s =>
                {
                    double? score = Kit.Num(s, "score");
                    (DsState state, string word) = W.ShowScore(score);
                    return W.DotNumber(state, word, score.HasValue ? W.Int(score) : null);
                }) { Width = 130, SortKey = s => Kit.Num(s, "score") ?? -1, Help = "The show's score out of 100. Open the results for the stars and every match." },
                new DsColumn<JToken>("tv", "TV", s => Kit.Bool(s, "televised") ? Ds.Tag("TV", "live") : W.Cell(Kit.NoValue)) { Width = 60, Default = false },
                new DsColumn<JToken>("card", "Segments", s => W.Cell(W.Int(Kit.Num(s, "segmentCount")), number: true)) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = s => Kit.Num(s, "segmentCount") ?? 0 },
                new DsColumn<JToken>("results", string.Empty, s =>
                {
                    string id = Kit.Str(s, "eventInstanceId");
                    Button results = Ds.Button("Results", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", id)), DsButtonKind.Ghost, "chevron-right");
                    results.AddToClassList("ds-btn--link");
                    results.name = $"history-results-{id}";
                    return results;
                }) { Width = 110, Align = DsAlign.Right, Pinned = true },
            };
            if (showPromotion)
            {
                columns.Insert(2, new DsColumn<JToken>("promotion", "Promotion", s =>
                {
                    VisualElement cell = Ds.Row("wl-promo-cell");
                    cell.Add(Ds.Text(Kit.Str(s, "promotion.name"), "ds-cell__text", "wl-promo-cell__name"));
                    if (Kit.Bool(s, "isOwn")) cell.Add(Ds.Tag("Yours", "live"));
                    return cell;
                }) { Grow = 1.8f, MinWidth = 180, SortKey = s => Kit.Str(s, "promotion.name") });
            }
            var table = new PagedTable<JToken>(columns, shows, "shows", null, "date", true) { name = "history-table" };
            table.Table.RowClicked += s => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", Kit.Str(s, "eventInstanceId")));
            return table;
        }

        private static VisualElement ShowCell(JToken show)
        {
            VisualElement cell = Ds.Row("wl-name-cell");
            VisualElement slot = Ds.Row("wl-logo-slot");
            UnityEngine.Texture2D logo = PromotionLogos.ShowTexture(Kit.Str(show, "logoRef"));
            if (logo != null)
            {
                VisualElement plate = DsCards.Logo(null, null, "wl-logo--row", logo);
                plate.style.unityBackgroundScaleMode = UnityEngine.ScaleMode.ScaleToFit;
                slot.Add(plate);
            }
            else slot.Add(W.Logo(null, Kit.Str(show, "promotion.shortName"), Kit.Str(show, "promotion.color"), "wl-logo--row"));
            cell.Add(slot);
            VisualElement words = Ds.Column("wl-name-cell__words");
            words.Add(Ds.Text(Kit.Str(show, "name"), "ds-cell__text", "ds-cell__text--strong", "wl-name-cell__name"));
            if (Kit.Str(show, "brand.name") is string brand && brand != Kit.Str(show, "name")) words.Add(Ds.Text(brand, "wl-name-cell__detail"));
            cell.Add(words);
            return cell;
        }
    }
}
