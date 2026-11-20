using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Screens.Trades
{
    /// <summary>
    /// The trade sheet's words and small rules (TRD-02), kept pure so they can be tested: how the
    /// rival leans, a trade's status and what comes next, how a worker feels about the move, and the
    /// fix for each rule an offer breaks.
    /// </summary>
    public static class TradeText
    {
        /// <summary>The default <c>trades.answer.counterRange</c>: how far short a deal can be and still get a counter.</summary>
        public const double CounterRange = 15;

        public const string OfferInTradeLabel = "Offer in a trade";
        public const string ProposeLabel = "Propose a trade";
        public const string ChampionBlocked = "Champion: drop or vacate the title first";

        // ---- The rival's read ----------------------------------------------------------------------

        public static string LeanLabel(string lean) => lean switch
        {
            "yes" => "Likely yes",
            "close" => "Close",
            "far" => "Far apart",
            _ => "Working it out",
        };

        public static DsState LeanState(string lean) => lean switch
        {
            "yes" => DsState.Good,
            "close" => DsState.Warn,
            "far" => DsState.Bad,
            _ => DsState.Neutral,
        };

        /// <summary>What their likely answer means for the player, in a few words.</summary>
        public static string LikelyLine(string likely, string rival) => likely switch
        {
            "accept" => $"{rival} would say yes as it stands.",
            "counter" => $"{rival} would ask for a bit more.",
            "refuse" => $"{rival} would turn it down.",
            _ => null,
        };

        /// <summary>How full the meter is: full at a yes, half at the edge of a counter, empty well past it.</summary>
        public static float MeterFraction(string lean, double shortfall, double counterRange = CounterRange)
        {
            if (lean == "yes") return 1f;
            double range = counterRange <= 0 ? CounterRange : counterRange;
            double fraction = 1 - Math.Max(0, shortfall) / (2 * range);
            return (float)Math.Max(0.04, Math.Min(0.96, fraction));
        }

        // ---- A trade's status ----------------------------------------------------------------------

        public static string StatusLabel(JToken trade)
        {
            string status = Kit.Str(trade, "status");
            switch (status)
            {
                case "open":
                    if (!Kit.Bool(trade, "awaitingYou")) return "Waiting for their answer";
                    return IsTheirOffer(trade) ? "Their offer: your answer" : "Counter-offer: your answer";
                case "completed": return "Done";
                case "refused": return "Turned down";
                case "withdrawn": return "Withdrawn";
                case "lapsed": return "Lapsed";
                case "cancelled": return "Fell through";
                default: return Kit.Capital(status ?? "Unknown");
            }
        }

        public static DsState StatusState(JToken trade)
        {
            switch (Kit.Str(trade, "status"))
            {
                case "open": return Kit.Bool(trade, "awaitingYou") ? DsState.Warn : DsState.Info;
                case "completed": return DsState.Good;
                case "refused":
                case "cancelled": return DsState.Bad;
                default: return DsState.Neutral;
            }
        }

        public static string StatusIcon(JToken trade) => Kit.Str(trade, "status") switch
        {
            "open" => Kit.Bool(trade, "awaitingYou") ? "handshake" : "clock",
            "completed" => "check-circle",
            "refused" => "close",
            _ => "info",
        };

        /// <summary>A rival's own offer (TRD-03), not a counter to yours.</summary>
        public static bool IsTheirOffer(JToken trade) =>
            Kit.Bool(trade, "rivalInitiated") && (Kit.Num(trade, "rounds") ?? 1) <= 1;

        /// <summary>What happens next: their answer after the next day, when an offer lapses, or when it closed.</summary>
        public static string NextLine(JToken trade)
        {
            if (Kit.Str(trade, "status") == "open")
            {
                if (!Kit.Bool(trade, "awaitingYou")) return "Their answer comes after the next day";
                return Kit.Str(trade, "expiresOn") is string expires ? $"Lapses on {ContractText.Date(expires)} if you don't answer" : "Waiting for your answer";
            }
            return Kit.Str(trade, "closedOn") is string closed ? $"Closed on {ContractText.Date(closed)}" : null;
        }

        /// <summary>The stop's words for the trade (the eyebrow on a decision card).</summary>
        public static string Eyebrow(JToken trade) =>
            Kit.Str(trade, "status") == "open" ? (IsTheirOffer(trade) ? "TRADE OFFER" : "COUNTER-OFFER") : "TRADE ANSWER";

        /// <summary>The banner at the top of an open or closed trade.</summary>
        public static string Banner(JToken trade, string you = null)
        {
            string rival = Kit.Str(trade, "otherName") ?? "The rival";
            switch (Kit.Str(trade, "status"))
            {
                case "open":
                    if (!Kit.Bool(trade, "awaitingYou")) return $"Offer sent to {rival}. Their answer comes after the next day.";
                    return IsTheirOffer(trade) ? $"{rival} offered you a trade." : $"{rival} sent a counter-offer.";
                case "completed": return $"The trade with {rival} is done.";
                case "refused":
                    return you != null && Kit.Str(trade, "answer.by") == you ? "You turned the trade down." : $"{rival} turned the trade down.";
                case "withdrawn": return "The offer was withdrawn.";
                case "lapsed": return "The offer lapsed: nobody answered in time.";
                case "cancelled": return $"The trade fell through: {Kit.Str(trade, "outcome.message") ?? "it can no longer happen"}";
                default: return null;
            }
        }

        /// <summary>The answer's kind in a few words (the Why?'s value).</summary>
        public static string AnswerWord(string kind) => kind switch
        {
            "accept" => "They accept",
            "counter" => "They counter",
            "refuse" => "They refuse",
            _ => "Their answer",
        };

        // ---- Workers -------------------------------------------------------------------------------

        public static DsState SayState(JToken say)
        {
            if (say == null || say.Type == JTokenType.Null) return DsState.Neutral;
            if (Kit.Bool(say, "blocks")) return DsState.Bad;
            return Kit.Bool(say, "willing") ? DsState.Good : DsState.Warn;
        }

        /// <summary>"+3 morale", "−15 morale", or null for no change.</summary>
        public static string MoraleWords(double? change)
        {
            if (!change.HasValue || Math.Abs(change.Value) < 0.5) return null;
            long whole = (long)Math.Round(change.Value);
            return whole > 0 ? $"+{whole} morale" : $"−{-whole} morale";
        }

        /// <summary>Card position (or role), value, pay and time left on one line.</summary>
        public static string WorkerFacts(JToken worker, bool after = false)
        {
            var parts = new List<string>();
            string push = Kit.Str(worker, "push");
            parts.Add(push != null && push != "none" ? Kit.PushLabel(push) : ContractText.RoleLabel(Kit.Str(worker, "role")));
            if (Kit.Num(worker, "value") is double value) parts.Add($"value {value:0.#}");
            parts.Add(PayText(worker, after));
            double? months = Kit.Num(worker, "contract.monthsLeft");
            parts.Add(months.HasValue ? $"{MonthsText(months.Value)} left" : "open-ended");
            return string.Join(" · ", parts.Where(part => !string.IsNullOrEmpty(part)));
        }

        public static string PayText(JToken worker, bool after = false)
        {
            double pay = (after ? Kit.Num(worker, "contract.payAfter") : null) ?? Kit.Num(worker, "contract.pay") ?? 0;
            return Kit.Str(worker, "contract.kind") == "perAppearance" ? $"{ContractText.Money(pay)} a show" : $"{ContractText.Money(pay)}/mo";
        }

        public static string PayLabel(JToken worker) =>
            Kit.Str(worker, "contract.kind") == "perAppearance" ? "Fee per appearance" : "Monthly wage";

        public static string MonthsText(double months)
        {
            double rounded = Math.Round(months);
            return rounded == 1 ? "1 month" : $"{rounded:0} months";
        }

        /// <summary>A picker row that can't go: the champion rule in short, else the first reason.</summary>
        public static string BlockedWords(JToken candidate)
        {
            if (Kit.Bool(candidate, "tradable")) return null;
            List<JToken> reasons = Kit.Arr(candidate, "reasons").ToList();
            if (reasons.Any(reason => Kit.Str(reason, "code") == "trades.champion")) return ChampionBlocked;
            return reasons.Select(reason => Kit.Str(reason, "message")).FirstOrDefault(message => !string.IsNullOrEmpty(message)) ?? "Can't be traded now";
        }

        /// <summary>The length choices for a contract change; 0 keeps their length.</summary>
        public static readonly int[] LengthChoices = { 0, 6, 12, 24, 36 };

        public static string LengthChoiceLabel(int months) => months == 0 ? "Keep" : $"{months} mo";

        // ---- Problems ------------------------------------------------------------------------------

        private static readonly Regex SideField = new Regex(@"sides\[(\d+)\]\.employmentIds(?:\[(\d+)\])?", RegexOptions.Compiled);

        /// <summary>
        /// True when <paramref name="problem"/> is about the worker at <paramref name="position"/> on
        /// side <paramref name="side"/> (0 = yours, 1 = theirs, as the preview orders them): by its
        /// field, its subject, or the worker's name in the message.
        /// </summary>
        public static bool IsAbout(JToken problem, int side, int position, string employmentId, string name)
        {
            if (problem == null) return false;
            if (Kit.Str(problem, "subject.kind") == "employment" && Kit.Str(problem, "subject.id") == employmentId) return true;
            Match match = SideField.Match(Kit.Str(problem, "field") ?? string.Empty);
            if (match.Success && int.Parse(match.Groups[1].Value) == side)
            {
                if (match.Groups[2].Success) return int.Parse(match.Groups[2].Value) == position;
                return !string.IsNullOrEmpty(name) && (Kit.Str(problem, "message") ?? string.Empty).StartsWith(name, StringComparison.Ordinal);
            }
            return false;
        }

        /// <summary>What to do about a broken rule, in plain words (null when there's nothing to say).</summary>
        public static string Fix(string code) => code switch
        {
            "trades.champion" => "Drop or vacate the title first, or take them out of the deal.",
            "trades.noTradeClause" => "Take them out, or offer them more pay under More terms.",
            "trades.alreadyInTrade" => "They're in another offer: take them out, or withdraw that offer.",
            "trades.alreadyThere" => "They already work there: take them out.",
            "trades.notOnRoster" => "Take them out: that contract isn't with this side.",
            "trades.contractNotActive" => "Take them out: their contract hasn't started.",
            "trades.contractEnding" => "Take them out: their contract ends today.",
            "trades.notTradable" => "Take them out: bookers can't be traded.",
            "trades.empty" => "Add a worker to either side.",
            "trades.cashBothWays" => "Keep cash on one side only.",
            "trades.notEnoughCash" => "Send less cash.",
            "trades.promotionClosed" => "Pick a promotion that is still running.",
            "trades.draftRunning" => "Finish the draft first.",
            "trades.showRunning" => "Try again after tonight's show.",
            "trades.talkOpen" => "You already have a trade open with them: open it instead.",
            "trades.notARival" => "Pick a promotion the computer runs.",
            _ => null,
        };

        /// <summary>A problem that a "Take them out" button fixes.</summary>
        public static bool FixedByRemoving(string code) => code switch
        {
            "trades.champion" or "trades.noTradeClause" or "trades.alreadyInTrade" or "trades.alreadyThere" or
                "trades.notOnRoster" or "trades.contractNotActive" or "trades.contractEnding" or "trades.notTradable" => true,
            _ => false,
        };

        /// <summary>One side of a deal in words: "Rex Vale, Ana Cruz and $50,000", or "nothing".</summary>
        public static string SideWords(IEnumerable<string> names, double cash)
        {
            var parts = names.Where(name => !string.IsNullOrEmpty(name)).ToList();
            if (cash > 0) parts.Add(ContractText.Money(cash));
            if (parts.Count == 0) return "nothing";
            if (parts.Count == 1) return parts[0];
            return string.Join(", ", parts.Take(parts.Count - 1)) + " and " + parts[parts.Count - 1];
        }
    }
}
