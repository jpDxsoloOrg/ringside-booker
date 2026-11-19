using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.MatchLab
{
    /// <summary>
    /// The lab's result column: the night in full (winner, finish, score, stars and the numbers behind
    /// them, each with a quiet Why?), the winner odds over Runs nights, each worker's lines, the
    /// physical toll (with the "fatigue going in" what-if) and the aftermath; for an angle, the score
    /// and every beat's score. Words lead; the numbers sit one step away.
    /// </summary>
    public static class LabResults
    {
        private static readonly (double? value, string label)[] FatigueWhatIfs =
        {
            (null, "As now"),
            (0, "Fresh"),
            (50, "Tired"),
            (85, "Exhausted"),
        };

        // ---- Match --------------------------------------------------------------------------------

        public static void Match(VisualElement column, LabState state, LabView view, string today, JToken matchType)
        {
            LabRun run = state.LastRun;
            VisualElement panel = Ds.Panel("Result", null, null, "lab-panel", "lab-result").Named("lab-result");
            column.Add(panel);
            if (run == null)
            {
                panel.Add(Ds.Empty("lab", "Nothing run yet", "Put someone on every side and press Run. Raise Runs to see how often each side wins."));
                return;
            }

            JToken simulation = run.Simulation;
            JToken preview = run.Preview;
            VisualElement flags = Ds.Row("ds-row--wrap", "lab-flags");
            if (state.IsOutOfDate(run)) flags.Add(Ds.Pill(DsState.Warn, "Changed since this run: run again", "reset"));
            if (run.Date != null && today != null && run.Date != today) flags.Add(Ds.Pill(DsState.Neutral, $"Rated on {Kit.Date(run.Date)}", "calendar"));
            if (flags.childCount > 0) panel.Add(flags);
            if (run.Batch != null) panel.Add(Ds.Text($"The last of {LabText.RunsText(run.Runs)}, in full. The odds for all of them are below.", "lab-quiet"));

            List<List<string>> sides = (run.Args?["sides"] as JArray)?.Select(side => side.Select(id => (string)id).ToList()).ToList() ?? new List<List<string>>();
            int? winner = Kit.Num(simulation, "winningSide") is double won ? (int)won : (int?)null;
            string outcome = Kit.Str(simulation, "outcome.kind");
            string finishText = outcome == "draw" ? "Draw" : outcome == "noContest" ? "No contest"
                : string.Join(" · ", new[] { Kit.Str(simulation, "finish.name"), Kit.Str(simulation, "method.name") }.Where(text => text != null));

            string SideNames(int side) => side < sides.Count ? ScreenDs.JoinNames(sides[side].Select(state.NameOf)) : LabText.SideLabel(side);
            if (sides.Count == 2)
            {
                var matchup = new Matchup
                {
                    Slot = LabText.SlotWord(Kit.Str(preview, "slot.role")),
                    MatchType = Kit.Str(matchType, "name") ?? "Match",
                    A = new MatchupSide(SideNames(0), Alignment.Face),
                    B = new MatchupSide(SideNames(1), Alignment.Heel),
                    Length = LabText.TimeWord(Kit.Str(preview, "slot.durationClass")),
                    Stars = (float?)Kit.Num(preview, "stars.value"),
                    Winner = outcome == "win" ? winner : null,
                    Finish = finishText,
                };
                VisualElement card = DsCards.MatchupCard(matchup);
                card.name = "lab-matchup";
                panel.Add(card);
            }
            else
            {
                VisualElement list = Ds.Column("lab-multi");
                for (int side = 0; side < sides.Count; side++)
                {
                    VisualElement row = Ds.Row("lab-multi__row");
                    bool won = outcome == "win" && winner == side;
                    row.Add(new Icon(won ? "crown" : "user", "ds-icon--sm", won ? "lab-multi__crown" : "lab-multi__icon"));
                    row.Add(Ds.Text(SideNames(side), won ? "lab-multi__winner" : "lab-multi__name"));
                    list.Add(row);
                }
                list.Add(Ds.Text(finishText, "lab-quiet"));
                panel.Add(list);
            }

            // Who won, in words, with the decision's Why?.
            string headline = outcome == "win" && winner.HasValue ? $"{SideNames(winner.Value)} win{(sides.ElementAtOrDefault(winner.Value)?.Count > 1 ? string.Empty : "s")}" : finishText;
            VisualElement verdict = Ds.Row("lab-verdict");
            verdict.Add(Ds.Text(headline, "lab-verdict__text"));
            ScreenDs.WhyDecision(verdict, "Why this result?", Kit.Str(simulation, "resultTrace.value") ?? headline, Kit.Obj(simulation, "resultTrace"));
            panel.Add(verdict);

            panel.Add(ScoreRow(preview, "Segment score"));
            panel.Add(Tiles(preview, new[]
            {
                ("Work rate", "workRate", "How well they worked: in-ring, stamina and how the styles met."),
                ("Crowd", "crowd", "How much the crowd got into it."),
                ("Expected", "expectation", "What the crowd came in expecting from these names in this spot."),
                ("Star power", "starPower", "How big the names are in this region."),
            }));
            double score = Kit.Num(preview, "score.value") ?? 0;
            double expected = Kit.Num(preview, "expectation.value") ?? 0;
            panel.Add(Ds.Text($"{LabText.ExpectationGap(score, expected)} · {Kit.Str(preview, "policy.label") ?? "Full rules"}", "lab-quiet"));
            Warnings(panel, preview);

            if (run.Batch != null) column.Add(Odds(run.Batch));
            column.Add(WorkerLines(preview));
            JToken physical = Kit.Obj(simulation, "extensions.physical");
            if (physical != null && physical.Type == JTokenType.Object) column.Add(Physical(physical, run.Batch, state, view));
            JToken aftermath = Kit.Obj(simulation, "aftermath");
            if (aftermath != null && aftermath.Type == JTokenType.Object) column.Add(Aftermath(aftermath, view));
        }

        private static VisualElement ScoreRow(JToken rated, string scoreLabel)
        {
            double score = Kit.Num(rated, "score.value") ?? 0;
            double stars = Kit.Num(rated, "stars.value") ?? 0;
            VisualElement row = Ds.Row("lab-score").Named("lab-score");
            VisualElement number = Ds.Column("lab-score__block");
            VisualElement top = Ds.Row("lab-score__top");
            top.Add(Ds.Text("SCORE", "lab-score__label"));
            number.Add(top);
            number.Add(Ds.Text(Kit.Whole(score), "lab-score__value"));
            ScreenDs.WhyTrace(number, scoreLabel, score, Kit.Obj(rated, "score.trace"), "points", top);
            row.Add(number);
            VisualElement words = Ds.Column("lab-score__words");
            words.Add(Ds.Text(LabText.ScoreWord(score), "lab-score__word"));
            VisualElement starRow = Ds.Row("lab-score__stars");
            starRow.Add(new Stars((float)stars, "ds-icon--md"));
            starRow.Add(Ds.Text($"{stars:0.##} stars", "lab-score__stars-text"));
            ScreenDs.WhyTrace(starRow, "Stars", stars, Kit.Obj(rated, "stars.trace"), "stars");
            words.Add(starRow);
            row.Add(words);
            return row;
        }

        private static VisualElement Tiles(JToken rated, IEnumerable<(string label, string key, string help)> tiles)
        {
            VisualElement row = Ds.Row("lab-tiles").Named("lab-tiles");
            foreach ((string label, string key, string help) in tiles)
            {
                double? value = Kit.Num(rated, $"{key}.value");
                if (!value.HasValue) continue;
                VisualElement tile = Ds.StatTile(label, Kit.Whole(value), LabText.ScoreWord(value.Value), ScoreState(value.Value));
                DsTooltip.Attach(tile, help, label);
                ScreenDs.WhyTrace(tile, label, value.Value, Kit.Obj(rated, $"{key}.trace"), "points", tile.Q(className: "ds-stat__top"));
                row.Add(tile);
            }
            return row;
        }

        private static DsState ScoreState(double value) =>
            value >= 72 ? DsState.Good : value >= 50 ? DsState.Info : value >= 35 ? DsState.Warn : DsState.Bad;

        private static void Warnings(VisualElement panel, JToken rated)
        {
            List<JToken> warnings = Kit.Arr(rated, "warnings").ToList();
            if (warnings.Count == 0) return;
            VisualElement list = Ds.Column("lab-warnings").Named("lab-warnings");
            foreach (JToken warning in warnings)
            {
                DsState state = Kit.Str(warning, "severity") == "error" ? DsState.Bad : DsState.Warn;
                VisualElement pill = Ds.Pill(state, Kit.Str(warning, "message") ?? Kit.Str(warning, "code"));
                pill.AddToClassList("lab-warning");
                list.Add(pill);
            }
            panel.Add(list);
        }

        private static VisualElement Odds(JToken batch)
        {
            int runs = (int)(Kit.Num(batch, "runs") ?? 1);
            VisualElement panel = Ds.Panel($"Over {LabText.RunsText(runs)}", null, null, "lab-panel").Named("lab-odds");
            panel.Add(Ds.Text("WINNER ODDS", "lab-label"));
            foreach (JToken side in Kit.Arr(batch, "sides"))
            {
                double wins = Kit.Num(side, "wins") ?? 0;
                VisualElement row = Ds.Row("lab-odds__row");
                row.Add(Ds.Text(ScreenDs.JoinNames(Kit.Arr(side, "names").Select(name => (string)name)), "lab-odds__name"));
                VisualElement meter = Ds.Meter((float)(runs == 0 ? 0 : wins / runs), wins * 2 >= runs ? DsState.Good : DsState.Info);
                meter.AddToClassList("lab-odds__meter");
                row.Add(meter);
                row.Add(Ds.Text(LabText.ShareText(wins, runs), "lab-odds__share"));
                panel.Add(row);
            }
            double draws = Kit.Num(batch, "draws") ?? 0;
            double noContests = Kit.Num(batch, "noContests") ?? 0;
            if (draws + noContests > 0)
            {
                panel.Add(Ds.Text($"Draws {LabText.ShareText(draws, runs)} · No contests {LabText.ShareText(noContests, runs)}", "lab-quiet"));
            }
            panel.Add(Ds.Text("SCORE", "lab-label", "lab-gap-top"));
            panel.Add(Ds.Text(LabText.StatsSummary(Kit.Obj(batch, "score")), "lab-odds__stats"));
            panel.Add(Ds.Text($"Stars: average {LabText.StatNumber(Kit.Num(batch, "stars.mean") ?? 0)}, from {LabText.StatNumber(Kit.Num(batch, "stars.min") ?? 0)} to {LabText.StatNumber(Kit.Num(batch, "stars.max") ?? 0)}", "lab-quiet"));
            List<JToken> finishes = Kit.Arr(batch, "finishes").OrderByDescending(finish => Kit.Num(finish, "count") ?? 0).ToList();
            if (finishes.Count > 0)
            {
                panel.Add(Ds.Text("FINISHES", "lab-label", "lab-gap-top"));
                VisualElement chips = Ds.Row("ds-row--wrap", "lab-finishes");
                foreach (JToken finish in finishes)
                {
                    chips.Add(Ds.Chip(Kit.Str(finish, "name"), false, null, (int)(Kit.Num(finish, "count") ?? 0)));
                }
                panel.Add(chips);
            }
            return panel;
        }

        private static VisualElement WorkerLines(JToken preview)
        {
            List<JToken> workers = Kit.Arr(preview, "workers").ToList();
            VisualElement panel = Ds.Panel("Each worker", null, null, "lab-panel").Named("lab-workers");
            if (workers.Count == 0) return panel;
            var table = new DsTable<JToken>(new[]
            {
                new DsColumn<JToken>("name", "Name", row => Ds.Text(Kit.Str(row, "name"), "ds-cell__text", "ds-cell__text--strong")) { Grow = 2f, Pinned = true, SortKey = row => Kit.Str(row, "name") },
                new DsColumn<JToken>("side", "Side", row => Ds.Text(LabText.SideLabel((int)(Kit.Num(row, "side") ?? 0)), "ds-cell__text")) { Width = 70, SortKey = row => Kit.Num(row, "side") ?? 0 },
                TraceColumn("inRing", "In-ring", "In-ring", "How they worked in the ring tonight."),
                TraceColumn("entertainment", "Entertainment", "Entertainment", "Charisma and presence on the night."),
                new DsColumn<JToken>("stamina", "Stamina", StaminaCell) { Grow = 1.1f, SortKey = row => Kit.Num(row, "stamina.penalty.value") ?? 0, Help = "Did they have the gas for this length of match?" },
                TraceColumn("popularity", "Popularity", "Popularity", "Popularity in the show's region.", false),
                TraceColumn("momentum", "Momentum", "Momentum", "How hot they are right now.", false),
            }, workers);
            panel.Add(table);
            return panel;
        }

        private static DsColumn<JToken> TraceColumn(string key, string header, string label, string help, bool shown = true) =>
            new DsColumn<JToken>(key, header, row =>
            {
                double value = Kit.Num(row, $"{key}.value") ?? 0;
                VisualElement cell = Ds.Row("lab-cell");
                cell.Add(Ds.Text(Kit.Whole(value), "ds-cell__text", "ds-cell__text--num"));
                ScreenDs.WhyTrace(cell, $"{Kit.Str(row, "name")}: {label}", value, Kit.Obj(row, $"{key}.trace"), "points");
                return cell;
            }) { Width = 120, Align = DsAlign.Right, SortKey = row => Kit.Num(row, $"{key}.value") ?? 0, Help = help, Default = shown };

        private static VisualElement StaminaCell(JToken row)
        {
            double penalty = Math.Abs(Kit.Num(row, "stamina.penalty.value") ?? 0);
            VisualElement cell = Ds.Row("lab-cell");
            cell.Add(penalty == 0 ? Ds.Dot(DsState.Good, "Passed") : Ds.Dot(DsState.Bad, $"Failed {TextFormat.Minus}{LabText.StatNumber(penalty)}"));
            ScreenDs.WhyTrace(cell, $"{Kit.Str(row, "name")}: stamina penalty", -penalty, Kit.Obj(row, "stamina.penalty.trace"), "points");
            return cell;
        }

        private static VisualElement Physical(JToken physical, JToken batch, LabState state, LabView view)
        {
            VisualElement panel = Ds.Panel("Physical toll", null, null, "lab-panel").Named("lab-physical");
            List<JToken> workers = Kit.Arr(physical, "workers").ToList();
            bool anyInjured = workers.Any(worker => Kit.Bool(worker, "injury.injured"));
            panel.Add(Ds.Text(anyInjured ? "Someone got hurt on this night." : "Nobody got hurt on this night. Open a row to try them tired or fresh.", "lab-quiet"));
            var table = new DsTable<JToken>(new[]
            {
                new DsColumn<JToken>("name", "Name", row => Ds.Text(Kit.Str(row, "name"), "ds-cell__text", "ds-cell__text--strong")) { Grow = 2f, Pinned = true, SortKey = row => Kit.Str(row, "name") },
                new DsColumn<JToken>("fatigue", "Fatigue after", row =>
                {
                    double after = Kit.Num(row, "fatigueAfter") ?? 0;
                    string word = LabText.FatigueWord(after);
                    return Ds.Dot(after >= 65 ? DsState.Warn : DsState.Good, Kit.Bool(row, "fatigueWhatIf") ? $"{word} (what-if)" : word);
                }) { Grow = 1.2f, SortKey = row => Kit.Num(row, "fatigueAfter") ?? 0, Help = "How tired they'd be the next day." },
                new DsColumn<JToken>("injury", "Injury risk", row =>
                {
                    if (Kit.Bool(row, "injury.injured")) return Ds.Pill(DsState.Bad, "Injured", "injured");
                    double chance = Kit.Num(row, "injuryChance.value") ?? 0;
                    return Ds.Dot(chance >= 0.03 ? DsState.Warn : DsState.Neutral, LabText.ChanceText(chance));
                }) { Grow = 1.3f, SortKey = row => Kit.Num(row, "injuryChance.value") ?? 0 },
                new DsColumn<JToken>("worst", "Sorest spot", row =>
                {
                    double condition = Kit.Num(row, "worstPartAfter.value") ?? 100;
                    return Ds.Text($"{Kit.Capital(Kit.Str(row, "worstPartAfter.part") ?? "-")}: {LabText.ConditionWord(condition)}", "ds-cell__text");
                }) { Grow = 1.3f, SortKey = row => Kit.Num(row, "worstPartAfter.value") ?? 100 },
                new DsColumn<JToken>("learning", "Learned", row => Ds.Text(LabText.Signed(Kit.Num(row, "learning.value") ?? 0, 2), "ds-cell__text", "ds-cell__text--num")) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "learning.value") ?? 0 },
                new DsColumn<JToken>("wear", "Wear", row => Ds.Text(LabText.StatNumber(Math.Round(Kit.Num(row, "wearTotal.value") ?? 0, 1)), "ds-cell__text", "ds-cell__text--num")) { Width = 80, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "wearTotal.value") ?? 0 },
            }, workers, row => FatigueWhatIf(row, state, view));
            panel.Add(table);

            JToken summary = Kit.Obj(batch, "extensionSummaries.physical");
            if (summary != null && summary.Type == JTokenType.Object)
            {
                panel.Add(Ds.Text($"Over {LabText.RunsText((int)(Kit.Num(summary, "runs") ?? 0))}: {LabText.StatNumber(Kit.Num(summary, "injuriesPer100") ?? 0)} injuries per 100 matches.", "lab-quiet"));
            }
            return panel;
        }

        private static VisualElement FatigueWhatIf(JToken row, LabState state, LabView view)
        {
            string personId = Kit.Str(row, "personId");
            VisualElement details = Ds.Column("lab-whatif");
            details.Add(Ds.Text($"Going in now: {LabText.FatigueWord(Kit.Num(row, "fatigueNow") ?? 0)}. Try them another way (the same night again):", "lab-quiet"));
            state.FatigueOverrides.TryGetValue(personId ?? string.Empty, out double current);
            bool hasOverride = personId != null && state.FatigueOverrides.ContainsKey(personId);
            VisualElement chips = Ds.Row("ds-row--wrap");
            foreach ((double? value, string label) in FatigueWhatIfs)
            {
                bool selected = value.HasValue ? hasOverride && Math.Abs(current - value.Value) < 0.01 : !hasOverride;
                double? target = value;
                Button chip = Ds.Chip(label, selected, () =>
                {
                    if (personId == null) return;
                    if (target.HasValue) state.FatigueOverrides[personId] = target.Value;
                    else state.FatigueOverrides.Remove(personId);
                    _ = view.RunAsync(sameSeed: true);
                });
                chip.name = $"whatif-{personId}-{label.ToLowerInvariant().Replace(' ', '-')}";
                chips.Add(chip);
            }
            details.Add(chips);
            return details;
        }

        private static VisualElement Aftermath(JToken aftermath, LabView view)
        {
            string region = Kit.Str(aftermath, "showRegionName") ?? "the show's region";
            VisualElement panel = Ds.Panel("Aftermath", null, null, "lab-panel").Named("lab-aftermath");
            panel.Add(Ds.Text($"What this would do to them if it happened. Popularity is read in {region}; open a row for the regions around it.", "lab-quiet"));
            List<JToken> workers = Kit.Arr(aftermath, "workers").ToList();
            var table = new DsTable<JToken>(new[]
            {
                new DsColumn<JToken>("name", "Name", row => Ds.Text(Kit.Str(row, "name"), "ds-cell__text", "ds-cell__text--strong")) { Grow = 2f, Pinned = true, SortKey = row => Kit.Str(row, "name") },
                new DsColumn<JToken>("line", "Tonight", row => Ds.Text(Kit.Str(row, "resultLine") ?? Kit.Str(row, "shareText") ?? string.Empty, "ds-cell__text")) { Grow = 1.8f },
                new DsColumn<JToken>("momentum", "Momentum", row => Change(row, "momentum.change", "momentum.delta.trace", $"{Kit.Str(row, "name")}: momentum change")) { Width = 110, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "momentum.change") ?? 0, Help = "How hot they get from this." },
                new DsColumn<JToken>("popularity", "Popularity", row => Change(row, "popularity.delta.value", "popularity.delta.trace", $"{Kit.Str(row, "name")}: popularity change")) { Width = 110, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "popularity.delta.value") ?? 0, Help = $"The change in {region}." },
            }, workers, row =>
            {
                VisualElement details = Ds.Column("lab-aftermath__regions");
                foreach (JToken change in Kit.Arr(row, "popularity.regions").OrderByDescending(item => Math.Abs(Kit.Num(item, "change") ?? 0)).Take(6))
                {
                    VisualElement line = Ds.Row("lab-aftermath__region");
                    line.Add(Ds.Text(Kit.Str(change, "name"), "lab-aftermath__region-name"));
                    line.Add(Ds.Text(Kit.Str(change, "reason") ?? string.Empty, "lab-quiet"));
                    line.Add(Ds.Spacer());
                    line.Add(Ds.Text($"{LabText.StatNumber(Math.Round(Kit.Num(change, "before") ?? 0, 1))} → {LabText.StatNumber(Math.Round(Kit.Num(change, "after") ?? 0, 1))}", "lab-aftermath__region-value"));
                    details.Add(line);
                }
                return details;
            });
            panel.Add(table);
            foreach (JToken note in Kit.Arr(aftermath, "notes")) panel.Add(Ds.Text(note.Type == JTokenType.String ? (string)note : Kit.Str(note, "text") ?? note.ToString(), "lab-quiet"));
            return panel;
        }

        private static VisualElement Change(JToken row, string valuePath, string tracePath, string label)
        {
            double change = Kit.Num(row, valuePath) ?? 0;
            DsState state = change > 0.05 ? DsState.Good : change < -0.05 ? DsState.Bad : DsState.Neutral;
            VisualElement cell = Ds.Row("lab-cell");
            VisualElement trend = Ds.El("ds-trend", Ds.StateClass(state));
            trend.Add(new Icon(state == DsState.Good ? "up" : state == DsState.Bad ? "down" : "flat", "ds-icon--xs"));
            trend.Add(Ds.Text(LabText.Signed(change), "ds-trend__text"));
            cell.Add(trend);
            ScreenDs.WhyTrace(cell, label, change, Kit.Obj(row, tracePath), "points");
            return cell;
        }

        // ---- Angle --------------------------------------------------------------------------------

        public static void Angle(VisualElement column, LabState state, LabView view, string today)
        {
            LabAngleRun run = state.LastAngle;
            VisualElement panel = Ds.Panel("Result", null, null, "lab-panel", "lab-result").Named("lab-result");
            column.Add(panel);
            if (run == null)
            {
                panel.Add(Ds.Empty("megaphone", "Nothing run yet", "Put someone in every beat and press Run to see how the angle lands, beat by beat."));
                return;
            }
            JToken result = run.Result;
            VisualElement flags = Ds.Row("ds-row--wrap", "lab-flags");
            if (state.IsAngleOutOfDate(run)) flags.Add(Ds.Pill(DsState.Warn, "Changed since this run: run again", "reset"));
            if (run.Date != null && today != null && run.Date != today) flags.Add(Ds.Pill(DsState.Neutral, $"Rated on {Kit.Date(run.Date)}", "calendar"));
            string limit = Kit.Str(result, "beatLimit.message");
            if (limit != null) flags.Add(Ds.Pill(DsState.Info, limit, "clock"));
            if (flags.childCount > 0) panel.Add(flags);

            panel.Add(ScoreRow(result, "Angle score"));
            panel.Add(Tiles(result, new[]
            {
                ("Delivered", "delivered", "How well the beats were delivered."),
                ("Crowd", "crowd", "How much the crowd bought it."),
                ("Expected", "expected", "What the crowd expected from these names."),
                ("Star power", "starPower", "How big the names are in this region."),
            }));
            Warnings(panel, result);

            VisualElement beats = Ds.Panel("Beat by beat", null, null, "lab-panel").Named("lab-beat-scores");
            foreach (JToken beat in Kit.Arr(result, "beats"))
            {
                int index = (int)(Kit.Num(beat, "index") ?? 0);
                double score = Kit.Num(beat, "score.value") ?? 0;
                VisualElement card = Ds.Column("lab-beat-score").Named($"lab-beat-score-{index}");
                VisualElement head = Ds.Row("lab-beat-score__head");
                head.Add(Ds.Text($"{index + 1}", "lab-beat__number"));
                head.Add(Ds.Text(Kit.Str(beat, "name"), "lab-beat-score__name"));
                if (Kit.Bool(beat, "physical")) head.Add(Ds.Tag("Physical"));
                if (!Kit.Bool(beat, "counted")) head.Add(Ds.Pill(DsState.Neutral, "Not counted: over the beat limit"));
                head.Add(Ds.Spacer());
                VisualElement meter = Ds.Meter((float)(score / 100.0), ScoreState(score));
                meter.AddToClassList("lab-beat-score__meter");
                head.Add(meter);
                head.Add(Ds.Text(Kit.Whole(score), "lab-beat-score__value"));
                ScreenDs.WhyTrace(head, $"Beat {index + 1}: {Kit.Str(beat, "name")}", score, Kit.Obj(beat, "score.trace"), "points");
                card.Add(head);
                foreach (JToken group in Kit.Arr(beat, "groups"))
                {
                    var people = Kit.Arr(group, "people").Select(person =>
                        $"{Kit.Str(person, "name")} ({Kit.Str(person, "statLabel")} {Kit.Whole(Kit.Num(person, "value.value"))}{(Kit.Bool(person, "viaManager") ? ", via manager" : string.Empty)})");
                    card.Add(Ds.Text($"{Kit.Str(group, "label")}: {string.Join(", ", people)}", "lab-beat-score__people"));
                }
                beats.Add(card);
            }
            column.Add(beats);
            JToken aftermath = Kit.Obj(result, "aftermath");
            if (aftermath != null && aftermath.Type == JTokenType.Object) column.Add(Aftermath(aftermath, view));
        }
    }
}
