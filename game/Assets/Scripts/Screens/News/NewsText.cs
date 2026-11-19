using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Why;

namespace RingsideBooker.Screens.News
{
    /// <summary>One entity a story names: its id, kind (null when its row is gone) and name.</summary>
    public sealed class NewsName
    {
        public NewsName(string id, string kind, string name)
        {
            Id = id;
            Kind = kind;
            Name = name;
        }

        public string Id { get; }
        /// <summary><c>person</c>, <c>promotion</c>, <c>title</c>, <c>eventInstance</c>, <c>employment</c>, <c>season</c>; null for a gone row.</summary>
        public string Kind { get; }
        public string Name { get; }
    }

    /// <summary>
    /// The news wire's words in the Windows game (UNITY-19): a port of the web's
    /// <c>text/catalogs/news.en.ts</c> and the string half of <c>renderTemplatedText</c>. A story
    /// stores a content key and params (<c>{ key: "news.signing.headline", params: { promotionId, personId } }</c>);
    /// these lines write it with the names from the query's <c>names</c>. Formats: <c>{p:date}</c>
    /// (long game date), <c>{p:count}</c> ("1,200"), <c>{p:ordinal}</c> ("10th"), <c>{p:money}</c>
    /// (cents). A plain <c>{p}</c> whose value is an id, or ids joined by commas, reads as the names
    /// "A, B and C". A key with no words reads <see cref="MissingText"/>. Never a match length (D-10).
    /// </summary>
    public static class NewsText
    {
        public const string MissingText = "[missing text]";
        public const string NoLongerInRecords = "(no longer in the records)";

        private static readonly Regex Placeholder = new Regex(@"\{([A-Za-z0-9_]+)(?::([A-Za-z]+))?\}", RegexOptions.Compiled);
        private static readonly Regex IdPattern = new Regex("^[a-z]{3}_[0-9a-hjkmnp-tv-z]{10}$", RegexOptions.Compiled);

        /// <summary>The params of a templated text, read as strings or numbers.</summary>
        public sealed class Params
        {
            private readonly JObject values;

            public Params(JObject values)
            {
                this.values = values ?? new JObject();
            }

            /// <summary>The raw value, or null when the param is missing.</summary>
            public JToken this[string name] => values.TryGetValue(name, out JToken value) && value.Type != JTokenType.Null ? value : null;

            public bool Has(string name) => this[name] is JToken value && (value.Type != JTokenType.String || (string)value != string.Empty);

            /// <summary>How many people a comma-joined id param names (1 for anything else).</summary>
            public int CountOf(string name) =>
                this[name] is JToken value && value.Type == JTokenType.String
                    ? ((string)value).Split(',').Count(part => part != string.Empty)
                    : 1;

            public double? Number(string name)
            {
                JToken value = this[name];
                if (value == null) return null;
                if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) return (double)value;
                return double.TryParse((string)value, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed) ? parsed : (double?)null;
            }
        }

        private static string Verb(Params p, string name, string one, string many) => p.CountOf(name) > 1 ? many : one;

        private static string YearsText(Params p) => p.Number("years") == 1 ? "{years:count} year" : "{years:count} years";

        private static string ReignLength(Params p) => p["years"] != null ? YearsText(p) : "{days:count} days";

        /// <summary>Every key's English, as the web's catalog has it.</summary>
        public static readonly IReadOnlyDictionary<string, Func<Params, string>> Catalog = new Dictionary<string, Func<Params, string>>
        {
            ["news.season-start.headline"] = _ => "Season {seasonNumber} has begun",
            ["news.season-start.body"] = _ => "Season {seasonNumber} is under way in {worldName}. It opened on {startDate:date} and runs until {endDate:date}.",

            ["news.reign-milestone.headline"] = p => $"{{holderIds}} {Verb(p, "holderIds", "reaches", "reach")} {ReignLength(p)} holding the {{titleId}}",
            ["news.reign-milestone.body"] = p => $"As of {{onDate:date}}, {{holderIds}} {Verb(p, "holderIds", "has", "have")} held the {{titleId}} for {ReignLength(p)}. The longer a reign lasts, the more the belt means to whoever finally takes it.",

            ["news.reign-record.headline"] = p => $"{{holderIds}} now {Verb(p, "holderIds", "holds", "hold")} the longest {{titleId}} reign ever",
            ["news.reign-record.body"] = _ => "On {onDate:date}, {holderIds} passed {days:count} days with the {titleId}, going beyond the reign of {previousHolderIds} to set a new record for the title.",

            ["news.career-anniversary.headline"] = p => $"{{personId}} marks {YearsText(p)} in the ring",
            ["news.career-anniversary.body"] = p => $"{{personId}} reached {YearsText(p)} as a professional on {{onDate:date}}. Few careers in the business last that long.",

            ["news.promotion-anniversary.headline"] = _ => "{promotionId} turns {years:count}",
            ["news.promotion-anniversary.body"] = p => $"{{promotionId}} celebrated {YearsText(p)} in business on {{onDate:date}}, still running shows and still looking for its next big star.",

            ["news.show-result.headline"] = _ => "{eventInstanceId} scores {score:count} out of 100",
            ["news.show-result.body"] = p => p.Has("mainEventIds")
                ? "{promotionId} ran {eventInstanceId}, headlined by {mainEventIds}. The show scored {score:count} out of 100."
                : "{promotionId} ran {eventInstanceId}. The show scored {score:count} out of 100.",

            ["news.title-change.headline"] = p => p.Has("previousHolderIds")
                ? $"{{newHolderIds}} {Verb(p, "newHolderIds", "wins", "win")} the {{titleId}}"
                : $"{{newHolderIds}} {Verb(p, "newHolderIds", "is", "are")} crowned {{titleId}} champion",
            ["news.title-change.body"] = p => p.Has("previousHolderIds")
                ? "{newHolderIds} took the {titleId} from {previousHolderIds} at {eventInstanceId}. A new reign begins."
                : $"{{newHolderIds}} won the vacant {{titleId}} at {{eventInstanceId}} and {Verb(p, "newHolderIds", "becomes", "become")} the new champion.",

            ["news.show-cancelled.headline"] = _ => "{promotionId} calls off {eventInstanceId}",
            ["news.show-cancelled.body"] = _ => "{promotionId} will not run {eventInstanceId} after all. Fans holding tickets will have to wait for the next big show.",

            ["news.signing.headline"] = _ => "{promotionId} signs {personId}",
            ["news.signing.body"] = _ => "{personId} is now under contract with {promotionId}. Expect to see them on its shows soon.",
            ["news.release.headline"] = _ => "{promotionId} releases {personId}",
            ["news.release.body"] = _ => "{promotionId} has let {personId} go. They are free to talk to any promotion that wants them.",
            ["news.departure.headline"] = _ => "{personId} leaves {promotionId}",
            ["news.departure.body"] = _ => "{personId} is no longer with {promotionId}. Where they turn up next is anyone’s guess.",
            ["news.walked-out.headline"] = _ => "{personId} walks out on {promotionId}",
            ["news.walked-out.body"] = _ => "{personId} has walked out on {promotionId} and is now a free agent. It is not a parting on good terms.",

            ["news.release-refused.headline"] = _ => "{personId} was refused a release by {promotionId}",
            ["news.release-refused.body"] = _ => "Word is out that {personId} asked {promotionId} to be let go and the promotion said no.",

            ["news.deal-signed.headline"] = _ => "{promotionId} signs with {network}",
            ["news.deal-signed.body"] = _ => "{network} will carry {show} for {promotionId}. The terms were not made public.",
        };

        /// <summary>The query's <c>names</c> object as a lookup (id → kind and name).</summary>
        public static Dictionary<string, NewsName> NamesFrom(JToken names)
        {
            var lookup = new Dictionary<string, NewsName>();
            if (!(names is JObject obj)) return lookup;
            foreach (JProperty property in obj.Properties())
            {
                lookup[property.Name] = new NewsName(property.Name, (string)property.Value?["kind"], (string)property.Value?["name"] ?? NoLongerInRecords);
            }
            return lookup;
        }

        /// <summary>A templated text (<c>{ key, params }</c>) in English, names included.</summary>
        public static string Render(JToken text, IReadOnlyDictionary<string, NewsName> names)
        {
            string key = (string)text?["key"];
            if (key == null || !Catalog.TryGetValue(key, out Func<Params, string> template)) return MissingText;
            var parameters = new Params(text["params"] as JObject);
            return Fill(template(parameters), parameters, names);
        }

        /// <summary>Fills a template's placeholders; one with no param stays as written.</summary>
        public static string Fill(string template, Params parameters, IReadOnlyDictionary<string, NewsName> names)
        {
            return Placeholder.Replace(template, match =>
            {
                JToken value = parameters[match.Groups[1].Value];
                if (value == null) return match.Value;
                string raw = value.Type == JTokenType.String ? (string)value : value.ToString(Newtonsoft.Json.Formatting.None);
                if (match.Groups[2].Success) return Formatted(value, raw, match.Groups[2].Value);
                List<NewsName> entities = EntitiesOf(raw, names);
                return entities == null ? raw : JoinNames(entities.Select(entity => entity.Name).ToList());
            });
        }

        /// <summary>"A", "A and B", "A, B and C".</summary>
        public static string JoinNames(IReadOnlyList<string> parts)
        {
            var text = new StringBuilder();
            for (int index = 0; index < parts.Count; index++)
            {
                if (index > 0) text.Append(index == parts.Count - 1 ? " and " : ", ");
                text.Append(parts[index]);
            }
            return text.ToString();
        }

        /// <summary>"1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st".</summary>
        public static string Ordinal(long value)
        {
            long lastTwo = Math.Abs(value) % 100;
            long last = Math.Abs(value) % 10;
            string suffix = "th";
            if (lastTwo < 11 || lastTwo > 13)
            {
                if (last == 1) suffix = "st";
                else if (last == 2) suffix = "nd";
                else if (last == 3) suffix = "rd";
            }
            return TextFormat.Number(value) + suffix;
        }

        private static string Formatted(JToken value, string raw, string format)
        {
            if (format == "date") return GameDate.TryParse(raw, out GameDate date) ? date.Long : raw;
            double? number = value.Type == JTokenType.Integer || value.Type == JTokenType.Float
                ? (double)value
                : double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed) && raw.Trim() != string.Empty ? parsed : (double?)null;
            if (number == null) return raw;
            switch (format)
            {
                case "count":
                    return TextFormat.Number((long)Math.Round(number.Value, MidpointRounding.AwayFromZero));
                case "ordinal":
                    return Ordinal((long)Math.Truncate(number.Value));
                case "money":
                    return TraceFormat.FormatMoney((long)Math.Round(number.Value));
                default:
                    return raw;
            }
        }

        /// <summary>
        /// The entities a value names when every comma-separated part is an id (named, or an id whose
        /// row is gone), else null: the value is shown as written.
        /// </summary>
        private static List<NewsName> EntitiesOf(string value, IReadOnlyDictionary<string, NewsName> names)
        {
            string[] parts = value.Split(',').Select(part => part.Trim()).Where(part => part != string.Empty).ToArray();
            if (parts.Length == 0) return null;
            var entities = new List<NewsName>();
            foreach (string id in parts)
            {
                if (names != null && names.TryGetValue(id, out NewsName named)) entities.Add(named);
                else if (IdPattern.IsMatch(id)) entities.Add(new NewsName(id, null, NoLongerInRecords));
                else return null;
            }
            return entities;
        }
    }
}
