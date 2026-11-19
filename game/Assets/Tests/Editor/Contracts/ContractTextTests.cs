using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Tests.Contracts
{
    /// <summary>The Contracts screen's words and offer draft (UNITY-17), checked against the web's wording.</summary>
    public sealed class ContractTextTests
    {
        [Test]
        public void WageTextJoinsWageAndFee()
        {
            Assert.AreEqual("$8,000/mo", ContractText.WageText(JObject.Parse("{\"monthlyWage\":800000,\"perAppearanceFee\":0}")));
            Assert.AreEqual("$8,000/mo + $300 per show", ContractText.WageText(JObject.Parse("{\"monthlyWage\":800000,\"perAppearanceFee\":30000}")));
            Assert.AreEqual("$0", ContractText.WageText(JObject.Parse("{\"monthlyWage\":0,\"perAppearanceFee\":0}")));
        }

        [Test]
        public void StatusChipsPutTheRequestFirst()
        {
            JObject row = JObject.Parse("{\"status\":\"active\",\"daysLeft\":20,\"notice\":\"unseen\",\"request\":{\"status\":\"open\"},\"unhappy\":{\"days\":9,\"of\":14,\"paused\":false},\"walkout\":null,\"endReason\":null}");
            var chips = ContractText.StatusChips(row, 30, 60);
            CollectionAssert.AreEqual(new[] { "wantsToLeave", "unhappy", "unseen", "expiring" }, chips.Select(chip => chip.Kind).ToArray());
            Assert.AreEqual("Unhappy: day 9 of 14", chips[1].Text);
            Assert.AreEqual(DsState.Warn, chips[3].State);
            Assert.AreEqual("Ends in 20 days", chips[3].Text);
        }

        [Test]
        public void StatusChipsSayActiveWhenNothingElse()
        {
            JObject row = JObject.Parse("{\"status\":\"active\",\"daysLeft\":400,\"notice\":null,\"request\":null,\"unhappy\":null,\"walkout\":null,\"endReason\":null}");
            Assert.AreEqual("active", ContractText.StatusChips(row, 30, 60).Single().Kind);
        }

        [Test]
        public void CountsLineAndBanner()
        {
            Assert.AreEqual("55 contracts · $1,200,000 a month · 1 expiring soon · 1 wants to leave", ContractText.CountsLine(55, 120000000, 1, 1));
            Assert.AreEqual("1 contract · $0 a month · 0 expiring soon", ContractText.CountsLine(1, 0, 0, 0));
            Assert.AreEqual("2 contracts are close to their end date. Skips stop until you’ve seen them.", ContractText.ExpiringBanner(2, true));
            Assert.AreEqual("1 contract is close to its end date.", ContractText.ExpiringBanner(1, false));
        }

        [Test]
        public void OfferStatusInPlainWords()
        {
            Assert.AreEqual("Countered: answer by Jan 14, 2027", ContractText.OfferStatus(JObject.Parse("{\"status\":\"countered\",\"counterExpiresOn\":\"2027-01-14\"}")));
            Assert.AreEqual("Considering your offer: decides on Jan 8, 2027", ContractText.OfferStatus(JObject.Parse("{\"status\":\"awaitingReview\",\"reviewOn\":\"2027-01-08\"}")));
            Assert.AreEqual("Walked away: try again after Feb 3, 2027", ContractText.OfferStatus(JObject.Parse("{\"status\":\"walkedAway\",\"cooldownUntil\":\"2027-02-03\"}")));
            Assert.AreEqual("You withdrew the offer", ContractText.OfferStatus(JObject.Parse("{\"status\":\"withdrawn\",\"outcome\":null}")));
            Assert.AreEqual("Decides on Jan 8, 2027", ContractText.OfferDue(JObject.Parse("{\"status\":\"awaitingReview\",\"reviewOn\":\"2027-01-08\"}")));
        }

        [Test]
        public void OfferSummaryAndCounterLines()
        {
            JObject offer = JObject.Parse("{\"terms\":{\"kind\":\"written\",\"exclusive\":true,\"monthlyWage\":2400000,\"perAppearanceFee\":0,\"signingBonus\":200000},\"lengthMonths\":24,\"push\":\"upperCard\"}");
            Assert.AreEqual("$24,000 a month, $2,000 to sign, 24 months, exclusive", ContractText.OfferSummary(offer));
            Assert.AreEqual("They countered $24,000 a month, $2,000 to sign, 24 months, exclusive, Upper card", ContractText.CounterLine(offer));
            JObject row = JObject.Parse("{\"status\":\"countered\",\"offerSummary\":{\"kind\":\"perAppearance\",\"perAppearanceFee\":60000,\"lengthMonths\":1},\"counterSummary\":{\"kind\":\"written\",\"monthlyWage\":3420000,\"lengthMonths\":12}}");
            Assert.AreEqual("Their counter: $34,200 a month, 12 months", ContractText.OnTheTable(row));
        }

        [Test]
        public void FreeAgentAskAndTalks()
        {
            Assert.AreEqual("$600 an appearance", ContractText.AskText(JObject.Parse("{\"bestKind\":\"perAppearance\",\"askMonthly\":4130000,\"askPerAppearance\":60000}")));
            Assert.AreEqual("$41,300/mo", ContractText.AskText(JObject.Parse("{\"bestKind\":\"written\",\"askMonthly\":4130000,\"askPerAppearance\":60000}")));
            Assert.IsNull(ContractText.AskText(JObject.Parse("{\"bestKind\":null,\"askMonthly\":null,\"askPerAppearance\":null}")));
            Assert.AreEqual("Talking · 2 other bidders", ContractText.TalksState(JObject.Parse("{\"openNegotiationId\":\"neg_1\",\"cooldownUntil\":null,\"competingBidders\":[\"A\",\"B\"]}")));
            Assert.AreEqual("No talks yet", ContractText.TalksState(JObject.Parse("{\"openNegotiationId\":null,\"cooldownUntil\":null,\"competingBidders\":[]}")));
            Assert.AreEqual("Free from Sep 30, 2026", ContractText.Situation("endingSoonElsewhere", "Crown Pro", "2026-09-30"));
        }

        [Test]
        public void LengthsStayUnderTheCap()
        {
            CollectionAssert.AreEqual(new[] { 6, 12, 18, 24 }, ContractText.LengthOptions(24, 12));
            CollectionAssert.AreEqual(new[] { 6, 12, 15, 18, 24 }, ContractText.LengthOptions(24, 15));
            Assert.AreEqual(24, ContractText.NearestLength(30, 24));
            Assert.AreEqual(40, ContractText.NearestLength(40, 60), "the web keeps a length of their own under the cap");
        }

        [Test]
        public void DollarsParseToCents()
        {
            Assert.AreEqual(1250000, ContractText.ParseDollars("$12,500"));
            Assert.IsNull(ContractText.ParseDollars("abc"));
            Assert.AreEqual("12500", ContractText.DollarsText(1250000));
        }

        [Test]
        public void DraftFromAskTakesTheirTerms()
        {
            JObject ask = JObject.Parse(@"{
                ""personId"": ""per_1"", ""role"": ""wrestler"", ""kind"": ""written"", ""exclusive"": false,
                ""monthlyWage"": { ""value"": 500000 }, ""perAppearanceFee"": { ""value"": 40000 }, ""signingBonus"": { ""value"": 100000 },
                ""perks"": [ { ""term"": ""perk.ironClad"" } ], ""appearanceCap"": null,
                ""preferredLengthMonths"": { ""value"": 20 }, ""expectedPush"": { ""value"": ""midCard"" } }");
            OfferDraft draft = OfferDraft.FromAsk(ask, 60);
            Assert.AreEqual(500000, draft.Money("monthlyWage"));
            Assert.AreEqual(0, draft.Money("perAppearanceFee"));
            Assert.AreEqual(100000, draft.Money("signingBonus"));
            Assert.AreEqual(20, draft.LengthMonths);
            Assert.AreEqual("midCard", draft.Push);
            Assert.IsTrue(draft.Perk("ironClad"));
            Assert.AreEqual("shared", (string)draft.Offer["brand"]["kind"]);

            draft.SetKind("perAppearance", ask);
            Assert.AreEqual(0, draft.Money("monthlyWage"));
            Assert.AreEqual(40000, draft.Money("perAppearanceFee"));
            Assert.IsFalse(draft.Exclusive);

            var general = draft.ShowRefusal(new[] { ("offer.lengthMonths", "Too long"), ((string)null, "Not now") });
            CollectionAssert.AreEqual(new[] { "Not now" }, general);
            Assert.AreEqual("Too long", draft.ErrorOf("offer.lengthMonths"));
            draft.SetLength(12);
            Assert.IsNull(draft.ErrorOf("offer.lengthMonths"));
        }
    }
}
