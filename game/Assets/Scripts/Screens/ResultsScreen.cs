using System.Collections.Generic;
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
    /// A show's results (the web's ShowResultsScreen): the score and stars with Why?s
    /// (<c>shows.results</c>), the crowd and money (<c>boxOffice.showCrowd</c>, gate and viewers),
    /// what it did to your popularity (<c>popularity.showChange</c>), each segment's report and its
    /// physical toll (<c>match.physicalForSegment</c>).
    /// </summary>
    public static class ResultsScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            string eventId = context.Route.Param("event");
            VisualElement screen = Kit.Screen(ScreenIds.ShowResults, "Show results");
            VisualElement host = Ui.El("rb-results");
            screen.Add(host);
            if (eventId == null) Kit.Live(host, () => RenderLatest(host, context));
            else Kit.Live(host, () => Render(host, context, eventId));
            return screen;
        }

        private static async Task RenderLatest(VisualElement host, ScreenContext context)
        {
            QueryResult<JToken> last = await Kit.Game.Client.Query("shows.lastCompleted", new JObject { ["scope"] = "mine" });
            string id = last.Ok ? Kit.Str(last.Data, "eventInstanceId") : null;
            if (id == null)
            {
                host.Clear();
                host.Add(Kit.Note("None of your shows has run yet."));
                return;
            }
            await Render(host, context, id);
        }

        private static async Task Render(VisualElement host, ScreenContext context, string eventId)
        {
            EngineClient client = Kit.Game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };
            QueryResult<JToken> answer = await client.Query("shows.results", args);
            QueryResult<JToken> crowd = await client.Query("boxOffice.showCrowd", args);
            QueryResult<JToken> popularity = await client.Query("popularity.showChange", args);
            host.Clear();
            if (!answer.Ok || answer.Data == null || answer.Data.Type == JTokenType.Null)
            {
                host.Add(Kit.Error(answer.Ok ? "There are no results for that show." : Kit.Reasons(answer.Reasons)));
                return;
            }
            JToken view = answer.Data;
            JToken result = Kit.Obj(view, "result");

            VisualElement header = Ui.El("card", "rb-showbar", "rb-broadcast").Named("results-header");
            header.Add(Ui.El("rb-showbar__info").With(
                Ui.Text(TextFormat.Upper(Kit.Str(view, "name")), "rb-title"),
                Kit.Note($"{Kit.Str(view, "promotion.name")} · {Kit.Date(Kit.Str(view, "date"), true)} · {Kit.Str(view, "venue.name") ?? Kit.Str(view, "region.name")}")));
            if (result == null)
            {
                header.Add(Kit.Note(Kit.Str(view, "status") == "completed" ? "No score was kept for this show." : "This show hasn't run yet."));
                host.Add(header);
                if (Kit.Str(view, "status") != "completed")
                {
                    host.Add(Ui.Btn("Go to the show", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowNight, "event", eventId)), "btn--link"));
                }
                return;
            }

            double score = Kit.Num(result, "score") ?? 0;
            VisualElement bug = Ui.El("rb-row", "rb-scorebug").Named("results-score");
            bug.Add(Kit.Stat("Score", Kit.Whole(score), Kit.WhyRef("Show score", score, Kit.Obj(result, "scoreTraceRef"), "points"), "t-prestige"));
            bug.Add(Kit.Stat("Stars", Kit.Stars(Kit.Num(result, "stars"))));
            header.Add(bug);
            host.Add(header);

            VisualElement columns = Kit.Columns();
            VisualElement main = Ui.El("rb-column", "rb-column--wide");
            VisualElement side = Ui.El("rb-column");
            columns.With(main, side);
            host.Add(columns);

            // The crowd and the money.
            Kit.Panel(side, "Crowd and money", out VisualElement money).Named("results-money");
            double attendance = Kit.Num(crowd.Ok ? crowd.Data : null, "attendance") ?? Kit.Num(result, "attendance") ?? 0;
            money.Add(Kit.Line("Attendance",
                crowd.Ok && Kit.Num(crowd.Data, "capacity") is double capacity
                    ? $"{TextFormat.Number((long)attendance)} of {TextFormat.Number((long)capacity)} ({Kit.Num(crowd.Data, "percentFull")}% full)"
                    : TextFormat.Number((long)attendance),
                Kit.WhyRef("Attendance", attendance, Kit.Obj(crowd.Ok ? crowd.Data : null, "attendanceTraceRef"), "people")));
            if (Kit.Num(result, "gate") is double gate) money.Add(Kit.Line("Ticket sales", TextFormat.Money((long)gate)));
            if (Kit.Num(result, "viewers") is double viewers) money.Add(Kit.Line("Viewers", TextFormat.Number((long)viewers)));

            // Popularity.
            if (popularity.Ok && popularity.Data != null && popularity.Data.Type != JTokenType.Null)
            {
                Kit.Panel(side, "Popularity", out VisualElement pop).Named("results-popularity");
                JToken summary = Kit.Obj(popularity.Data, "summary");
                double change = Kit.Num(summary, "world.change") ?? 0;
                pop.Add(Kit.Line("Worldwide", $"{Kit.Decimal1(Kit.Num(summary, "world.before"))} → {Kit.Decimal1(Kit.Num(summary, "world.after"))} ({(change >= 0 ? "+" : TextFormat.Minus)}{System.Math.Abs(change):0.00})",
                    Kit.WhyTrace("Worldwide popularity change", change, Kit.Obj(summary, "world.trace"), "points")));
                pop.Add(Kit.Note($"{Kit.Num(summary, "regionsGained") ?? 0} regions up, {Kit.Num(summary, "regionsLost") ?? 0} down, {Kit.Num(summary, "regionsUnchanged") ?? 0} unchanged"));
                foreach (JToken country in Kit.Arr(popularity.Data, "countries"))
                {
                    double countryChange = Kit.Num(country, "change") ?? 0;
                    pop.Add(Kit.Line(Kit.Str(country, "name"), $"{(countryChange >= 0 ? "+" : TextFormat.Minus)}{System.Math.Abs(countryChange):0.00}",
                        Kit.WhyTrace($"{Kit.Str(country, "name")} popularity change", countryChange, Kit.Obj(country, "trace"), "points")));
                }
            }

            // Score breakdown.
            Kit.Panel(side, "How the score added up", out VisualElement breakdown);
            foreach (JToken row in Kit.Arr(result, "breakdown.rows"))
            {
                breakdown.Add(Kit.Line(Kit.Str(row, "label"), $"{Kit.Whole(Kit.Num(row, "score"))} × {Kit.Num(row, "weight"):0.##}"));
            }

            // Segments, each with its physical toll.
            foreach (JToken segment in Kit.Arr(view, "segments"))
            {
                VisualElement report = SegmentReport.Build(segment);
                report.name = $"results-segment-{Kit.Str(segment, "segmentId")}";
                main.Add(report);
                if (Kit.Str(segment, "kind") == "match") await PhysicalToll(report, Kit.Str(segment, "segmentId"));
            }
        }

        private static async Task PhysicalToll(VisualElement report, string segmentId)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("match.physicalForSegment", new JObject { ["segmentId"] = segmentId });
            List<JToken> workers = answer.Ok ? Kit.Arr(answer.Data, "workers").ToList() : new List<JToken>();
            if (workers.Count == 0) return;
            VisualElement body = report.Q<VisualElement>(className: "rb-panel__body") ?? report;
            body.Add(Ui.Text(TextFormat.Upper("Physical toll"), "section-label", "rb-gap-top"));
            var table = new Kit.Table(body, new[] { "Who", "Tiredness", "Wear", "Injury chance", "Learned" }, new[] { 2f, 1.2f, 1f, 1.2f, 1f });
            foreach (JToken worker in workers)
            {
                double fatigue = Kit.Num(worker, "fatigueGain.value") ?? 0;
                double wear = Kit.Num(worker, "wearTotal.value") ?? 0;
                double chance = Kit.Num(worker, "injuryChance.value") ?? 0;
                double learning = Kit.Num(worker, "learning.value") ?? 0;
                Label name = Ui.Text(Kit.Str(worker, "name") + (Kit.Bool(worker, "injured.value") ? " (injured)" : string.Empty), "t-sm");
                if (Kit.Bool(worker, "injured.value")) name.AddToClassList("t-negative");
                table.AddRow(name,
                    Cell($"+{fatigue:0.0}", Kit.WhyRef("Tiredness", fatigue, Kit.Obj(worker, "fatigueGain.traceRef"))),
                    Cell($"{wear:0.0}", Kit.WhyRef("Wear", wear, Kit.Obj(worker, "wearTotal.traceRef"))),
                    Cell($"{chance * 100:0.0}%", Kit.WhyRef("Injury chance", chance, Kit.Obj(worker, "injuryChance.traceRef"), "probability")),
                    Cell($"+{learning:0.000}", Kit.WhyRef("Learning", learning, Kit.Obj(worker, "learning.traceRef"))));
            }
        }

        private static VisualElement Cell(string text, VisualElement why) =>
            Ui.El("rb-row", "rb-row--tight").With(Ui.Text(text, "rb-table__text"), why);
    }
}
