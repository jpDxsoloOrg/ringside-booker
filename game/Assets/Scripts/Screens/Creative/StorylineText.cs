using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// The Storylines screens' words and rules, ported from the web
    /// (<c>apps/web/src/screens/storylines/</c>): heat words, how heat cools, the card's footer facts,
    /// the payoff texts, member sides, where refusals go, and the timeline that joins the heat steps
    /// to the linked segments. No minutes or lengths anywhere (D-10). Engine-free, so the EditMode
    /// tests cover it.
    /// </summary>
    public static class StorylineText
    {
        public const string HotLabel = "Hot";
        public const string HeatNotPublic = "Heat not public";
        public const string LeftPromotion = "Left the promotion";
        public const string EmptyTimeline = "No linked segments yet: link this story's segments in Booking";
        public const string Booked = "Booked: counts once the show has run";
        public const string NotCounted = "Didn't count: nobody in it was in the storyline";
        public const string PayoffLoading = "Working out what ending it now would pay…";
        public const string PayoffStrengthLabel = "Payoff strength";
        public const string FinalePlayed = "Its finale was played, so a hot story pays off more";
        public const string OldSavePayoff = "Ended before storyline payoffs, so it paid nothing";
        public const string SkippedRecord = "Nothing: they had left, or there was no fan base to notice";
        public const int MaxMembers = 12;
        public const int NameMax = 80;
        public const int SummaryMax = 500;

        /// <summary>
        /// Heat in a word and a state, said before the number: Hot from <paramref name="hotFrom"/>,
        /// Warm from 30 below it, else Cold (display words only).
        /// </summary>
        public static (string word, DsState state) HeatWord(double heat, double hotFrom)
        {
            if (heat >= hotFrom) return (HotLabel, DsState.Live);
            if (heat >= hotFrom - 30) return ("Warm", DsState.Warn);
            return ("Cold", DsState.Info);
        }

        /// <summary>"You run 6 storylines. It gets hard to keep them all hot; you can still start more."</summary>
        public static string SoftLimitText(int activeCount) =>
            $"You run {TextFormat.Number(activeCount)} storylines. It gets hard to keep them all hot; you can still start more.";

        /// <summary>"3 active · 1 ended".</summary>
        public static string CountsText(int active, int ended) => $"{TextFormat.Number(active)} active · {TextFormat.Number(ended)} ended";

        private static string Plural(long count, string one, string many) => $"{TextFormat.Number(count)} {(count == 1 ? one : many)}";

        /// <summary>
        /// A card's footer facts: "Started Jan 4, 2027 · 2 linked segments · 3 days since it moved on".
        /// A rival's card only has its dates; an ended one says when it ended.
        /// </summary>
        public static IReadOnlyList<string> FooterFacts(string startedOn, string endedOn, double? linkedSegments, double? daysSinceProgress)
        {
            var facts = new List<string> { $"Started {Kit.Date(startedOn)}" };
            if (endedOn != null) facts.Add($"Ended {Kit.Date(endedOn)}");
            if (linkedSegments.HasValue) facts.Add(Plural((long)linkedSegments.Value, "linked segment", "linked segments"));
            if (daysSinceProgress.HasValue)
            {
                long days = (long)daysSinceProgress.Value;
                facts.Add(days == 0 ? "Moved on today" : $"{Plural(days, "day", "days")} since it moved on");
            }
            return facts;
        }

        /// <summary>
        /// How heat cools, in a line: "Cools from day 8 without progress (in 8 days).", "Cooling 1
        /// per day, floor 10.", "At its floor of 10: it cools no further." or "Heat doesn't cool."
        /// </summary>
        public static string CoolingText(double perDay, bool coolingNow, double floor, double? startsInDays, double graceDays)
        {
            if (perDay <= 0) return "Heat doesn't cool.";
            if (coolingNow) return $"Cooling {TextFormat.Number((long)perDay)} per day, floor {TextFormat.Number((long)floor)}.";
            if (startsInDays.HasValue)
            {
                long days = (long)startsInDays.Value;
                return $"Cools from day {TextFormat.Number((long)graceDays + 1)} without progress (in {Plural(days, "day", "days")}).";
            }
            return $"At its floor of {TextFormat.Number((long)floor)}: it cools no further.";
        }

        public static string CoolingText(JToken cooling) =>
            cooling == null ? null : CoolingText(Kit.Num(cooling, "perDay") ?? 0, Kit.Bool(cooling, "coolingNow"), Kit.Num(cooling, "floor") ?? 0,
                Kit.Num(cooling, "startsInDays"), Kit.Num(cooling, "graceDays") ?? 0);

        /// <summary>"No payoff (needs 4 linked segments, has 1)": ending now pays nothing.</summary>
        public static string NotEligibleText(int minSegments, int counted) =>
            $"No payoff (needs {Plural(minSegments, "linked segment", "linked segments")}, has {TextFormat.Number(counted)})";

        /// <summary>"No payoff (needs 4 linked segments, had 3)": an ended storyline that paid nothing.</summary>
        public static string NoPayoffRecordText(int minSegments, int counted) =>
            $"No payoff (needs {Plural(minSegments, "linked segment", "linked segments")}, had {TextFormat.Number(counted)})";

        /// <summary>What a payoff strength means for the members, in a few words.</summary>
        public static string PayoffStrengthWords(double quality)
        {
            if (quality >= 0.5) return "a big lift for everyone in it";
            if (quality > 0) return "a small lift for everyone in it";
            if (quality == 0) return "nothing either way";
            if (quality > -0.5) return "the story fell flat: a small drop";
            return "the story went cold: a real drop";
        }

        public static DsState PayoffState(double quality) => quality > 0 ? DsState.Good : quality < 0 ? DsState.Bad : DsState.Neutral;

        /// <summary>"Segments still booked for Test Weekly will no longer count".</summary>
        public static string StillBookedText(string showName) => $"Segments still booked for {showName} will no longer count";

        /// <summary>"Finale played on Jan 4, 2027: end the storyline to pay it off".</summary>
        public static string FinalePlayedText(string date) => $"Finale played on {Kit.Date(date)}: end the storyline to pay it off";

        /// <summary>"Started Jan 4, 2027 · Ended Mar 1, 2027".</summary>
        public static string DatesText(string startedOn, string endedOn) =>
            endedOn == null ? $"Started {Kit.Date(startedOn)}" : $"Started {Kit.Date(startedOn)} · Ended {Kit.Date(endedOn)}";

        /// <summary>"+1.5", "−2", "0": popularity in tenths, momentum in whole points (U+2212 minus).</summary>
        public static string Signed(double value, int decimals)
        {
            double rounded = Math.Round(value, decimals, MidpointRounding.AwayFromZero);
            if (rounded == 0) return "0";
            string number = Math.Abs(rounded).ToString(decimals == 0 ? "0" : "0.#", System.Globalization.CultureInfo.InvariantCulture);
            return (rounded > 0 ? "+" : "−") + number;
        }

        // ---- Sides and members ------------------------------------------------------------------------

        public static readonly (string side, string title, string label)[] Sides =
        {
            ("face", "Faces", "Face"),
            ("heel", "Heels", "Heel"),
            ("neutral", "Neutral", "Neutral"),
        };

        public static string SideLabel(string side) => side == "face" ? "Face" : side == "heel" ? "Heel" : "Neutral";

        /// <summary>The side a person starts on: face → Face, heel → Heel, tweener → Neutral.</summary>
        public static string DefaultSideFor(string alignment) => alignment == "face" ? "face" : alignment == "heel" ? "heel" : "neutral";

        public static string RoleWord(string role) => role switch
        {
            "wrestler" => "Wrestler",
            "manager" => "Manager",
            "presenter" => "Presenter",
            "announcer" => "Announcer",
            "referee" => "Referee",
            "producer" => "Producer",
            "booker" => "Booker",
            _ => Kit.Capital(role ?? string.Empty),
        };

        /// <summary>"Wrestler · Main event · In 2 storylines".</summary>
        public static string MemberOptionFacts(string role, string push, int activeStorylines)
        {
            var facts = new List<string> { RoleWord(role) };
            if (!string.IsNullOrEmpty(push) && push != "none") facts.Add(Kit.PushLabel(push));
            facts.Add(activeStorylines == 0 ? "In no storylines" : $"In {Plural(activeStorylines, "storyline", "storylines")}");
            return string.Join(" · ", facts);
        }

        /// <summary>Where each refusal goes: under its field, or above the footer when it names none.</summary>
        public sealed class PlacedReasons
        {
            public string Name;
            public string Summary;
            public string BrandId;
            public string Members;
            public readonly List<string> General = new List<string>();
        }

        public static PlacedReasons PlaceReasons(IEnumerable<(string code, string field, string message)> reasons)
        {
            var placed = new PlacedReasons();
            string Join(string before, string message) => before == null ? message : $"{before} {message}";
            foreach ((string _, string field, string message) in reasons)
            {
                if (field == "name") placed.Name = Join(placed.Name, message);
                else if (field == "summary") placed.Summary = Join(placed.Summary, message);
                else if (field == "brandId") placed.BrandId = Join(placed.BrandId, message);
                else if (field != null && (field == "members" || field.StartsWith("members[", StringComparison.Ordinal))) placed.Members = Join(placed.Members, message);
                else placed.General.Add(message);
            }
            return placed;
        }

        // ---- Timeline -------------------------------------------------------------------------------

        /// <summary>"Slot 3", "Pre-show slot 1".</summary>
        public static string SlotLabel(bool preShow, int slot) => preShow ? $"Pre-show slot {slot + 1}" : $"Slot {slot + 1}";

        /// <summary>One row of the storyline page's timeline: a counted step, a booked segment or one that didn't count.</summary>
        public sealed class TimelineEntry
        {
            public string SegmentId;
            public string EventInstanceId;
            public string ShowName;
            public string Date;
            public bool? PreShow;
            public int? Slot;
            public string Label;
            public bool Finale;
            public double? Stars;
            public string RatingTraceKey;
            public double? HeatBefore;
            public double? HeatAfter;
            public JToken HeatTraceRef;
            /// <summary><c>counted</c>, <c>booked</c> or <c>notCounted</c>.</summary>
            public string State;
        }

        /// <summary>
        /// The page's timeline, newest first: every heat step <c>storylines.timeline</c> still holds,
        /// joined to the linked segments of <c>storylines.detail</c>, plus the linked segments that
        /// haven't counted (still booked, or run without anyone in the story). <paramref name="today"/>
        /// is the next day to play (ISO date) or null.
        /// </summary>
        public static List<TimelineEntry> TimelineEntries(IEnumerable<JToken> linked, IEnumerable<JToken> steps, string today)
        {
            List<JToken> linkedList = linked.ToList();
            var bySegment = new Dictionary<string, JToken>();
            foreach (JToken entry in linkedList)
            {
                string id = Kit.Str(entry, "segmentId");
                if (id != null && !bySegment.ContainsKey(id)) bySegment[id] = entry;
            }
            var entries = new List<TimelineEntry>();
            var counted = new HashSet<string>();
            foreach (JToken step in steps)
            {
                string segmentId = Kit.Str(step, "segmentId");
                counted.Add(segmentId);
                bySegment.TryGetValue(segmentId ?? string.Empty, out JToken entry);
                entries.Add(new TimelineEntry
                {
                    SegmentId = segmentId,
                    EventInstanceId = Kit.Str(step, "eventInstanceId"),
                    ShowName = Kit.Str(step, "showName") ?? Kit.Str(entry, "eventName"),
                    Date = Kit.Str(step, "date"),
                    PreShow = BoolOrNull(step, "preShow") ?? BoolOrNull(entry, "preShow"),
                    Slot = IntOrNull(step, "slot") ?? IntOrNull(entry, "slot"),
                    Label = Kit.Str(step, "segmentLabel") ?? Kit.Str(entry, "label"),
                    Finale = Kit.Bool(step, "finale"),
                    Stars = Kit.Num(entry, "stars"),
                    RatingTraceKey = Kit.Str(entry, "ratingTraceId"),
                    HeatBefore = Kit.Num(step, "heatBefore"),
                    HeatAfter = Kit.Num(step, "heatAfter"),
                    HeatTraceRef = Kit.Obj(step, "traceRef"),
                    State = "counted",
                });
            }
            foreach (JToken entry in linkedList)
            {
                string segmentId = Kit.Str(entry, "segmentId");
                if (counted.Contains(segmentId)) continue;
                double? before = Kit.Num(entry, "heatBefore");
                double? after = Kit.Num(entry, "heatAfter");
                bool hasStep = before.HasValue && after.HasValue;
                double? stars = Kit.Num(entry, "stars");
                string date = Kit.Str(entry, "date");
                bool booked = !stars.HasValue && (today == null || string.CompareOrdinal(date, today) >= 0);
                entries.Add(new TimelineEntry
                {
                    SegmentId = segmentId,
                    EventInstanceId = Kit.Str(entry, "eventInstanceId"),
                    ShowName = Kit.Str(entry, "eventName"),
                    Date = date,
                    PreShow = BoolOrNull(entry, "preShow"),
                    Slot = IntOrNull(entry, "slot"),
                    Label = Kit.Str(entry, "label"),
                    Finale = Kit.Bool(entry, "isFinale"),
                    Stars = stars,
                    RatingTraceKey = Kit.Str(entry, "ratingTraceId"),
                    HeatBefore = hasStep ? before : null,
                    HeatAfter = hasStep ? after : null,
                    HeatTraceRef = hasStep ? Kit.Obj(entry, "heatTraceRef") : null,
                    State = hasStep ? "counted" : booked ? "booked" : "notCounted",
                });
            }
            entries.Sort(CompareNewestFirst);
            return entries;
        }

        private static int CompareNewestFirst(TimelineEntry left, TimelineEntry right)
        {
            int byDate = string.CompareOrdinal(right.Date, left.Date);
            if (byDate != 0) return byDate;
            int byShow = string.CompareOrdinal(right.EventInstanceId, left.EventInstanceId);
            if (byShow != 0) return byShow;
            // Later on the night first: the main card after the pre-show, higher slots after lower.
            int leftPre = left.PreShow == true ? 0 : 1;
            int rightPre = right.PreShow == true ? 0 : 1;
            if (leftPre != rightPre) return rightPre - leftPre;
            return (right.Slot ?? 0) - (left.Slot ?? 0);
        }

        private static bool? BoolOrNull(JToken token, string path) =>
            token?.SelectToken(path) is JValue value && value.Type == JTokenType.Boolean ? (bool?)(bool)value : null;

        private static int? IntOrNull(JToken token, string path)
        {
            double? number = Kit.Num(token, path);
            return number.HasValue ? (int?)(int)number.Value : null;
        }

        /// <summary>A trace key (<c>"segment.rating:seg_1"</c>) as the <c>{kind, id}</c> ref Why? panels load, or null.</summary>
        public static JObject TraceRefFromKey(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            int separator = key.IndexOf(':');
            if (separator <= 0 || separator == key.Length - 1) return null;
            return new JObject { ["kind"] = key.Substring(0, separator), ["id"] = key.Substring(separator + 1) };
        }

        /// <summary>"42 → 51".</summary>
        public static string HeatStep(double before, double after) =>
            $"{TextFormat.Number((long)Math.Round(before))} → {TextFormat.Number((long)Math.Round(after))}";

        /// <summary>The date the active storyline's finale was played, or null when it has none or it hasn't run.</summary>
        public static string FinalePlayedOn(string status, IEnumerable<JToken> linked)
        {
            if (status != "active") return null;
            JToken finale = linked.FirstOrDefault(entry => Kit.Bool(entry, "isFinale"));
            return finale == null || !Kit.Num(finale, "stars").HasValue ? null : Kit.Str(finale, "date");
        }

        /// <summary>Shows still to run with linked segments, in date order: ending it now means those no longer count.</summary>
        public static IReadOnlyList<string> StillBookedShows(IEnumerable<JToken> linked, string today)
        {
            var shows = new List<string>();
            if (today == null) return shows;
            foreach (JToken entry in linked)
            {
                string name = Kit.Str(entry, "eventName");
                if (!Kit.Num(entry, "stars").HasValue && string.CompareOrdinal(Kit.Str(entry, "date"), today) >= 0 && name != null && !shows.Contains(name)) shows.Add(name);
            }
            return shows;
        }
    }
}
