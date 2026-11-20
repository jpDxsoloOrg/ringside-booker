using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// The engine's <c>Recurrence</c> on the C# side (EVT8): how often a show runs. Weekdays are the
    /// engine's, 0 = Monday to 6 = Sunday. Pure: the recurrence builder edits one and sends
    /// <see cref="ToJson"/> to the engine; no clock time or length anywhere (D-10).
    /// </summary>
    public sealed class RecurrenceValue
    {
        public const string Weekly = "weekly";
        public const string EveryNWeeks = "everyNWeeks";
        public const string Monthly = "monthly";
        public const string Annual = "annual";
        public const string SetDates = "dates";

        public static readonly string[] WeekdayShort = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };
        public static readonly string[] WeekdayLong = { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };
        public static readonly string[] MonthShort = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        /// <summary>Week of the month: "1".."4" or "last".</summary>
        public static readonly string[] Weeks = { "1", "2", "3", "4", "last" };

        public string Kind = Weekly;
        public List<int> Weekdays = new List<int> { 4 };
        public int IntervalWeeks = 2;
        public int Weekday = 4;
        /// <summary>The first show of an every-N-weeks recurrence (ISO), on <see cref="Weekday"/>.</summary>
        public string Anchor;
        public string Week = "last";
        public int Month = 1;
        /// <summary>A set-dates recurrence is kept as it was stored; the builder never makes one.</summary>
        public JToken StoredDates;

        /// <summary>The engine weekday (0 = Monday) of a date.</summary>
        public static int WeekdayOf(GameDate date) => ((int)date.DayOfWeek + 6) % 7;

        /// <summary>The first date on or after <paramref name="from"/> that falls on <paramref name="weekday"/>.</summary>
        public static GameDate NextOn(int weekday, GameDate from) => from.AddDays(((weekday - WeekdayOf(from)) % 7 + 7) % 7);

        public RecurrenceValue Clone() => new RecurrenceValue
        {
            Kind = Kind,
            Weekdays = new List<int>(Weekdays),
            IntervalWeeks = IntervalWeeks,
            Weekday = Weekday,
            Anchor = Anchor,
            Week = Week,
            Month = Month,
            StoredDates = StoredDates?.DeepClone(),
        };

        /// <summary>
        /// Switches to another kind, carrying the weekday over, and fills an every-N-weeks start
        /// date from <paramref name="from"/> when it has none on the right weekday.
        /// </summary>
        public void SwitchTo(string kind, GameDate from)
        {
            if (Kind == Weekly && Weekdays.Count > 0) Weekday = Weekdays.Min();
            if (kind == Weekly && Weekdays.Count == 0) Weekdays.Add(Weekday);
            Kind = kind;
            if (kind == EveryNWeeks) FixAnchor(from);
        }

        /// <summary>Sets the single weekday (every N weeks, monthly, annual) and moves the start date to it.</summary>
        public void SetWeekday(int weekday, GameDate from)
        {
            Weekday = weekday;
            if (Kind == EveryNWeeks) FixAnchor(from, force: true);
        }

        /// <summary>Turns one weekday of a weekly show on or off; the last one stays on.</summary>
        public void ToggleWeekday(int weekday)
        {
            if (Weekdays.Contains(weekday))
            {
                if (Weekdays.Count > 1) Weekdays.Remove(weekday);
            }
            else Weekdays.Add(weekday);
            Weekdays.Sort();
        }

        /// <summary>Sets the start date of an every-N-weeks show; the weekday follows it.</summary>
        public void SetAnchor(GameDate date)
        {
            Anchor = date.Iso;
            Weekday = WeekdayOf(date);
        }

        private void FixAnchor(GameDate from, bool force = false)
        {
            bool valid = GameDate.TryParse(Anchor, out GameDate anchor) && WeekdayOf(anchor) == Weekday;
            if (!valid || force) Anchor = NextOn(Weekday, from).Iso;
        }

        public JObject ToJson()
        {
            switch (Kind)
            {
                case EveryNWeeks:
                    return new JObject { ["kind"] = EveryNWeeks, ["intervalWeeks"] = IntervalWeeks, ["weekday"] = Weekday, ["anchor"] = Anchor };
                case Monthly:
                    return new JObject { ["kind"] = Monthly, ["week"] = WeekToken(Week), ["weekday"] = Weekday };
                case Annual:
                    return new JObject { ["kind"] = Annual, ["month"] = Month, ["week"] = WeekToken(Week), ["weekday"] = Weekday };
                case SetDates:
                    return StoredDates is JObject stored ? (JObject)stored.DeepClone() : new JObject { ["kind"] = SetDates, ["dates"] = new JArray() };
                default:
                    return new JObject { ["kind"] = Weekly, ["weekdays"] = new JArray(Weekdays.OrderBy(day => day).Select(day => (object)day).ToArray()) };
            }
        }

        public static RecurrenceValue FromJson(JToken token)
        {
            var value = new RecurrenceValue();
            if (token == null || token.Type != JTokenType.Object) return value;
            value.Kind = (string)token["kind"] ?? Weekly;
            switch (value.Kind)
            {
                case Weekly:
                    value.Weekdays = token["weekdays"]?.Select(day => (int)day).OrderBy(day => day).ToList() ?? new List<int> { 4 };
                    if (value.Weekdays.Count > 0) value.Weekday = value.Weekdays[0];
                    break;
                case EveryNWeeks:
                    value.IntervalWeeks = (int?)token["intervalWeeks"] ?? 2;
                    value.Weekday = (int?)token["weekday"] ?? 4;
                    value.Anchor = (string)token["anchor"];
                    value.Weekdays = new List<int> { value.Weekday };
                    break;
                case Monthly:
                case Annual:
                    value.Week = token["week"]?.ToString() ?? "last";
                    value.Weekday = (int?)token["weekday"] ?? 6;
                    value.Month = (int?)token["month"] ?? 1;
                    value.Weekdays = new List<int> { value.Weekday };
                    break;
                case SetDates:
                    value.StoredDates = token.DeepClone();
                    break;
            }
            return value;
        }

        private static JToken WeekToken(string week) =>
            int.TryParse(week, out int number) ? (JToken)number : "last";

        /// <summary>"1st", "2nd", "3rd", "4th", "Last".</summary>
        public static string WeekWord(string week) => week switch
        {
            "1" => "1st",
            "2" => "2nd",
            "3" => "3rd",
            "4" => "4th",
            _ => "Last",
        };
    }
}
