using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace RingsideBooker.UI.Why
{
    /// <summary>Which way a step moved the running value. Shown with a sign or word too, never colour alone.</summary>
    public enum TraceTone
    {
        Neutral,
        Positive,
        Negative,
    }

    /// <summary>One row's words, in reading order (the web's <c>TraceLine</c>).</summary>
    public sealed class TraceLine
    {
        public TraceLine(string text, string badge = null, IReadOnlyList<string> details = null,
            TraceTone tone = TraceTone.Neutral, bool hiddenByDefault = false, IReadOnlyList<string> items = null)
        {
            Text = text;
            Badge = badge;
            Details = details ?? Array.Empty<string>();
            Tone = tone;
            HiddenByDefault = hiddenByDefault;
            Items = items ?? Array.Empty<string>();
        }

        /// <summary>The sentence itself.</summary>
        public string Text { get; }
        /// <summary>A short chip after the sentence, such as "Custom setting".</summary>
        public string Badge { get; }
        /// <summary>Muted detail after the sentence: before → after, a reason, a random stream.</summary>
        public IReadOnlyList<string> Details { get; }
        public TraceTone Tone { get; }
        /// <summary>True for checks that changed nothing; the panel hides them until asked.</summary>
        public bool HiddenByDefault { get; }
        /// <summary>Lines listed under the row, such as the options a decision weighed.</summary>
        public IReadOnlyList<string> Items { get; }
    }

    /// <summary>
    /// The words for every trace row: a port of the web app's
    /// <c>apps/web/src/components/Trace/wording.ts</c>. The panel's rows and Copy as text both
    /// read them from here, so a bug report says exactly what the player saw, in the same words
    /// as the web panel. Keep the two in step: a wording change on the web needs the same change
    /// here (the EditMode tests compare against text the web code wrote).
    /// </summary>
    public static class TraceWording
    {
        /// <summary>Separator between a row's sentence, badge and details in plain text.</summary>
        public const string TextSeparator = " · ";

        /// <summary>The engine's "Best stat" decision label (angle rater, MTCH5-02).</summary>
        public const string BestStatLabel = "Best stat";

        /// <summary>Beat stat codes and their player-facing labels (engine <c>BEAT_STAT_LABELS</c>).</summary>
        public static readonly IReadOnlyDictionary<string, string> BeatStatLabels = new Dictionary<string, string>
        {
            ["mic"] = "Mic",
            ["charisma"] = "Charisma",
            ["presence"] = "Presence",
            ["athleticism"] = "Athleticism",
            ["ringwork"] = "Ring work",
            ["psychology"] = "Psychology",
            ["broadcasting"] = "Broadcasting",
            ["popularity"] = "Popularity here",
        };

        /// <summary>The engine's default labels for each rounding mode, which double as the sentence's verb.</summary>
        public static readonly IReadOnlyDictionary<string, string> RoundWords = new Dictionary<string, string>
        {
            ["round"] = "Rounded",
            ["floor"] = "Rounded down",
            ["ceil"] = "Rounded up",
        };

        private static readonly Regex ChoiceCodePattern = new Regex(@"^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*\z", RegexOptions.CultureInvariant);
        private static readonly Regex SideCodePattern = new Regex(@"^side:([0-9]+)\z", RegexOptions.CultureInvariant);
        private static readonly Regex ContentKeyPattern = new Regex(@"^[a-z][a-zA-Z]*\.([a-z0-9]+(?:-[a-z0-9]+)*)\z", RegexOptions.CultureInvariant);
        private static readonly Regex BeatStatOptionPattern = new Regex(@"^([a-z]+)(:manager)?\z", RegexOptions.CultureInvariant);

        /// <summary>A row as one line of plain text: the sentence, then its badge and details.</summary>
        public static string LineText(TraceLine line)
        {
            var parts = new List<string> { line.Text };
            if (line.Badge != null) parts.Add(line.Badge);
            parts.AddRange(line.Details);
            return string.Join(TextSeparator, parts);
        }

        /// <summary>The words for one node, by its kind.</summary>
        public static TraceLine Describe(TraceNode node)
        {
            switch (node.Kind)
            {
                case TraceKinds.Formula:
                    return new TraceLine($"{node.Label}: {TraceFormat.Value(node.Value, node.Unit)}");
                case TraceKinds.Input:
                    return new TraceLine($"{node.Label}: {TraceFormat.Value(node.Value, node.Unit)}");
                case TraceKinds.Constant:
                    return new TraceLine($"{node.Label}: {ConstantValueText(node)}",
                        details: new[] { $"Fixed: {node.Reason}" });
                case TraceKinds.Tunable:
                    return TunableLine(node);
                case TraceKinds.Add:
                case TraceKinds.Subtract:
                case TraceKinds.Multiply:
                case TraceKinds.Divide:
                case TraceKinds.Power:
                    return ArithmeticLine(node);
                case TraceKinds.Min:
                case TraceKinds.Max:
                case TraceKinds.Clamp:
                    return LimitLine(node);
                case TraceKinds.Round:
                    return RoundLine(node);
                case TraceKinds.Roll:
                    return RollLine(node);
                case TraceKinds.Branch:
                    return BranchLine(node);
                case TraceKinds.Decision:
                    return DecisionLine(node);
                case TraceKinds.Note:
                    return NoteLine(node);
                default:
                    // The web refuses to build with a kind it has no words for; at run time the
                    // game shows the label and value rather than failing the whole panel.
                    return new TraceLine($"{node.Label}: {TraceFormat.Value(node.Value, node.Unit)}",
                        details: new[] { $"Unknown step kind {node.Kind}" });
            }
        }

        /// <summary>A trace's own value as the headline shows it: a decision's choice in words, a number in its unit.</summary>
        public static string ValueText(TraceNode node)
        {
            if (node.Kind == TraceKinds.Decision) return OptionText(node, node.Chosen);
            return TraceFormat.Value(node.Value, node.Unit);
        }

        private static string ConstantValueText(TraceNode node) =>
            node.Value.IsNumber ? TraceFormat.Number(node.Value.Number, node.Unit) : TraceFormat.Value(node.Value, node.Unit);

        private static TraceTone ToneOf(double before, double after)
        {
            if (after > before) return TraceTone.Positive;
            if (after < before) return TraceTone.Negative;
            return TraceTone.Neutral;
        }

        private static string BeforeAfter(TraceNode node) => TraceFormat.Change(node.Before, node.After, node.Unit);

        private static string ArithmeticBeforeAfter(TraceNode node)
        {
            if (node.BeforeUnit == null) return BeforeAfter(node);
            return $"{TraceFormat.Number(node.Before, node.BeforeUnit)} → {TraceFormat.Number(node.After, node.Unit)}";
        }

        /// <summary>A setting's value: a choice setting's option in words ("Standard", not <c>standard</c>).</summary>
        private static string TunableValueText(TraceValue value, TraceNode node) =>
            value.IsText ? ChoiceText(value) : TraceFormat.Value(value, node.Unit);

        private static TraceLine TunableLine(TraceNode node)
        {
            string text = $"{node.Label}: {TunableValueText(node.Value, node)}";
            if (node.Overridden)
            {
                return new TraceLine(text, badge: "Custom setting",
                    details: new[] { $"default {TunableValueText(node.DefaultValue, node)}", node.Key });
            }
            return new TraceLine(text, details: new[] { "Game setting", node.Key });
        }

        private static string Factor(double operand, string operandUnit = null) =>
            TraceFormat.Number(operand, operandUnit ?? TraceUnits.Ratio);

        private static string ArithmeticSentence(TraceNode node)
        {
            switch (node.Kind)
            {
                case TraceKinds.Add:
                    return $"{TraceFormat.Delta(node.Operand, node.Unit)} {node.Label}";
                case TraceKinds.Subtract:
                    return $"{TraceFormat.Delta(-node.Operand, node.Unit)} {node.Label}";
                case TraceKinds.Multiply:
                    return $"×{Factor(node.Operand, node.OperandUnit)} {node.Label}";
                case TraceKinds.Divide:
                    return $"÷{Factor(node.Operand, node.OperandUnit)} {node.Label}";
                default: // power
                    return $"{Factor(node.Before)} raised to the power {Factor(node.Operand)} = {Factor(node.After)} ({node.Label})";
            }
        }

        private static TraceLine ArithmeticLine(TraceNode node)
        {
            var details = new List<string> { ArithmeticBeforeAfter(node) };
            if (node.Reason != null) details.Add(node.Reason);
            // A step that changes the unit compares two different things, so it is neither up nor down.
            TraceTone tone = node.BeforeUnit == null ? ToneOf(node.Before, node.After) : TraceTone.Neutral;
            return new TraceLine(ArithmeticSentence(node), details: details, tone: tone);
        }

        private static string AppliedLimitSentence(TraceNode node)
        {
            string change = BeforeAfter(node);
            return node.After < node.Before ? $"Capped {change} (maximum)" : $"Raised {change} (minimum)";
        }

        private static string UnappliedLimitSentence(TraceNode node)
        {
            string checkedValue = TraceFormat.Number(node.Before, node.Unit);
            switch (node.Kind)
            {
                case TraceKinds.Clamp:
                    return $"Checked {checkedValue} against {TraceFormat.Number(node.Min, node.Unit)}–{TraceFormat.Number(node.Max, node.Unit)}: already in range";
                case TraceKinds.Min:
                    return $"Checked {checkedValue} against a maximum of {TraceFormat.Number(node.Limit, node.Unit)}: not reached";
                default:
                    return $"Checked {checkedValue} against a minimum of {TraceFormat.Number(node.Limit, node.Unit)}: not reached";
            }
        }

        private static TraceLine LimitLine(TraceNode node)
        {
            if (node.Applied)
            {
                return new TraceLine(AppliedLimitSentence(node), details: new[] { node.Label },
                    tone: ToneOf(node.Before, node.After));
            }
            return new TraceLine(UnappliedLimitSentence(node), details: new[] { node.Label }, hiddenByDefault: true);
        }

        private static TraceLine RoundLine(TraceNode node)
        {
            string word = node.Mode != null && RoundWords.TryGetValue(node.Mode, out string found) ? found : "Rounded";
            return new TraceLine($"{word} {BeforeAfter(node)}",
                details: node.Label == word ? Array.Empty<string>() : new[] { node.Label },
                tone: ToneOf(node.Before, node.After));
        }

        private static string OutcomeWord(TraceValue result)
        {
            if (result.IsBool) return result.Bool ? "yes" : "no";
            return TraceFormat.Value(result);
        }

        /// <summary>A range end as it was rolled: plain numbers, since a roll's range has no unit.</summary>
        private static string RangeEnd(double? value) => value.HasValue ? TraceFormat.Number(value.Value) : "?";

        /// <summary><c>0–100</c>, or <c>−3 to 3</c> when a minus sign would sit next to the dash.</summary>
        private static string RangeText(double? min, double? max)
        {
            string separator = (min ?? 0) < 0 || (max ?? 0) < 0 ? " to " : "–";
            return RangeEnd(min) + separator + RangeEnd(max);
        }

        private static string RollSentence(RollRecord roll)
        {
            string result = OutcomeWord(roll.Result);
            string odds = roll.Odds.HasValue ? TraceFormat.Number(roll.Odds.Value, TraceUnits.Probability) : "?";
            string options = roll.Options.HasValue ? TraceFormat.Number(roll.Options.Value) : "?";
            switch (roll.Kind)
            {
                case "int":
                    return $"rolled {result} on {RangeText(roll.Min, roll.Max)} (both ends possible)";
                case "float":
                    return $"rolled {result} on {RangeText(roll.Min, roll.Max)} ({RangeEnd(roll.Min)} possible, {RangeEnd(roll.Max)} not)";
                case "chance":
                    return $"{odds} chance, came up {result}";
                case "oneIn":
                    return $"1 in {options} chance, came up {result}";
                case "normal":
                    return $"rolled {result} on a bell curve";
                case "pick":
                    return $"picked {result} from {options} options (1 in {options} each)";
                case "weighted":
                    return $"picked {result} from {options} options ({odds} chance)";
                default:
                    return $"rolled {result}";
            }
        }

        private static TraceLine RollLine(TraceNode node)
        {
            RollRecord roll = node.Roll ?? new RollRecord { Stream = string.Empty, Kind = string.Empty, Result = node.Value };
            return new TraceLine($"{node.Label}: {RollSentence(roll)}", details: new[] { $"Random stream {roll.Stream}" });
        }

        private static TraceLine BranchLine(TraceNode node)
        {
            string[] details = node.Label == node.Condition ? Array.Empty<string>() : new[] { node.Label };
            if (node.Taken) return new TraceLine($"Because {node.Condition}", details: details);
            return new TraceLine($"Did not apply: {node.Condition}", details: details, hiddenByDefault: true);
        }

        /// <summary>"count-out" → "Count out".</summary>
        private static string SlugWords(string slug)
        {
            string words = slug.Replace('-', ' ');
            return Capitalise(words);
        }

        private static string Capitalise(string words) =>
            words.Length == 0 ? words : char.ToUpperInvariant(words[0]) + words.Substring(1);

        /// <summary>
        /// A decision's option as the player reads it: codes the data uses read as words
        /// (<c>mainEvent</c> → "Main event"), a content key as its slug (<c>method.count-out</c> →
        /// "Count out"), a side code as the side's number (<c>side:0</c> → "Side 1"). Text that is
        /// not a code is left as it is.
        /// </summary>
        public static string ChoiceText(TraceValue option)
        {
            if (option.IsBool) return option.Bool ? "yes" : "no";
            if (!option.IsText) return TraceFormat.Value(option);
            return ChoiceText(option.Text);
        }

        /// <inheritdoc cref="ChoiceText(TraceValue)"/>
        public static string ChoiceText(string option)
        {
            Match side = SideCodePattern.Match(option);
            if (side.Success) return "Side " + (double.Parse(side.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            Match contentKey = ContentKeyPattern.Match(option);
            if (contentKey.Success) return SlugWords(contentKey.Groups[1].Value);
            if (!ChoiceCodePattern.IsMatch(option)) return option;
            var words = new System.Text.StringBuilder();
            foreach (char c in option)
            {
                if (c >= 'A' && c <= 'Z') words.Append(' ').Append(char.ToLowerInvariant(c));
                else words.Append(c);
            }
            return Capitalise(words.ToString());
        }

        /// <summary>
        /// One of a decision's options in words. A side code the decision weighed with the side's
        /// names as its reason reads as those names.
        /// </summary>
        private static string OptionText(TraceNode node, TraceValue option)
        {
            if (option.IsText && SideCodePattern.IsMatch(option.Text))
            {
                ConsideredOption named = node.Considered?.FirstOrDefault(entry => entry.Option == option);
                if (named?.Reason != null) return named.Reason;
            }
            if (option.IsText && node.Label == BestStatLabel)
            {
                string stat = BeatStatOptionText(option.Text);
                if (stat != null) return stat;
            }
            return ChoiceText(option);
        }

        /// <summary>"Ring work" or "Mic via manager": an option of the angle rater's "Best stat" decision.</summary>
        private static string BeatStatOptionText(string option)
        {
            Match match = BeatStatOptionPattern.Match(option);
            if (!match.Success || !BeatStatLabels.TryGetValue(match.Groups[1].Value, out string label)) return null;
            return match.Groups[2].Success ? label + " via manager" : label;
        }

        private static TraceLine DecisionLine(TraceNode node)
        {
            IReadOnlyList<ConsideredOption> considered = node.Considered ?? Array.Empty<ConsideredOption>();
            string Describe(string prefix, ConsideredOption option)
            {
                string words = OptionText(node, option.Option);
                string text = $"{prefix}: {words}, score {TraceFormat.Number(option.Score)}";
                return option.Reason == null || option.Reason == words ? text : text + TextSeparator + option.Reason;
            }
            var items = new List<string>();
            items.AddRange(considered.Where(option => option.Option == node.Chosen).Select(option => Describe("Chosen", option)));
            items.AddRange(considered.Where(option => option.Option != node.Chosen).Select(option => Describe("Also considered", option)));
            return new TraceLine($"{node.Label}: {OptionText(node, node.Chosen)}", details: new[] { node.Reason }, items: items);
        }

        private static TraceLine NoteLine(TraceNode node)
        {
            if (!node.Value.IsNumber) return new TraceLine(node.Label);
            return new TraceLine(node.Label, details: new[] { $"running value {TraceFormat.Number(node.Value.Number, node.Unit)}" });
        }
    }
}
