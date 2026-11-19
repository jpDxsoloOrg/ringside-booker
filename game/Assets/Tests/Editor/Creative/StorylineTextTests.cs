using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Creative;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Tests.Creative
{
    /// <summary>The Storylines screens' words and timeline rules (UNITY-16), checked against the web's.</summary>
    public sealed class StorylineTextTests
    {
        [Test]
        public void HeatIsAWordBeforeItIsANumber()
        {
            Assert.AreEqual(("Hot", DsState.Live), StorylineText.HeatWord(84, 70));
            Assert.AreEqual(("Warm", DsState.Warn), StorylineText.HeatWord(40, 70));
            Assert.AreEqual(("Cold", DsState.Info), StorylineText.HeatWord(39, 70));
        }

        [Test]
        public void SaysHowHeatCools()
        {
            Assert.AreEqual("Heat doesn't cool.", StorylineText.CoolingText(0, false, 10, null, 7));
            Assert.AreEqual("Cooling 1 per day, floor 10.", StorylineText.CoolingText(1, true, 10, null, 7));
            Assert.AreEqual("Cools from day 8 without progress (in 1 day).", StorylineText.CoolingText(1, false, 10, 1, 7));
            Assert.AreEqual("At its floor of 10: it cools no further.", StorylineText.CoolingText(1, false, 10, null, 7));
        }

        [Test]
        public void FooterFactsAndPayoffWords()
        {
            CollectionAssert.AreEqual(new[] { "Started Jan 4, 2027", "1 linked segment", "26 days since it moved on" },
                StorylineText.FooterFacts("2027-01-04", null, 1, 26));
            CollectionAssert.AreEqual(new[] { "Started Jan 4, 2027", "Moved on today" }, StorylineText.FooterFacts("2027-01-04", null, null, 0));
            Assert.AreEqual("No payoff (needs 4 linked segments, has 1)", StorylineText.NotEligibleText(4, 1));
            Assert.AreEqual("No payoff (needs 1 linked segment, had 0)", StorylineText.NoPayoffRecordText(1, 0));
            Assert.AreEqual("a big lift for everyone in it", StorylineText.PayoffStrengthWords(0.5));
            Assert.AreEqual("the story went cold: a real drop", StorylineText.PayoffStrengthWords(-0.5));
            Assert.AreEqual("+1.5", StorylineText.Signed(1.46, 1));
            Assert.AreEqual("−2", StorylineText.Signed(-2, 0));
            Assert.AreEqual("0", StorylineText.Signed(0.01, 1));
        }

        [Test]
        public void SidesAndRefusalsLandWhereTheWebPutsThem()
        {
            Assert.AreEqual("neutral", StorylineText.DefaultSideFor("tweener"));
            Assert.AreEqual("Wrestler · Main event · In 2 storylines", StorylineText.MemberOptionFacts("wrestler", "mainEvent", 2));
            Assert.AreEqual("Referee · In no storylines", StorylineText.MemberOptionFacts("referee", "none", 0));
            StorylineText.PlacedReasons placed = StorylineText.PlaceReasons(new[]
            {
                ("a", "members[2].personId", "Not employed."),
                ("b", "name", "Taken."),
                ("c", "storylineId", "Ended."),
            });
            Assert.AreEqual("Not employed.", placed.Members);
            Assert.AreEqual("Taken.", placed.Name);
            Assert.AreEqual("Ended.", placed.General.Single());
        }

        [Test]
        public void TimelineJoinsHeatStepsToLinkedSegmentsNewestFirst()
        {
            JArray linked = JArray.Parse(@"[
              {""segmentId"":""seg_a"",""eventInstanceId"":""evi_1"",""eventName"":""Weekly"",""date"":""2027-01-04"",""slot"":2,""preShow"":false,""label"":""A vs B"",""stars"":3.5,""ratingTraceId"":""segment.rating:seg_a"",""isFinale"":false,""heatBefore"":null,""heatAfter"":null,""heatTraceRef"":null},
              {""segmentId"":""seg_b"",""eventInstanceId"":""evi_2"",""eventName"":""Weekly"",""date"":""2027-01-11"",""slot"":0,""preShow"":false,""label"":""A & B"",""stars"":null,""ratingTraceId"":null,""isFinale"":true,""heatBefore"":null,""heatAfter"":null,""heatTraceRef"":null},
              {""segmentId"":""seg_c"",""eventInstanceId"":""evi_1"",""eventName"":""Weekly"",""date"":""2027-01-04"",""slot"":0,""preShow"":true,""label"":""C"",""stars"":2,""ratingTraceId"":null,""isFinale"":false,""heatBefore"":null,""heatAfter"":null,""heatTraceRef"":null}
            ]");
            JArray steps = JArray.Parse(@"[{""segmentId"":""seg_a"",""eventInstanceId"":""evi_1"",""showName"":null,""date"":""2027-01-04"",""slot"":2,""preShow"":false,""segmentLabel"":""A vs B"",""heatBefore"":42,""heatAfter"":51,""traceRef"":{""kind"":""storylines.heatStep"",""id"":""x""},""finale"":false}]");
            var entries = StorylineText.TimelineEntries(linked, steps, "2027-01-08");
            CollectionAssert.AreEqual(new[] { "seg_b", "seg_a", "seg_c" }, entries.Select(entry => entry.SegmentId));
            Assert.AreEqual("booked", entries[0].State);
            Assert.AreEqual("counted", entries[1].State);
            Assert.AreEqual("Weekly", entries[1].ShowName);
            Assert.AreEqual(3.5, entries[1].Stars);
            Assert.AreEqual("notCounted", entries[2].State);
            Assert.AreEqual("42 → 51", StorylineText.HeatStep(42, 51));
            Assert.AreEqual("Pre-show slot 1", StorylineText.SlotLabel(true, 0));
            Assert.AreEqual("segment.rating", (string)StorylineText.TraceRefFromKey("segment.rating:seg_a")["kind"]);
            Assert.IsNull(StorylineText.TraceRefFromKey("nokey"));
            CollectionAssert.AreEqual(new[] { "Weekly" }, StorylineText.StillBookedShows(linked, "2027-01-08"));
            Assert.IsNull(StorylineText.FinalePlayedOn("active", linked));
        }
    }
}
