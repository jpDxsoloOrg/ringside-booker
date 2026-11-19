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
    /// Show night, live (the web's ShowNightScreen): the running order, Run next segment
    /// (<c>shows.runNextSegment</c>), Sim the rest (<c>shows.runRestOfShow</c>), Leave and finish later,
    /// a report for each segment once it has run, and the show so far (<c>shows.liveState</c>,
    /// <c>shows.results</c>). When the last segment is over it offers the results.
    /// </summary>
    public static class ShowNightScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            string eventId = context.Route.Param("event");
            VisualElement screen = Kit.Screen(ScreenIds.ShowNight, "Show night");
            VisualElement host = Ui.El("rb-show-night");
            screen.Add(host);
            if (eventId == null)
            {
                host.Add(Kit.Note("No show was picked. Open one from Booking or the calendar."));
                return screen;
            }
            var state = new State();
            Kit.Live(host, () => Render(host, context, eventId, state));
            return screen;
        }

        private sealed class State
        {
            public string Selected;
            public string Refusal;
        }

        private static async Task Render(VisualElement host, ScreenContext context, string eventId, State state)
        {
            EngineClient client = Kit.Game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };
            QueryResult<JToken> liveAnswer = await client.Query("shows.liveState", args);
            QueryResult<JToken> viewAnswer = await client.Query("shows.results", args);
            host.Clear();
            if (!liveAnswer.Ok || liveAnswer.Data == null || liveAnswer.Data.Type == JTokenType.Null || !viewAnswer.Ok || viewAnswer.Data == null)
            {
                host.Add(Kit.Error(liveAnswer.Ok ? "That show can't be run from here. Only your own shows run on show night." : Kit.Reasons(liveAnswer.Reasons)));
                return;
            }
            JToken live = liveAnswer.Data;
            JToken view = viewAnswer.Data;
            string stage = Kit.Str(live, "stage");
            List<JToken> segments = Kit.Arr(view, "segments").ToList();
            List<JToken> ran = Kit.Arr(live, "segmentsRun").ToList();
            int total = segments.Count;
            bool finished = stage == "finished";

            int? problems = null;
            bool? tonight = null;
            if (stage == "notStarted")
            {
                QueryResult<JToken> card = await client.Query("booking.card", args);
                QueryResult<JToken> validation = await client.Query("booking.validate", args);
                if (card.Ok) tonight = Kit.Bool(card.Data, "runsTonight");
                if (validation.Ok) problems = Kit.Arr(validation.Data, "errors").Count();
            }

            // Header and score bug.
            VisualElement header = Ui.El("card", "rb-showbar", "rb-broadcast").Named("show-night-header");
            PromotionLogos.PrependShow(header, eventId, null, Kit.Str(view, "promotion.id") ?? Kit.Str(view, "promotionId"), "rb-logo--lg");
            string kicker = finished ? "Show's over" : stage == "live" ? "Live" : "Tonight";
            header.Add(Ui.El("rb-showbar__info").With(
                Ui.El("rb-row", "rb-row--tight").With(Kit.Badge(kicker, stage == "live" ? "badge--action" : null)),
                Ui.Text(TextFormat.Upper(Kit.Str(view, "name")), "rb-title"),
                Kit.Note($"{Kit.Date(Kit.Str(view, "date"), true)} · {Kit.Str(view, "venue.name") ?? Kit.Str(view, "region.name")}")));
            VisualElement bug = Ui.El("rb-row", "rb-scorebug").Named("show-score-bug");
            JToken result = Kit.Obj(view, "result");
            if (finished && result != null)
            {
                double score = Kit.Num(result, "score") ?? 0;
                bug.Add(Kit.Stat("Final score", Kit.Whole(score), Kit.WhyRef("Show score", score, Kit.Obj(result, "scoreTraceRef"), "points"), "t-prestige"));
                bug.Add(Kit.Stat("Stars", Kit.Stars(Kit.Num(result, "stars"))));
            }
            else
            {
                JToken soFar = Kit.Obj(live, "scoreSoFar");
                double score = Kit.Num(soFar, "score") ?? 0;
                bug.Add(Kit.Stat("Show so far", soFar == null ? "–" : Kit.Whole(score), soFar == null ? null : Kit.WhyTrace("Show score so far", score, Kit.Obj(soFar, "trace"), "points"), "t-prestige"));
                bug.Add(Kit.Stat("Stars", soFar == null ? "–" : Kit.Stars(Kit.Num(soFar, "stars"))));
            }
            bug.Add(Kit.Stat("Segments", $"{(finished ? total : ran.Count)}/{total}"));
            header.Add(bug);
            host.Add(header);

            // Controls.
            Label feedback = Kit.Feedback();
            if (state.Refusal != null)
            {
                feedback.text = state.Refusal;
                feedback.SetShown(true);
            }
            JToken next = Kit.Obj(live, "next");
            bool stuck = stage == "live" && next == null;
            bool canRun = next != null && (stage == "live" || (stage == "notStarted" && tonight == true && problems == 0));
            VisualElement controls = Ui.El("rb-row", "rb-controls").Named("show-night-controls");
            if (!finished)
            {
                Button runNext = Ui.Btn("RUN NEXT SEGMENT", async () =>
                {
                    CommandResult<JToken> run = await client.Command("shows.runNextSegment", args);
                    state.Refusal = run.Ok ? null : Kit.Reasons(run.Reasons);
                    state.Selected = run.Ok ? (string)run.Data?["segmentId"] : state.Selected;
                    if (!run.Ok) await Render(host, context, eventId, state);
                }, "btn--primary");
                runNext.name = "show-run-next";
                runNext.SetEnabled(canRun);
                controls.Add(runNext);

                Button simRest = Ui.Btn("SIM THE REST", async () =>
                {
                    CommandResult<JToken> run = await client.Command("shows.runRestOfShow", args);
                    state.Refusal = run.Ok ? null : Kit.Reasons(run.Reasons);
                    state.Selected = null;
                    if (!run.Ok) await Render(host, context, eventId, state);
                }, null);
                simRest.name = "show-sim-rest";
                simRest.SetEnabled(canRun);
                controls.Add(simRest);

                if (stuck)
                {
                    controls.Add(Ui.Btn("FINISH THE SHOW", async () =>
                    {
                        CommandResult<JToken> run = await client.Command("shows.finishShow", args);
                        state.Refusal = run.Ok ? null : Kit.Reasons(run.Reasons);
                    }, null));
                }
                if (stage == "live")
                {
                    controls.Add(Ui.Btn("Leave and finish later", () => context.Navigator.Go(NavigationModel.HomeItemId), "btn--ghost").Named("show-leave"));
                }
            }
            else
            {
                Button results = Ui.Btn("SEE THE RESULTS", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventId)), "btn--primary");
                results.name = "show-see-results";
                controls.Add(results);
            }
            host.Add(controls);
            host.Add(feedback);

            // Before the first segment: what keeps it from starting, if anything.
            if (stage == "notStarted")
            {
                string blocker = total == 0 ? "Nothing is booked on this show yet. Book the card first, then come back to go live."
                    : tonight == false ? $"This show isn't on tonight. It's on {Kit.Date(Kit.Str(live, "date"), true)}."
                    : problems > 0 ? $"Fix {problems} {(problems == 1 ? "problem" : "problems")} to run the show. The card has problems that keep it from starting."
                    : null;
                if (blocker != null)
                {
                    host.Add(Kit.Error(blocker));
                    host.Add(Ui.Btn("Open the card", () => context.Navigator.Go(ShellRoute.With("booking", "event", eventId)), "btn--link"));
                }
                else
                {
                    host.Add(Kit.Note($"The card has {total} {(total == 1 ? "segment" : "segments")}. Run them one at a time and read how each one went, or sim the whole show at once. The results are the same either way."));
                }
            }

            // Running order and the report.
            VisualElement columns = Kit.Columns();
            VisualElement order = Ui.El("rb-column");
            VisualElement report = Ui.El("rb-column", "rb-column--wide");
            columns.With(order, report);
            host.Add(columns);

            var ranIds = new HashSet<string>(ran.Select(segment => Kit.Str(segment, "segmentId")));
            string nextId = Kit.Str(next, "segmentId");
            JToken shown = ran.FirstOrDefault(segment => Kit.Str(segment, "segmentId") == state.Selected) ?? ran.LastOrDefault();
            if (finished && shown == null) shown = segments.LastOrDefault();

            Kit.Panel(order, "Running order", out VisualElement orderBody).Named("show-running-order");
            orderBody.Add(Kit.Note($"{(finished ? total : ran.Count)} of {total} run"));
            foreach (JToken segment in segments)
            {
                string id = Kit.Str(segment, "segmentId");
                bool done = finished || ranIds.Contains(id);
                string mark = done ? "✓" : id == nextId ? "▶" : "·";
                Button row = Ui.Button(string.Empty, () =>
                {
                    if (!done) return;
                    state.Selected = id;
                    _ = Render(host, context, eventId, state);
                }, "rb-order-row");
                row.EnableInClassList("rb-order-row--next", id == nextId);
                row.EnableInClassList("rb-order-row--shown", shown != null && Kit.Str(shown, "segmentId") == id);
                row.Add(Ui.Text(mark, "rb-order-row__mark"));
                row.Add(Ui.El("rb-cell-stack").With(
                    Ui.Text($"{Kit.Num(segment, "slotNumber")}. {Kit.Str(segment, "roleLabel")} · {Kit.Str(segment, "typeName")}", "t-xs", "t-muted"),
                    Ui.Text(SegmentTitle(segment), "t-sm", "t-wrap")));
                JToken rating = Kit.Obj(ran.FirstOrDefault(entry => Kit.Str(entry, "segmentId") == id) ?? (finished ? segment : null), "rating");
                if (rating != null) row.Add(Ui.Text(Kit.Stars(Kit.Num(rating, "stars")), "t-sm", "t-prestige"));
                orderBody.Add(row);
            }

            if (shown != null) report.Add(SegmentReport.Build(shown, "show-segment-report"));
            else if (next != null)
            {
                Kit.Panel(report, "Up next", out VisualElement upNext);
                upNext.Add(Ui.Text(SegmentTitle(next), "rb-title"));
                upNext.Add(Kit.Note($"{Kit.Str(next, "roleLabel")} · {Kit.Str(next, "typeName")} · {Kit.Str(next, "durationLabel")}"));
            }
        }

        public static string SegmentTitle(JToken segment)
        {
            if (Kit.Str(segment, "label") is string label) return label;
            bool match = Kit.Str(segment, "kind") == "match";
            string sides = string.Join(match ? " vs " : " & ", Kit.Arr(segment, "sides").Select(side => Kit.Str(side, "label")));
            return !match && Kit.Str(segment, "talkLine") is string talk ? talk : sides;
        }
    }

    /// <summary>One segment's report (the web's SegmentReport): result, rating with Why?s, why it rated so, title changes.</summary>
    public static class SegmentReport
    {
        public static VisualElement Build(JToken segment, string name = null)
        {
            VisualElement panel = Kit.Panel(null, $"{Kit.Str(segment, "roleLabel")} · {Kit.Str(segment, "typeName")}", out VisualElement body, "rb-report");
            if (name != null) panel.name = name;
            body.Add(Ui.Text(ShowNightScreen.SegmentTitle(segment), "rb-title", "t-wrap"));

            JToken outcome = Kit.Obj(segment, "outcome");
            if (outcome != null)
            {
                string kind = Kit.Str(outcome, "kind");
                string text;
                if (kind == "win")
                {
                    int side = (int)(Kit.Num(outcome, "winningSide") ?? 0);
                    string winner = Kit.Arr(segment, "sides").Where(entry => (int)(Kit.Num(entry, "side") ?? -1) == side).Select(entry => Kit.Str(entry, "label")).FirstOrDefault();
                    text = $"{winner} won by {Kit.Str(outcome, "methodName")?.ToLowerInvariant()}";
                    if (Kit.Str(outcome, "finishName") is string finish) text += $" ({finish})";
                }
                else text = kind == "draw" ? "A draw" : "No contest";
                body.Add(Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(text, "t-ui-semibold", "t-wrap"),
                    Kit.WhyRef("Result", 0, Kit.Obj(outcome, "resultTraceRef"), null, "Why this result")));
            }

            foreach (JToken title in Kit.Arr(segment, "titles"))
            {
                string titleOutcome = Kit.Str(title, "outcome");
                if (titleOutcome == "none") continue;
                string line = titleOutcome == "changed"
                    ? $"New {Kit.Str(title, "name")}: {string.Join(" & ", Kit.Arr(title, "newHolderNames").Select(holder => (string)holder))}"
                    : $"{Kit.Str(title, "name")} {titleOutcome}";
                body.Add(Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(line, "t-sm", titleOutcome == "changed" ? "t-prestige" : "t-muted", "t-wrap"),
                    Kit.WhyRef(Kit.Str(title, "name"), 0, Kit.Obj(title, "outcomeTraceRef"), null, "Title outcome")));
            }

            JToken rating = Kit.Obj(segment, "rating");
            if (rating != null)
            {
                double score = Kit.Num(rating, "score") ?? 0;
                body.Add(Kit.Row(
                    Kit.Stat("Score", Kit.Whole(score), Kit.WhyRef("Segment score", score, Kit.Obj(rating, "traceRef"), "points"), "t-prestige"),
                    Kit.Stat("Stars", Kit.Stars(Kit.Num(rating, "stars"))),
                    Kit.Stat("Work rate", Kit.Whole(Kit.Num(rating, "workRate"))),
                    Kit.Stat("Crowd", Kit.Whole(Kit.Num(rating, "crowd"))),
                    Kit.Stat("Expected", Kit.Whole(Kit.Num(rating, "expectation")))));
                foreach (JToken reason in Kit.Arr(rating, "reasons"))
                {
                    double effect = Kit.Num(reason, "effect") ?? 0;
                    body.Add(Ui.Text($"{(effect >= 0 ? "+" : TextFormat.Minus)}{System.Math.Abs(effect):0.0}  {Kit.Str(reason, "label")}", "t-sm", effect >= 0 ? "t-positive" : "t-negative"));
                }
            }
            else body.Add(Kit.Note("Not run yet."));

            if (Kit.Arr(segment, "storylines").Any())
            {
                body.Add(Ui.Text("Storylines: " + string.Join(", ", Kit.Arr(segment, "storylines").Select(story => Kit.Str(story, "name") ?? Kit.Str(story, "storylineId"))), "t-xs", "t-muted", "t-wrap"));
            }
            return panel;
        }
    }
}
