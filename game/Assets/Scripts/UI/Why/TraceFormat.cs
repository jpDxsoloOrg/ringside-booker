using System;
using System.Globalization;
using System.Text;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// How trace values read in the Why? panel: a port of the web app's
    /// <c>components/Trace/formatTraceValue.ts</c> and the en-US number and money formatters it
    /// uses, so a number reads exactly as it does on the web. Exact numbers for now (owner rule):
    /// nothing is hidden or rounded beyond what the web shows.
    /// </summary>
    public static class TraceFormat
    {
        /// <summary>U+2212, the typographic minus sign.</summary>
        public const string MinusSign = "−";

        /// <summary>Most decimals for a number without a unit, or with a unit that allows fractions.</summary>
        private const int DefaultDecimals = 2;
        /// <summary>Decimals for factors (ratios and multipliers): <c>×0.885</c>.</summary>
        public const int FactorDecimals = 3;
        private const int AttributeDecimals = 3;
        private const int PercentDecimals = 1;
        private const int SmallPercentDecimals = 3;
        private const int PopularityDecimals = 1;
        private const double PercentPerProbability = 100;
        private const long ShowCentsBelow = 100_000;
        private const long CentsPerDollar = 100;

        /// <summary>
        /// A number in its unit (see <c>formatTraceNumber</c> on the web): money from cents, percent
        /// on 0–100, probability from 0–1, factors with up to 3 decimals, popularity points with 1,
        /// days/months/years/people with their word, and anything else with up to 2 decimals.
        /// </summary>
        public static string Number(double value, string unit = null)
        {
            switch (unit)
            {
                case TraceUnits.Money:
                    return Money(value);
                case TraceUnits.MoneyPerMonth:
                    return Money(value) + "/month";
                case TraceUnits.Percent:
                    return Percent(value);
                case TraceUnits.Probability:
                    return Percent(value * PercentPerProbability);
                case TraceUnits.Ratio:
                    return Decimal(value, FactorDecimals);
                case TraceUnits.Multiplier:
                    return "×" + Decimal(value, FactorDecimals);
                case TraceUnits.PointsPerDay:
                    return Decimal(value) + "/day";
                case TraceUnits.Stars:
                    return Decimal(value) + "★";
                case TraceUnits.Days:
                    return Plural(value, "day", "days");
                case TraceUnits.Months:
                    return Plural(value, "month", "months");
                case TraceUnits.Years:
                    return Plural(value, "year", "years");
                case TraceUnits.People:
                    return Plural(value, "person", "people");
                case TraceUnits.Kilograms:
                    return Decimal(value) + " kg";
                case TraceUnits.Attribute:
                    return Decimal(value, AttributeDecimals);
                case TraceUnits.Points:
                    return FormatNumber(value, PopularityDecimals);
                default:
                    return Decimal(value);
            }
        }

        /// <summary>Any trace value: numbers in their unit, <c>yes</c>/<c>no</c>, text as it is, <c>–</c> for none.</summary>
        public static string Value(TraceValue value, string unit = null)
        {
            switch (value.Type)
            {
                case TraceValueType.Number: return Number(value.Number, unit);
                case TraceValueType.Bool: return value.Bool ? "yes" : "no";
                case TraceValueType.Text: return value.Text;
                default: return "–";
            }
        }

        /// <summary>
        /// A change with its sign always shown: <c>+6</c>, <c>−$500</c>. A change that rounds to
        /// nothing at the shown precision reads <c>±0</c>.
        /// </summary>
        public static string Delta(double delta, string unit = null)
        {
            string magnitude = Number(Math.Abs(delta), unit);
            if (!HasNonZeroDigit(magnitude)) return "±" + magnitude;
            return (delta > 0 ? "+" : MinusSign) + magnitude;
        }

        /// <summary>
        /// <c>before → after</c>. When they differ but read the same (a big amount rounded to the
        /// dollar), money shows its cents so the change is seen.
        /// </summary>
        public static string Change(double before, double after, string unit = null)
        {
            string beforeText = Number(before, unit);
            string afterText = Number(after, unit);
            // `before === after` in JavaScript: NaN never equals itself, which traces never hold.
            if (beforeText != afterText || before == after) return beforeText + " → " + afterText;
            if (unit == TraceUnits.Money) return Money(before, true) + " → " + Money(after, true);
            if (unit == TraceUnits.MoneyPerMonth) return Money(before, true) + "/month → " + Money(after, true) + "/month";
            return beforeText + " → " + afterText;
        }

        /// <summary>Popularity as every screen shows it: one decimal at most (<c>70.3</c>).</summary>
        public static string Popularity(double value) => FormatNumber(value, PopularityDecimals);

        /// <summary>
        /// A game date (<c>YYYY-MM-DD</c>) in the web's short style, <c>Jul 3, 2027</c>. Text that is
        /// not a date is returned as it is.
        /// </summary>
        public static string GameDate(string date)
        {
            if (DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime parsed))
            {
                return parsed.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
            }
            return date ?? string.Empty;
        }

        private static bool HasNonZeroDigit(string text)
        {
            foreach (char c in text)
            {
                if (c >= '1' && c <= '9') return true;
            }
            return false;
        }

        private static string Percent(double value)
        {
            int decimals = Math.Abs(value) < 1 ? SmallPercentDecimals : PercentDecimals;
            return Decimal(value, decimals) + "%";
        }

        private static string Decimal(double value, int maximumFractionDigits = DefaultDecimals) =>
            FormatNumber(value, maximumFractionDigits);

        private static string Plural(double value, string singular, string pluralForm) =>
            Decimal(value) + " " + (Math.Abs(value) == 1 ? singular : pluralForm);

        /// <summary>
        /// Money values are whole cents; a fraction that crept in through a multiplier is rounded.
        /// Cents show on a small amount that is not whole dollars (<c>$12.50</c>), never on a big
        /// one, unless <paramref name="exact"/>.
        /// </summary>
        private static string Money(double value, bool exact = false)
        {
            long amount = ToCents(JsRound(value));
            bool showCents = exact || (amount % CentsPerDollar != 0 && Math.Abs(amount) < ShowCentsBelow);
            return FormatMoney(amount, showCents);
        }

        /// <summary>JavaScript's <c>Math.round</c>: halves go up (towards +∞).</summary>
        private static double JsRound(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return value;
            double floor = Math.Floor(value);
            return value - floor >= 0.5 ? floor + 1 : floor;
        }

        private static long ToCents(double value)
        {
            if (double.IsNaN(value)) return 0;
            if (value >= long.MaxValue) return long.MaxValue;
            if (value <= long.MinValue + 1) return long.MinValue + 1;
            return (long)value;
        }

        /// <summary>
        /// The web's <c>formatMoney</c> (full style): whole dollars rounded to the nearest dollar
        /// (halves up), or dollars and cents. Negatives read <c>−$1,250</c>; an amount that rounds
        /// to zero reads <c>$0</c>, never <c>−$0</c>.
        /// </summary>
        public static string FormatMoney(long amount, bool showCents = false)
        {
            bool isNegative = amount < 0;
            long absoluteCents = Math.Abs(amount);
            long centsPart = absoluteCents % CentsPerDollar;
            long dollars = (absoluteCents - centsPart) / CentsPerDollar;
            string body;
            bool isZero;
            if (showCents)
            {
                body = Group(dollars.ToString(CultureInfo.InvariantCulture)) + "." + centsPart.ToString("00", CultureInfo.InvariantCulture);
                isZero = absoluteCents == 0;
            }
            else
            {
                long rounded = centsPart * 2 >= CentsPerDollar ? dollars + 1 : dollars;
                body = Group(rounded.ToString(CultureInfo.InvariantCulture));
                isZero = rounded == 0;
            }
            string sign = isNegative && !isZero ? MinusSign : string.Empty;
            return sign + "$" + body;
        }

        /// <summary>
        /// The web's <c>formatNumber</c>: en-US grouping (<c>12,345.67</c>), at most
        /// <paramref name="maximumFractionDigits"/> decimals with trailing zeros dropped, halves
        /// rounded away from zero, and a true minus sign for negatives (including a negative that
        /// rounds to <c>−0</c>, as <c>Intl.NumberFormat</c> does). Like Intl, it rounds the
        /// shortest decimal that reads back as the same double (<c>1.005</c> → <c>1.01</c>).
        /// </summary>
        public static string FormatNumber(double value, int maximumFractionDigits)
        {
            if (double.IsNaN(value)) return "NaN";
            if (double.IsInfinity(value)) return value > 0 ? "∞" : MinusSign + "∞";
            bool negative = value < 0 || (value == 0 && double.IsNegative(value));
            ShortestDigits(Math.Abs(value), out string digits, out int point);

            // Round to the wanted decimals on the decimal digits, halves away from zero.
            int keep = point + maximumFractionDigits;
            if (keep < digits.Length)
            {
                bool roundUp = keep >= 0 && digits[keep] >= '5';
                char[] kept = digits.Substring(0, Math.Max(keep, 0)).ToCharArray();
                if (roundUp)
                {
                    int index = kept.Length - 1;
                    while (index >= 0 && kept[index] == '9')
                    {
                        kept[index] = '0';
                        index--;
                    }
                    if (index >= 0)
                    {
                        kept[index]++;
                        digits = new string(kept);
                    }
                    else
                    {
                        digits = "1" + new string(kept);
                        point++;
                    }
                }
                else
                {
                    digits = new string(kept);
                }
            }

            string integerPart;
            string fractionPart;
            if (point <= 0)
            {
                integerPart = "0";
                fractionPart = new string('0', -point) + digits;
            }
            else if (point >= digits.Length)
            {
                integerPart = digits + new string('0', point - digits.Length);
                fractionPart = string.Empty;
            }
            else
            {
                integerPart = digits.Substring(0, point);
                fractionPart = digits.Substring(point);
            }
            integerPart = integerPart.TrimStart('0');
            if (integerPart.Length == 0) integerPart = "0";
            fractionPart = fractionPart.TrimEnd('0');

            var builder = new StringBuilder();
            if (negative) builder.Append(MinusSign);
            builder.Append(Group(integerPart));
            if (fractionPart.Length > 0) builder.Append('.').Append(fractionPart);
            return builder.ToString();
        }

        /// <summary>
        /// The shortest decimal digits that read back as <paramref name="value"/> (non-negative),
        /// without leading zeros, and where the decimal point goes: value = 0.digits × 10^point.
        /// Zero is <c>("", 0)</c>.
        /// </summary>
        private static void ShortestDigits(double value, out string digits, out int point)
        {
            string text = null;
            for (int precision = 15; precision <= 17; precision++)
            {
                text = value.ToString("E" + (precision - 1), CultureInfo.InvariantCulture);
                if (precision == 17 || double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture) == value) break;
            }
            // text is d.ddddE+xxx
            int exponentAt = text.IndexOf('E');
            string mantissa = text.Substring(0, exponentAt);
            int exponent = int.Parse(text.Substring(exponentAt + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
            string all = mantissa.Replace(".", string.Empty).TrimEnd('0');
            if (all.Length == 0)
            {
                digits = string.Empty;
                point = 0;
                return;
            }
            digits = all;
            point = exponent + 1;
        }

        /// <summary>Groups an integer's digits in threes with commas.</summary>
        private static string Group(string integerDigits)
        {
            if (integerDigits.Length <= 3) return integerDigits;
            var builder = new StringBuilder();
            int first = integerDigits.Length % 3;
            if (first > 0) builder.Append(integerDigits, 0, first);
            for (int index = first; index < integerDigits.Length; index += 3)
            {
                if (builder.Length > 0) builder.Append(',');
                builder.Append(integerDigits, index, 3);
            }
            return builder.ToString();
        }
    }
}
