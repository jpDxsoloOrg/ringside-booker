using System;
using System.Globalization;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;

namespace RingsideBooker.Screens.MatchLab
{
    /// <summary>
    /// The Match lab's wording (the web's <c>labText.ts</c>), kept apart so it can be tested. Nothing
    /// here says how long a segment runs in minutes (D-10): Short, Standard and Long are the only
    /// "how long" words.
    /// </summary>
    public static class LabText
    {
        public static string SideLabel(int side) => $"Side {side + 1}";

        /// <summary>"1 run", "50 runs".</summary>
        public static string RunsText(int runs) => $"{TextFormat.Number(runs)} {(runs == 1 ? "run" : "runs")}";

        /// <summary>"62%" of <paramref name="count"/> out of <paramref name="total"/>, whole percent.</summary>
        public static string ShareText(double count, double total) =>
            $"{(total <= 0 ? 0 : (int)Math.Round(count / total * 100, MidpointRounding.AwayFromZero))}%";

        /// <summary>A statistic: whole numbers stay whole, anything else gets one decimal.</summary>
        public static string StatNumber(double value) =>
            Math.Abs(value - Math.Round(value)) < 1e-9
                ? Math.Round(value).ToString("0", CultureInfo.InvariantCulture)
                : value.ToString("0.0", CultureInfo.InvariantCulture);

        /// <summary>"Average 63.4 · usually 57–70 · range 49–77" from a batch's stats.</summary>
        public static string StatsSummary(JToken stats)
        {
            if (stats == null || stats.Type != JTokenType.Object) return string.Empty;
            double Get(string key) => stats[key]?.Type == JTokenType.Float || stats[key]?.Type == JTokenType.Integer ? (double)stats[key] : 0;
            return $"Average {StatNumber(Get("mean"))} · usually {StatNumber(Get("p10"))}–{StatNumber(Get("p90"))} · range {StatNumber(Get("min"))}–{StatNumber(Get("max"))}";
        }

        /// <summary>The time word for a duration class; null (the slot's usual time) reads "Usual".</summary>
        public static string TimeWord(string durationClass) => durationClass switch
        {
            "short" => "Short",
            "standard" => "Standard",
            "long" => "Long",
            _ => "Usual",
        };

        public static string SlotWord(string slotRole) => slotRole switch
        {
            "preShow" => "Pre-show",
            "opener" => "Opener",
            "midcard" => "Midcard",
            "semiMain" => "Semi-main",
            "mainEvent" => "Main event",
            _ => slotRole,
        };

        /// <summary>"+1.2", "−0.4", "0" with the typographic minus.</summary>
        public static string Signed(double value, int decimals = 1)
        {
            double rounded = Math.Round(value, decimals, MidpointRounding.AwayFromZero);
            string body = Math.Abs(rounded).ToString(decimals == 0 ? "0" : "0." + new string('#', decimals), CultureInfo.InvariantCulture);
            if (rounded > 0) return "+" + body;
            if (rounded < 0) return TextFormat.Minus + body;
            return "0";
        }

        /// <summary>A chance 0–1 as words and a percent: "Low (0.2%)".</summary>
        public static string ChanceText(double chance)
        {
            string percent = chance * 100 < 1 ? (chance * 100).ToString("0.0", CultureInfo.InvariantCulture) : Math.Round(chance * 100).ToString("0", CultureInfo.InvariantCulture);
            string word = chance >= 0.1 ? "High" : chance >= 0.03 ? "Some" : chance >= 0.005 ? "Low" : "Tiny";
            return $"{word} ({percent}%)";
        }

        /// <summary>A body condition 0–100 in a word.</summary>
        public static string ConditionWord(double condition) =>
            condition >= 90 ? "Fine" : condition >= 75 ? "Sore" : condition >= 55 ? "Banged up" : "Hurting";

        /// <summary>Fatigue 0–100 in a word.</summary>
        public static string FatigueWord(double fatigue) =>
            fatigue < 15 ? "Fresh" : fatigue < 40 ? "Fine" : fatigue < 65 ? "Tired" : fatigue < 85 ? "Worn out" : "Exhausted";

        /// <summary>A 0–100 score in a word, the way the results speak.</summary>
        public static string ScoreWord(double score) =>
            score >= 85 ? "Outstanding" : score >= 72 ? "Great" : score >= 60 ? "Good" : score >= 45 ? "Fair" : "Poor";

        /// <summary>"6 below expectation", "4 above expectation", "right on expectation".</summary>
        public static string ExpectationGap(double got, double expected)
        {
            int gap = (int)Math.Round(got - expected, MidpointRounding.AwayFromZero);
            if (gap == 0) return "Right on expectation";
            return $"{Math.Abs(gap)} {(gap < 0 ? "below" : "above")} expectation";
        }
    }
}
