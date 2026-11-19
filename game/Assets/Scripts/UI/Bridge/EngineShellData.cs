using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// <see cref="IShellData"/> over the engine: the top bar and sidebar read <c>sim.status</c>,
    /// refreshed after every command, new game or load, and at the end of every advance.
    /// </summary>
    public sealed class EngineShellData : IShellData, IShellNews
    {
        private const int TickerSize = 8;

        private readonly EngineGame game;
        private bool attached = true;
        private bool refreshing;
        private bool refreshAgain;
        private string logoFor;
        private string logoRef;

        internal EngineShellData(EngineGame game)
        {
            this.game = game;
            Snapshot = new ShellSnapshot(default, null, 0);
            game.Client.OnStateChanged += OnStateChanged;
            NewsSeen.Changed += Refresh;
        }

        public ShellSnapshot Snapshot { get; private set; }

        /// <summary>The ticker's lines from <c>news.top</c> (hero and ticker stories), refreshed with the snapshot.</summary>
        public IReadOnlyList<string> Headlines { get; private set; } = Array.Empty<string>();

        public event Action Changed;

        /// <summary>True while a refresh is reading the engine (dev tools wait for it).</summary>
        public bool Refreshing => refreshing;

        /// <summary>The last <c>sim.status</c>, raw, or null before the first answer.</summary>
        public SimStatus Status { get; private set; }

        private void OnStateChanged(long revision) => Refresh();

        /// <summary>Reads <c>sim.status</c> again and raises <see cref="Changed"/>.</summary>
        public async void Refresh()
        {
            if (!attached) return;
            if (refreshing)
            {
                refreshAgain = true;
                return;
            }
            refreshing = true;
            try
            {
                do
                {
                    refreshAgain = false;
                    EnginePerf.Count("ui.shellData.refresh");
                    // One trip: sim.status and news.top (the ticker), plus promotions.list the first time a promotion shows up
                    // (a promotion's logo never changes in a game).
                    string knownLogoFor = logoFor;
                    (string date, int count)? seen = NewsSeen.Marker;
                    JObject unreadArgs = NewsSeen.CountArgs(seen);
                    // The sidebar badges come in the same trip (UNITY-19): stops waiting, workers who
                    // want to leave (with a promotion) and the news since the player last looked.
                    (QueryResult<SimStatus> status, QueryResult<JToken> list, QueryResult<JToken> news, BadgeReads badgeReads) = await game.Client.Read("shell.status", reader =>
                    {
                        QueryResult<SimStatus> read = reader.Query<SimStatus>(EngineQueries.SimStatus);
                        string id = read.Data?.Promotion?.PromotionId;
                        var badges = new BadgeReads
                        {
                            Gates = reader.Query<PendingGates>(EngineQueries.PendingGates),
                            Contracts = id != null ? reader.Query("contracts.counts") : null,
                            Unread = reader.Query("news.feed", unreadArgs),
                        };
                        return (read, id != null && id != knownLogoFor ? reader.Query("promotions.list") : null, reader.Query("news.top"), badges);
                    });
                    if (!attached) return;
                    string promotionId = status.Data?.Promotion?.PromotionId;
                    if (list != null && promotionId != null)
                    {
                        logoRef = LogoRefIn(list, promotionId);
                        logoFor = promotionId;
                    }
                    Headlines = HeadlinesFrom(news);
                    if (status.Ok && status.Data != null)
                    {
                        Status = status.Data;
                        Snapshot = Build(status.Data, logoRef, BadgesFrom(badgeReads, seen));
                        Changed?.Invoke();
                    }
                }
                while (refreshAgain && attached);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineShellData] sim.status: {exception.Message}");
            }
            finally
            {
                refreshing = false;
            }
        }

        internal void Detach()
        {
            attached = false;
            game.Client.OnStateChanged -= OnStateChanged;
            NewsSeen.Changed -= Refresh;
        }

        /// <summary>The ticker's lines: each top story's headline in words (UNITY-19's port of the web's news wire). Empty on any failure.</summary>
        private static IReadOnlyList<string> HeadlinesFrom(QueryResult<JToken> news)
        {
            try
            {
                if (!news.Ok || !(news.Data is JObject data)) return Array.Empty<string>();
                Dictionary<string, Screens.News.NewsName> names = Screens.News.NewsText.NamesFrom(data["names"]);
                IEnumerable<JToken> stories = (data["hero"] as JArray ?? new JArray()).Concat(data["ticker"] as JArray ?? new JArray());
                return stories
                    .GroupBy(story => (string)story["id"])
                    .Select(group => Screens.News.NewsText.Render(group.First()["headline"], names))
                    .Where(line => line != Screens.News.NewsText.MissingText)
                    .Take(TickerSize)
                    .ToList();
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineShellData] news.top: {exception.GetType().Name}");
                return Array.Empty<string>();
            }
        }

        /// <summary>The badge queries read in the shell's trip.</summary>
        private sealed class BadgeReads
        {
            public QueryResult<PendingGates> Gates;
            public QueryResult<JToken> Contracts;
            public QueryResult<JToken> Unread;
        }

        /// <summary>
        /// The sidebar's counts (UNITY-19): Dashboard = stops waiting on the player other than news
        /// alerts (News has its own badge); Contracts = workers who want to leave
        /// (<c>contracts.counts</c>); News = stories since the player last had News open
        /// (<see cref="NewsSeen"/>). Inbox stays 0 until the inbox lands (SOC1).
        /// </summary>
        private static IReadOnlyDictionary<NavBadgeKey, int> BadgesFrom(BadgeReads reads, (string date, int count)? seen)
        {
            var badges = new Dictionary<NavBadgeKey, int>();
            try
            {
                if (reads?.Gates != null && reads.Gates.Ok && reads.Gates.Data != null)
                {
                    badges[NavBadgeKey.PendingDecisions] = reads.Gates.Data.Hits.Count(hit => hit.ActionHint != Day.GateHints.News);
                }
                if (reads?.Contracts != null && reads.Contracts.Ok && reads.Contracts.Data?["wantsToLeave"] is JValue leaving &&
                    (leaving.Type == JTokenType.Integer || leaving.Type == JTokenType.Float))
                {
                    badges[NavBadgeKey.WantsToLeave] = (int)leaving;
                }
                if (reads?.Unread != null && reads.Unread.Ok && reads.Unread.Data?["total"] is JValue total &&
                    (total.Type == JTokenType.Integer || total.Type == JTokenType.Float))
                {
                    badges[NavBadgeKey.UnreadNews] = NewsSeen.Unread((int)total, seen);
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineShellData] badges: {exception.GetType().Name}");
            }
            return badges;
        }

        /// <summary>The promotion's logo ref in a <c>promotions.list</c> answer, or null.</summary>
        private static string LogoRefIn(QueryResult<JToken> list, string promotionId)
        {
            if (!list.Ok || !(list.Data is JArray rows)) return null;
            foreach (JToken row in rows)
            {
                if ((string)row["promotionId"] == promotionId) return row["logoRef"]?.Type == JTokenType.String ? (string)row["logoRef"] : null;
            }
            return null;
        }

        private static ShellSnapshot Build(SimStatus status, string logoRef, IReadOnlyDictionary<NavBadgeKey, int> badges)
        {
            GameDate.TryParse(status.Date, out GameDate date);
            string season = status.Season == null ? null : $"Season {status.Season.Number}";
            PromotionStatus promotion = status.Promotion;
            if (promotion == null) return new ShellSnapshot(date, null, 0, season, badges: badges);

            JToken popularity = promotion.Popularity;
            double? headline = (double?)popularity?["headline"];
            double? prestige = (double?)popularity?["prestige"];
            string cashRef = promotion.CashTraceRef is JObject cash ? $"{(string)cash["kind"]}:{(string)cash["id"]}" : null;
            var info = new PromotionInfo(promotion.PromotionId, promotion.Name, promotion.ShortName,
                status.Sandbox ? "Sandbox" : string.Empty, logoRef);
            return new ShellSnapshot(
                date,
                info,
                promotion.Cash,
                season,
                headline.HasValue ? (int?)Math.Round(headline.Value) : null,
                prestige.HasValue ? (int?)Math.Round(prestige.Value) : null,
                badges,
                cashRef);
        }
    }
}
