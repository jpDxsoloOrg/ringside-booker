using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// A show's results as the approved mockup (11/12): the grade first (stars and a word, with the
    /// score's Why?), the scoreboard (attendance from <c>boxOffice.showCrowd</c>, gate, viewers and the
    /// popularity change from <c>popularity.showChange</c>), an "And new" banner for each title change,
    /// the main event big and every other segment as a reveal card (winner on the left, DEF.), and on
    /// the right the key changes (titles, injuries from <c>match.physicalForSegment</c>, popularity,
    /// money) and the star of the night. A card opens that segment's full report in a side sheet with
    /// its physical toll.
    /// </summary>
    public static class ResultsScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            string eventId = context.Route.Param("event");
            VisualElement screen = FightCardStyles.Apply(Ui.El("rb-screen", "fc-screen").Named($"screen-{ScreenIds.ShowResults}"));
            VisualElement host = Ds.Column("fc-page").Named("results-host");
            screen.Add(host);
            var state = new State();
            if (eventId == null) Kit.Live(host, () => RenderLatest(host, context, state));
            else Kit.Live(host, () => Render(host, context, eventId, state));
            return screen;
        }

        private sealed class State
        {
            public CardPeople People;
            public string Revealed;
        }

        /// <summary>True while the screenshot tours run: the reveal is instant.</summary>
        public static bool InstantReveal;

        private static async Task RenderLatest(VisualElement host, ScreenContext context, State state)
        {
            QueryResult<JToken> last = await Kit.Game.Client.Query("shows.lastCompleted", new JObject { ["scope"] = "mine" });
            string id = last.Ok ? Kit.Str(last.Data, "eventInstanceId") : null;
            if (id == null)
            {
                host.Clear();
                host.Add(Ds.Empty("trophy", "No results yet", "None of your shows has run yet.", "Open Booking", () => context.Navigator.Go(ShellRoute.To("booking")), "booking"));
                return;
            }
            await Render(host, context, id, state);
        }

        private static async Task Render(VisualElement host, ScreenContext context, string eventId, State state)
        {
            EngineClient client = Kit.Game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };
            QueryResult<JToken> answer = await client.Query("shows.results", args);
            QueryResult<JToken> crowd = await client.Query("boxOffice.showCrowd", args);
            QueryResult<JToken> popularity = await client.Query("popularity.showChange", args);
            state.People ??= await CardPeople.LoadAsync();
            if (!answer.Ok || answer.Data == null || answer.Data.Type == JTokenType.Null)
            {
                host.Clear();
                host.Add(Kit.Error(answer.Ok ? "There are no results for that show." : Kit.Reasons(answer.Reasons)));
                return;
            }
            JToken view = answer.Data;
            JToken result = Kit.Obj(view, "result");
            List<JToken> segments = Kit.Arr(view, "segments").ToList();

            // The physical toll of every match (for the injuries in Key changes and the reports).
            var tolls = new Dictionary<string, List<JToken>>();
            foreach (JToken segment in segments.Where(segment => Kit.Str(segment, "kind") == "match" && Kit.Obj(segment, "rating") != null))
            {
                QueryResult<JToken> toll = await client.Query("match.physicalForSegment", new JObject { ["segmentId"] = Kit.Str(segment, "segmentId") });
                if (toll.Ok) tolls[Kit.Str(segment, "segmentId")] = Kit.Arr(toll.Data, "workers").ToList();
            }

            host.Clear();
            if (result == null)
            {
                host.Add(Hero(view, null, null, null));
                bool completed = Kit.Str(view, "status") == "completed";
                host.Add(Ds.Empty("clock", completed ? "No score was kept for this show." : "This show hasn't run yet.", null,
                    completed ? null : "Go to the show", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowNight, "event", eventId)), "live"));
                return;
            }

            JToken crowdData = crowd.Ok ? crowd.Data : null;
            JToken popData = popularity.Ok && popularity.Data != null && popularity.Data.Type != JTokenType.Null ? popularity.Data : null;
            host.Add(Hero(view, result, crowdData, popData));

            VisualElement columns = Ds.Row("ds-row--top", "fc-columns");
            VisualElement reveals = Ds.Column("fc-reveals").Named("results-reveals");
            var order = new List<VisualElement>();

            // Title changes lead, then the main event big, then the rest of the card from the top down.
            foreach (JToken segment in segments)
            {
                foreach (JToken title in Kit.Arr(segment, "titles").Where(title => Kit.Str(title, "outcome") == "newChampion"))
                {
                    VisualElement banner = Ds.Row("fc-new-champ");
                    var shape = new SkewShape { SkewLeft = false };
                    shape.AddToClassList("fc-new-champ__tag");
                    shape.Add(new Icon("crown", "ds-icon--sm", "fc-new-champ__icon"));
                    shape.Add(Ds.Text("AND NEW", "fc-new-champ__tag-text"));
                    banner.Add(shape);
                    banner.Add(Ds.Text($"{string.Join(" & ", Kit.Arr(title, "newHolderNames").Select(name => (string)name))} {(Kit.Arr(title, "newHolderNames").Count() > 1 ? "are" : "is")} the new {Kit.Str(title, "name")}", "fc-new-champ__text"));
                    reveals.Add(banner);
                    order.Add(banner);
                }
            }
            JToken main = segments.LastOrDefault(segment => !Kit.Bool(segment, "preShow")) ?? segments.LastOrDefault();
            if (main != null)
            {
                VisualElement mainCard = Card(state.People, main, tolls, big: true);
                mainCard.AddToClassList("fc-reveal-main");
                reveals.Add(mainCard);
                order.Add(mainCard);
            }
            VisualElement grid = Ds.Row("ds-row--top", "fc-reveal-grid");
            foreach (JToken segment in Enumerable.Reverse(segments).Where(segment => segment != main))
            {
                VisualElement cell = Card(state.People, segment, tolls, big: false);
                cell.AddToClassList("fc-reveal-cell");
                grid.Add(cell);
                order.Add(cell);
            }
            reveals.Add(grid);
            columns.Add(reveals);
            columns.Add(Side(context, state.People, view, result, segments, tolls, crowdData, popData));
            host.Add(columns);

            // The reveal: one card after another, once per show (instant in the tours and on redraws).
            if (!InstantReveal && state.Revealed != eventId)
            {
                for (int index = 0; index < order.Count; index++)
                {
                    VisualElement element = order[index];
                    element.AddToClassList("fc-reveal");
                    element.schedule.Execute(() => element.RemoveFromClassList("fc-reveal")).StartingIn(200 + index * 160);
                }
            }
            state.Revealed = eventId;
        }

        private static VisualElement Hero(JToken view, JToken result, JToken crowd, JToken popularity)
        {
            VisualElement hero = Ds.Row("fc-results-hero").Named("results-header");
            VisualElement grade = Ds.Column("fc-grade");
            grade.Add(Ds.Text(Kit.Str(view, "status") == "completed" ? "TONIGHT'S RESULTS" : "RESULTS", "fc-label"));
            VisualElement nameRow = Ds.Row();
            PromotionLogos.PrependShow(nameRow, Kit.Str(view, "eventInstanceId"), null, Kit.Str(view, "promotion.id"), "rb-logo--lg");
            nameRow.Add(Ds.Text(TextFormat.Upper(Kit.Str(view, "name")), "ds-type-display", "fc-grade__name"));
            grade.Add(nameRow);
            if (result != null)
            {
                double stars = Kit.Num(result, "stars") ?? 0;
                double score = Kit.Num(result, "score") ?? 0;
                VisualElement starRow = Ds.Row("fc-grade__stars").Named("results-score");
                starRow.Add(new Stars((float)stars, "ds-icon--xl"));
                starRow.Add(Ds.Text(CardWords.StarsWord(stars, show: true), "fc-grade__word"));
                starRow.AddOpt(Kit.WhyRef("Show rating", score, Kit.Obj(result, "scoreTraceRef"), "points", "Show rating"));
                grade.Add(starRow);
            }
            grade.Add(Ds.Text(string.Join(" · ", new[] { Kit.Str(view, "promotion.name"), Kit.Date(Kit.Str(view, "date"), true), Kit.Str(view, "venue.name") ?? Kit.Str(view, "region.name") }
                .Where(text => !string.IsNullOrEmpty(text))), "ds-type-body"));
            hero.Add(grade);
            hero.Add(Ds.Spacer());
            if (result == null) return hero;

            double attendance = Kit.Num(crowd, "attendance") ?? Kit.Num(result, "attendance") ?? 0;
            string full = Kit.Num(crowd, "percentFull") is double percent ? $"{percent:0}% full" : null;
            double? gate = Kit.Num(result, "gate");
            double? viewers = Kit.Num(result, "viewers");
            JToken summary = Kit.Obj(popularity, "summary");
            double change = Kit.Num(summary, "world.change") ?? 0;
            var cells = new List<(string, string, string, DsState)>
            {
                ("Attendance", TextFormat.Number((long)attendance), full ?? "People in the building", DsState.Good),
                ("Gate", gate == null ? "–" : TextFormat.Money((long)gate.Value), "Ticket sales", DsState.Good),
                ("Viewers", viewers == null ? "–" : TextFormat.Number((long)viewers.Value), viewers == null ? "Not on TV" : "Watching", DsState.Neutral),
                ("Popularity", summary == null ? "–" : $"{(change >= 0 ? "+" : TextFormat.Minus)}{System.Math.Abs(change):0.00}",
                    summary == null ? "No change" : $"{Kit.Num(summary, "regionsGained") ?? 0} regions up, {Kit.Num(summary, "regionsLost") ?? 0} down", change >= 0 ? DsState.Good : DsState.Bad),
            };
            VisualElement board = DsCards.Scoreboard(cells, "broadcast");
            board.AddToClassList("fc-results-board");
            board.name = "results-board";
            List<VisualElement> boxes = board.Children().ToList();
            boxes[0].AddOpt(Kit.WhyRef("Attendance", attendance, Kit.Obj(crowd, "attendanceTraceRef"), "people"));
            if (summary != null) boxes[3].AddOpt(Kit.WhyTrace("Worldwide popularity change", change, Kit.Obj(summary, "world.trace"), "points"));
            hero.Add(board);
            return hero;
        }

        private static VisualElement Card(CardPeople people, JToken segment, Dictionary<string, List<JToken>> tolls, bool big)
        {
            Matchup matchup = Matchups.FromResult(segment, people, true);
            string id = Kit.Str(segment, "segmentId");
            if (tolls.TryGetValue(id, out List<JToken> workers))
            {
                foreach (JToken worker in workers.Where(worker => Kit.Bool(worker, "injured.value")))
                {
                    matchup.Flags.Add((DsState.Bad, $"{Kit.Str(worker, "name")} got hurt"));
                }
            }
            VisualElement card = null;
            card = DsCards.MatchupCard(matchup, big, () => SegmentReport.Open(card, segment, tolls));
            card.RegisterCallback<NavigationSubmitEvent>(evt => SegmentReport.Open(card, segment, tolls));
            card.name = $"results-segment-{id}";
            return card;
        }

        private static VisualElement Side(ScreenContext context, CardPeople people, JToken view, JToken result, List<JToken> segments, Dictionary<string, List<JToken>> tolls,
            JToken crowd, JToken popularity)
        {
            VisualElement side = Ds.Column("fc-side-col");
            VisualElement changes = Ds.Panel("Key changes", null, null).Named("results-key-changes");
            int count = 0;
            foreach (JToken segment in segments)
            {
                foreach (JToken title in Kit.Arr(segment, "titles"))
                {
                    string outcome = Kit.Str(title, "outcome");
                    if (outcome != "newChampion") continue;
                    changes.Add(Change(DsState.Gold, "crown", $"New {Kit.Str(title, "name")}",
                        $"{string.Join(" & ", Kit.Arr(title, "newHolderNames").Select(name => (string)name))} won it in the {Kit.Str(segment, "roleLabel")?.ToLowerInvariant()}.",
                        Kit.WhyRef(Kit.Str(title, "name"), 0, Kit.Obj(title, "outcomeTraceRef"), null, "Title outcome")));
                    count++;
                }
            }
            foreach (JToken worker in tolls.Values.SelectMany(list => list).Where(worker => Kit.Bool(worker, "injured.value")))
            {
                changes.Add(Change(DsState.Bad, "injured", $"{Kit.Str(worker, "name")} got hurt", "Check the injury list on the roster.", null));
                count++;
            }
            JToken summary = Kit.Obj(popularity, "summary");
            if (summary != null)
            {
                double change = Kit.Num(summary, "world.change") ?? 0;
                changes.Add(Change(change >= 0 ? DsState.Good : DsState.Bad, change >= 0 ? "trend-up" : "trend-down",
                    change >= 0 ? "Your popularity grew" : "Your popularity slipped",
                    $"Worldwide {Kit.Decimal1(Kit.Num(summary, "world.before"))} → {Kit.Decimal1(Kit.Num(summary, "world.after"))}.",
                    Kit.WhyTrace("Worldwide popularity change", change, Kit.Obj(summary, "world.trace"), "points")));
                count++;
            }
            if (Kit.Num(result, "gate") is double gate)
            {
                double attendance = Kit.Num(crowd, "attendance") ?? Kit.Num(result, "attendance") ?? 0;
                changes.Add(Change(DsState.Good, "money", $"A {TextFormat.Money((long)gate)} gate", $"{TextFormat.Number((long)attendance)} people bought tickets.", null));
                count++;
            }
            if (count == 0) changes.Add(Ds.Text("A quiet night: nothing big changed.", "fc-hint"));
            side.Add(changes);

            // Star of the night: the best-rated match's winner.
            JToken best = segments.Where(segment => Kit.Obj(segment, "rating") != null && Kit.Str(segment, "kind") == "match")
                .OrderByDescending(segment => Kit.Num(segment, "rating.score") ?? 0).FirstOrDefault();
            if (best != null)
            {
                Matchup matchup = Matchups.FromResult(best, people, true);
                VisualElement star = Ds.Panel("Star of the night", null, null).Named("results-star");
                VisualElement row = Ds.Row("ds-row--top");
                row.Add(DsCards.PortraitBox(matchup.A?.Picture, matchup.A?.Alignment ?? Alignment.Tweener, "ds-portrait--md", matchup.A?.Champion != null));
                VisualElement words = Ds.Column("fc-star-night__words");
                words.Add(Ds.Text(TextFormat.Upper(matchup.A?.Name ?? string.Empty), "ds-type-title"));
                words.Add(new Stars(matchup.Stars ?? 0, "ds-icon--md"));
                words.Add(Ds.Text($"Best match of the night: the {Kit.Str(best, "roleLabel")?.ToLowerInvariant()}.", "ds-type-caption"));
                row.Add(words);
                star.Add(row);
                side.Add(star);
            }

            JToken breakdownRows = Kit.Obj(result, "breakdown.rows");
            if (breakdownRows != null && Kit.Arr(breakdownRows).Any())
            {
                VisualElement breakdown = Ds.Panel("How the score added up", null, null).Named("results-breakdown");
                breakdown.Add(Ds.KeyValues(Kit.Arr(breakdownRows).Select(row => (Kit.Str(row, "label"), $"{Kit.Whole(Kit.Num(row, "score"))} × {Kit.Num(row, "weight"):0.##}")).ToArray()));
                side.Add(breakdown);
            }

            VisualElement next = Ds.Row("fc-results-next");
            next.Add(Ds.Button("Booking", () => context.Navigator.Go(ShellRoute.To("booking")), DsButtonKind.Ghost, "booking"));
            next.Add(Ds.Spacer());
            SkewButton done = Ds.Cta("Back to the office", () => context.Navigator.Go(NavigationModel.HomeItemId), "chevron-right");
            done.name = "results-done";
            next.Add(done);
            side.Add(next);
            return side;
        }

        private static VisualElement Change(DsState state, string icon, string title, string detail, VisualElement why)
        {
            VisualElement row = Ds.Row("fc-change", Ds.StateClass(state));
            VisualElement badge = Ds.Column("fc-change__icon");
            badge.Add(new Icon(icon, "ds-icon--md"));
            row.Add(badge);
            VisualElement words = Ds.Column("fc-change__words");
            words.Add(Ds.Text(title, "fc-change__title"));
            words.Add(Ds.Text(detail, "fc-change__detail"));
            row.Add(words);
            row.AddOpt(why);
            return row;
        }
    }

    /// <summary>One segment's full report in a side sheet: result, rating and why, title news, storylines, physical toll.</summary>
    public static class SegmentReport
    {
        public static void Open(VisualElement anchor, JToken segment, Dictionary<string, List<JToken>> tolls)
        {
            VisualElement body = FightCardStyles.Apply(Build(segment, tolls));
            DsOverlay.SideSheet(anchor, ShowNightScreen.SegmentTitle(segment), body, $"{Kit.Str(segment, "roleLabel")} · {Kit.Str(segment, "typeName")}", null, 560f);
        }

        private static VisualElement Build(JToken segment, Dictionary<string, List<JToken>> tolls)
        {
            VisualElement body = Ds.Column("fc-report").Named("segment-report");
            JToken outcome = Kit.Obj(segment, "outcome");
            if (outcome != null)
            {
                string kind = Kit.Str(outcome, "kind");
                string text = kind == "draw" ? "A draw" : kind == "noContest" ? "No contest" : null;
                if (kind == "win")
                {
                    int side = (int)(Kit.Num(outcome, "winningSide") ?? 0);
                    string winner = Kit.Arr(segment, "sides").Where(entry => (int)(Kit.Num(entry, "side") ?? -1) == side).Select(entry => Kit.Str(entry, "label")).FirstOrDefault();
                    text = $"{winner} won by {Kit.Str(outcome, "methodName")?.ToLowerInvariant()}";
                    if (Kit.Str(outcome, "finishName") is string finish) text += $" ({finish})";
                }
                VisualElement line = Ds.Row("fc-kv-why");
                line.Add(Ds.Text(text, "fc-details-title"));
                line.AddOpt(Kit.WhyRef("Result", 0, Kit.Obj(outcome, "resultTraceRef"), null, "Why this result"));
                body.Add(line);
            }
            JToken rating = Kit.Obj(segment, "rating");
            if (rating != null)
            {
                double score = Kit.Num(rating, "score") ?? 0;
                VisualElement starRow = Ds.Row("fc-expect");
                starRow.Add(new Stars((float)(Kit.Num(rating, "stars") ?? 0), "ds-icon--md"));
                starRow.Add(Ds.Text($"{CardWords.StarsWord(Kit.Num(rating, "stars") ?? 0)} · score {Kit.Whole(score)}", "fc-expect__word"));
                starRow.Add(Ds.Spacer());
                starRow.AddOpt(Kit.WhyRef("Segment score", score, Kit.Obj(rating, "traceRef"), "points"));
                body.Add(starRow);
                VisualElement meters = Ds.Column("fc-read");
                if (Kit.Num(rating, "workRate") is double work) meters.Add(Ds.Meter((float)(work / 100), DsState.Good, $"Work rate {work:0}"));
                if (Kit.Num(rating, "crowd") is double crowd) meters.Add(Ds.Meter((float)(crowd / 100), DsState.Live, $"Crowd {crowd:0}"));
                if (Kit.Num(rating, "expectation") is double expected) meters.Add(Ds.Meter((float)(expected / 100), DsState.Info, $"Expected {expected:0}"));
                body.Add(meters);
                if (Kit.Arr(rating, "reasons").Any())
                {
                    body.Add(Ds.SectionHeader("Why it rated so"));
                    foreach (JToken reason in Kit.Arr(rating, "reasons"))
                    {
                        double effect = Kit.Num(reason, "effect") ?? 0;
                        body.Add(Ds.Row("fc-feed__line").With(
                            Ds.Text($"{(effect >= 0 ? "+" : TextFormat.Minus)}{System.Math.Abs(effect):0.0}", "fc-feed__mark", effect >= 0 ? "fc-feed__mark--good" : "fc-feed__mark--bad"),
                            Ds.Text(Kit.Str(reason, "label"), "fc-feed__text")));
                    }
                }
            }
            else body.Add(Ds.Text("Not run yet.", "fc-hint"));

            foreach (JToken title in Kit.Arr(segment, "titles"))
            {
                string titleOutcome = Kit.Str(title, "outcome");
                if (titleOutcome == "none") continue;
                body.Add(Ds.Pill(titleOutcome == "newChampion" ? DsState.Gold : DsState.Neutral,
                    titleOutcome == "newChampion" ? $"New {Kit.Str(title, "name")}: {string.Join(" & ", Kit.Arr(title, "newHolderNames").Select(name => (string)name))}"
                    : titleOutcome == "retained" ? $"{Kit.Str(title, "name")} retained" : $"{Kit.Str(title, "name")} still vacant", "trophy"));
            }
            if (Kit.Arr(segment, "storylines").Any())
            {
                body.Add(Ds.Text("Storylines: " + string.Join(", ", Kit.Arr(segment, "storylines").Select(story => Kit.Str(story, "name"))), "fc-hint"));
            }

            if (tolls != null && tolls.TryGetValue(Kit.Str(segment, "segmentId") ?? string.Empty, out List<JToken> workers) && workers.Count > 0)
            {
                body.Add(Ds.SectionHeader("Physical toll"));
                foreach (JToken worker in workers)
                {
                    double fatigue = Kit.Num(worker, "fatigueGain.value") ?? 0;
                    double chance = Kit.Num(worker, "injuryChance.value") ?? 0;
                    bool injured = Kit.Bool(worker, "injured.value");
                    VisualElement row = Ds.Row("fc-feed__line");
                    row.Add(Ds.Text(Kit.Str(worker, "name"), "fc-feed__text"));
                    row.Add(Ds.Spacer());
                    row.Add(Ds.Text($"Tired +{fatigue:0.0}", "fc-hint"));
                    row.AddOpt(Kit.WhyRef("Tiredness", fatigue, Kit.Obj(worker, "fatigueGain.traceRef")));
                    row.Add(Ds.Text($" · injury chance {chance * 100:0.0}%", "fc-hint"));
                    row.AddOpt(Kit.WhyRef("Injury chance", chance, Kit.Obj(worker, "injuryChance.traceRef"), "probability"));
                    if (injured) row.Add(Ds.Pill(DsState.Bad, "Injured", "injured"));
                    body.Add(row);
                }
            }
            return body;
        }
    }
}
