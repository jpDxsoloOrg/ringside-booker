using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Screens.Draft
{
    /// <summary>
    /// The draft start's words and small rules (DRF-02, DRF-06, DRF-07), kept pure so they are
    /// tested: the wizard's counts, the setting choices, the pool's fit hint, the Why? lines, the
    /// clock banner and how many picks a "Sim to my pick" step shows at once.
    /// </summary>
    public static class DraftText
    {
        public const string StartKey = "draftStart";
        public const string RosterSizeKey = "draftRosterSize";
        public const string PoolSizeKey = "draftPoolSize";
        public const string OrderKey = "draftOrder";
        public const string StaffKey = "draftStaff";
        public const string NegotiateAfterKey = "draftNegotiateAfter";
        public const string ScheduleKey = "draftSchedule";
        public const string StartingCashKey = "draftStartingCash";

        /// <summary>The Contracts free-agent list's line for anyone short of money (DRF-10).</summary>
        public const string PerAppearanceHint = "Short of money? Offer a per-appearance deal: no wage, just a fee each time they work.";

        /// <summary>The draft settings shown under "More draft options" (the rest show with the toggle).</summary>
        public static readonly IReadOnlyList<string> MoreOptionKeys = new[] { PoolSizeKey, OrderKey, StaffKey };

        public static readonly IReadOnlyList<string> CardLevels = new[] { "mainEvent", "upperCard", "midCard", "lowerCard", "enhancement" };

        public static readonly IReadOnlyList<string> WeightClasses = new[] { "lightweight", "cruiserweight", "lightHeavyweight", "heavyweight", "superHeavyweight" };

        public static readonly IReadOnlyList<string> StaffRoles = new[] { "manager", "announcer", "referee", "presenter", "producer" };

        public static readonly IReadOnlyList<string> Genders = new[] { "male", "female", "nonBinary" };

        // ---- Wizard -----------------------------------------------------------------------------

        /// <summary>"12 active promotions, 380 wrestlers" (or "All 14 promotions active, 549 wrestlers").</summary>
        public static string ActiveSummary(int active, int total, int wrestlers)
        {
            string people = $"{TextFormat.Number(wrestlers)} {(wrestlers == 1 ? "wrestler" : "wrestlers")}";
            if (active >= total && total > 0) return $"All {TextFormat.Number(total)} promotions active, {people}";
            return $"{TextFormat.Number(active)} active {(active == 1 ? "promotion" : "promotions")}, {people}";
        }

        /// <summary>
        /// The keys "Only the biggest N" keeps: the first N of <paramref name="biggestFirst"/>, plus
        /// your own promotion (always active) when it is not among them.
        /// </summary>
        public static List<string> Biggest(IEnumerable<string> biggestFirst, int count, string yours)
        {
            List<string> keys = (biggestFirst ?? Enumerable.Empty<string>()).Take(Math.Max(1, count)).ToList();
            if (!string.IsNullOrEmpty(yours) && !keys.Contains(yours)) keys.Add(yours);
            return keys;
        }

        /// <summary>A draft setting's choice in plain words (the engine's keys are camelCase).</summary>
        public static string OptionLabel(string settingKey, string option) => (settingKey, option) switch
        {
            (RosterSizeKey, "auto") => "Auto",
            (PoolSizeKey, "auto") => "Auto",
            (PoolSizeKey, "small") => "Small",
            (PoolSizeKey, "large") => "Large",
            (PoolSizeKey, "all") => "Everyone",
            (OrderKey, "snake") => "Snake",
            (OrderKey, "random") => "Random",
            (OrderKey, "bySize") => "Smallest first",
            (ScheduleKey, "weekly") => "One show a week",
            (ScheduleKey, "open") => "Open",
            (StartingCashKey, "median") => "World median",
            (StartingCashKey, "250k") => "$250k",
            (StartingCashKey, "500k") => "$500k",
            (StartingCashKey, "1m") => "$1M",
            (StartingCashKey, "2m") => "$2M",
            _ => null,
        };

        /// <summary>A card level in words ("Upper midcard"); the engine sends a label too, which wins.</summary>
        public static string LevelWord(string level) => level switch
        {
            "mainEvent" => "Main event",
            "upperCard" => "Upper midcard",
            "midCard" => "Midcard",
            "lowerCard" => "Lower card",
            "enhancement" => "Enhancement",
            _ => level ?? Kit.NoValue,
        };

        /// <summary>A card level's colour: gold for main eventers, down to neutral for enhancement.</summary>
        public static DsState LevelState(string level) => level switch
        {
            "mainEvent" => DsState.Gold,
            "upperCard" => DsState.Good,
            "midCard" => DsState.Info,
            _ => DsState.Neutral,
        };

        public static string WeightClassWord(string weightClass) => weightClass switch
        {
            "lightweight" => "Lightweight",
            "cruiserweight" => "Cruiserweight",
            "lightHeavyweight" => "Light heavyweight",
            "heavyweight" => "Heavyweight",
            "superHeavyweight" => "Super heavyweight",
            _ => weightClass ?? Kit.NoValue,
        };

        public static string GenderWord(string gender) => gender switch
        {
            "male" => "Men",
            "female" => "Women",
            "nonBinary" => "Non-binary",
            _ => gender ?? Kit.NoValue,
        };

        /// <summary>"The level playing field" in one line: cash and home popularity every promotion starts with.</summary>
        public static string LevelLine(double cashCents, double homePopularity, double prestige) => LevelLine(cashCents, homePopularity, prestige, null);

        /// <summary>
        /// The level line with where the cash comes from (DRF-10): "(the world median)" for the
        /// default Starting cash, nothing extra for a chosen amount.
        /// </summary>
        public static string LevelLine(double cashCents, double homePopularity, double prestige, string startingCash) =>
            $"Every promotion starts with {TextFormat.Money((long)Math.Round(cashCents))}{(startingCash == "median" ? " (the world median)" : string.Empty)}, prestige {Whole(prestige)} and popularity {Whole(homePopularity)} at home. No TV deals, every title vacant.";

        // ---- Money (DRF-10) ---------------------------------------------------------------------

        /// <summary>Why a pick is out of reach: "Costs $120,000; you have $80,000."</summary>
        public static string CannotAfford(double costCents, double cashCents) =>
            $"Costs {TextFormat.Money((long)Math.Round(costCents))}; you have {TextFormat.Money((long)Math.Round(cashCents))}.";

        /// <summary>What a pick's season cost is made of, for its tooltip.</summary>
        public static string CostDetail(double wagesCents, double appearances, double feesCents, bool paysUpFront)
        {
            var parts = new List<string>();
            if (wagesCents > 0) parts.Add($"{TextFormat.Money((long)Math.Round(wagesCents))} in wages");
            if (feesCents > 0) parts.Add($"{Whole(appearances)} appearances for {TextFormat.Money((long)Math.Round(feesCents))}");
            string made = parts.Count == 0 ? string.Empty : " (" + string.Join(", ", parts) + ")";
            return paysUpFront
                ? $"Their whole season contract{made}, paid when you draft them."
                : $"Their season contract at their ask{made}. You agree the real terms after the draft.";
        }

        /// <summary>
        /// The quiet hint when a pick leaves less than <paramref name="months"/> months of running
        /// costs (DRF-11), or null when it leaves enough (or running costs are unknown).
        /// </summary>
        public static string ReserveHint(double cashAfterCents, double runningMonthlyCents, double months)
        {
            if (runningMonthlyCents <= 0 || months <= 0 || cashAfterCents >= runningMonthlyCents * months) return null;
            return $"Leaves you {TextFormat.Money((long)Math.Round(cashAfterCents))}: under {Whole(months)} months of running costs ({TextFormat.Money((long)Math.Round(runningMonthlyCents))} a month for shows, venues and medical).";
        }

        /// <summary>
        /// The finish line for a roster you could not fill: null when it is full. Points at
        /// per-appearance deals, which cost nothing up front.
        /// </summary>
        public static string ShortRosterLine(int wrestlersShort, bool outOfMoney)
        {
            if (wrestlersShort <= 0) return null;
            string who = $"{wrestlersShort} {(wrestlersShort == 1 ? "wrestler" : "wrestlers")}";
            return outOfMoney
                ? $"You ran out of money {who} short. Sign free agents on per-appearance deals in Contracts: no wage, just a fee each time they work."
                : $"You are {who} short. Sign free agents on per-appearance deals in Contracts: no wage, just a fee each time they work.";
        }

        /// <summary>"300 wrestlers in the pool, 191 sit out" (staff added when they are drafted).</summary>
        public static string PoolLine(int poolWrestlers, int sittingOut, int poolStaff)
        {
            string line = $"{TextFormat.Number(poolWrestlers)} wrestlers in the pool";
            if (poolStaff > 0) line += $" and {TextFormat.Number(poolStaff)} staff";
            if (sittingOut > 0) line += $", {TextFormat.Number(sittingOut)} sit out";
            return line;
        }

        // ---- The pool -----------------------------------------------------------------------------

        /// <summary>
        /// How a wrestler fits your roster, in words: the gap between your pick score (<c>fit</c>)
        /// and their draft value is what your roster's needs add or take away.
        /// </summary>
        public static (DsState state, string word) Fit(double value, double? fit)
        {
            if (fit == null) return (DsState.Neutral, Kit.NoValue);
            double needs = fit.Value - value;
            if (needs >= 8) return (DsState.Good, "Big need");
            if (needs >= 3) return (DsState.Good, "Good fit");
            if (needs > -3) return (DsState.Neutral, "Fits");
            return (DsState.Warn, "Have enough");
        }

        /// <summary>
        /// The fit hint against the rows on screen: early in a draft every wrestler fills a need, so
        /// the words rank the needs among the shown rows (<paramref name="lowNeeds"/> to
        /// <paramref name="highNeeds"/>); a negative gap still says "Have enough". With little spread
        /// the plain rule applies.
        /// </summary>
        public static (DsState state, string word) Fit(double value, double? fit, double lowNeeds, double highNeeds)
        {
            if (fit == null) return (DsState.Neutral, Kit.NoValue);
            double needs = fit.Value - value;
            if (needs <= -3 || highNeeds - lowNeeds < 2) return Fit(value, fit);
            double place = (needs - lowNeeds) / (highNeeds - lowNeeds);
            if (place >= 0.66) return (DsState.Good, "Big need");
            if (place >= 0.33) return (DsState.Good, "Good fit");
            return (DsState.Neutral, "Fits");
        }

        /// <summary>A draft value in words: the number leads in the table, the word sets its colour.</summary>
        public static (DsState state, string word) Value(double value)
        {
            if (value >= 70) return (DsState.Gold, "Star");
            if (value >= 55) return (DsState.Good, "Strong");
            if (value >= 40) return (DsState.Info, "Solid");
            return (DsState.Neutral, "Depth");
        }

        /// <summary>
        /// The engine's Why? lines as breakdown rows. "Skill: 43.2 (rating 72)" reads label then
        /// effect; "+5: their style suits the promotion" reads effect then label.
        /// </summary>
        public static WhyLine[] WhyLines(IEnumerable<string> lines)
        {
            var rows = new List<WhyLine>();
            foreach (string line in lines ?? Enumerable.Empty<string>())
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                int colon = line.IndexOf(": ", StringComparison.Ordinal);
                bool signed = line.StartsWith("+", StringComparison.Ordinal) || line.StartsWith("−", StringComparison.Ordinal) || line.StartsWith("-", StringComparison.Ordinal);
                if (colon < 0)
                {
                    rows.Add(new WhyLine(line, string.Empty));
                }
                else if (signed)
                {
                    string effect = line.Substring(0, colon);
                    rows.Add(new WhyLine(Capitalise(line.Substring(colon + 2)), effect, effect.StartsWith("+", StringComparison.Ordinal) ? DsState.Good : DsState.Warn));
                }
                else
                {
                    rows.Add(new WhyLine(line.Substring(0, colon), line.Substring(colon + 2)));
                }
            }
            return rows.ToArray();
        }

        // ---- The clock -----------------------------------------------------------------------------

        /// <summary>The banner's headline: "You're on the clock", "ALT is on the clock" or "Every pick is made".</summary>
        public static string ClockHeadline(string status, bool isYou, string shortName)
        {
            if (status == "finished") return "The draft is done";
            if (status == "complete" || shortName == null) return "Every pick is made";
            return isYou ? "You're on the clock" : $"{shortName} is on the clock";
        }

        /// <summary>"Round 3 of 20 · Pick 47".</summary>
        public static string RoundLine(int round, int rounds, int pick) =>
            rounds > 0 ? $"Round {round} of {rounds} · Pick {pick}" : $"Round {round} · Pick {pick}";

        /// <summary>Your next pick: "You pick next", "Your pick: 4 picks away (round 3)", or that you are done.</summary>
        public static string NextTurnLine(bool onTheClock, int? picksAway, int? round)
        {
            if (onTheClock) return "Make your pick, or let the computer pick for you.";
            if (picksAway == null) return "Your roster is full. The rivals are still picking.";
            if (picksAway.Value <= 0) return "You pick next.";
            return $"Your pick: {picksAway.Value} {(picksAway.Value == 1 ? "pick" : "picks")} away (round {round ?? 0}).";
        }

        /// <summary>A pick on the ticker: "#47 ALT · Name".</summary>
        public static string PickLine(int number, string shortName, string name) => $"#{number} {shortName} · {name}";

        /// <summary>A pick's contract in words.</summary>
        public static (DsState state, string word) ContractWord(string contract) => contract switch
        {
            "signed" => (DsState.Good, "Signed"),
            "reserved" => (DsState.Warn, "Unsigned"),
            "released" => (DsState.Neutral, "Released"),
            "lapsed" => (DsState.Bad, "Rights lapsed"),
            _ => (DsState.Neutral, contract ?? Kit.NoValue),
        };

        /// <summary>
        /// How many rival picks one "Sim to my pick" step makes, so a long wait still ticks by in
        /// about eight steps (a big world has hundreds of picks between yours).
        /// </summary>
        public static int SimStep(int picksAway) => Math.Max(1, Math.Min(40, (int)Math.Ceiling(picksAway / 8.0)));

        /// <summary>How many rounds the draft runs: the roster target plus the staff target when staff are drafted.</summary>
        public static int Rounds(int rosterTarget, int staffTarget, bool draftStaff) => rosterTarget + (draftStaff ? staffTarget : 0);

        private static string Whole(double value) => Math.Round(value).ToString("0", CultureInfo.InvariantCulture);

        private static string Capitalise(string text) =>
            string.IsNullOrEmpty(text) ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);
    }
}
