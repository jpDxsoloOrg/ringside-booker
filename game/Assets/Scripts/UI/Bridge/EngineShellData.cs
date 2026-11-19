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
        }

        public ShellSnapshot Snapshot { get; private set; }

        /// <summary>The ticker's lines from <c>news.top</c> (hero and ticker stories), refreshed with the snapshot.</summary>
        public IReadOnlyList<string> Headlines { get; private set; } = Array.Empty<string>();

        public event Action Changed;

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
                    QueryResult<SimStatus> status = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
                    if (!attached) return;
                    string promotionId = status.Data?.Promotion?.PromotionId;
                    if (promotionId != null && promotionId != logoFor)
                    {
                        logoRef = await ReadLogoRef(promotionId);
                        logoFor = promotionId;
                        if (!attached) return;
                    }
                    Headlines = await ReadHeadlines();
                    if (!attached) return;
                    if (status.Ok && status.Data != null)
                    {
                        Status = status.Data;
                        Snapshot = Build(status.Data, logoRef);
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
        }

        /// <summary>
        /// The ticker's lines: each top story as "Kind: the names it involves" (the web's message
        /// catalogue is not in Unity yet, as on the Office page). Empty on any failure.
        /// </summary>
        private async System.Threading.Tasks.Task<IReadOnlyList<string>> ReadHeadlines()
        {
            try
            {
                QueryResult<JToken> news = await game.Client.Query("news.top");
                if (!news.Ok || !(news.Data is JObject data)) return Array.Empty<string>();
                JToken names = data["names"];
                IEnumerable<JToken> stories = (data["hero"] as JArray ?? new JArray()).Concat(data["ticker"] as JArray ?? new JArray());
                return stories
                    .GroupBy(story => (string)story["id"])
                    .Select(group => Headline(group.First(), names))
                    .Where(line => line != null)
                    .Take(TickerSize)
                    .ToList();
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineShellData] news.top: {exception.GetType().Name}");
                return Array.Empty<string>();
            }
        }

        private static string Headline(JToken story, JToken names)
        {
            var parts = new List<string>();
            void Add(string id)
            {
                string name = id == null ? null : (string)names?[id.Trim()]?["name"];
                if (!string.IsNullOrEmpty(name) && !parts.Contains(name)) parts.Add(name);
            }
            if (story["headline"]?["params"] is JObject parameters)
            {
                foreach (JProperty parameter in parameters.Properties())
                {
                    foreach (string id in parameter.Value.ToString().Split(',')) Add(id);
                }
            }
            if (story["refs"]?["personIds"] is JArray people)
            {
                foreach (JToken id in people) Add((string)id);
            }
            Add((string)story["refs"]?["eventInstanceId"]);
            string kind = (string)story["kindLabel"] ?? "News";
            return parts.Count == 0 ? kind : $"{kind}: {string.Join(" · ", parts.Take(3))}";
        }

        /// <summary>The promotion's logo ref (from <c>promotions.list</c>; a logo never changes in a game), or null.</summary>
        private async System.Threading.Tasks.Task<string> ReadLogoRef(string promotionId)
        {
            try
            {
                QueryResult<JToken> list = await game.Client.Query("promotions.list");
                if (!list.Ok || !(list.Data is JArray rows)) return null;
                foreach (JToken row in rows)
                {
                    if ((string)row["promotionId"] == promotionId) return row["logoRef"]?.Type == JTokenType.String ? (string)row["logoRef"] : null;
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineShellData] promotions.list: {exception.GetType().Name}");
            }
            return null;
        }

        private static ShellSnapshot Build(SimStatus status, string logoRef)
        {
            GameDate.TryParse(status.Date, out GameDate date);
            string season = status.Season == null ? null : $"Season {status.Season.Number}";
            PromotionStatus promotion = status.Promotion;
            if (promotion == null) return new ShellSnapshot(date, null, 0, season);

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
                null,
                cashRef);
        }
    }
}
