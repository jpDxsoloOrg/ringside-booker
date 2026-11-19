using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// The engine commands that clear each stop the Unity game has no screen for yet (UNITY-10), the
    /// same ones the web's screens send. Contract stops (<c>contracts.expiringSoon</c>,
    /// <c>contracts.releaseRequested</c>, <c>contracts.counterWaiting</c>, <c>contracts.offerAnswered</c>)
    /// are no longer here: the Contracts screen (UNITY-17) clears them.
    /// <list type="bullet">
    /// <item><c>news.alert</c>: OK → <c>news.ackAlerts</c> (News).</item>
    /// <item><c>health.ownWorkerInjured</c>: Mark as seen → <c>health.acknowledgeInjuries</c> for every injury waiting (the roster's Injuries tab does the same when it opens).</item>
    /// </list>
    /// Show night (<c>shows.tonight</c>) has its screens (Booking, Show night) and no action here.
    /// </summary>
    public static class EngineGateActions
    {
        public const string ExpiringSoon = "contracts.expiringSoon";
        public const string ReleaseRequested = "contracts.releaseRequested";
        public const string CounterWaiting = "contracts.counterWaiting";
        public const string OfferAnswered = "contracts.offerAnswered";
        public const string NewsAlert = "news.alert";
        public const string OwnWorkerInjured = "health.ownWorkerInjured";
        public const string ShowsTonight = "shows.tonight";

        /// <summary>The actions for one stop, primary first; empty for a stop that needs its screen.</summary>
        public static IReadOnlyList<GateAction> For(EngineGame game, GateHit hit)
        {
            if (game == null || hit == null) return Array.Empty<GateAction>();
            EngineClient client = game.Client;
            switch (hit.GateId)
            {
                // Contract stops (expiring, release request, counter waiting, offer answered) are
                // cleared on the Contracts screen (UNITY-17), which the day button opens.
                case NewsAlert:
                    return new[]
                    {
                        new GateAction("OK", () => Run(client, EngineCommands.AckNewsAlerts, new JObject()),
                            "Marks the news alert as seen.", primary: true),
                    };
                case OwnWorkerInjured:
                    return new[]
                    {
                        new GateAction("Mark as seen", () => AcknowledgeInjuries(game),
                            "Marks the new injuries as seen (the roster's Injuries tab lists them).", primary: true),
                    };
                default:
                    return Array.Empty<GateAction>();
            }
        }

        private static async Task<string> Run(EngineClient client, string command, JObject args)
        {
            CommandResult<JToken> result = await client.Command(command, args);
            return result.Ok ? null : (string.IsNullOrEmpty(result.ReasonText) ? $"{command} was refused" : result.ReasonText);
        }

        /// <summary>Every injury waiting to be noticed (<c>health.report</c>), in batches of 50.</summary>
        private static async Task<string> AcknowledgeInjuries(EngineGame game)
        {
            QueryResult<JToken> report = await game.Client.Query("health.report", new JObject { ["promotionId"] = game.PromotionId });
            if (!report.Ok || report.Data == null) return report.ReasonText;
            var ids = new HashSet<string>();
            if (report.Data["waitingForViewer"] is JArray waiting)
            {
                foreach (JToken id in waiting) ids.Add((string)id);
            }
            if (report.Data["rows"] is JArray rows)
            {
                foreach (JToken row in rows)
                {
                    if (row["pendingNotice"] is JValue pending && pending.Type == JTokenType.Boolean && (bool)pending)
                    {
                        ids.Add((string)row["injuryId"]);
                    }
                }
            }
            List<string> all = ids.Where(id => id != null).ToList();
            if (all.Count == 0) return "No injury is waiting to be seen.";
            for (int start = 0; start < all.Count; start += 50)
            {
                string error = await Run(game.Client, "health.acknowledgeInjuries", new JObject { ["injuryIds"] = new JArray(all.Skip(start).Take(50)) });
                if (error != null) return error;
            }
            return null;
        }
    }
}
