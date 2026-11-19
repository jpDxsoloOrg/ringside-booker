using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Why;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// The contract rules the screen reads (the web's <c>useContractRules</c>): <c>tunables.list
    /// { category: 'Contracts' }</c>, saved with the game, with the engine's defaults until the
    /// answer arrives.
    /// </summary>
    public sealed class ContractRules
    {
        public int ExpiringWindowDays { get; private set; } = 60;
        public int ExpiringSoonDays { get; private set; } = 30;
        public bool ExpiringStop { get; private set; } = true;
        public int QuitThreshold { get; private set; } = -40;
        /// <summary>The morale above which a refused worker settles down: threshold + recover margin.</summary>
        public int SettlesAbove { get; private set; } = -30;
        public int RenewalWindowDays { get; private set; } = 180;
        public int MaxLengthMonths { get; private set; } = 60;
        public bool CounterStop { get; private set; } = true;

        public static readonly ContractRules Defaults = new ContractRules();

        public static ContractRules From(JToken rows)
        {
            var rules = new ContractRules();
            if (!(rows is JArray list)) return rules;
            int Number(string key, int fallback)
            {
                JToken value = list.FirstOrDefault(row => (string)row["key"] == key)?["value"];
                return value != null && (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) ? (int)Math.Round(value.Value<double>()) : fallback;
            }
            bool Flag(string key, bool fallback)
            {
                JToken value = list.FirstOrDefault(row => (string)row["key"] == key)?["value"];
                return value != null && value.Type == JTokenType.Boolean ? value.Value<bool>() : fallback;
            }
            rules.ExpiringWindowDays = Number("contracts.expiring.windowDays", 60);
            rules.ExpiringSoonDays = Number("contracts.expiringSoon.days", 30);
            rules.ExpiringStop = Flag("contracts.expiringSoon.stopSkip", true);
            rules.QuitThreshold = Number("contracts.quit.threshold", -40);
            rules.SettlesAbove = rules.QuitThreshold + Number("contracts.walkout.recoverMargin", 10);
            rules.RenewalWindowDays = Number("contracts.renewal.windowDays", 180);
            rules.MaxLengthMonths = Number("contracts.offer.maxLengthMonths", 60);
            rules.CounterStop = Flag("contracts.counter.stopSkip", true);
            return rules;
        }

        public static async Task<ContractRules> LoadAsync(EngineClient client)
        {
            QueryResult<JToken> result = await client.Query("tunables.list", new JObject { ["category"] = "Contracts" });
            return result.Ok ? From(result.Data) : Defaults;
        }
    }

    /// <summary>Why? buttons over the traces the contract queries hand back inline.</summary>
    public static class ContractWhy
    {
        /// <summary>A Why? over an inline trace with a number value (money in cents, days, a chance).</summary>
        public static WhyButton Number(string label, JToken traced, string unit = null) =>
            traced == null ? null : Kit.WhyTrace(label, Kit.Num(traced, "value") ?? 0, Kit.Obj(traced, "trace"), unit, label);

        /// <summary>A Why? over an inline trace whose value is words ("24 months", "Mid card").</summary>
        public static WhyButton Words(string label, string words, JToken trace)
        {
            if (trace == null || trace.Type != JTokenType.Object) return null;
            try
            {
                TraceNode node = TraceReader.ParseNode(trace.ToString(Newtonsoft.Json.Formatting.None));
                return new WhyButton(label, TraceValue.Of(words), WhySource.FromTrace(node)) { PanelTitle = label };
            }
            catch (Exception exception)
            {
                UnityEngine.Debug.LogWarning($"[Contracts] trace for {label}: {exception.Message}");
                return null;
            }
        }

        /// <summary>A Why? over a stored trace (<c>{ kind, id }</c>).</summary>
        public static WhyButton Ref(string label, double value, JToken traceRef, string unit = null) =>
            traceRef == null || traceRef.Type == JTokenType.Null ? null : Kit.WhyRef(label, value, traceRef, unit, label);

        /// <summary>A Why? over a stored trace with a words value (a counter-offer, a reaction).</summary>
        public static WhyButton RefWords(string label, string words, JObject traceRef)
        {
            WhySource source = Kit.Game?.TraceRefSource(traceRef);
            return source == null ? null : new WhyButton(label, TraceValue.Of(words), source) { PanelTitle = label };
        }
    }
}
