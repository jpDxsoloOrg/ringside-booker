using System;
using System.Globalization;

namespace RingsideBooker.UI
{
    /// <summary>The web app's number and money formats (components/format), in C#.</summary>
    public static class TextFormat
    {
        /// <summary>A true minus sign, as the web uses, so negatives line up with positives.</summary>
        public const string Minus = "−";

        /// <summary><c>3,650</c>; negatives with a true minus.</summary>
        public static string Number(long value)
        {
            string body = Math.Abs(value).ToString("N0", CultureInfo.InvariantCulture);
            return value < 0 ? Minus + body : body;
        }

        /// <summary><c>1 day</c>, <c>30 days</c>, <c>3,650 days</c>.</summary>
        public static string DayCount(int days) => $"{Number(days)} {(days == 1 ? "day" : "days")}";

        /// <summary>Cents as whole dollars: <c>$1,234,568</c>, <c>−$2,500</c>.</summary>
        public static string Money(long cents)
        {
            long dollars = (long)Math.Round(Math.Abs(cents) / 100.0, MidpointRounding.AwayFromZero);
            string body = "$" + dollars.ToString("N0", CultureInfo.InvariantCulture);
            return cents < 0 && dollars != 0 ? Minus + body : body;
        }

        /// <summary>The display face is set in capitals (USS has no text-transform).</summary>
        public static string Upper(string text) => text?.ToUpperInvariant() ?? string.Empty;

        /// <summary>Ends <paramref name="text"/> with a full stop unless it already ends a sentence.</summary>
        public static string Sentence(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            char last = text[text.Length - 1];
            return last == '.' || last == '!' || last == '?' || last == '…' ? text : text + ".";
        }
    }
}
