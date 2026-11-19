using System;
using System.Globalization;

namespace RingsideBooker.UI
{
    /// <summary>
    /// A calendar day in the game, the C# side of the engine's ISO <c>YYYY-MM-DD</c> game date.
    /// Game dates are days, not instants, so nothing here touches time zones.
    /// </summary>
    public readonly struct GameDate : IEquatable<GameDate>, IComparable<GameDate>
    {
        private readonly DateTime value;

        public GameDate(int year, int month, int day)
        {
            value = new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Unspecified);
        }

        private GameDate(DateTime dateTime)
        {
            value = dateTime.Date;
        }

        public int Year => value.Year;
        public int Month => value.Month;
        public int Day => value.Day;

        /// <summary>The engine's form: <c>2031-03-14</c>.</summary>
        public string Iso => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        /// <summary>Parses an engine date (<c>YYYY-MM-DD</c>).</summary>
        public static bool TryParse(string iso, out GameDate date)
        {
            if (!string.IsNullOrEmpty(iso) &&
                DateTime.TryParseExact(iso.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime parsed))
            {
                date = new GameDate(parsed);
                return true;
            }
            date = default;
            return false;
        }

        public static GameDate Parse(string iso)
        {
            if (!TryParse(iso, out GameDate date)) throw new FormatException($"Not a game date: '{iso}'");
            return date;
        }

        public GameDate AddDays(int days) => new GameDate(value.AddDays(days));
        public GameDate AddMonths(int months) => new GameDate(value.AddMonths(months));
        public GameDate StartOfMonth => new GameDate(Year, Month, 1);
        public DayOfWeek DayOfWeek => value.DayOfWeek;

        /// <summary>Whole days from this date to <paramref name="other"/> (negative when it is earlier).</summary>
        public int DaysUntil(GameDate other) => (int)Math.Round((other.value - value).TotalDays);

        /// <summary><c>Wednesday, January 1, 2031</c> (the web's <c>long</c> style).</summary>
        public string Long => value.ToString("dddd, MMMM d, yyyy", CultureInfo.InvariantCulture);

        /// <summary><c>Jan 1, 2031</c> (the web's <c>short</c> style).</summary>
        public string Short => value.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);

        /// <summary><c>Wed 1 Jan 2031</c> (the web's <c>dayMonthYear</c> style).</summary>
        public string DayMonthYear => value.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

        public bool Equals(GameDate other) => value == other.value;
        public override bool Equals(object obj) => obj is GameDate other && Equals(other);
        public override int GetHashCode() => value.GetHashCode();
        public int CompareTo(GameDate other) => value.CompareTo(other.value);
        public override string ToString() => Iso;

        public static bool operator ==(GameDate left, GameDate right) => left.Equals(right);
        public static bool operator !=(GameDate left, GameDate right) => !left.Equals(right);
        public static bool operator <(GameDate left, GameDate right) => left.value < right.value;
        public static bool operator >(GameDate left, GameDate right) => left.value > right.value;
        public static bool operator <=(GameDate left, GameDate right) => left.value <= right.value;
        public static bool operator >=(GameDate left, GameDate right) => left.value >= right.value;
    }
}
