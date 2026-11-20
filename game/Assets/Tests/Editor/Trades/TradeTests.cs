using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.Screens.Trades;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.Tests.Trades
{
    /// <summary>The trade sheet's draft, words and routes (TRD-02).</summary>
    public sealed class TradeTests
    {
        [Test]
        public void DraftWritesTheEngineArgsWithCashOneWayAndOneChangePerWorker()
        {
            var draft = new TradeDraft("pro_me", "pro_them");
            Assert.IsTrue(draft.Add("emp_a", true));
            Assert.IsTrue(draft.Add("emp_b", false));
            Assert.IsFalse(draft.Add("emp_a", false), "a worker is in the deal once");
            draft.SetCash(false, 5_000_000);
            draft.SetCash(true, 100_000);
            Assert.AreEqual(0, draft.GetCash, "cash goes one way: setting yours clears theirs");
            draft.SetPay("emp_b", 250_000);
            draft.SetLength("emp_b", 24);
            draft.SetLength("emp_a", 0);

            JObject args = draft.ToArgs();
            Assert.AreEqual("pro_me", (string)args["promotionId"]);
            Assert.AreEqual("pro_them", (string)args["partnerId"]);
            CollectionAssert.AreEqual(new[] { "emp_a" }, args["give"]["employmentIds"].Select(id => (string)id).ToArray());
            Assert.AreEqual(100_000, (long)args["give"]["cash"]);
            Assert.AreEqual(0, (long)args["get"]["cash"]);
            JArray adjustments = (JArray)args["adjustments"];
            Assert.AreEqual(1, adjustments.Count, "no change for a worker whose terms are kept");
            Assert.AreEqual("emp_b", (string)adjustments[0]["employmentId"]);
            Assert.AreEqual(250_000, (long)adjustments[0]["pay"]);
            Assert.AreEqual(24, (int)adjustments[0]["lengthMonths"]);
            Assert.IsNull(args["tradeId"]);

            draft.Remove("emp_b");
            Assert.IsNull(draft.ToArgs()["adjustments"], "taking a worker out drops their change");
        }

        [Test]
        public void DraftHoldsFiveASideAndStartsOverOnTheirSideForANewRival()
        {
            var draft = new TradeDraft("pro_me", "pro_them");
            for (int i = 0; i < 6; i++) draft.Add("emp_g" + i, true);
            Assert.AreEqual(TradeDraft.MaxPerSide, draft.Give.Count);
            Assert.IsTrue(draft.IsFull(true));
            draft.Add("emp_x", false);
            draft.SetCash(false, 1000);
            draft.SetPartner("pro_other");
            Assert.AreEqual(0, draft.Get.Count);
            Assert.AreEqual(0, draft.GetCash);
            Assert.AreEqual(5, draft.Give.Count, "your side stays");
        }

        [Test]
        public void CounterDraftComesFromTheOfferOnTheTableAndPreviewsWithItsTrade()
        {
            JObject offer = JObject.Parse(@"{""sides"":[
                {""promotionId"":""pro_them"",""isYou"":false,""cash"":0,""workers"":[{""employmentId"":""emp_t"",""adjustment"":null}]},
                {""promotionId"":""pro_me"",""isYou"":true,""cash"":6100000,""workers"":[{""employmentId"":""emp_m"",""adjustment"":{""employmentId"":""emp_m"",""pay"":null,""lengthMonths"":12}}]}]}");
            TradeDraft draft = TradeDraft.FromOffer(offer, "pro_me", "trd_1");
            Assert.AreEqual("pro_them", draft.PartnerId);
            CollectionAssert.AreEqual(new[] { "emp_m" }, draft.Give.ToArray());
            CollectionAssert.AreEqual(new[] { "emp_t" }, draft.Get.ToArray());
            Assert.AreEqual(6_100_000, draft.GiveCash);
            Assert.AreEqual(12, draft.LengthChange("emp_m"));
            Assert.AreEqual("trd_1", (string)draft.ToArgs(forPreview: true)["tradeId"]);
            JObject counter = draft.ToCounter();
            Assert.AreEqual("counter", (string)counter["answer"]);
            Assert.AreEqual("trd_1", (string)counter["tradeId"]);
        }

        [Test]
        public void LeanReadsAsWordsStateAndMeter()
        {
            Assert.AreEqual("Likely yes", TradeText.LeanLabel("yes"));
            Assert.AreEqual("Close", TradeText.LeanLabel("close"));
            Assert.AreEqual("Far apart", TradeText.LeanLabel("far"));
            Assert.AreEqual(DsState.Good, TradeText.LeanState("yes"));
            Assert.AreEqual(DsState.Bad, TradeText.LeanState("far"));
            Assert.AreEqual(1f, TradeText.MeterFraction("yes", 0));
            Assert.AreEqual(0.5f, TradeText.MeterFraction("close", 15), 0.001f);
            Assert.Less(TradeText.MeterFraction("far", 40), 0.1f);
        }

        [Test]
        public void StatusWordsSayWhoMustAnswerAndWhen()
        {
            JObject theirOffer = JObject.Parse(@"{""status"":""open"",""awaitingYou"":true,""rivalInitiated"":true,""rounds"":1,""expiresOn"":""2027-03-08"",""otherName"":""Crown Pro""}");
            Assert.AreEqual("Their offer: your answer", TradeText.StatusLabel(theirOffer));
            Assert.AreEqual("TRADE OFFER", TradeText.Eyebrow(theirOffer));
            StringAssert.StartsWith("Lapses on ", TradeText.NextLine(theirOffer));
            JObject counter = JObject.Parse(@"{""status"":""open"",""awaitingYou"":true,""rivalInitiated"":false,""rounds"":2,""otherName"":""Crown Pro""}");
            Assert.AreEqual("Counter-offer: your answer", TradeText.StatusLabel(counter));
            Assert.AreEqual("Crown Pro sent a counter-offer.", TradeText.Banner(counter));
            JObject sent = JObject.Parse(@"{""status"":""open"",""awaitingYou"":false,""rounds"":1}");
            Assert.AreEqual("Their answer comes after the next day", TradeText.NextLine(sent));
            JObject refused = JObject.Parse(@"{""status"":""refused"",""otherName"":""Crown Pro"",""answer"":{""by"":""pro_me""}}");
            Assert.AreEqual("You turned the trade down.", TradeText.Banner(refused, "pro_me"));
            Assert.AreEqual("Crown Pro turned the trade down.", TradeText.Banner(refused, "pro_x"));
        }

        [Test]
        public void ProblemsFindTheirWorkerAndSayTheFix()
        {
            JObject champion = JObject.Parse(@"{""code"":""trades.champion"",""message"":""Rex holds the belt"",""field"":""offer.sides[1].employmentIds[0]""}");
            Assert.IsTrue(TradeText.IsAbout(champion, 1, 0, "emp_r", "Rex"));
            Assert.IsFalse(TradeText.IsAbout(champion, 0, 0, "emp_r", "Rex"));
            JObject clause = JObject.Parse(@"{""code"":""trades.noTradeClause"",""message"":""Sable Whitcombe has a no-trade clause"",""field"":""offer.sides[0].employmentIds""}");
            Assert.IsTrue(TradeText.IsAbout(clause, 0, 2, "emp_s", "Sable Whitcombe"));
            Assert.IsFalse(TradeText.IsAbout(clause, 0, 1, "emp_o", "Other One"));
            Assert.IsTrue(TradeText.FixedByRemoving("trades.champion"));
            Assert.IsFalse(TradeText.FixedByRemoving("trades.empty"));
            StringAssert.Contains("vacate", TradeText.Fix("trades.champion"));
            JObject blocked = JObject.Parse(@"{""tradable"":false,""reasons"":[{""code"":""trades.champion"",""message"":""long""}]}");
            Assert.AreEqual(TradeText.ChampionBlocked, TradeText.BlockedWords(blocked));
            Assert.AreEqual("+3 morale", TradeText.MoraleWords(3));
            Assert.AreEqual("−15 morale", TradeText.MoraleWords(-15));
            Assert.IsNull(TradeText.MoraleWords(0));
            Assert.AreEqual("Rex, Ana and $500", TradeText.SideWords(new[] { "Rex", "Ana" }, 50_000));
        }

        [Test]
        public void TradeStopsOpenContractsTradesOnTheTrade()
        {
            var offer = new GateHit(GateHints.TradeOfferGateId, "Crown Pro offered you a trade", GateHints.Trades, new GateSubject("trade", "trd_1"));
            var answered = new GateHit(GateHints.TradeAnsweredGateId, "Crown Pro accepted your trade", GateHints.Trades, new GateSubject("trade", "trd_2"));
            DayControlState state = DayControlLogic.Derive(new[] { offer }, false);
            Assert.AreEqual(DayControlLogic.TradeOfferLabel, state.Primary.Label);
            Assert.AreEqual("contracts", state.Primary.Destination.ScreenId);
            Assert.AreEqual("trades", state.Primary.Destination.Param("tab"));
            Assert.AreEqual("trd_1", state.Primary.Destination.Param("trade"));
            Assert.AreEqual(DayControlLogic.TradeAnsweredLabel, DayControlLogic.Derive(new[] { answered }, false).Primary.Label);
            Assert.AreEqual("trd_2", ContractsScreen.TradeOnArrival(DayControlLogic.GateDestination(answered).Value.to));
            Assert.IsTrue(ContractsView.Tabs.Any(tab => tab.id == ContractsScreen.TabTrades));
        }
    }
}
