using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// The Contracts screen's words (UNITY-17), ported from the web's <c>contractLabels.ts</c>,
    /// <c>negotiationText.ts</c> and the tabs' helpers so the game says exactly what the web says.
    /// Pure functions over the engine's JSON: the EditMode tests cover them.
    /// </summary>
    public static class ContractText
    {
        public const string NoValue = "—";
        public const string NoEndDate = "No end date";
        public const string TermsPrivate = "Terms private";
        public const string NotEnforced = "Not enforced by the game yet";

        // ---- Labels ---------------------------------------------------------------------------------

        public static string KindLabel(string kind) => kind switch
        {
            "written" => "Written",
            "perAppearance" => "Per appearance",
            "development" => "Development",
            "tour" => "Tour",
            _ => kind ?? NoValue,
        };

        public static string PerkLabel(string perk) => perk switch
        {
            "creativeControl" => "Creative control",
            "noHouseShows" => "No house shows",
            "ironClad" => "Iron-clad",
            "travelCovered" => "Travel covered",
            _ => perk,
        };

        /// <summary>The web's <c>EMPLOYMENT_ROLE_LABELS</c>.</summary>
        public static string RoleLabel(string role) => role switch
        {
            "wrestler" => "Wrestler",
            "manager" => "Manager",
            "presenter" => "Presenter",
            "announcer" => "Announcer",
            "referee" => "Referee",
            "producer" => "Producer",
            "booker" => "Booker",
            null => NoValue,
            _ => Kit.Capital(role),
        };

        public static readonly string[] EmploymentRoles = { "wrestler", "manager", "presenter", "announcer", "referee", "producer", "booker" };

        /// <summary>The web's <c>WORKER_ROLE_LABELS</c> (a person's roles on the Free agents list).</summary>
        public static string PersonRoleLabel(string role) => role switch
        {
            "wrestler" => "Wrestler",
            "occasionalWrestler" => "Occasional wrestler",
            "manager" => "Manager",
            "presenter" => "Presenter",
            "announcer" => "Announcer",
            "referee" => "Referee",
            "producer" => "Producer",
            null => NoValue,
            _ => Kit.Capital(role),
        };

        public static readonly string[] PersonRoles = { "wrestler", "occasionalWrestler", "manager", "presenter", "announcer", "referee", "producer" };

        /// <summary>The engine's <c>PUSH_LABELS</c> for every level, "None" included.</summary>
        public static string PushName(string push) => push switch
        {
            "mainEvent" => "Main event",
            "upperCard" => "Upper card",
            "midCard" => "Mid card",
            "lowerCard" => "Lower card",
            "enhancement" => "Enhancement",
            "none" => "None",
            _ => push ?? NoValue,
        };

        /// <summary>A push for sorting, top of the card highest.</summary>
        public static int PushRank(string push) => push switch
        {
            "mainEvent" => 5,
            "upperCard" => 4,
            "midCard" => 3,
            "lowerCard" => 2,
            "enhancement" => 1,
            _ => 0,
        };

        public static readonly string[] PushLevels = { "mainEvent", "upperCard", "midCard", "lowerCard", "enhancement", "none" };

        public static string StyleLabel(string style) => style switch
        {
            "allRounder" => "All-rounder",
            "technician" => "Technician",
            "brawler" => "Brawler",
            "highFlyer" => "High flyer",
            "powerhouse" => "Powerhouse",
            "hardcore" => "Hardcore",
            "striker" => "Striker",
            "grappler" => "Grappler",
            "showman" => "Showman",
            "nonWrestler" => "Non-wrestler",
            null => NoValue,
            _ => Kit.Capital(style),
        };

        public static readonly string[] RingStyles = { "allRounder", "technician", "brawler", "highFlyer", "powerhouse", "hardcore", "striker", "grappler", "showman", "nonWrestler" };

        public static string GenderLabel(string gender) => gender switch
        {
            "male" => "Male",
            "female" => "Female",
            "nonBinary" => "Non-binary",
            null => NoValue,
            _ => Kit.Capital(gender),
        };

        public static readonly string[] Genders = { "male", "female", "nonBinary" };

        /// <summary>"Mid card wrestler", "Referee" (the web's <c>roleText</c>).</summary>
        public static string RoleText(string role, string push)
        {
            string roleWords = RoleLabel(role);
            string pushWords = Kit.PushLabel(push);
            return pushWords == Kit.NoValue ? roleWords : $"{pushWords} {roleWords.ToLowerInvariant()}";
        }

        // ---- Money and dates ------------------------------------------------------------------------

        public static string Money(double? cents) => cents.HasValue ? TextFormat.Money((long)System.Math.Round(cents.Value)) : NoValue;

        public static string Date(string iso) => string.IsNullOrEmpty(iso) ? NoValue : Kit.Date(iso);

        public static string Days(double days)
        {
            long whole = (long)System.Math.Round(days);
            return $"{TextFormat.Number(whole)} {(whole == 1 ? "day" : "days")}";
        }

        public static string Months(double months)
        {
            long whole = (long)System.Math.Round(months);
            return $"{TextFormat.Number(whole)} {(whole == 1 ? "month" : "months")}";
        }

        /// <summary>"$8,000/mo", "$300 per show", or both (the web's <c>wageText</c>).</summary>
        public static string WageText(JToken row)
        {
            double wage = Kit.Num(row, "monthlyWage") ?? 0;
            double fee = Kit.Num(row, "perAppearanceFee") ?? 0;
            var parts = new List<string>();
            if (wage > 0) parts.Add($"{Money(wage)}/mo");
            if (fee > 0) parts.Add($"{Money(fee)} per show");
            return parts.Count == 0 ? Money(0) : string.Join(" + ", parts);
        }

        /// <summary>A wage for sorting: the monthly wage plus four appearances.</summary>
        public static double WageValue(JToken row) => (Kit.Num(row, "monthlyWage") ?? 0) + (Kit.Num(row, "perAppearanceFee") ?? 0) * 4;

        // ---- Contract states ------------------------------------------------------------------------

        /// <summary>One chip on a contract row: state, icon, words.</summary>
        public readonly struct StatusChip
        {
            public StatusChip(string kind, DsState state, string text, string icon)
            {
                Kind = kind;
                State = state;
                Text = text;
                Icon = icon;
            }

            public string Kind { get; }
            public DsState State { get; }
            public string Text { get; }
            public string Icon { get; }
        }

        public static string EndReasonText(string reason) => reason switch
        {
            "expired" => "Expired",
            "released" => "Released",
            "quit" => "Let go at their request",
            "walkedOut" => "Walked out",
            "exclusiveDeal" => "Left for an exclusive deal",
            "withdrawn" => "Deal called off",
            _ => "Ended",
        };

        /// <summary>
        /// The chips a row shows, most urgent first (the web's <c>contractStatusesOf</c>): a request
        /// or walk-out risk, the unhappy clock, a new notice, then where the contract stands.
        /// </summary>
        public static List<StatusChip> StatusChips(JToken row, int expiringSoonDays, int expiringWindowDays, bool ignoreEnd = false)
        {
            var chips = new List<StatusChip>();
            if (Kit.Str(row, "request.status") == "open") chips.Add(new StatusChip("wantsToLeave", DsState.Bad, "Wants to leave", "user-minus"));
            double? walkout = Kit.Num(row, "walkout.chance");
            if (walkout.HasValue && walkout.Value > 0)
            {
                chips.Add(new StatusChip("walkoutRisk", DsState.Bad, $"Walk-out risk {Percent(walkout.Value)} a day", "warning"));
            }
            if (Kit.Obj(row, "unhappy") is JToken unhappy)
            {
                bool paused = Kit.Bool(unhappy, "paused");
                string clock = paused
                    ? "Unhappy (clock paused)"
                    : $"Unhappy: day {TextFormat.Number((long)(Kit.Num(unhappy, "days") ?? 0))} of {TextFormat.Number((long)(Kit.Num(unhappy, "of") ?? 0))}";
                chips.Add(new StatusChip("unhappy", DsState.Warn, clock, "morale"));
            }
            if (Kit.Str(row, "notice") == "unseen") chips.Add(new StatusChip("unseen", DsState.Live, "New", "bell"));
            string endReason = ignoreEnd ? null : Kit.Str(row, "endReason");
            double? daysLeft = Kit.Num(row, "daysLeft");
            if (endReason != null)
            {
                chips.Add(new StatusChip("ended", DsState.Neutral, EndReasonText(endReason), "history"));
            }
            else if (Kit.Str(row, "status") == "signed")
            {
                chips.Add(new StatusChip("starts", DsState.Info, $"Starts {Date(Kit.Str(row, "startsOn"))}", "clock"));
            }
            else if (daysLeft.HasValue && daysLeft.Value <= expiringWindowDays)
            {
                bool soon = daysLeft.Value <= expiringSoonDays;
                chips.Add(new StatusChip("expiring", soon ? DsState.Warn : DsState.Info, $"Ends in {Days(daysLeft.Value)}", "clock"));
            }
            else if (chips.Count == 0)
            {
                chips.Add(new StatusChip("active", DsState.Good, "Active", "check-circle"));
            }
            return chips;
        }

        /// <summary>0.034 → "3.4%".</summary>
        public static string Percent(double share)
        {
            double percent = share * 100;
            return percent >= 10 || percent == System.Math.Round(percent)
                ? $"{System.Math.Round(percent):0}%"
                : $"{percent:0.#}%";
        }

        /// <summary>A signed number with a true minus: "+12", "−40".</summary>
        public static string Signed(double value)
        {
            long whole = (long)System.Math.Round(value);
            return whole > 0 ? "+" + TextFormat.Number(whole) : TextFormat.Number(whole);
        }

        /// <summary>"55 contracts · $1,200,000 a month · 1 expiring soon · 1 wants to leave".</summary>
        public static string CountsLine(int contracts, double monthlyCents, int expiringSoon, int wantsToLeave)
        {
            var parts = new List<string>
            {
                $"{TextFormat.Number(contracts)} {(contracts == 1 ? "contract" : "contracts")}",
                $"{Money(monthlyCents)} a month",
                $"{TextFormat.Number(expiringSoon)} expiring soon",
            };
            if (wantsToLeave > 0) parts.Add($"{TextFormat.Number(wantsToLeave)} {(wantsToLeave == 1 ? "wants" : "want")} to leave");
            return string.Join(" · ", parts);
        }

        /// <summary>"2 contracts are close to their end date. Skips stop until you've seen them."</summary>
        public static string ExpiringBanner(int unseen, bool stopsSkip)
        {
            string lead = unseen == 1 ? "1 contract is close to its end date." : $"{TextFormat.Number(unseen)} contracts are close to their end date.";
            return stopsSkip ? lead + " Skips stop until you’ve seen them." : lead;
        }

        public static string RenewPointer(int windowDays) =>
            $"Contracts end on their date unless you renew them. Press Renew to open talks: they open {TextFormat.Number(windowDays)} days before a contract ends.";

        public static string RenewalWindow(int windowDays) => $"Talks open {TextFormat.Number(windowDays)} days before the contract ends";

        /// <summary>"Mara Quill wants to leave (asked Mar 3, 2027, answer by Mar 10, 2027)".</summary>
        public static string RequestHeadline(string ringName, JToken request) =>
            request == null ? string.Empty : $"{ringName} wants to leave (asked {Date(Kit.Str(request, "raisedOn"))}, answer by {Date(Kit.Str(request, "answerBy"))})";

        // ---- Negotiation ----------------------------------------------------------------------------

        /// <summary>"Free agent", "Per appearance at Crown Pro", "Free from Sep 30, 2026".</summary>
        public static string Situation(string situation, string otherPromotionName, string endsOn) => situation switch
        {
            "freeAgent" => "Free agent",
            "perAppearanceElsewhere" => otherPromotionName == null ? "Per appearance elsewhere" : $"Per appearance at {otherPromotionName}",
            "endingSoonElsewhere" => endsOn == null ? "Free soon" : $"Free from {Date(endsOn)}",
            "underContract" => otherPromotionName == null ? "Under contract elsewhere" : $"Under contract at {otherPromotionName}",
            "yours" => "Under contract with you",
            "unavailable" => "Not available",
            _ => situation ?? NoValue,
        };

        public static string SituationOf(JToken freeAgent) =>
            Situation(Kit.Str(freeAgent, "situation"), Kit.Str(freeAgent, "otherPromotionName"), Kit.Str(freeAgent, "endsOn"));

        public static string BiddersCount(int count) => count == 0 ? null : $"{TextFormat.Number(count)} other {(count == 1 ? "bidder" : "bidders")}";

        public static string AlsoTalking(IReadOnlyCollection<string> names) => names == null || names.Count == 0 ? null : $"Also talking to: {string.Join(", ", names)}";

        /// <summary>"Talking", "Cooldown until Feb 3, 2027", "2 other bidders", "No talks yet".</summary>
        public static string TalksState(JToken row)
        {
            var parts = new List<string>();
            if (Kit.Str(row, "openNegotiationId") != null) parts.Add("Talking");
            else if (Kit.Str(row, "cooldownUntil") is string until) parts.Add($"Cooldown until {Date(until)}");
            string bidders = BiddersCount(Kit.Arr(row, "competingBidders").Count());
            if (bidders != null) parts.Add(bidders);
            return parts.Count == 0 ? "No talks yet" : string.Join(" · ", parts);
        }

        public static string CooldownReason(string until) => $"Walked away from talks with you: try again after {Date(until)}";

        /// <summary>"$41,300/mo" or "$600 an appearance" by the kind you may offer first; null when neither.</summary>
        public static string AskText(JToken row)
        {
            double? monthly = Kit.Num(row, "askMonthly");
            double? perAppearance = Kit.Num(row, "askPerAppearance");
            if (Kit.Str(row, "bestKind") == "perAppearance" && perAppearance.HasValue) return $"{Money(perAppearance)} an appearance";
            if (monthly.HasValue) return $"{Money(monthly)}/mo";
            if (perAppearance.HasValue) return $"{Money(perAppearance)} an appearance";
            return null;
        }

        /// <summary>The ask as one monthly number for sorting.</summary>
        public static double AskValue(JToken row) => Kit.Num(row, "askMonthly") ?? (Kit.Num(row, "askPerAppearance") ?? 0) * 4;

        /// <summary>An offer's status in plain words (the web's <c>offerStatusText</c>).</summary>
        public static string OfferStatus(JToken row)
        {
            switch (Kit.Str(row, "status"))
            {
                case "submitted":
                    return "Considering your offer: they answer after the next day";
                case "awaitingReview":
                    return Kit.Str(row, "reviewOn") is string review ? $"Considering your offer: decides on {Date(review)}" : "Considering your offer";
                case "countered":
                    return Kit.Str(row, "counterExpiresOn") is string by ? $"Countered: answer by {Date(by)}" : "Countered: waiting for your answer";
                case "signed":
                    return "Signed";
                case "walkedAway":
                    return Kit.Str(row, "cooldownUntil") is string until ? $"Walked away: try again after {Date(until)}" : "Walked away";
                case "declined":
                    return Kit.Str(row, "outcome.message") ?? "Talks closed";
                case "lapsed":
                    return Kit.Str(row, "outcome.message") ?? "They stopped waiting for your answer";
                case "withdrawn":
                    return Kit.Str(row, "outcome.message") ?? "You withdrew the offer";
                default:
                    return Kit.Str(row, "status") ?? NoValue;
            }
        }

        /// <summary>The state an offer's status shows in (countered waits on you).</summary>
        public static DsState OfferState(string status) => status switch
        {
            "countered" => DsState.Warn,
            "signed" => DsState.Good,
            "submitted" or "awaitingReview" => DsState.Info,
            "walkedAway" or "declined" or "lapsed" => DsState.Bad,
            _ => DsState.Neutral,
        };

        public static bool IsOpenStatus(string status) => status == "submitted" || status == "awaitingReview" || status == "countered";

        /// <summary>Talks waiting on you first (their counter), then by how far along they are.</summary>
        public static int OfferStatusRank(string status) => status switch
        {
            "countered" => -1,
            "submitted" => 0,
            "awaitingReview" => 1,
            "signed" => 3,
            "walkedAway" => 4,
            "declined" => 5,
            "lapsed" => 6,
            "withdrawn" => 7,
            _ => 8,
        };

        /// <summary>"Decides on Jan 8, 2027" / "Answer by Jan 14, 2027" / null.</summary>
        public static string OfferDue(JToken row)
        {
            string status = Kit.Str(row, "status");
            if (status == "awaitingReview" && Kit.Str(row, "reviewOn") is string review) return $"Decides on {Date(review)}";
            if (status == "countered" && Kit.Str(row, "counterExpiresOn") is string by) return $"Answer by {Date(by)}";
            return null;
        }

        /// <summary>"$24,000 a month, $2,000 to sign, 24 months, exclusive" from a summary (flat) or an offer (terms inside).</summary>
        public static string OfferSummary(JToken offer)
        {
            JToken terms = Kit.Obj(offer, "terms") ?? offer;
            var parts = new List<string>
            {
                Kit.Str(terms, "kind") == "perAppearance"
                    ? $"{Money(Kit.Num(terms, "perAppearanceFee") ?? 0)} an appearance"
                    : $"{Money(Kit.Num(terms, "monthlyWage") ?? 0)} a month",
            };
            double bonus = Kit.Num(terms, "signingBonus") ?? 0;
            if (bonus > 0) parts.Add($"{Money(bonus)} to sign");
            parts.Add(Months(Kit.Num(offer, "lengthMonths") ?? 0));
            if (Kit.Bool(terms, "exclusive")) parts.Add("exclusive");
            return string.Join(", ", parts);
        }

        /// <summary>The Offers tab's "On the table": their counter while it waits on you, else your offer.</summary>
        public static string OnTheTable(JToken row)
        {
            if (Kit.Str(row, "status") == "countered" && Kit.Obj(row, "counterSummary") is JToken counter)
            {
                return $"Their counter: {OfferSummary(counter)}";
            }
            return OfferSummary(Kit.Obj(row, "offerSummary"));
        }

        /// <summary>What is on the table as one monthly number, for sorting.</summary>
        public static double OnTheTableValue(JToken row)
        {
            JToken terms = Kit.Str(row, "status") == "countered" && Kit.Obj(row, "counterSummary") is JToken counter ? counter : Kit.Obj(row, "offerSummary");
            return (Kit.Num(terms, "monthlyWage") ?? 0) + (Kit.Num(terms, "perAppearanceFee") ?? 0) * 4;
        }

        /// <summary>"They countered $34,200 a month, 24 months, Upper card".</summary>
        public static string CounterLine(JToken offer)
        {
            string push = Kit.Str(offer, "push");
            return $"They countered {OfferSummary(offer)}{(push == null || push == "none" ? string.Empty : ", " + PushName(push))}";
        }

        public static string OfferedLine(JToken offer) => $"You offered {OfferSummary(offer)}";

        public static string Patience(double left, double start) =>
            $"Patience: {TextFormat.Number((long)left)} of {TextFormat.Number((long)start)} {(start == 1 ? "round" : "rounds")} left";

        public static string OfferSent(string reviewOn) =>
            reviewOn == null ? "Offer sent. They'll answer after the next day." : $"Offer accepted. They'll decide on {Date(reviewOn)}.";

        public static string Signed(string ringName, bool renewal) =>
            $"{ringName} has signed{(renewal ? " the new contract" : string.Empty)}. They look forward to working with you.";

        /// <summary>The reaction band's state on the meter.</summary>
        public static DsState BandState(string band) => band switch
        {
            "likely" => DsState.Good,
            "counter" => DsState.Info,
            "reject" => DsState.Warn,
            "walkAway" or "refuse" => DsState.Bad,
            _ => DsState.Neutral,
        };

        /// <summary>The meter's fill: the offer's share of their ask, where "accept" sits at 80% of the bar.</summary>
        public static float MeterFraction(double ratio, double acceptAt)
        {
            if (acceptAt <= 0) acceptAt = 1;
            return UnityEngine.Mathf.Clamp01((float)(ratio / acceptAt * 0.8));
        }

        // ---- Offer lengths --------------------------------------------------------------------------

        /// <summary>The lengths the sheet offers, in months, up to <c>contracts.offer.maxLengthMonths</c>.</summary>
        public static readonly int[] OfferLengths = { 6, 12, 18, 24, 36, 48, 60 };

        /// <summary>The lengths allowed under the cap, always with the draft's own length among them.</summary>
        public static List<int> LengthOptions(int maxLengthMonths, int current)
        {
            List<int> options = OfferLengths.Where(months => months <= maxLengthMonths).ToList();
            if (options.Count == 0) options.Add(maxLengthMonths);
            if (!options.Contains(current)) options.Add(current);
            options.Sort();
            return options;
        }

        /// <summary>The nearest allowed length to <paramref name="months"/>, never above the cap.</summary>
        public static int NearestLength(int months, int maxLengthMonths)
        {
            List<int> options = LengthOptions(maxLengthMonths, System.Math.Min(months, maxLengthMonths));
            int best = options[0];
            foreach (int option in options)
            {
                if (System.Math.Abs(option - months) < System.Math.Abs(best - months)) best = option;
            }
            return best;
        }

        /// <summary>Whole dollars typed by the player ("12,500", "$300") as cents, or null for anything else.</summary>
        public static long? ParseDollars(string text)
        {
            if (text == null) return null;
            string digits = new string(text.Where(char.IsDigit).ToArray());
            if (digits.Length == 0 || digits.Length > 12) return null;
            return long.Parse(digits, System.Globalization.CultureInfo.InvariantCulture) * 100;
        }

        /// <summary>Cents as the dollars a money field shows ("12500").</summary>
        public static string DollarsText(double cents) => ((long)System.Math.Round(cents / 100.0)).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
}
