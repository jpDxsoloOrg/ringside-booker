using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.MatchLab;
using RingsideBooker.Screens.Office;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Tests.Screens
{
    /// <summary>The Match lab's argument building and wording, and the Office's needs and rankings (UNITY-21).</summary>
    public sealed class MatchLabAndOfficeTests
    {
        private static LabState Seeded()
        {
            var state = new LabState();
            state.Seed(JObject.Parse(@"{ ""promotion"": { ""id"": ""pro_a"" },
                ""defaults"": { ""typeKey"": ""match.singles"", ""slotRole"": ""midcard"", ""importance"": ""regular"", ""regionId"": ""reg_a"", ""televised"": true } }"), 2);
            return state;
        }

        private static LabPerson Person(string id) => new LabPerson { Id = id, Name = id.ToUpperInvariant() };

        [Test]
        public void PreviewArgsNeedSomeoneOnEverySide()
        {
            LabState state = Seeded();
            Assert.IsNull(state.PreviewArgs(1));
            Assert.IsTrue(state.AddPerson(0, Person("per_a")));
            Assert.IsNull(state.PreviewArgs(1));
            Assert.IsTrue(state.AddPerson(1, Person("per_b")));
            JObject args = state.PreviewArgs(7);
            Assert.AreEqual("match.singles", (string)args["typeKey"]);
            Assert.AreEqual("per_b", (string)args["sides"][1][0]);
            Assert.AreEqual(7, (int)args["previewSeed"]);
            Assert.IsNull(args["bookedTime"], "the slot's usual time is left out");
        }

        [Test]
        public void SomeoneStandsOnOneSideOnly()
        {
            LabState state = Seeded();
            Assert.IsTrue(state.AddPerson(0, Person("per_a")));
            Assert.IsFalse(state.AddPerson(1, Person("per_a")));
            Assert.AreEqual(0, state.SideOf("per_a"));
        }

        [Test]
        public void ResizeKeepsSidesWithPeople()
        {
            var sides = new List<List<string>> { new List<string> { "a" }, new List<string>(), new List<string> { "c" }, new List<string>() };
            List<List<string>> resized = LabState.ResizeSides(sides, 2);
            Assert.AreEqual(3, resized.Count, "the empty last side goes, the occupied third stays");
            Assert.AreEqual(4, LabState.ResizeSides(sides, 4).Count);
        }

        [Test]
        public void SimulateArgsCarryThePlanTimeAndWhatIfs()
        {
            LabState state = Seeded();
            state.AddPerson(0, Person("per_a"));
            state.AddPerson(1, Person("per_b"));
            state.Winner = "1";
            state.BookedTime = "short";
            state.FatigueOverrides["per_a"] = 85;
            state.FatigueOverrides["per_gone"] = 10;
            JObject args = state.BatchArgs(100, 50);
            Assert.AreEqual(1, (int)args["winner"]["side"]);
            Assert.AreEqual("short", (string)args["bookedTime"]);
            Assert.AreEqual(50, (int)args["runs"]);
            Assert.AreEqual(100, (int)args["previewSeed"]);
            JObject overrides = (JObject)args["extensions"]["physical"]["fatigueOverrides"];
            Assert.AreEqual(85, (double)overrides["per_a"]);
            Assert.IsNull(overrides["per_gone"], "only people still on a side");
        }

        [Test]
        public void ChangingTheSegmentOrPlanMakesARunOutOfDate()
        {
            LabState state = Seeded();
            state.AddPerson(0, Person("per_a"));
            state.AddPerson(1, Person("per_b"));
            var run = new LabRun { Args = state.PreviewArgs(5), PlanKey = state.PlanKey() };
            Assert.IsFalse(state.IsOutOfDate(run));
            state.Runs = 50;
            Assert.IsFalse(state.IsOutOfDate(run), "runs don't count");
            state.Winner = "draw";
            Assert.IsTrue(state.IsOutOfDate(run));
            state.Winner = "auto";
            state.SlotRole = "mainEvent";
            Assert.IsTrue(state.IsOutOfDate(run));
        }

        [Test]
        public void RemovingASideResetsAWinnerOnOrAfterIt()
        {
            LabState state = Seeded();
            state.AddSide();
            state.Winner = "2";
            state.RemoveSide(1);
            Assert.AreEqual("auto", state.Winner);
            Assert.AreEqual(2, state.Sides.Count);
        }

        [Test]
        public void AngleArgsListBeatsAndAskForTheAftermath()
        {
            LabState state = Seeded();
            state.Kind = "angle";
            state.SetAngleType("angle.promo", "beat.promo", "ring");
            Assert.IsNull(state.AngleArgs(1), "a beat with nobody in it can't run");
            state.Beats[0].GroupOne.Add("per_a");
            state.Beats.Add(new LabBeat { BeatKey = "beat.callout" });
            state.Beats[1].GroupOne.Add("per_b");
            state.Beats[1].GroupTwo.Add("per_a");
            JObject args = state.AngleArgs(3);
            Assert.AreEqual("angle.promo", (string)args["angleTypeKey"]);
            Assert.AreEqual(2, ((JArray)args["beats"]).Count);
            Assert.AreEqual("per_a", (string)args["beats"][1]["groupTwo"][0]);
            Assert.IsTrue((bool)args["aftermath"]);
            Assert.AreEqual("ring", (string)args["setting"]);
        }

        [Test]
        public void SeedsLeaveRoomForEveryNight()
        {
            var random = new System.Random(1);
            for (int i = 0; i < 100; i++)
            {
                int seed = LabState.FreshSeed(100, random);
                Assert.That(seed + 99, Is.LessThanOrEqualTo(LabState.SeedMax));
                Assert.That(seed, Is.GreaterThanOrEqualTo(0));
            }
            Assert.AreEqual(100, LabState.ClampRuns(1000));
            Assert.AreEqual(1, LabState.ClampRuns(0));
        }

        [Test]
        public void LabWordsNeverUseMinutes()
        {
            Assert.AreEqual("Usual", LabText.TimeWord(null));
            Assert.AreEqual("Long", LabText.TimeWord("long"));
            Assert.AreEqual("Main event", LabText.SlotWord("mainEvent"));
            Assert.AreEqual("50 runs", LabText.RunsText(50));
            Assert.AreEqual("40%", LabText.ShareText(8, 20));
            Assert.AreEqual("6 below expectation", LabText.ExpectationGap(80, 86.3));
            Assert.AreEqual("Average 81.1 · usually 76.6–85 · range 73–86",
                LabText.StatsSummary(JObject.Parse(@"{ ""mean"": 81.1, ""p10"": 76.6, ""p90"": 85, ""min"": 73, ""max"": 86 }")));
            Assert.AreEqual("+0.7", LabText.Signed(0.66));
        }

        private static readonly JToken Roster = JObject.Parse(@"{ ""rows"": [
            { ""personId"": ""p1"", ""ringName"": ""Popular Cold"", ""group"": ""wrestlers"", ""gender"": ""male"", ""popularity"": 80, ""momentum"": { ""value"": 20 } },
            { ""personId"": ""p2"", ""ringName"": ""Hot Prospect"", ""group"": ""wrestlers"", ""gender"": ""female"", ""popularity"": 50, ""momentum"": { ""value"": 90 } },
            { ""personId"": ""p3"", ""ringName"": ""Referee"", ""group"": ""referees"", ""gender"": ""male"", ""popularity"": 99, ""momentum"": { ""value"": 99 } },
            { ""personId"": ""p4"", ""ringName"": ""Middle"", ""group"": ""wrestlers"", ""gender"": ""male"", ""popularity"": 55, ""momentum"": { ""value"": 50 } } ] }");

        private static readonly JToken Titles = JObject.Parse(@"{ ""groups"": [ { ""titles"": [
            { ""name"": ""World Championship"", ""champion"": { ""holders"": [ { ""personId"": ""p4"" } ] } } ] } ] }");

        [Test]
        public void PowerRankingsWeighPopularityAndMomentum()
        {
            List<RankedWorker> ranked = OfficeLogic.PowerRankings(Roster, Titles);
            CollectionAssert.AreEqual(new[] { "Hot Prospect", "Popular Cold", "Middle" }, ranked.Select(worker => worker.Name).ToArray());
            Assert.AreEqual(DsState.Good, ranked[0].Trend);
            Assert.AreEqual(DsState.Bad, ranked[1].Trend);
            Assert.AreEqual("World Championship", ranked[2].Champion);
            Assert.AreEqual(1, OfficeLogic.PowerRankings(Roster, Titles, "female").Count);
        }

        [Test]
        public void NeedsTodayLeadsWithTonightAndFoldsStopsIntoTheirLines()
        {
            var gates = new List<GateHit>
            {
                new GateHit("shows.tonight", "Tonight: Mainstage", "showNight", new GateSubject("eventInstance", "evi_1")),
                new GateHit("contracts.expiringSoon", "2 contracts end soon", "contracts"),
                new GateHit("health.ownWorkerInjured", "Rook was injured", "roster", new GateSubject("person", "per_r")),
            };
            JToken next = JObject.Parse(@"{ ""daysUntil"": 0, ""show"": { ""eventInstanceId"": ""evi_1"", ""name"": ""Mainstage"", ""segmentCount"": 4, ""format"": { ""slots"": 6, ""preShowSlots"": 0 } } }");
            JToken expiring = JArray.Parse(@"[ { ""ringName"": ""Late"", ""daysLeft"": 40 }, { ""ringName"": ""Soon"", ""daysLeft"": 10 } ]");
            JToken offers = JArray.Parse(@"[ { ""ringName"": ""Free Agent"", ""status"": ""countered"", ""negotiationId"": ""neg_1"", ""answerUnseen"": false },
                { ""ringName"": ""Quiet"", ""status"": ""submitted"", ""answerUnseen"": false } ]");
            JToken counts = JObject.Parse(@"{ ""wantsToLeave"": 0 }");

            List<NeedItem> items = OfficeLogic.NeedsToday(gates, next, counts, expiring, null, offers);

            Assert.AreEqual("tonight", items[0].Id);
            Assert.AreEqual("Mainstage is tonight", items[0].Title);
            Assert.AreEqual("2 of 6 slots still open", items[0].Detail);
            Assert.AreEqual("booking", items[0].Route.ScreenId);
            NeedItem contracts = items.Single(item => item.Id == "contracts-expiring");
            Assert.AreEqual("Soon's contract ends in 10 days", contracts.Title);
            Assert.AreEqual(DsState.Bad, contracts.State);
            Assert.AreEqual("expiring", contracts.Route.Param("tab"));
            NeedItem offer = items.Single(item => item.Id == "offers");
            Assert.AreEqual("1 offer waiting", offer.Title);
            Assert.AreEqual("neg_1", offer.Route.Param("negotiation"));
            NeedItem injury = items.Single(item => item.Id == "gate-health.ownWorkerInjured");
            Assert.AreEqual("Rook was injured", injury.Title);
            Assert.AreEqual(4, items.Count, "the tonight and expiry stops are folded into their own lines");
        }

        [Test]
        public void StoriesWithoutNamesReadFromTheirKey()
        {
            JToken story = JObject.Parse(@"{ ""headline"": { ""key"": ""news.season-start.headline"", ""params"": { ""seasonNumber"": 1 } } }");
            Assert.AreEqual("Season 1 starts", OfficeLogic.HeadlineFromKey(story));
        }

        [Test]
        public void NothingNeededWhenTheDayIsClear()
        {
            Assert.IsEmpty(OfficeLogic.NeedsToday(new List<GateHit>(), JObject.Parse(@"{ ""daysUntil"": 3, ""show"": { ""name"": ""X"" } }"), null, new JArray(), null, new JArray()));
        }
    }
}
