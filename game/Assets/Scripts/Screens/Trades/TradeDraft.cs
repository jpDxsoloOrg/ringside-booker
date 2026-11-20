using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Screens.Trades
{
    /// <summary>
    /// The offer being built on the trade sheet (TRD-02): who you give and get (up to five a side),
    /// cash one way, and an optional pay or length change per worker. It writes the engine's
    /// <c>TradeTermsArgs</c> (<c>trades.preview</c>, <c>trades.propose</c>) and the counter of
    /// <c>trades.respond</c>. Pure: no engine calls.
    /// </summary>
    public sealed class TradeDraft
    {
        public const int MaxPerSide = 5;

        private readonly List<string> give = new List<string>();
        private readonly List<string> get = new List<string>();
        private readonly Dictionary<string, (long? pay, int? months)> changes = new Dictionary<string, (long?, int?)>();

        public TradeDraft(string promotionId, string partnerId)
        {
            PromotionId = promotionId;
            PartnerId = partnerId;
        }

        /// <summary>Your promotion.</summary>
        public string PromotionId { get; }
        /// <summary>The rival on the other side (null until one is picked).</summary>
        public string PartnerId { get; private set; }
        /// <summary>The open trade this draft changes (a counter), or null for a new offer.</summary>
        public string TradeId { get; set; }

        public IReadOnlyList<string> Give => give;
        public IReadOnlyList<string> Get => get;
        /// <summary>Cash you send, in cents.</summary>
        public long GiveCash { get; private set; }
        /// <summary>Cash they send, in cents.</summary>
        public long GetCash { get; private set; }

        public bool IsEmpty => give.Count == 0 && get.Count == 0 && GiveCash == 0 && GetCash == 0;
        public bool HasWorkers => give.Count + get.Count > 0;

        /// <summary>A different rival: the workers belong to the old one's deal, so they go; your side stays.</summary>
        public void SetPartner(string partnerId)
        {
            if (partnerId == PartnerId) return;
            PartnerId = partnerId;
            foreach (string id in get) changes.Remove(id);
            get.Clear();
            GetCash = 0;
        }

        public bool Contains(string employmentId) => give.Contains(employmentId) || get.Contains(employmentId);

        /// <summary>Adds a worker to your side (<paramref name="yours"/>) or theirs; false when full or already in.</summary>
        public bool Add(string employmentId, bool yours)
        {
            if (string.IsNullOrEmpty(employmentId) || Contains(employmentId)) return false;
            List<string> side = yours ? give : get;
            if (side.Count >= MaxPerSide) return false;
            side.Add(employmentId);
            return true;
        }

        public bool IsFull(bool yours) => (yours ? give : get).Count >= MaxPerSide;

        public void Remove(string employmentId)
        {
            give.Remove(employmentId);
            get.Remove(employmentId);
            changes.Remove(employmentId);
        }

        /// <summary>Cash goes one way: setting one side clears the other.</summary>
        public void SetCash(bool yours, long cents)
        {
            long value = cents < 0 ? 0 : cents;
            if (yours)
            {
                GiveCash = value;
                if (value > 0) GetCash = 0;
            }
            else
            {
                GetCash = value;
                if (value > 0) GiveCash = 0;
            }
        }

        public long? PayChange(string employmentId) => changes.TryGetValue(employmentId, out (long? pay, int? months) change) ? change.pay : null;
        public int? LengthChange(string employmentId) => changes.TryGetValue(employmentId, out (long? pay, int? months) change) ? change.months : null;
        public bool HasChange(string employmentId) => PayChange(employmentId).HasValue || LengthChange(employmentId).HasValue;

        /// <summary>A new main pay in cents (null keeps theirs).</summary>
        public void SetPay(string employmentId, long? cents)
        {
            if (!Contains(employmentId)) return;
            Store(employmentId, cents.HasValue && cents.Value > 0 ? cents : null, LengthChange(employmentId));
        }

        /// <summary>A new length in months from today, 1 to 60 (null or 0 keeps theirs).</summary>
        public void SetLength(string employmentId, int? months)
        {
            if (!Contains(employmentId)) return;
            int? kept = months.HasValue && months.Value > 0 ? System.Math.Min(60, months.Value) : (int?)null;
            Store(employmentId, PayChange(employmentId), kept);
        }

        private void Store(string employmentId, long? pay, int? months)
        {
            if (!pay.HasValue && !months.HasValue) changes.Remove(employmentId);
            else changes[employmentId] = (pay, months);
        }

        private static JObject Side(IEnumerable<string> ids, long cash) =>
            new JObject { ["employmentIds"] = new JArray(ids.ToArray()), ["cash"] = cash };

        private JArray Adjustments()
        {
            var list = new JArray();
            foreach (string id in give.Concat(get))
            {
                if (!changes.TryGetValue(id, out (long? pay, int? months) change)) continue;
                list.Add(new JObject
                {
                    ["employmentId"] = id,
                    ["pay"] = change.pay.HasValue ? (JToken)change.pay.Value : JValue.CreateNull(),
                    ["lengthMonths"] = change.months.HasValue ? (JToken)change.months.Value : JValue.CreateNull(),
                });
            }
            return list;
        }

        /// <summary><c>trades.propose</c> / <c>trades.preview</c> arguments (a preview of a counter carries <c>tradeId</c>).</summary>
        public JObject ToArgs(bool forPreview = false)
        {
            var args = new JObject
            {
                ["promotionId"] = PromotionId,
                ["partnerId"] = PartnerId,
                ["give"] = Side(give, GiveCash),
                ["get"] = Side(get, GetCash),
            };
            JArray adjustments = Adjustments();
            if (adjustments.Count > 0) args["adjustments"] = adjustments;
            if (forPreview && TradeId != null) args["tradeId"] = TradeId;
            return args;
        }

        /// <summary><c>trades.respond</c> arguments for a counter to <see cref="TradeId"/>.</summary>
        public JObject ToCounter()
        {
            var args = new JObject
            {
                ["tradeId"] = TradeId,
                ["answer"] = "counter",
                ["give"] = Side(give, GiveCash),
                ["get"] = Side(get, GetCash),
            };
            JArray adjustments = Adjustments();
            if (adjustments.Count > 0) args["adjustments"] = adjustments;
            return args;
        }

        /// <summary>A stable key of the terms, so a preview answers only the draft it was asked for.</summary>
        public string Key => ToArgs(true).ToString(Newtonsoft.Json.Formatting.None);

        /// <summary>
        /// A draft from the offer on the table (<c>TradeOfferView</c>): your side (<c>isYou</c>) is
        /// what you give, the other side what you get, with each worker's contract change kept.
        /// </summary>
        public static TradeDraft FromOffer(JToken offer, string promotionId, string tradeId)
        {
            JToken mine = Kit.Arr(offer, "sides").FirstOrDefault(side => Kit.Bool(side, "isYou"));
            JToken theirs = Kit.Arr(offer, "sides").FirstOrDefault(side => !Kit.Bool(side, "isYou"));
            var draft = new TradeDraft(promotionId, Kit.Str(theirs, "promotionId")) { TradeId = tradeId };
            foreach ((JToken side, bool yours) in new[] { (mine, true), (theirs, false) })
            {
                foreach (JToken worker in Kit.Arr(side, "workers"))
                {
                    string id = Kit.Str(worker, "employmentId");
                    draft.Add(id, yours);
                    JToken change = Kit.Obj(worker, "adjustment");
                    if (change == null) continue;
                    if (Kit.Num(change, "pay") is double pay) draft.SetPay(id, (long)pay);
                    if (Kit.Num(change, "lengthMonths") is double months) draft.SetLength(id, (int)months);
                }
                draft.SetCash(yours, (long)(Kit.Num(side, "cash") ?? 0));
            }
            return draft;
        }
    }
}
