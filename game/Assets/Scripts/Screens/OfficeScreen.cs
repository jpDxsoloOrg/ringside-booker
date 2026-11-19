using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Office dashboard (the web's OfficeScreen and its panels): the headline numbers with
    /// their Why?s (<c>office.dashboard</c>), the next show (<c>calendar.nextShow</c>), the last show
    /// (<c>shows.lastCompleted</c>) and the top stories (<c>news.top</c>).
    /// </summary>
    public static class OfficeScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = Kit.Screen("dashboard", "Office");
            VisualElement host = Ui.El("rb-office");
            screen.Add(host);
            Kit.Live(host, () => Render(host, context));
            return screen;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> dashboard = await client.Query("office.dashboard");
            QueryResult<JToken> next = await client.Query("calendar.nextShow", new JObject { ["scope"] = "mine" });
            QueryResult<JToken> last = await client.Query("shows.lastCompleted", new JObject { ["scope"] = "mine" });
            QueryResult<JToken> news = await client.Query("news.top");

            host.Clear();
            if (!dashboard.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(dashboard.Reasons)));
                return;
            }

            JToken data = dashboard.Data;
            JToken clock = Kit.Obj(data, "clock");
            string season = Kit.Num(clock, "season.number") is double number
                ? $"Season {number} · Week {Kit.Num(clock, "season.week")} · {Kit.Num(clock, "season.daysLeft")} days left"
                : null;
            host.Add(Kit.Note($"{Kit.Str(data, "promotion.name") ?? "No promotion"} · {Kit.Date(Kit.Str(data, "date"), true)}{(season == null ? string.Empty : " · " + season)}", "rb-subtitle"));

            VisualElement kpis = Ui.El("rb-kpis").Named("office-kpis");
            foreach (JToken kpi in Kit.Arr(data, "kpis")) kpis.Add(Kpi(kpi));
            host.Add(kpis);

            VisualElement columns = Kit.Columns();
            host.Add(columns);
            VisualElement left = Ui.El("rb-column");
            VisualElement right = Ui.El("rb-column");
            columns.With(left, right);

            NextShowPanel(left, next, context);
            LastShowPanel(left, last, context);
            StoriesPanel(right, news);
        }

        private static VisualElement Kpi(JToken kpi)
        {
            string label = Kit.Str(kpi, "label") ?? Kit.Str(kpi, "key");
            string unit = Kit.Str(kpi, "unit");
            double value = Kit.Num(kpi, "value") ?? 0;
            string text = Format(value, unit);
            string traceUnit = unit == "money" ? "money" : unit == "count" ? null : "points";
            VisualElement why = (VisualElement)Kit.WhyTrace(label, value, Kit.Obj(kpi, "trace"), traceUnit)
                ?? Kit.WhyRef(label, value, Kit.Obj(kpi, "traceRef"), traceUnit);
            VisualElement card = Ui.El("card", "rb-kpi").Named($"kpi-{Kit.Str(kpi, "key")}");
            card.Add(Kit.Stat(label, text, why, Kit.Str(kpi, "key") == "popularity.headline" ? "t-data" : null));
            double? delta = Kit.Num(kpi, "delta.value") ?? Kit.Num(kpi, "delta");
            if (delta.HasValue && delta.Value != 0)
            {
                bool good = (Kit.Str(kpi, "goodWhen") ?? "up") == "up" ? delta.Value > 0 : delta.Value < 0;
                card.Add(Ui.Text((delta.Value > 0 ? "+" : TextFormat.Minus) + Format(System.Math.Abs(delta.Value), unit), "t-sm", good ? "t-positive" : "t-negative"));
            }
            string footer = Kit.Str(kpi, "footer");
            if (!string.IsNullOrEmpty(footer)) card.Add(Ui.Text(footer, "t-xs", "t-muted"));
            return card;
        }

        private static string Format(double value, string unit)
        {
            switch (unit)
            {
                case "money": return TextFormat.Money((long)value);
                case "count": return TextFormat.Number((long)System.Math.Round(value));
                default: return Kit.Decimal1(value);
            }
        }

        private static void NextShowPanel(VisualElement parent, QueryResult<JToken> next, ScreenContext context)
        {
            Kit.Panel(parent, "Next show", out VisualElement body).Named("office-next-show");
            JToken show = next.Ok ? Kit.Obj(next.Data, "show") : null;
            if (show == null)
            {
                body.Add(Kit.Note("No show on the calendar."));
                return;
            }
            string id = Kit.Str(show, "eventInstanceId");
            double days = Kit.Num(next.Data, "daysUntil") ?? 0;
            string when = days <= 0 ? "Tonight" : days == 1 ? "Tomorrow" : $"In {days} days";
            body.Add(Ui.Text(TextFormat.Upper(Kit.Str(show, "name")), "rb-title"));
            body.Add(Kit.Line("When", $"{when} · {Kit.Date(Kit.Str(show, "date"), true)}"));
            string venue = Kit.Str(show, "venue.name") ?? Kit.Str(show, "genericVenue.name");
            if (venue != null) body.Add(Kit.Line("Venue", $"{venue}, {Kit.Str(show, "region.name")}"));
            body.Add(Kit.Line("Card", $"{Kit.Num(show, "segmentCount") ?? 0} of {Kit.Num(show, "format.slots")} slots booked"));
            Button book = Ui.Btn("BOOK THE CARD", () => context.Navigator.Go(ShellRoute.With("booking", "event", id)), "btn--primary");
            book.AddToClassList("rb-panel__action");
            body.Add(book);
        }

        private static void LastShowPanel(VisualElement parent, QueryResult<JToken> last, ScreenContext context)
        {
            if (!last.Ok || last.Data == null || last.Data.Type == JTokenType.Null) return;
            Kit.Panel(parent, "Last show", out VisualElement body).Named("office-last-show");
            JToken show = last.Data;
            string id = Kit.Str(show, "eventInstanceId");
            body.Add(Ui.Text(TextFormat.Upper(Kit.Str(show, "name")), "rb-title"));
            body.Add(Kit.Note(Kit.Date(Kit.Str(show, "date"), true)));
            double score = Kit.Num(show, "score") ?? 0;
            body.Add(Kit.Row(
                Kit.Stat("Score", Kit.Whole(score), Kit.WhyRef("Show score", score, Kit.Obj(show, "scoreTraceRef"), "points"), "t-prestige"),
                Kit.Stat("Stars", Kit.Stars(Kit.Num(show, "stars")))));
            body.Add(Ui.Btn("See the results", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", id)), "btn--link"));
        }

        private static void StoriesPanel(VisualElement parent, QueryResult<JToken> news)
        {
            Kit.Panel(parent, "Top stories", out VisualElement body).Named("office-stories");
            if (!news.Ok)
            {
                body.Add(Kit.Note("No news yet."));
                return;
            }
            JToken names = Kit.Obj(news.Data, "names");
            var stories = Kit.Arr(news.Data, "hero").Concat(Kit.Arr(news.Data, "ticker"))
                .GroupBy(story => Kit.Str(story, "id")).Select(group => group.First()).Take(6).ToList();
            if (stories.Count == 0)
            {
                body.Add(Kit.Note("Quiet so far. Stories land here as the world moves."));
                return;
            }
            foreach (JToken story in stories)
            {
                VisualElement row = Ui.El("list-row", "rb-story");
                row.Add(Ui.El("rb-row").With(
                    Kit.Badge(Kit.Str(story, "kindLabel") ?? "News", Kit.Bool(story, "frontPage") ? "badge--action" : null),
                    Ui.Text(Kit.Date(Kit.Str(story, "date")), "t-xs", "t-muted", "rb-story__date")));
                row.Add(Ui.Text(StoryLine(story, names), "t-sm", "t-wrap"));
                body.Add(row);
            }
        }

        /// <summary>The story in a line from the names it involves (the web's message catalogue is not in Unity yet).</summary>
        private static string StoryLine(JToken story, JToken names)
        {
            JToken refs = Kit.Obj(story, "refs");
            var parts = new System.Collections.Generic.List<string>();
            void Add(string id)
            {
                string name = id == null ? null : Kit.Str(names, $"['{id}'].name");
                if (name != null && !parts.Contains(name)) parts.Add(name);
            }
            foreach (JToken param in Kit.Obj(story, "headline.params")?.Children<JProperty>().Select(p => p.Value) ?? Enumerable.Empty<JToken>())
            {
                foreach (string id in (param.ToString()).Split(',')) Add(id.Trim());
            }
            foreach (JToken id in Kit.Arr(refs, "personIds")) Add((string)id);
            Add(Kit.Str(refs, "eventInstanceId"));
            return parts.Count == 0 ? Kit.Str(story, "kindLabel") ?? "News" : string.Join(" · ", parts);
        }
    }
}
