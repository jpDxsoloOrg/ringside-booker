using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.Screens.News
{
    /// <summary>The feed's filters (the web's <c>NewsFilters</c>): kinds (empty = every kind), mine, period, front page.</summary>
    public sealed class NewsFilters : IEquatable<NewsFilters>
    {
        public static readonly NewsFilters None = new NewsFilters(Array.Empty<string>(), false, NewsModel.PeriodAll, false);

        public NewsFilters(IEnumerable<string> kinds, bool mine, string period, bool frontPageOnly)
        {
            var wanted = new HashSet<string>(kinds ?? Array.Empty<string>());
            Kinds = NewsModel.Kinds.Select(kind => kind.id).Where(wanted.Contains).ToList();
            Mine = mine;
            Period = NewsModel.Periods.Any(entry => entry.id == period) ? period : NewsModel.PeriodAll;
            FrontPageOnly = frontPageOnly;
        }

        /// <summary>The kinds shown, in the engine's order; empty for every kind.</summary>
        public IReadOnlyList<string> Kinds { get; }
        public bool Mine { get; }
        /// <summary><c>7</c>, <c>30</c>, <c>90</c> or <c>all</c>.</summary>
        public string Period { get; }
        public bool FrontPageOnly { get; }

        /// <summary>How many filters are away from their default.</summary>
        public int ActiveCount => (Kinds.Count > 0 ? 1 : 0) + (Mine ? 1 : 0) + (Period == NewsModel.PeriodAll ? 0 : 1) + (FrontPageOnly ? 1 : 0);

        public NewsFilters WithKinds(IEnumerable<string> kinds) => new NewsFilters(kinds, Mine, Period, FrontPageOnly);
        public NewsFilters WithMine(bool mine) => new NewsFilters(Kinds, mine, Period, FrontPageOnly);
        public NewsFilters WithPeriod(string period) => new NewsFilters(Kinds, Mine, period, FrontPageOnly);
        public NewsFilters WithFrontPageOnly(bool front) => new NewsFilters(Kinds, Mine, Period, front);

        public NewsFilters Toggle(string kind) =>
            WithKinds(Kinds.Contains(kind) ? Kinds.Where(other => other != kind) : Kinds.Concat(new[] { kind }));

        /// <summary>The filters a route holds (<c>kind=a,b</c>, <c>mine=1</c>, <c>period=7|30|90</c>, <c>front=1</c>), as the web's URL.</summary>
        public static NewsFilters FromRoute(ShellRoute route)
        {
            if (route == null) return None;
            string kinds = route.Param("kind") ?? string.Empty;
            return new NewsFilters(kinds.Split(',').Select(part => part.Trim()), route.Param("mine") == "1",
                route.Param("period") ?? NewsModel.PeriodAll, route.Param("front") == "1");
        }

        public bool Equals(NewsFilters other) =>
            other != null && Kinds.SequenceEqual(other.Kinds) && Mine == other.Mine && Period == other.Period && FrontPageOnly == other.FrontPageOnly;

        public override bool Equals(object obj) => Equals(obj as NewsFilters);
        public override int GetHashCode() => (Period, Mine, FrontPageOnly, Kinds.Count).GetHashCode();
    }

    /// <summary>
    /// The News screen's plain logic (UNITY-19), ported from the web's <c>screens/news</c>: kinds and
    /// their tone, importance words, who a story is about, the <c>news.feed</c> arguments, counts and
    /// archive lines, and the alert settings change. No engine and no UI: EditMode tests cover it.
    /// </summary>
    public static class NewsModel
    {
        public const string PeriodAll = "all";

        /// <summary>The stories the feed asks for at a time, and the engine's most per call.</summary>
        public const int PageSize = 200;
        public const int MaxLimit = 500;

        /// <summary>Every kind of story in the engine's order, with its words on screen.</summary>
        public static readonly IReadOnlyList<(string id, string label)> Kinds = new[]
        {
            ("result", "Result"),
            ("titleChange", "Title change"),
            ("signing", "Signing"),
            ("release", "Release"),
            ("injury", "Injury"),
            ("retirement", "Retirement"),
            ("rumour", "Rumour"),
            ("business", "Business"),
            ("milestone", "Milestone"),
            ("backstage", "Backstage"),
            ("personal", "Personal"),
            ("season", "Season"),
            ("award", "Award"),
            ("rivalry", "Rivalry"),
        };

        public static readonly IReadOnlyList<(string id, string label)> Periods = new[]
        {
            ("7", "Last 7 days"),
            ("30", "Last 30 days"),
            ("90", "Last 90 days"),
            (PeriodAll, "Everything"),
        };

        public static string KindLabel(string kind) => Kinds.FirstOrDefault(entry => entry.id == kind).label ?? "News";

        /// <summary>The kind's colour, as the web's ticker tags: titles, awards and seasons gold; results, rivalries and injuries live red; the rest data blue.</summary>
        public static DsState KindState(string kind) => kind switch
        {
            "titleChange" => DsState.Gold,
            "season" => DsState.Gold,
            "award" => DsState.Gold,
            "result" => DsState.Live,
            "rivalry" => DsState.Live,
            "injury" => DsState.Live,
            _ => DsState.Info,
        };

        /// <summary>A glyph per kind for the kicker.</summary>
        public static string KindIcon(string kind) => kind switch
        {
            "result" => "versus",
            "titleChange" => "trophy",
            "signing" => "handshake",
            "release" => "user-minus",
            "injury" => "injured",
            "retirement" => "log-out",
            "rumour" => "megaphone",
            "business" => "chart",
            "milestone" => "medal",
            "backstage" => "promo",
            "personal" => "user",
            "season" => "calendar",
            "award" => "star",
            "rivalry" => "hot",
            _ => "newspaper",
        };

        /// <summary>Importance 0..3 in words.</summary>
        public static string ImportanceLabel(int importance) => importance switch
        {
            0 => "Filler",
            1 => "Minor",
            2 => "Major",
            3 => "Front page",
            _ => "—",
        };

        /// <summary>Buzz as the screens show it: a whole number.</summary>
        public static int ShownBuzz(double buzz) => (int)Math.Round(buzz, MidpointRounding.AwayFromZero);

        /// <summary>Buzz in a word, for the quiet line under a headline.</summary>
        public static string BuzzWord(double buzz) => buzz >= 70 ? "Huge buzz" : buzz >= 45 ? "Big buzz" : buzz >= 20 ? "Some buzz" : "Little buzz";

        /// <summary>
        /// Everyone and everything a story is about, from its refs: people, then promotions, then its
        /// show. Ids the names do not hold are left out.
        /// </summary>
        public static List<NewsName> EntitiesOf(JToken item, IReadOnlyDictionary<string, NewsName> names)
        {
            var ids = new List<string>();
            JToken refs = item?["refs"];
            foreach (JToken id in refs?["personIds"] as JArray ?? new JArray()) ids.Add((string)id);
            foreach (JToken id in refs?["promotionIds"] as JArray ?? new JArray()) ids.Add((string)id);
            if (refs?["eventInstanceId"] is JValue show && show.Type == JTokenType.String) ids.Add((string)show);
            var entities = new List<NewsName>();
            foreach (string id in ids.Distinct())
            {
                if (id != null && names != null && names.TryGetValue(id, out NewsName named) && named.Kind != null) entities.Add(named);
            }
            return entities;
        }

        /// <summary>The people a story leads with (for portraits), at most <paramref name="max"/>.</summary>
        public static List<NewsName> PeopleOf(JToken item, IReadOnlyDictionary<string, NewsName> names, int max = 2) =>
            EntitiesOf(item, names).Where(entity => entity.Kind == "person").Take(max).ToList();

        /// <summary>The first promotion a story names, or null.</summary>
        public static NewsName PromotionOf(JToken item, IReadOnlyDictionary<string, NewsName> names) =>
            EntitiesOf(item, names).FirstOrDefault(entity => entity.Kind == "promotion");

        /// <summary>The <c>news.feed</c> arguments for the filters on <paramref name="today"/>, asking for <paramref name="pages"/> pages.</summary>
        public static JObject FeedArgs(NewsFilters filters, GameDate today, int pages)
        {
            var args = new JObject();
            if (filters.Period != PeriodAll && int.TryParse(filters.Period, out int days)) args["from"] = today.AddDays(1 - days).Iso;
            if (filters.Kinds.Count > 0) args["kinds"] = new JArray(filters.Kinds.Cast<object>().ToArray());
            if (filters.Mine) args["mine"] = true;
            if (filters.FrontPageOnly) args["frontPageOnly"] = true;
            args["limit"] = Math.Min(PageSize * Math.Max(1, pages), MaxLimit);
            return args;
        }

        /// <summary>"2 stories" or "Showing 200 of 340 stories".</summary>
        public static string CountText(int shown, int total)
        {
            string noun = total == 1 ? "story" : "stories";
            return shown >= total
                ? $"{TextFormat.Number(total)} {noun}"
                : $"Showing {TextFormat.Number(shown)} of {TextFormat.Number(total)} {noun}";
        }

        /// <summary>"Leaves the archive on …", or "Kept in the archive" for a story that never expires.</summary>
        public static string ArchiveText(JToken item)
        {
            string expires = (string)item?["expiresOn"];
            return expires == null || !GameDate.TryParse(expires, out GameDate date)
                ? "Kept in the archive"
                : $"Leaves the archive on {date.Long}";
        }

        /// <summary>"Today", "Yesterday", "3 days ago", else the short date: the kicker's when.</summary>
        public static string When(string iso, GameDate today)
        {
            if (!GameDate.TryParse(iso, out GameDate date)) return iso;
            int ago = date.DaysUntil(today);
            if (ago <= 0) return "Today";
            if (ago == 1) return "Yesterday";
            if (ago < 7) return $"{ago} days ago";
            return date.Short;
        }

        /// <summary>
        /// The lead story and the top stories under it: the first front-page (hero) story leads, else
        /// the best of the window; the rest of the heroes, then the window's best, fill the top stories
        /// (each story once, at most <paramref name="topCount"/>).
        /// </summary>
        public static (JToken lead, List<JToken> top) FrontPage(JToken newsTop, int topCount = 4)
        {
            var hero = (newsTop?["hero"] as JArray ?? new JArray()).ToList();
            var ticker = (newsTop?["ticker"] as JArray ?? new JArray()).ToList();
            var ordered = hero.Concat(ticker).GroupBy(story => (string)story["id"]).Select(group => group.First()).ToList();
            if (ordered.Count == 0) return (null, new List<JToken>());
            return (ordered[0], ordered.Skip(1).Take(topCount).ToList());
        }

        /// <summary>The alert switches the player moved against the saved settings, or null when none differ (the web's <c>alertSettingsChange</c>).</summary>
        public static JObject AlertChange(JToken saved, IReadOnlyDictionary<string, bool> draftRules, bool? draftStopSkip)
        {
            var rules = new JObject();
            foreach (JToken rule in saved?["rules"] as JArray ?? new JArray())
            {
                string id = (string)rule["id"];
                bool enabled = rule["enabled"]?.Type == JTokenType.Boolean && (bool)rule["enabled"];
                if (id != null && draftRules != null && draftRules.TryGetValue(id, out bool wanted) && wanted != enabled) rules[id] = wanted;
            }
            bool savedStop = saved?["stopSkip"]?.Type != JTokenType.Boolean || (bool)saved["stopSkip"];
            bool? stopSkip = draftStopSkip.HasValue && draftStopSkip.Value != savedStop ? draftStopSkip : null;
            if (!rules.HasValues && stopSkip == null) return null;
            var change = new JObject { ["rules"] = rules };
            if (stopSkip != null) change["stopSkip"] = stopSkip.Value;
            return change;
        }
    }
}
