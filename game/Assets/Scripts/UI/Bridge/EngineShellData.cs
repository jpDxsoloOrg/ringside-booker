using System;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// <see cref="IShellData"/> over the engine: the top bar and sidebar read <c>sim.status</c>,
    /// refreshed after every command, new game or load, and at the end of every advance.
    /// </summary>
    public sealed class EngineShellData : IShellData
    {
        private readonly EngineGame game;
        private bool attached = true;
        private bool refreshing;
        private bool refreshAgain;

        internal EngineShellData(EngineGame game)
        {
            this.game = game;
            Snapshot = new ShellSnapshot(default, null, 0);
            game.Client.OnStateChanged += OnStateChanged;
        }

        public ShellSnapshot Snapshot { get; private set; }

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
                    if (status.Ok && status.Data != null)
                    {
                        Status = status.Data;
                        Snapshot = Build(status.Data);
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

        private static ShellSnapshot Build(SimStatus status)
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
                status.Sandbox ? "Sandbox" : string.Empty);
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
