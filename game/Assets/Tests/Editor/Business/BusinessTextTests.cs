using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Business;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Tests.Business
{
    /// <summary>The money screens' words (UNITY-18), checked against the web's wording.</summary>
    public sealed class BusinessTextTests
    {
        private const string Minus = "−";

        [Test]
        public void MoneyKeepsItsSign()
        {
            Assert.AreEqual("+$1,200", BusinessText.Signed(120000, true));
            Assert.AreEqual(Minus + "$300", BusinessText.Signed(-30000, true));
            Assert.AreEqual("$0", BusinessText.Signed(0, true));
            Assert.AreEqual("$1,200", BusinessText.Signed(120000));
            Assert.AreEqual("+$1.10M", BusinessText.SignedCompact(110000000, true));
        }

        [Test]
        public void RunwaySaysItPlainly()
        {
            Assert.AreEqual("You're losing money", BusinessText.RunwayVerdict(BusinessText.StatusLosing));
            Assert.AreEqual("At this rate you run out of cash in about 8 months.", BusinessText.RunwayHeadline(BusinessText.StatusLosing, -500000, 7.6, 0));
            Assert.AreEqual("At this rate you run out of cash in less than a month.", BusinessText.RunwayHeadline(BusinessText.StatusRunningOut, -500000, 0.4, 0));
            Assert.AreEqual("At this rate your cash grows by about $5,000 a month.", BusinessText.RunwayHeadline(BusinessText.StatusMaking, 500000, null, 0));
            Assert.AreEqual("You are out of cash. Costs are still paid, so the debt grows by about $5,000 a month.", BusinessText.RunwayHeadline(BusinessText.StatusOut, -500000, null, 0));
            Assert.AreEqual("Fixed costs come to $5,000 a month. Ticket sales and other show money count after 1 more day.", BusinessText.RunwayHeadline(BusinessText.StatusTooEarly, -500000, null, 1));
            Assert.AreEqual(("8", "months"), BusinessText.RunwayValue(BusinessText.StatusLosing, 7.6));
            Assert.AreEqual(("Under 1", "month"), BusinessText.RunwayValue(BusinessText.StatusRunningOut, 0.3));
            Assert.AreEqual(("Growing", (string)null), BusinessText.RunwayValue(BusinessText.StatusMaking, null));
            Assert.IsTrue(BusinessText.RunwayWarns(BusinessText.StatusOut));
            Assert.IsFalse(BusinessText.RunwayWarns(BusinessText.StatusTooEarly));
            Assert.AreEqual(DsState.Bad, BusinessText.RunwayBadge(BusinessText.StatusRunningOut).Value.state);
            Assert.IsNull(BusinessText.RunwayBadge(BusinessText.StatusMaking));
        }

        [Test]
        public void LedgerCategoriesFollowTheEngine()
        {
            Assert.AreEqual(25, BusinessText.LedgerCategories.Count());
            Assert.AreEqual("TV rights", BusinessText.CategoryLabel("broadcast"));
            Assert.AreEqual("Subsidies paid", BusinessText.CategoryLabel("subsidy"));
            Assert.IsTrue(BusinessText.IsIncome("tickets"));
            Assert.IsFalse(BusinessText.IsIncome("wages"));
            Assert.AreEqual("Jan 2027", BusinessText.MonthLabel("2027-01"));
            Assert.AreEqual("January 2027", BusinessText.MonthLabel("2027-01", true));
        }

        [Test]
        public void ProductionChangeWords()
        {
            Assert.AreEqual("Camera: level 2 → 4", BusinessText.ChangeTitle("Camera", 2, 4));
            Assert.AreEqual("Pay $28,000 and raise", BusinessText.ConfirmLabel(2, 4, 2800000));
            Assert.AreEqual("Raise to 4", BusinessText.ConfirmLabel(2, 4, 0));
            Assert.AreEqual("Lower to 1", BusinessText.ConfirmLabel(2, 1, null));
            Assert.AreEqual("Keep level 2", BusinessText.ConfirmLabel(2, 2, null));
            Assert.AreEqual("+$400", BusinessText.ChangeText(100000, 140000, "money/month"));
            Assert.AreEqual(DsState.Bad, BusinessText.ChangeState(100000, 140000, "money"));
            Assert.AreEqual(DsState.Good, BusinessText.ChangeState(40, 45, "points"));
            Assert.AreEqual("Can't go below level 3 while your TV deal with Channel 9 runs", BusinessText.TvFloorText(3, "Channel 9"));
            Assert.AreEqual("4 weeks", BusinessText.ForecastWindowText(28));
            Assert.AreEqual("week", BusinessText.ForecastWindowText(7));
            Assert.AreEqual("10 days", BusinessText.ForecastWindowText(10));
            Assert.AreEqual("Bonus slot on regular shows and bigger: at 90, yours 47", BusinessText.BonusSlotLine(false, 90, 47.2, "regular"));
        }

        [Test]
        public void SlotsAreNeverClockTimes()
        {
            Assert.AreEqual("Mon · Prime time · Live", BusinessText.Slot(0, "primeTime", true, "tv"));
            Assert.AreEqual("Pay-per-view · Taped", BusinessText.Slot(null, "primeTime", false, "ppv"));
            Assert.AreEqual("Sun · Late night · Taped", BusinessText.Slot(6, "lateNight", false, "streaming"));
            foreach (string slot in BusinessText.Timeslots)
            {
                StringAssert.DoesNotMatch("[0-9]", BusinessText.TimeslotLabel(slot));
            }
        }

        [Test]
        public void DealHealthAndTerms()
        {
            Assert.AreEqual("At risk", BusinessText.RiskLabel("atRisk", new[] { "Viewers below the safe line" }));
            Assert.AreEqual("Missed airing", BusinessText.RiskLabel("watch", new[] { "Missed airing on Jan 3" }));
            Assert.AreEqual(DsState.Gold, BusinessText.RiskState("exceeding"));
            Assert.AreEqual("$1.80 per buy", BusinessText.PerBuyText(180000));
            Assert.AreEqual("— · $1.80 per buy", BusinessText.FeeText("ppv", 0, 180000));
            Assert.AreEqual("$45,000", BusinessText.FeeText("tv", 4500000, 900));
            Assert.AreEqual("Oct 4, 2027 · in 3 days", BusinessText.EndsText("2027-10-04", "active", "2027-10-01"));
            Assert.AreEqual("Ended Oct 4, 2027", BusinessText.EndsText("2027-10-04", "ended", "2027-10-10"));
            Assert.AreEqual("Cancel your deal with NSN? You pay an exit fee of $41,300.", BusinessText.CancelTitle("NSN", "$41,300"));
            Assert.AreEqual("+10% for beating expectations", BusinessText.UpliftChipText(0.1));
            Assert.AreEqual("Missed: show not run", BusinessText.AiringStatusText("missed", "notRun", null));
        }

        [Test]
        public void ViewersAndTargetsRoundLikeTheWeb()
        {
            Assert.AreEqual("2.4M", BusinessText.ShortViewers(2_480_000));
            Assert.AreEqual("152K", BusinessText.ShortViewers(152_900));
            Assert.AreEqual("1.2K", BusinessText.ShortViewers(1_299));
            Assert.AreEqual("950", BusinessText.ShortViewers(950.7));
            JObject targets = JObject.Parse(
                "{\"expected\":2800000,\"safe\":{\"share\":0.75,\"viewers\":{\"value\":2100001,\"trace\":{}}}," +
                "\"cancel\":{\"share\":0.5,\"viewers\":{\"value\":1400000,\"trace\":{}}},\"bonus\":{\"share\":1.1,\"viewers\":{\"value\":3080000,\"trace\":{}}}}");
            var lines = BusinessText.TargetLines(targets, "tv");
            Assert.AreEqual("Stay above 2.2M (75% of 2.8M expected) to stay safe", lines[0].Text);
            Assert.AreEqual("May cancel below 1.4M", lines[1].Short);
            Assert.AreEqual("Beat 3.1M (110%) for a ratings bonus", lines[2].Text);
            Assert.AreEqual(0, BusinessText.TargetLines(null, "tv").Count);
        }

        [Test]
        public void AvailableNetworksSayWhatTheyWouldDo()
        {
            Assert.AreEqual("About $45,000 per show", BusinessText.BestOfferText("tv", JObject.Parse("{\"feePerShow\":4500000,\"incomePerAiring\":100}")));
            Assert.AreEqual("Paid per buy, loses $3,000 an airing", BusinessText.BestOfferText("ppv", JObject.Parse("{\"feePerShow\":0,\"incomePerAiring\":-300000}")));
            Assert.AreEqual("Nothing to offer: every show you have is already on it", BusinessText.BestOfferText("tv", null));
            var shows = new JArray(
                JObject.Parse("{\"eventDefinitionId\":\"evd_1\",\"name\":\"Mainstage\",\"importance\":\"regular\",\"televised\":true}"),
                JObject.Parse("{\"eventDefinitionId\":\"evd_2\",\"name\":\"Loop\",\"importance\":\"house\",\"televised\":false}"),
                JObject.Parse("{\"eventDefinitionId\":\"evd_3\",\"name\":\"Summit\",\"importance\":\"major\",\"televised\":false}"));
            CollectionAssert.AreEqual(new[] { "Mainstage", "Summit (becomes a TV show)" }, BusinessText.ShowOptions("tv", shows).Select(option => option.label).ToArray());
            CollectionAssert.AreEqual(new[] { "all", "evd_3" }, BusinessText.ShowOptions("ppv", shows).Select(option => option.value).ToArray());
        }
    }
}
