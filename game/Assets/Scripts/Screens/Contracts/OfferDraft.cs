using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// The offer the Negotiation sheet edits (the web's <c>useNegotiationDraft</c>), as the engine's
    /// <c>Offer</c> JSON: <c>{ terms, startsOn, lengthMonths, brand, role, push, extra }</c>. Seeded from
    /// their ask, the last counter or the offer on the table; each setter keeps the rest of the offer
    /// as it is. Nothing here works out a reaction: the engine's <c>contracts.offerPreview</c> does.
    /// </summary>
    public sealed class OfferDraft
    {
        public OfferDraft(JObject offer)
        {
            Offer = offer;
        }

        public JObject Offer { get; private set; }

        /// <summary>Command refusals tied to a field, by the field's path (<c>offer.lengthMonths</c>).</summary>
        public Dictionary<string, string> FieldErrors { get; } = new Dictionary<string, string>();

        public JObject Terms => (JObject)Offer["terms"];
        public string Kind => (string)Terms["kind"];
        public bool PerAppearance => Kind == "perAppearance";
        public bool Exclusive => Terms["exclusive"]?.Type == JTokenType.Boolean && (bool)Terms["exclusive"];
        public int LengthMonths => Offer["lengthMonths"]?.Value<int>() ?? 12;
        public string Push => (string)Offer["push"];
        public string Role => (string)Offer["role"];
        public string StartsOn => Offer["startsOn"]?.Type == JTokenType.String ? (string)Offer["startsOn"] : null;
        public string BrandId => (string)Offer["brand"]?["kind"] == "brand" ? (string)Offer["brand"]["brandId"] : null;
        public long Money(string field) => Terms[field]?.Type == JTokenType.Integer || Terms[field]?.Type == JTokenType.Float ? (long)Terms[field].Value<double>() : 0;
        public bool Perk(string perk) => Terms["perks"]?[perk]?.Type == JTokenType.Boolean && (bool)Terms["perks"][perk];
        public int? AppearanceCap => Terms["appearanceCap"]?.Type == JTokenType.Integer ? Terms["appearanceCap"].Value<int>() : (int?)null;

        /// <summary>The perk flag an enforceable term sets (the engine's <c>perkOfTerm</c>), or null for a share.</summary>
        public static string PerkOfTerm(string term) => term switch
        {
            "perk.ironClad" => "ironClad",
            "perk.travelCovered" => "travelCovered",
            "perk.noHouseShows" => "noHouseShows",
            "perk.creativeControl" => "creativeControl",
            _ => null,
        };

        /// <summary>Their ask as contract terms (the engine's <c>askTermsOf</c>).</summary>
        public static JObject TermsOfAsk(JToken ask)
        {
            var perks = new JObject { ["creativeControl"] = false, ["noHouseShows"] = false, ["ironClad"] = false, ["travelCovered"] = false };
            foreach (JToken perk in Kit.Arr(ask, "perks"))
            {
                string flag = PerkOfTerm(Kit.Str(perk, "term"));
                if (flag != null) perks[flag] = true;
            }
            bool perAppearance = Kit.Str(ask, "kind") == "perAppearance";
            JToken cap = Kit.Obj(ask, "appearanceCap");
            return new JObject
            {
                ["kind"] = Kit.Str(ask, "kind") ?? "written",
                ["exclusive"] = Kit.Bool(ask, "exclusive"),
                ["monthlyWage"] = perAppearance ? 0 : Cents(Kit.Num(ask, "monthlyWage.value")),
                ["perAppearanceFee"] = perAppearance ? Cents(Kit.Num(ask, "perAppearanceFee.value")) : 0,
                ["signingBonus"] = perAppearance ? 0 : Cents(Kit.Num(ask, "signingBonus.value")),
                ["shares"] = new JObject { ["gateBp"] = 0, ["merchBp"] = 0, ["broadcastBp"] = 0 },
                ["appearanceCap"] = cap == null ? JValue.CreateNull() : new JValue(Cents(Kit.Num(cap, "value"))),
                ["perks"] = perks,
            };
        }

        /// <summary>Their ask as an offer: the terms they ask, their preferred length, shared brand, expected push.</summary>
        public static OfferDraft FromAsk(JToken ask, int maxLengthMonths) => new OfferDraft(OfferFromAsk(ask, maxLengthMonths));

        public static JObject OfferFromAsk(JToken ask, int maxLengthMonths) => new JObject
        {
            ["terms"] = TermsOfAsk(ask),
            ["startsOn"] = JValue.CreateNull(),
            ["lengthMonths"] = ContractText.NearestLength((int)(Kit.Num(ask, "preferredLengthMonths.value") ?? 12), maxLengthMonths),
            ["brand"] = new JObject { ["kind"] = "shared" },
            ["role"] = Kit.Str(ask, "role") ?? "wrestler",
            ["push"] = Kit.Str(ask, "expectedPush.value") ?? "none",
            ["extra"] = new JObject(),
        };

        /// <summary>A copy of an offer the engine handed over (the last counter, the offer on the table).</summary>
        public static OfferDraft FromOffer(JToken offer) => new OfferDraft((JObject)offer.DeepClone());

        private static long Cents(double? value) => value.HasValue ? (long)System.Math.Round(value.Value) : 0;

        public void Replace(JObject offer)
        {
            Offer = offer;
            FieldErrors.Clear();
        }

        /// <summary>The kind, with their ask's money for it; a per-appearance deal is never exclusive.</summary>
        public void SetKind(string kind, JToken ask)
        {
            bool written = kind != "perAppearance";
            Terms["kind"] = kind;
            Terms["exclusive"] = written && Exclusive;
            Terms["monthlyWage"] = written ? Cents(Kit.Num(ask, "monthlyWage.value")) : 0;
            Terms["perAppearanceFee"] = written ? 0 : Cents(Kit.Num(ask, "perAppearanceFee.value"));
            FieldErrors.Remove("offer.terms.kind");
        }

        public void SetExclusive(bool exclusive)
        {
            Terms["exclusive"] = exclusive;
            FieldErrors.Remove("offer.terms.exclusive");
        }

        public void SetMoney(string field, long cents)
        {
            Terms[field] = System.Math.Max(0, cents);
            FieldErrors.Remove("offer.terms." + field);
        }

        public void SetLength(int months)
        {
            Offer["lengthMonths"] = months;
            FieldErrors.Remove("offer.lengthMonths");
        }

        public void SetPush(string push)
        {
            Offer["push"] = push;
            FieldErrors.Remove("offer.push");
        }

        public void SetRole(string role)
        {
            Offer["role"] = role;
            FieldErrors.Remove("offer.role");
        }

        public void SetBrand(string brandId)
        {
            Offer["brand"] = brandId == null ? new JObject { ["kind"] = "shared" } : new JObject { ["kind"] = "brand", ["brandId"] = brandId };
            FieldErrors.Remove("offer.brand.brandId");
        }

        public void SetStartsOn(string isoDate)
        {
            Offer["startsOn"] = isoDate == null ? JValue.CreateNull() : new JValue(isoDate);
            FieldErrors.Remove("offer.startsOn");
        }

        public void SetPerk(string perk, bool on)
        {
            Terms["perks"][perk] = on;
            FieldErrors.Remove("offer.terms.perks." + perk);
        }

        public void SetAppearanceCap(int? cap)
        {
            Terms["appearanceCap"] = cap.HasValue && cap.Value >= 1 ? new JValue(cap.Value) : JValue.CreateNull();
            FieldErrors.Remove("offer.terms.appearanceCap");
        }

        /// <summary>Puts a refusal's field reasons under their fields; returns the reasons tied to no field.</summary>
        public List<string> ShowRefusal(IEnumerable<(string field, string message)> reasons)
        {
            FieldErrors.Clear();
            var general = new List<string>();
            foreach ((string field, string message) in reasons)
            {
                if (string.IsNullOrEmpty(field)) general.Add(message);
                else if (!FieldErrors.ContainsKey(field)) FieldErrors[field] = message;
            }
            return general;
        }

        public string ErrorOf(params string[] fields) =>
            fields.Select(field => FieldErrors.TryGetValue(field, out string error) ? error : null).FirstOrDefault(error => error != null);
    }
}
