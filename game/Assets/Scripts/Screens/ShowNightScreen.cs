using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Show night with the broadcast feel of the approved mockup (10): a LIVE bar with the show so far
    /// as a scoreboard (<c>shows.liveState</c>), the segment on now big in the middle as a matchup card
    /// (the one just run, with its result, or the one up next), what happened in it in plain lines, one
    /// clear call to action (Run the next segment, <c>shows.runNextSegment</c>) with Sim the rest
    /// (<c>shows.runRestOfShow</c>) beside it, and the running order on the right. When the show is over
    /// the call to action is See the results. Keys: Space runs the next segment, S sims the rest.
    /// </summary>
    public static class ShowNightScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            string eventId = context.Route.Param("event");
            VisualElement screen = FightCardStyles.Apply(Ui.El("rb-screen", "fc-screen").Named($"screen-{ScreenIds.ShowNight}"));
            VisualElement host = Ds.Column("fc-page").Named("show-night-host");
            screen.Add(host);
            if (eventId == null)
            {
                host.Add(Ds.Empty("live", "No show was picked", "Open a show from Booking or the calendar.", "Open Booking", () => context.Navigator.Go(ShellRoute.To("booking")), "booking"));
                return screen;
            }
            var state = new State();
            screen.focusable = true;
            screen.RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.target is TextField) return;
                if (evt.keyCode == KeyCode.Space) state.RunNext?.Invoke();
                else if (evt.keyCode == KeyCode.S) state.SimRest?.Invoke();
                else return;
                evt.StopPropagation();
            });
            Kit.Live(host, () => Render(host, context, eventId, state));
            return screen;
        }

        private sealed class State
        {
            public string Selected;
            public string Refusal;
            public CardPeople People;
            public System.Action RunNext;
            public System.Action SimRest;
            public bool Busy;
        }

        private static async Task Render(VisualElement host, ScreenContext context, string eventId, State state)
        {
            EngineClient client = Kit.Game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };
            QueryResult<JToken> liveAnswer = await client.Query("shows.liveState", args);
            QueryResult<JToken> viewAnswer = await client.Query("shows.results", args);
            state.People ??= await CardPeople.LoadAsync();
            if (!liveAnswer.Ok || liveAnswer.Data == null || liveAnswer.Data.Type == JTokenType.Null || !viewAnswer.Ok || viewAnswer.Data == null || viewAnswer.Data.Type == JTokenType.Null)
            {
                host.Clear();
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

            JToken next = Kit.Obj(live, "next");
            var ranById = ran.ToDictionary(segment => Kit.Str(segment, "segmentId"), segment => segment);
            JToken shown = (state.Selected != null && ranById.TryGetValue(state.Selected, out JToken picked) ? picked : null)
                ?? (finished ? segments.LastOrDefault() : ran.LastOrDefault());
            int done = finished ? total : ran.Count;

            host.Clear();
            host.Add(LiveBar(view, live, eventId, stage, done, total, next));

            // Controls (built first so the keys work).
            Label feedback = Kit.Feedback();
            if (state.Refusal != null)
            {
                feedback.text = state.Refusal;
                feedback.SetShown(true);
            }
            bool stuck = stage == "live" && next == null;
            bool canRun = next != null && (stage == "live" || (stage == "notStarted" && tonight == true && problems == 0));

            async void Run(string command)
            {
                if (state.Busy) return;
                state.Busy = true;
                try
                {
                    CommandResult<JToken> run = await client.Command(command, args);
                    state.Refusal = run.Ok ? null : Kit.Reasons(run.Reasons);
                    state.Selected = run.Ok && command == "shows.runNextSegment" ? (string)run.Data?["segmentId"] : null;
                    if (!run.Ok) await Render(host, context, eventId, state);
                }
                finally
                {
                    state.Busy = false;
                }
            }

            state.RunNext = canRun ? () => Run("shows.runNextSegment") : (System.Action)null;
            state.SimRest = canRun ? () => Run("shows.runRestOfShow") : (System.Action)null;

            VisualElement columns = Ds.Row("ds-row--top", "fc-columns");
            VisualElement stageColumn = Ds.Column("fc-stage").Named("show-night-stage");
            columns.Add(stageColumn);

            // What keeps it from starting, if anything.
            if (stage == "notStarted")
            {
                string blocker = total == 0 ? "Nothing is booked on this show yet. Book the card first, then come back to go live."
                    : tonight == false ? $"This show isn't on tonight. It's on {Kit.Date(Kit.Str(live, "date"), true)}."
                    : problems > 0 ? $"Fix {problems} {(problems == 1 ? "problem" : "problems")} on the card to run the show."
                    : null;
                if (blocker != null)
                {
                    VisualElement row = Ds.Row("fc-note");
                    row.Add(Ds.Pill(DsState.Warn, blocker));
                    row.Add(Ds.Button("Open the card", () => context.Navigator.Go(ShellRoute.With("booking", "event", eventId)), DsButtonKind.Ghost, "booking"));
                    stageColumn.Add(row);
                }
            }

            JToken onStage = shown ?? next;
            bool hasResult = shown != null;
            VisualElement now = Ds.Row("fc-now");
            var tag = new SkewShape { SkewLeft = false };
            tag.AddToClassList("fc-now__tag");
            tag.Add(Ds.Text(finished ? "FINAL" : hasResult ? "JUST IN" : "UP NEXT", "fc-now__tag-text"));
            now.Add(tag);
            if (onStage != null)
            {
                string kindText = Kit.Str(onStage, "kind") == "match" ? "match" : "segment";
                now.Add(Ds.Text($"{Kit.Str(onStage, "roleLabel")} · {Kit.Str(onStage, "typeName")} · {CardWords.Length(Kit.Str(onStage, "durationClass"))} {kindText}", "fc-now__text"));
            }
            else now.Add(Ds.Text(stage == "notStarted" ? "The show hasn't started." : "Nothing left to run.", "fc-now__text"));
            stageColumn.Add(now);
            if (onStage != null)
            {
                VisualElement big = DsCards.MatchupCard(Matchups.FromResult(onStage, state.People, hasResult), big: true);
                big.name = "show-now-card";
                stageColumn.Add(big);
                stageColumn.Add(Feed(onStage, hasResult));
            }

            VisualElement controls = Ds.Row("fc-controls").Named("show-night-controls");
            if (!finished)
            {
                SkewButton runNext = Ds.Cta(next == null ? "Nothing to run" : ran.Count == 0 ? "Start the show" : "Run the next segment", () => state.RunNext?.Invoke(), "play");
                runNext.name = "show-run-next";
                runNext.AddToClassList("ds-cta--lg");
                runNext.SetEnabled(canRun);
                controls.Add(runNext);
                Button simRest = Ds.Button("Sim the rest", () => state.SimRest?.Invoke(), DsButtonKind.Secondary, "fast-forward");
                simRest.name = "show-sim-rest";
                simRest.SetEnabled(canRun);
                controls.Add(simRest);
                if (stuck)
                {
                    Button finish = Ds.Button("Finish the show", async () =>
                    {
                        CommandResult<JToken> run = await client.Command("shows.finishShow", args);
                        state.Refusal = run.Ok ? null : Kit.Reasons(run.Reasons);
                    }, DsButtonKind.Secondary, "stop");
                    finish.name = "show-finish";
                    controls.Add(finish);
                }
                if (stage == "live")
                {
                    Button leave = Ds.Button("Leave and finish later", () => context.Navigator.Go(NavigationModel.HomeItemId), DsButtonKind.Ghost, "pause");
                    leave.name = "show-leave";
                    controls.Add(leave);
                }
                controls.Add(Ds.Spacer());
                if (canRun) controls.Add(Ds.Text("Space: run · S: sim the rest", "ds-type-caption"));
            }
            else
            {
                SkewButton results = Ds.Cta("See the results", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventId)), "chevron-right");
                results.name = "show-see-results";
                results.AddToClassList("ds-cta--lg");
                controls.Add(results);
            }
            stageColumn.Add(controls);
            stageColumn.Add(feedback);
            if (stage == "notStarted" && canRun)
            {
                stageColumn.Add(Ds.Text($"The card has {total} {(total == 1 ? "segment" : "segments")}. Run them one at a time and see how each one went, or sim the whole show at once. The results are the same either way.", "fc-hint"));
            }

            columns.Add(RunningOrder(segments, ranById, finished, Kit.Str(next, "segmentId"), shown, done, total, id =>
            {
                state.Selected = id;
                _ = Render(host, context, eventId, state);
            }));
            host.Add(columns);
        }

        private static VisualElement LiveBar(JToken view, JToken live, string eventId, string stage, int done, int total, JToken next)
        {
            VisualElement bar = Ds.Row("fc-live-bar").Named("show-night-header");
            bool onAir = stage == "live";
            VisualElement pill = Ds.Pill(onAir ? DsState.Live : stage == "finished" ? DsState.Neutral : DsState.Info, onAir ? "LIVE" : stage == "finished" ? "OFF AIR" : "TONIGHT", onAir ? "live" : "tv", solid: onAir);
            pill.AddToClassList("fc-live-pill");
            bar.Add(pill);
            PromotionLogos.PrependShow(bar, eventId, null, Kit.Str(view, "promotion.id"), "rb-logo--md");
            // PrependShow puts the logo first; keep the LIVE pill in front of it.
            pill.SendToBack();
            VisualElement title = Ds.Column("fc-live-bar__title");
            title.Add(Ds.Text(TextFormat.Upper(Kit.Str(view, "name")), "fc-live-bar__name"));
            string where = Kit.Str(view, "venue.name") ?? Kit.Str(view, "region.name");
            title.Add(Ds.Text(string.Join(" · ", new[] { where, Kit.Date(Kit.Str(view, "date"), true), Kit.Str(view, "brand.name") }.Where(text => !string.IsNullOrEmpty(text))), "ds-type-caption"));
            bar.Add(title);
            bar.Add(Ds.Spacer());

            JToken soFar = Kit.Obj(live, "scoreSoFar");
            JToken result = Kit.Obj(view, "result");
            double? stars = stage == "finished" && result != null ? Kit.Num(result, "stars") : Kit.Num(soFar, "stars");
            double? score = stage == "finished" && result != null ? Kit.Num(result, "score") : Kit.Num(soFar, "score");
            string segmentLabel = stage == "finished" ? "All done" : next != null ? Kit.Str(next, "roleLabel") + " next" : "—";
            VisualElement board = DsCards.Scoreboard(new[]
            {
                ("Segment", $"{done} / {total}", segmentLabel, DsState.Neutral),
                (stage == "finished" ? "Show" : "Show so far", stars == null ? "–" : Kit.Stars(stars), stars == null ? "Nothing run yet" : CardWords.StarsWord(stars.Value) + (stage == "finished" ? " show" : " so far"), DsState.Gold),
                ("Score", score == null ? "–" : Kit.Whole(score), stage == "finished" ? "Final" : "Running total", DsState.Good),
            }, "live");
            board.AddToClassList("fc-board");
            board.name = "show-score-bug";
            VisualElement scoreCell = board.Children().LastOrDefault();
            if (scoreCell != null)
            {
                if (stage == "finished" && result != null) scoreCell.AddOpt(Kit.WhyRef("Show score", score ?? 0, Kit.Obj(result, "scoreTraceRef"), "points"));
                else scoreCell.AddOpt(Kit.WhyTrace("Show score so far", score ?? 0, Kit.Obj(soFar, "trace"), "points"));
            }
            bar.Add(board);
            return bar;
        }

        /// <summary>What happened in the segment, in plain lines: the result, title news, then the reasons for its rating.</summary>
        private static VisualElement Feed(JToken segment, bool hasResult)
        {
            VisualElement feed = Ds.Panel(hasResult ? "How it went" : "Before the bell", null, null, "fc-feed").Named("show-segment-report");
            if (!hasResult)
            {
                feed.Add(Ds.Text("Run it to see how it goes. The crowd, the work and the finish are decided on the night.", "fc-hint"));
                return feed;
            }
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
                else text = kind == "draw" ? "It ended in a draw" : "No contest";
                VisualElement line = Line("RESULT", text, true, null);
                line.AddOpt(Kit.WhyRef("Result", 0, Kit.Obj(outcome, "resultTraceRef"), null, "Why this result"));
                feed.Add(line);
            }
            foreach (JToken title in Kit.Arr(segment, "titles"))
            {
                string titleOutcome = Kit.Str(title, "outcome");
                if (titleOutcome == "none") continue;
                string text = titleOutcome == "newChampion"
                    ? $"And new {CardWords.Champion(Kit.Str(title, "name"))}: {string.Join(" & ", Kit.Arr(title, "newHolderNames").Select(holder => (string)holder))}"
                    : titleOutcome == "retained" ? $"{Kit.Str(title, "name")} retained" : $"{Kit.Str(title, "name")} is still vacant";
                VisualElement line = Line("TITLE", text, titleOutcome == "newChampion", "good");
                line.AddOpt(Kit.WhyRef(Kit.Str(title, "name"), 0, Kit.Obj(title, "outcomeTraceRef"), null, "Title outcome"));
                feed.Add(line);
            }
            JToken rating = Kit.Obj(segment, "rating");
            if (rating != null)
            {
                double score = Kit.Num(rating, "score") ?? 0;
                VisualElement line = Line("RATING", $"{Kit.Stars(Kit.Num(rating, "stars"))} · {CardWords.StarsWord(Kit.Num(rating, "stars") ?? 0)} (score {Kit.Whole(score)})", false, null);
                line.AddOpt(Kit.WhyRef("Segment score", score, Kit.Obj(rating, "traceRef"), "points"));
                feed.Add(line);
                foreach (JToken reason in Kit.Arr(rating, "reasons").Take(6))
                {
                    double effect = Kit.Num(reason, "effect") ?? 0;
                    feed.Add(Line(effect >= 0 ? "+" : TextFormat.Minus, Kit.Str(reason, "label"), false, effect >= 0 ? "good" : "bad"));
                }
            }
            if (Kit.Arr(segment, "storylines").Any())
            {
                feed.Add(Line("STORY", "Moved on: " + string.Join(", ", Kit.Arr(segment, "storylines").Select(story => Kit.Str(story, "name"))), false, null));
            }
            return feed;
        }

        private static VisualElement Line(string mark, string text, bool big, string tone)
        {
            VisualElement row = Ds.Row("fc-feed__line");
            if (big) row.AddToClassList("fc-feed__line--big");
            Label markLabel = Ds.Text(mark, "fc-feed__mark");
            if (tone != null) markLabel.AddToClassList($"fc-feed__mark--{tone}");
            row.Add(markLabel);
            row.Add(Ds.Text(text, "fc-feed__text"));
            return row;
        }

        private static VisualElement RunningOrder(List<JToken> segments, Dictionary<string, JToken> ranById, bool finished, string nextId, JToken shown,
            int done, int total, System.Action<string> onPick)
        {
            VisualElement order = Ds.Panel("Running order", null, null, "fc-order").Named("show-running-order");
            order.Add(Ds.Text($"{done} of {total} run", "fc-hint"));
            foreach (JToken segment in segments)
            {
                string id = Kit.Str(segment, "segmentId");
                JToken ranEntry = ranById.TryGetValue(id, out JToken found) ? found : finished ? segment : null;
                bool isNext = id == nextId;
                var row = new Button(() =>
                {
                    if (ranEntry != null) onPick(id);
                }) { text = string.Empty, name = $"order-{id}" };
                row.AddToClassList("fc-order__row");
                row.EnableInClassList("fc-order__row--done", ranEntry != null);
                row.EnableInClassList("fc-order__row--now", isNext);
                row.EnableInClassList("fc-order__row--shown", shown != null && Kit.Str(shown, "segmentId") == id && !isNext);
                row.Add(Ds.Text(Kit.Bool(segment, "preShow") ? "PRE" : Kit.Num(segment, "slotNumber")?.ToString() ?? string.Empty, "fc-order__number"));
                VisualElement words = Ds.Column("fc-order__words");
                words.Add(Ds.Text(SegmentTitle(segment, shortNames: true), "fc-order__name"));
                string title = Kit.Str(Kit.Arr(segment, "titles").FirstOrDefault(), "name");
                words.Add(Ds.Text(title != null ? CardWords.Title(title) : Kit.Str(segment, "roleLabel"), title != null ? "fc-order__title" : "fc-order__slot"));
                row.Add(words);
                row.Add(Ds.Spacer());
                JToken rating = Kit.Obj(ranEntry, "rating");
                if (rating != null) row.Add(new Stars((float)(Kit.Num(rating, "stars") ?? 0), "ds-icon--xs"));
                else if (isNext) row.Add(Ds.Pill(DsState.Live, "Next", "live"));
                else row.Add(Ds.Text(CardWords.Length(Kit.Str(segment, "durationClass")), "fc-order__meta"));
                order.Add(row);
            }
            return order;
        }

        public static string SegmentTitle(JToken segment, bool shortNames = false)
        {
            if (Kit.Str(segment, "label") is string label) return label;
            bool match = Kit.Str(segment, "kind") == "match";
            IEnumerable<string> sides = Kit.Arr(segment, "sides").Select(side => Kit.Str(side, "label"));
            if (shortNames) sides = sides.Select(CardWords.Short);
            string joined = string.Join(match ? " vs " : " & ", sides);
            return !match && Kit.Str(segment, "talkLine") is string talk ? talk : joined;
        }
    }
}
