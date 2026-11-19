using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.Screens.Office
{
    /// <summary>One line of "Needs you today": what it is, in words, and the one action that deals with it.</summary>
    public sealed class NeedItem
    {
        public string Id;
        public DsState State;
        public string Icon;
        public string Title;
        public string Detail;
        public string Action;
        public bool Primary;
        public ShellRoute Route;
        /// <summary>The stop it stands for, when it is one (a stop with no screen opens Needs attention).</summary>
        public GateHit Gate;
        public int Rank;
    }

    /// <summary>One wrestler in the power rankings.</summary>
    public sealed class RankedWorker
    {
        public string PersonId;
        public string Name;
        public string ImageRef;
        public string Alignment;
        public string Gender;
        public string Push;
        public double Popularity;
        public double Momentum;
        public double Score;
        public string Champion;
        public DsState Trend;
    }

    /// <summary>
    /// The Office homepage's decisions, kept apart from drawing so they can be tested: what needs the
    /// player today (stops, tonight's show, contracts, people who want out, offers) and the power
    /// rankings. There is no rankings query in the engine, so the rankings are built from the roster's
    /// popularity and momentum (<c>roster.rows</c>).
    /// </summary>
    public static class OfficeLogic
    {
        /// <summary>Popularity's share of a ranking score; momentum makes up the rest.</summary>
        public const double PopularityWeight = 0.6;

        public static string Days(double days) => days <= 0 ? "today" : days == 1 ? "tomorrow" : $"in {days} days";

        /// <summary>The roster's wrestlers ranked by popularity and momentum, champions named.</summary>
        public static List<RankedWorker> PowerRankings(JToken rosterRows, JToken titles, string filter = "all", int take = 8)
        {
            var champions = new Dictionary<string, string>();
            foreach (JToken title in Kit.Arr(titles, "groups").SelectMany(group => Kit.Arr(group, "titles")))
            {
                foreach (JToken holder in Kit.Arr(title, "champion.holders"))
                {
                    string id = Kit.Str(holder, "personId");
                    if (id != null && !champions.ContainsKey(id)) champions[id] = Kit.Str(title, "name");
                }
            }
            return Kit.Arr(rosterRows, "rows")
                .Where(row => Kit.Str(row, "group") == "wrestlers")
                .Where(row => filter == "all" || Kit.Str(row, "gender") == filter)
                .Select(row =>
                {
                    double popularity = Kit.Num(row, "popularity") ?? 0;
                    double momentum = Kit.Num(row, "momentum.value") ?? 50;
                    string id = Kit.Str(row, "personId");
                    return new RankedWorker
                    {
                        PersonId = id,
                        Name = Kit.Str(row, "ringName"),
                        ImageRef = Kit.Str(row, "imageRef"),
                        Alignment = Kit.Str(row, "alignment"),
                        Gender = Kit.Str(row, "gender"),
                        Push = Kit.Str(row, "push"),
                        Popularity = popularity,
                        Momentum = momentum,
                        Score = popularity * PopularityWeight + momentum * (1 - PopularityWeight),
                        Champion = id != null && champions.TryGetValue(id, out string title) ? title : null,
                        Trend = momentum >= 60 ? DsState.Good : momentum <= 40 ? DsState.Bad : DsState.Neutral,
                    };
                })
                .OrderByDescending(worker => worker.Score)
                .ThenBy(worker => worker.Name, StringComparer.Ordinal)
                .Take(take)
                .ToList();
        }

        /// <summary>
        /// Everything that needs the player today, most urgent first. Tonight's show, expiring contracts,
        /// people who want to leave and offers waiting come from their queries; any other stop the day
        /// is held at comes from the pending gates with the day control's own destination.
        /// </summary>
        public static List<NeedItem> NeedsToday(IReadOnlyList<GateHit> gates, JToken nextShow, JToken counts, JToken expiring, JToken active, JToken offers)
        {
            var items = new List<NeedItem>();
            gates ??= Array.Empty<GateHit>();

            JToken show = Kit.Obj(nextShow, "show");
            if (show != null && show.Type == JTokenType.Object && (Kit.Num(nextShow, "daysUntil") ?? 1) <= 0)
            {
                string id = Kit.Str(show, "eventInstanceId");
                int booked = (int)(Kit.Num(show, "segmentCount") ?? 0);
                int slots = (int)(Kit.Num(show, "format.slots") ?? 0) + (int)(Kit.Num(show, "format.preShowSlots") ?? 0);
                bool full = slots > 0 && booked >= slots;
                items.Add(new NeedItem
                {
                    Id = "tonight",
                    State = DsState.Live,
                    Icon = "live",
                    Title = $"{Kit.Str(show, "name")} is tonight",
                    Detail = full ? "The card is set. Time to go live." : booked == 0 ? $"Nothing booked yet: {slots} slots to fill" : $"{slots - booked} of {slots} slots still open",
                    Action = full ? "Go to the show" : "Book it",
                    Primary = true,
                    Route = full ? ShellRoute.With(ScreenIds.ShowNight, "event", id) : ShellRoute.With("booking", "event", id),
                    Gate = gates.FirstOrDefault(gate => gate.GateId == "shows.tonight"),
                    Rank = 0,
                });
            }

            List<JToken> expiringRows = Kit.Arr(expiring).OrderBy(row => Kit.Num(row, "daysLeft") ?? 9999).ToList();
            if (expiringRows.Count > 0)
            {
                JToken first = expiringRows[0];
                int more = expiringRows.Count - 1;
                double daysLeft = Kit.Num(first, "daysLeft") ?? 0;
                items.Add(new NeedItem
                {
                    Id = "contracts-expiring",
                    State = daysLeft <= 14 ? DsState.Bad : DsState.Warn,
                    Icon = "contracts",
                    Title = $"{Kit.Str(first, "ringName")}'s contract ends {Days(daysLeft)}",
                    Detail = more > 0 ? $"And {more} more ending soon. Talk before they hit the open market." : "Talk before they hit the open market.",
                    Action = "Talk",
                    Route = ShellRoute.With("contracts", "tab", "expiring"),
                    Gate = gates.FirstOrDefault(gate => gate.GateId == "contracts.expiringSoon"),
                    Rank = 2,
                });
            }

            int wantsToLeave = (int)(Kit.Num(counts, "wantsToLeave") ?? 0);
            List<JToken> leaving = Kit.Arr(active).Where(row => Kit.Obj(row, "request") is JToken request && request.Type == JTokenType.Object).ToList();
            if (wantsToLeave > 0 || leaving.Count > 0)
            {
                int count = Math.Max(wantsToLeave, leaving.Count);
                string name = leaving.Count > 0 ? Kit.Str(leaving[0], "ringName") : null;
                items.Add(new NeedItem
                {
                    Id = "wants-to-leave",
                    State = DsState.Bad,
                    Icon = "morale",
                    Title = count == 1 && name != null ? $"{name} wants to leave" : $"{count} people want to leave",
                    Detail = "They asked for their release. Keep them happy or let them go.",
                    Action = "See why",
                    Route = leaving.Count > 0
                        ? ShellRoute.With("contracts", "tab", "active", "wantsToLeave", "1", "employment", Kit.Str(leaving[0], "employmentId"))
                        : ShellRoute.With("contracts", "tab", "active", "wantsToLeave", "1"),
                    Gate = gates.FirstOrDefault(gate => gate.GateId == GateHints.ReleaseRequestedGateId),
                    Rank = 1,
                });
            }

            List<JToken> waiting = Kit.Arr(offers).Where(row => Kit.Bool(row, "answerUnseen") || Kit.Str(row, "status") == "countered").ToList();
            if (waiting.Count > 0)
            {
                int counters = waiting.Count(row => Kit.Str(row, "status") == "countered");
                items.Add(new NeedItem
                {
                    Id = "offers",
                    State = DsState.Info,
                    Icon = "inbox",
                    Title = waiting.Count == 1 ? "1 offer waiting" : $"{waiting.Count} offers waiting",
                    Detail = $"{ScreenDs.JoinNames(waiting.Take(3).Select(row => Kit.Str(row, "ringName")))}{(counters > 0 ? $" · {counters} counter-offer{(counters == 1 ? string.Empty : "s")} to answer" : " answered")}.",
                    Action = "Open",
                    Route = waiting.Count == 1
                        ? ShellRoute.With("contracts", "tab", "offers", "negotiation", Kit.Str(waiting[0], "negotiationId"))
                        : ShellRoute.With("contracts", "tab", "offers"),
                    Gate = gates.FirstOrDefault(gate => gate.GateId == "contracts.offerAnswered" || gate.GateId == GateHints.CounterWaitingGateId),
                    Rank = 3,
                });
            }

            // Any other stop: the day control's own words and destination.
            var covered = new HashSet<GateHit>(items.Where(item => item.Gate != null).Select(item => item.Gate));
            foreach (GateHit gate in gates)
            {
                if (covered.Contains(gate) || IsCoveredKind(gate, items)) continue;
                (string label, ShellRoute to)? destination = DayControlLogic.GateDestination(gate, gates);
                (DsState state, string icon, string action) look = gate.ActionHint switch
                {
                    GateHints.Roster => (DsState.Bad, "injured", "See injuries"),
                    GateHints.News => (DsState.Info, "newspaper", "Read it"),
                    GateHints.Inbox => (DsState.Warn, "inbox", "Decide"),
                    GateHints.ShowNight => (DsState.Live, "live", "Go to the show"),
                    GateHints.Contracts => (DsState.Warn, "contracts", "Contracts"),
                    _ => (DsState.Warn, "warning", destination?.label ?? "Open"),
                };
                items.Add(new NeedItem
                {
                    Id = "gate-" + gate.GateId,
                    State = look.state,
                    Icon = look.icon,
                    Title = gate.Reason,
                    Detail = "The day waits for this.",
                    Action = look.action,
                    Route = destination?.to,
                    Gate = gate,
                    Rank = look.state == DsState.Live ? 0 : look.state == DsState.Bad ? 1 : 4,
                });
            }
            return items.OrderBy(item => item.Rank).ToList();
        }

        /// <summary>True when a stop of the same kind is already on the list (one line per kind).</summary>
        private static bool IsCoveredKind(GateHit gate, List<NeedItem> items)
        {
            switch (gate.GateId)
            {
                case "shows.tonight": return items.Any(item => item.Id == "tonight");
                case "contracts.expiringSoon": return items.Any(item => item.Id == "contracts-expiring");
                case GateHints.ReleaseRequestedGateId: return items.Any(item => item.Id == "wants-to-leave");
                case "contracts.offerAnswered":
                case GateHints.CounterWaitingGateId: return items.Any(item => item.Id == "offers");
                default: return false;
            }
        }

        /// <summary>
        /// A headline from the story's message key when it names nobody ("news.season-start.headline"
        /// → "Season start", with a number when it has one: "Season 1 starts" is the web's wording).
        /// </summary>
        public static string HeadlineFromKey(JToken story)
        {
            string key = Kit.Str(story, "headline.key") ?? string.Empty;
            string[] parts = key.Split('.');
            string topic = parts.Length >= 2 ? parts[parts.Length - 2].Replace('-', ' ') : Kit.Str(story, "kindLabel") ?? "News";
            string number = Kit.Obj(story, "headline.params")?.Children<JProperty>().Select(p => p.Value)
                .FirstOrDefault(value => value.Type == JTokenType.Integer)?.ToString();
            string text = Kit.Capital(topic);
            if (number == null) return text;
            return text.EndsWith(" start") ? $"{text.Substring(0, text.Length - 6)} {number} starts" : $"{text}: {number}";
        }

        /// <summary>The story in a line from the names it involves (the web's message catalogue is not in Unity).</summary>
        public static string StoryLine(JToken story, JToken names)
        {
            var parts = new List<string>();
            void Add(string id)
            {
                string name = id == null ? null : Kit.Str(names, $"['{id}'].name");
                if (name != null && !parts.Contains(name)) parts.Add(name);
            }
            foreach (JToken param in Kit.Obj(story, "headline.params")?.Children<JProperty>().Select(p => p.Value) ?? Enumerable.Empty<JToken>())
            {
                foreach (string id in param.ToString().Split(',')) Add(id.Trim());
            }
            foreach (JToken id in Kit.Arr(Kit.Obj(story, "refs"), "personIds")) Add((string)id);
            foreach (JToken id in Kit.Arr(Kit.Obj(story, "refs"), "promotionIds")) Add((string)id);
            Add(Kit.Str(story, "refs.eventInstanceId"));
            return parts.Count == 0 ? null : ScreenDs.JoinNames(parts.Take(3));
        }
    }
}
