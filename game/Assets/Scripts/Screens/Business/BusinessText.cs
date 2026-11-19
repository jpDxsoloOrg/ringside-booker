using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;

namespace RingsideBooker.Screens.Business
{
    /// <summary>
    /// The words the Finances, Production and Networks screens use (UNITY-18), ported from the web's
    /// <c>screens/finances</c>, <c>screens/production</c> and <c>screens/networks</c> so both games
    /// say the same thing. Pure functions over numbers and engine JSON, so EditMode tests can check
    /// them. Never minutes or clock times (D-10): a timeslot is a part of the evening.
    /// </summary>
    public static class BusinessText
    {
        public const string NoValue = "—";

        // ---- Money ----------------------------------------------------------------------------------

        /// <summary>Whole dollars: <c>$1,234</c>, <c>−$2,500</c>.</summary>
        public static string Money(double cents) => TextFormat.Money(ToCents(cents));

        /// <summary>A short amount for tiles: <c>$40.62M</c>, <c>$125K</c>, <c>$900</c>.</summary>
        public static string Compact(double cents) => TopBarView.CompactMoney(ToCents(cents));

        /// <summary>An amount with its sign: <c>+$1,200</c> (with <paramref name="plus"/>), <c>−$300</c>, <c>$0</c>.</summary>
        public static string Signed(double cents, bool plus = false)
        {
            long amount = ToCents(cents);
            string text = TextFormat.Money(amount);
            return plus && amount > 0 && text != "$0" ? "+" + text : text;
        }

        /// <summary>A short amount with its sign: <c>+$1.10M</c>, <c>−$19K</c>.</summary>
        public static string SignedCompact(double cents, bool plus = false)
        {
            long amount = ToCents(cents);
            string text = TopBarView.CompactMoney(amount);
            return plus && amount > 0 && text != "$0" ? "+" + text : text;
        }

        /// <summary>Dollars and cents: <c>$1.80</c>.</summary>
        public static string Exact(double cents) => TraceFormat.FormatMoney(ToCents(cents), true);

        public static long ToCents(double cents) => (long)Math.Round(cents, MidpointRounding.AwayFromZero);

        /// <summary>The state colour of an amount: good for money in, bad for money out.</summary>
        public static DsState MoneyState(double cents) => cents > 0 ? DsState.Good : cents < 0 ? DsState.Bad : DsState.Neutral;

        // ---- Ledger categories ----------------------------------------------------------------------

        /// <summary>The ledger's categories in ledger order: income first, then costs (the engine's <c>LEDGER_CATEGORIES</c>).</summary>
        public static readonly string[] IncomeCategories =
        {
            "tickets", "liveMerch", "merch", "broadcast", "ppv", "streaming", "sponsorship", "otherIncome", "subsidyIncome",
        };

        public static readonly string[] CostCategories =
        {
            "wages", "appearanceFees", "signingBonuses", "severance", "venueRent", "production", "travel", "marketing",
            "backOffice", "medical", "catering", "otherCost", "charity", "networkUpkeep", "buyout", "subsidy",
        };

        public static IEnumerable<string> LedgerCategories => IncomeCategories.Concat(CostCategories);

        private static readonly Dictionary<string, string> CategoryLabels = new Dictionary<string, string>
        {
            ["tickets"] = "Tickets",
            ["liveMerch"] = "Live merchandise",
            ["merch"] = "Merchandise",
            ["broadcast"] = "TV rights",
            ["ppv"] = "Pay-per-view",
            ["streaming"] = "Streaming",
            ["sponsorship"] = "Sponsorship",
            ["otherIncome"] = "Other income",
            ["subsidyIncome"] = "Subsidies received",
            ["wages"] = "Wages",
            ["appearanceFees"] = "Appearance fees",
            ["signingBonuses"] = "Signing bonuses",
            ["severance"] = "Severance",
            ["venueRent"] = "Venue rent",
            ["production"] = "Production",
            ["travel"] = "Travel",
            ["marketing"] = "Marketing",
            ["backOffice"] = "Back office",
            ["medical"] = "Medical",
            ["catering"] = "Catering",
            ["charity"] = "Charity",
            ["networkUpkeep"] = "Network upkeep",
            ["buyout"] = "Buyouts",
            ["subsidy"] = "Subsidies paid",
            ["otherCost"] = "Other costs",
        };

        public static string CategoryLabel(string category) =>
            category != null && CategoryLabels.TryGetValue(category, out string label) ? label : Kit.Capital(category ?? NoValue);

        public static bool IsIncome(string category) => Array.IndexOf(IncomeCategories, category) >= 0;

        /// <summary>A month label: <c>Jan 2027</c>, or <c>January 2027</c> long.</summary>
        public static string MonthLabel(string yearMonth, bool longForm = false)
        {
            if (yearMonth == null || !DateTime.TryParseExact(yearMonth + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime date))
            {
                return yearMonth ?? NoValue;
            }
            return date.ToString(longForm ? "MMMM yyyy" : "MMM yyyy", CultureInfo.InvariantCulture);
        }

        // ---- Cash runway (production.cashRunway) ----------------------------------------------------

        public const string StatusMaking = "makingMoney";
        public const string StatusLosing = "losingMoney";
        public const string StatusRunningOut = "runningOut";
        public const string StatusOut = "outOfCash";
        public const string StatusTooEarly = "tooEarly";

        /// <summary>"less than a month", "about 1 month", "about 8 months".</summary>
        public static string RunwayMonthsText(double months)
        {
            if (months < 1) return "less than a month";
            long rounded = (long)Math.Round(months, MidpointRounding.AwayFromZero);
            return rounded == 1 ? "about 1 month" : $"about {rounded} months";
        }

        private static string MoreDaysText(int days) => days == 1 ? "1 more day" : $"{days} more days";

        /// <summary>True while money goes out faster than it comes in, or the cash is gone.</summary>
        public static bool RunwayWarns(string status) => status == StatusLosing || status == StatusRunningOut || status == StatusOut;

        /// <summary>The warning's words and state, or null when there is nothing to flag.</summary>
        public static (string text, DsState state)? RunwayBadge(string status) => status switch
        {
            StatusLosing => ("Losing money", DsState.Warn),
            StatusRunningOut => ("Running out of cash", DsState.Bad),
            StatusOut => ("Out of cash", DsState.Bad),
            _ => null,
        };

        /// <summary>
        /// The one plain answer to "am I making money?", before any number: "You're making money",
        /// "You're losing money", "Cash is running out", "You're out of cash", "Too early to tell".
        /// </summary>
        public static string RunwayVerdict(string status) => status switch
        {
            StatusMaking => "You're making money",
            StatusLosing => "You're losing money",
            StatusRunningOut => "Cash is running out",
            StatusOut => "You're out of cash",
            StatusTooEarly => "Too early to tell",
            _ => "Your money",
        };

        public static DsState RunwayState(string status) => status switch
        {
            StatusMaking => DsState.Good,
            StatusLosing => DsState.Warn,
            StatusRunningOut => DsState.Bad,
            StatusOut => DsState.Bad,
            _ => DsState.Info,
        };

        /// <summary>The sentence the runway leads with (the web's <c>runwayHeadline</c>).</summary>
        public static string RunwayHeadline(string status, double monthlyNet, double? monthsLeft, int daysUntilForecast)
        {
            string monthly = Money(Math.Abs(monthlyNet));
            switch (status)
            {
                case StatusLosing:
                case StatusRunningOut:
                    return $"At this rate you run out of cash in {RunwayMonthsText(monthsLeft ?? 0)}.";
                case StatusOut:
                    return monthlyNet < 0
                        ? $"You are out of cash. Costs are still paid, so the debt grows by about {monthly} a month."
                        : "You are out of cash. Costs are still paid until money comes back in.";
                case StatusMaking:
                    return $"At this rate your cash grows by about {monthly} a month.";
                case StatusTooEarly:
                    return $"Fixed costs come to {monthly} a month. Ticket sales and other show money count after {MoreDaysText(daysUntilForecast)}.";
                default:
                    return string.Empty;
            }
        }

        /// <summary>The runway tile's big value and unit: "8 months", "Under 1 month", "Growing", "Out of cash", "After a week".</summary>
        public static (string value, string unit) RunwayValue(string status, double? monthsLeft)
        {
            switch (status)
            {
                case StatusLosing:
                case StatusRunningOut:
                    double months = monthsLeft ?? 0;
                    if (months < 1) return ("Under 1", "month");
                    long rounded = (long)Math.Round(months, MidpointRounding.AwayFromZero);
                    return (rounded.ToString(CultureInfo.InvariantCulture), rounded == 1 ? "month" : "months");
                case StatusOut:
                    return ("Out of cash", null);
                case StatusMaking:
                    return ("Growing", null);
                case StatusTooEarly:
                    return ("After a week", null);
                default:
                    return (NoValue, null);
            }
        }

        // ---- Production -----------------------------------------------------------------------------

        public const int ProductionLevelMax = 10;
        public const string LoweringIsFree = "Lowering is free";
        public const string NoEffectText = "No effect yet. Nothing uses this area yet; it only costs money.";

        /// <summary>"Can't go below level 3 while your TV deal with Channel 9 runs".</summary>
        public static string TvFloorText(int minLevel, string networkName)
        {
            string deal = networkName == null ? "your TV deal" : $"your TV deal with {networkName}";
            return $"Can't go below level {minLevel} while {deal} runs";
        }

        /// <summary>"4 weeks" for 28 days, "week", "10 days".</summary>
        public static string ForecastWindowText(int days)
        {
            if (days > 0 && days % 7 == 0)
            {
                int weeks = days / 7;
                return weeks == 1 ? "week" : $"{weeks} weeks";
            }
            return days == 1 ? "day" : $"{days} days";
        }

        public static string ShowCountText(int count) => count == 1 ? "1 show" : $"{count} shows";

        /// <summary>"3 regions above it".</summary>
        public static string RegionsAboveText(int count) => count == 1 ? "1 region above it" : $"{count} regions above it";

        /// <summary>"Camera: level 2 → 4".</summary>
        public static string ChangeTitle(string label, int from, int to) => $"{label}: level {from} → {to}";

        /// <summary>"Pay $28,000 and raise", "Raise to 4" (no fee), "Lower to 1", "Keep level 2".</summary>
        public static string ConfirmLabel(int from, int to, double? fee)
        {
            if (to < from) return $"Lower to {to}";
            if (to == from) return $"Keep level {from}";
            if (fee.HasValue && fee.Value > 0) return $"Pay {TraceFormat.FormatMoney(ToCents(fee.Value))} and raise";
            return $"Raise to {to}";
        }

        /// <summary>True for money units: a cost going up is bad news, any other number going up is good news.</summary>
        public static bool IsMoneyUnit(string unit) => unit == "money" || unit == "money/month";

        /// <summary>A number in its engine unit, as the trace formatter writes it.</summary>
        public static string UnitValue(double value, string unit)
        {
            string traceUnit = unit == "money/month" ? "money" : KnownUnit(unit);
            return TraceFormat.Value(TraceValue.Of(value), traceUnit);
        }

        /// <summary>The change of a before → after pair, signed and in its unit: "+$400", "−2.5".</summary>
        public static string ChangeText(double before, double after, string unit)
        {
            double change = after - before;
            string magnitude = UnitValue(Math.Abs(change), unit);
            if (change > 0) return "+" + magnitude;
            if (change < 0) return TextFormat.Minus + magnitude;
            return magnitude;
        }

        /// <summary>Good or bad for a change: costs going down are good, anything else going up is good.</summary>
        public static DsState ChangeState(double before, double after, string unit)
        {
            if (after == before) return DsState.Neutral;
            bool up = after > before;
            bool good = IsMoneyUnit(unit) ? !up : up;
            return good ? DsState.Good : DsState.Bad;
        }

        private static readonly HashSet<string> KnownUnits = new HashSet<string>
        {
            "money", "points", "points/day", "percent", "probability", "ratio", "multiplier", "count", "days", "months", "years", "people", "stars", "attribute",
        };

        /// <summary>The trace formatter's unit for an engine unit, or null for one it does not know (a plain number then).</summary>
        public static string KnownUnit(string unit) => unit != null && KnownUnits.Contains(unit) ? unit : null;

        /// <summary>"Bonus slot on regular shows and bigger: unlocked" / ": at 90, yours 47".</summary>
        public static string BonusSlotLine(bool qualifies, double threshold, double ceiling, string minImportance)
        {
            string shows = minImportance == "flagship" ? "flagship shows" : $"{minImportance} shows and bigger";
            string head = $"Bonus slot on {shows}";
            return qualifies ? $"{head}: unlocked" : $"{head}: at {Kit.Whole(threshold)}, yours {Kit.Whole(ceiling)}";
        }

        // ---- Networks: slots, kinds, risks ----------------------------------------------------------

        public static readonly string[] Timeslots = { "daytime", "evening", "primeTime", "lateNight" };

        public static string TimeslotLabel(string timeslot) => timeslot switch
        {
            "daytime" => "Daytime",
            "evening" => "Evening",
            "primeTime" => "Prime time",
            "lateNight" => "Late night",
            _ => Kit.Capital(timeslot ?? NoValue),
        };

        private static readonly string[] WeekdayShort = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

        /// <summary>The engine numbers weekdays from 0 = Monday.</summary>
        public static string WeekdayText(int? weekday) => weekday is int day && day >= 0 && day < 7 ? WeekdayShort[day] : null;

        public static string KindLabel(string kind) => kind switch
        {
            "tv" => "TV network",
            "streaming" => "Streaming service",
            "ppv" => "Pay-per-view",
            _ => Kit.Capital(kind ?? NoValue),
        };

        /// <summary>"Mon · Prime time · Live", "Pay-per-view · Taped"; a deal not tied to a weekday leaves the day out.</summary>
        public static string Slot(int? weekday, string timeslot, bool live, string kind)
        {
            var parts = new List<string>();
            string day = WeekdayText(weekday);
            if (day != null) parts.Add(day);
            parts.Add(kind == "ppv" ? "Pay-per-view" : TimeslotLabel(timeslot));
            parts.Add(live ? "Live" : "Taped");
            return string.Join(" · ", parts);
        }

        public static string Slot(JToken deal) =>
            Slot(Kit.Num(deal, "weekday") is double day ? (int)day : (int?)null, Kit.Str(deal, "timeslot"), Kit.Bool(deal, "live"), Kit.Str(deal, "kind"));

        public const int ReachTierMax = 4;

        public static string TierText(int reachTier) => $"Tier {reachTier} of {ReachTierMax}";

        public static string EndReasonText(string reason) => reason switch
        {
            "expired" => "Ran to its end date",
            "lowViewers" => "Cancelled by the network: low viewers",
            "missedAirings" => "Cancelled by the network: too many missed airings",
            "byPromotion" => "You cancelled it",
            "networkClosed" => "The network closed down",
            _ => "Not running",
        };

        public const string MissedAiringLabel = "Missed airing";

        public static string RiskName(string risk) => risk switch
        {
            "exceeding" => "Exceeding",
            "safe" => "Safe",
            "watch" => "Watch",
            "atRisk" => "At risk",
            "cancelling" => "Cancelling",
            _ => Kit.Capital(risk ?? NoValue),
        };

        /// <summary>The badge's words: the risk, or "Missed airing" when that is the worst reason.</summary>
        public static string RiskLabel(string risk, IReadOnlyList<string> reasons)
        {
            string first = reasons != null && reasons.Count > 0 ? reasons[0] : null;
            return first != null && first.IndexOf("missed airing", StringComparison.OrdinalIgnoreCase) >= 0 ? MissedAiringLabel : RiskName(risk);
        }

        /// <summary>Gold for beating expectations, green safe, grey watch, amber at risk, red cancelling.</summary>
        public static DsState RiskState(string risk) => risk switch
        {
            "exceeding" => DsState.Gold,
            "safe" => DsState.Good,
            "watch" => DsState.Info,
            "atRisk" => DsState.Warn,
            "cancelling" => DsState.Bad,
            _ => DsState.Neutral,
        };

        public static string RiskIcon(string risk) => risk switch
        {
            "exceeding" => "star",
            "safe" => "check",
            "watch" => "eye",
            "atRisk" => "warning",
            "cancelling" => "warning",
            _ => null,
        };

        /// <summary>A per-thousand-buys rate as a per-buy price: 180000 → "$1.80 per buy".</summary>
        public static string PerBuyText(double perThousandBuys) =>
            $"{TraceFormat.FormatMoney((long)Math.Round(perThousandBuys / 1000, MidpointRounding.AwayFromZero), true)} per buy";

        public static string PerThousandLabel(string kind) => kind == "ppv" ? "Per buy" : "Per 1,000 viewers";

        /// <summary>The per-thousand term as the deal screens write it.</summary>
        public static string PerThousandText(string kind, double perThousand) =>
            kind == "ppv" ? PerBuyText(perThousand) : TraceFormat.FormatMoney(ToCents(perThousand), true);

        public static readonly int[] DealLengths = { 6, 12, 24, 36, 48 };

        public static string MonthsText(int months) => $"{months} {(months == 1 ? "month" : "months")}";

        public const int FallbackDefaultMonths = 24;

        public const string LosesMoneyText = "This deal loses money every airing: the airtime costs more than the network pays.";

        public const string PpvAirtimeText =
            "Pay-per-view airtime is expensive. You pay it on every show the deal carries, in return for the money from each buy.";

        /// <summary>"$45,000", or for pay-per-view (no flat fee) "— · $1.80 per buy".</summary>
        public static string FeeText(string kind, double feePerShow, double perThousand) =>
            kind == "ppv" ? $"{NoValue} · {PerBuyText(perThousand)}" : Money(feePerShow);

        /// <summary>"Oct 4, 2027 · in 269 days", or "Ended Oct 4, 2027".</summary>
        public static string EndsText(string endsOn, string status, string today)
        {
            string date = Kit.Date(endsOn);
            if (status != "active") return $"Ended {date}";
            if (!GameDate.TryParse(today, out GameDate now) || !GameDate.TryParse(endsOn, out GameDate end)) return date;
            return $"{date} · {DaysAway(now.DaysUntil(end))}";
        }

        /// <summary>"today", "tomorrow", "in 5 days", "yesterday", "5 days ago".</summary>
        public static string DaysAway(int days)
        {
            if (days == 0) return "today";
            if (days == 1) return "tomorrow";
            if (days == -1) return "yesterday";
            return days > 0 ? $"in {TextFormat.Number(days)} days" : $"{TextFormat.Number(-days)} days ago";
        }

        /// <summary>"Aired", "Missed: show cancelled", "Missed: show not run", "Aired without a show result".</summary>
        public static string AiringStatusText(string status, string missReason, string qualitySource)
        {
            if (status == "missed") return missReason == "notRun" ? "Missed: show not run" : "Missed: show cancelled";
            return qualitySource == "neutral" ? "Aired without a show result" : "Aired";
        }

        /// <summary>The engine's own line for a coming missed airing; the sheet writes it with its date.</summary>
        public const string ComingMissedPrefix = "Missed airing coming";

        public static string UpcomingMissedText(string date) => $"{ComingMissedPrefix}: {Kit.Date(date)} (show cancelled)";

        /// <summary>"Cancel your deal with NSN? You pay an exit fee of $41,300."</summary>
        public static string CancelTitle(string networkName, string fee) =>
            fee == null ? $"Cancel your deal with {networkName}?" : $"Cancel your deal with {networkName}? You pay an exit fee of {fee}.";

        /// <summary>"+10% for beating expectations".</summary>
        public static string UpliftChipText(double share) => $"+{(long)Math.Round(share * 100, MidpointRounding.AwayFromZero)}% for beating expectations";

        // ---- Viewers and targets --------------------------------------------------------------------

        /// <summary>The engine's <c>shortViewers</c>: "2.4M", "152K", "1.2K", "950" (rounded down).</summary>
        public static string ShortViewers(double value)
        {
            double whole = Math.Max(0, Math.Floor(value));
            string Tenths(double scaled)
            {
                double rounded = Math.Floor(scaled * 10) / 10;
                return rounded == Math.Floor(rounded)
                    ? rounded.ToString("0", CultureInfo.InvariantCulture)
                    : rounded.ToString("0.0", CultureInfo.InvariantCulture);
            }
            if (whole >= 1_000_000) return Tenths(whole / 1_000_000) + "M";
            if (whole >= 10_000) return Math.Floor(whole / 1_000).ToString("0", CultureInfo.InvariantCulture) + "K";
            if (whole >= 1_000) return Tenths(whole / 1_000) + "K";
            return whole.ToString("0", CultureInfo.InvariantCulture);
        }

        /// <summary>"2.4M viewers", or "152K buys" on pay-per-view.</summary>
        public static string ViewersText(double viewers, string kind) => $"{ShortViewers(viewers)} {(kind == "ppv" ? "buys" : "viewers")}";

        private static double ShortStep(double count)
        {
            if (count >= 1_000_000) return 100_000;
            if (count >= 10_000) return 1_000;
            if (count >= 1_000) return 100;
            return 1;
        }

        /// <summary>A target, rounded up to the step it shows in, so reaching the number on screen is enough.</summary>
        private static string TargetAmount(double count, string kind, bool up = true)
        {
            double step = ShortStep(count);
            string shown = ShortViewers(up ? Math.Ceiling(count / step) * step : count);
            return kind == "ppv" ? shown + " buys" : shown;
        }

        private static string Percent(double share) => $"{(long)Math.Round(share * 100, MidpointRounding.AwayFromZero)}%";

        /// <summary>One line a deal is judged by.</summary>
        public sealed class TargetLine
        {
            public string Id;
            /// <summary>"Stay above 2.1M (75% of 2.8M expected) to stay safe".</summary>
            public string Text;
            /// <summary>"Safe above 2.1M".</summary>
            public string Short;
            public string Label;
            public double Viewers;
            public JToken Trace;
        }

        /// <summary>The three lines (stay safe, may cancel, ratings bonus) from a <c>DealTargets</c> answer, or none.</summary>
        public static IReadOnlyList<TargetLine> TargetLines(JToken targets, string kind)
        {
            if (targets == null || targets.Type != JTokenType.Object) return Array.Empty<TargetLine>();
            double expected = Kit.Num(targets, "expected") ?? 0;
            TargetLine Line(string id, Func<string, string, string> text, Func<string, string> shortText, string label)
            {
                JToken target = targets[id];
                double viewers = Kit.Num(target, "viewers.value") ?? 0;
                string amount = TargetAmount(viewers, kind);
                string share = Percent(Kit.Num(target, "share") ?? 0);
                return new TargetLine
                {
                    Id = id,
                    Text = text(amount, share),
                    Short = shortText(amount),
                    Label = label,
                    Viewers = viewers,
                    Trace = Kit.Obj(target, "viewers.trace"),
                };
            }
            string expectedText = TargetAmount(expected, kind, false);
            return new[]
            {
                Line("safe", (amount, share) => $"Stay above {amount} ({share} of {expectedText} expected) to stay safe", amount => $"Safe above {amount}", "The line to stay safe"),
                Line("cancel", (amount, share) => $"Below {amount} ({share}) they may cancel", amount => $"May cancel below {amount}", "The line below which they may cancel"),
                Line("bonus", (amount, share) => $"Beat {amount} ({share}) for a ratings bonus", amount => $"Bonus above {amount}", "The ratings bonus line"),
            };
        }

        /// <summary>What the bonus line means, said once under the full list.</summary>
        public static string RatingsBonusText(string kind)
        {
            string on = kind == "ppv" ? "the per-buy money" : "the fee";
            return $"Viewers are judged over recent airings. While they stay above the bonus line, every airing pays a ratings bonus on top of {on}: more the further above it, up to a cap.";
        }

        // ---- Available networks --------------------------------------------------------------------

        /// <summary>"About $45,000 per show", "Paid per buy, loses $3,000 an airing", or why there's nothing to offer.</summary>
        public static string BestOfferText(string kind, JToken bestOffer)
        {
            if (bestOffer == null || bestOffer.Type != JTokenType.Object) return "Nothing to offer: every show you have is already on it";
            double fee = Kit.Num(bestOffer, "feePerShow") ?? 0;
            double income = Kit.Num(bestOffer, "incomePerAiring") ?? 0;
            string pay = kind == "ppv" ? "Paid per buy" : $"About {Money(fee)} per show";
            return income < 0 ? $"{pay}, loses {Money(-income)} an airing" : pay;
        }

        /// <summary>"Ashlar Thursday · Ashlar Pro Wrestling; …" or "Nothing yet". Names only, never anyone's money.</summary>
        public static string CarriesText(JToken network)
        {
            var carried = Kit.Arr(network, "carries").Select(deal => $"{Kit.Str(deal, "showName")} · {Kit.Str(deal, "promotionName")}").ToList();
            return carried.Count == 0 ? "Nothing yet" : string.Join("; ", carried);
        }

        public static string VerdictLabel(string verdict) => verdict == "accept" ? "Would accept" : "Would refuse";

        /// <summary>The shows a network can be offered (no house shows; major and flagship only on pay-per-view).</summary>
        public static IReadOnlyList<(string value, string label)> ShowOptions(string kind, IEnumerable<JToken> shows)
        {
            var options = new List<(string value, string label)>();
            if (kind == "ppv") options.Add((AllShowsValue, "All major shows"));
            foreach (JToken show in shows ?? Enumerable.Empty<JToken>())
            {
                string importance = Kit.Str(show, "importance");
                if (importance == "house") continue;
                if (kind == "ppv" && importance != "major" && importance != "flagship") continue;
                string name = Kit.Str(show, "name");
                options.Add((Kit.Str(show, "eventDefinitionId"), Kit.Bool(show, "televised") ? name : $"{name} (becomes a TV show)"));
            }
            return options;
        }

        public const string AllShowsValue = "all";

        /// <summary>"Last airing: Mainstage, Jan 3, 2027 · 2.4M viewers (expected 1.9M)", or that nothing has aired.</summary>
        public static string LastAiringText(JToken lastAiring)
        {
            if (lastAiring == null || lastAiring.Type != JTokenType.Object) return "Nothing has aired yet";
            return $"Last airing: {Kit.Str(lastAiring, "showName")}, {Kit.Date(Kit.Str(lastAiring, "airDate"))} · " +
                   $"{ShortViewers(Kit.Num(lastAiring, "viewers") ?? 0)} viewers (expected {ShortViewers(Kit.Num(lastAiring, "expectedViewers") ?? 0)})";
        }
    }
}
