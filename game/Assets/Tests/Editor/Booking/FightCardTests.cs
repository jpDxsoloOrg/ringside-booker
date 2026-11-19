using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens;

namespace RingsideBooker.Tests.Booking
{
    /// <summary>
    /// UNITY-20: the beats editor's side rules (a port of the engine's assignAngleSides and the web's
    /// beatsDraft), the founding form's checks and the fight card's words (never minutes, D-10).
    /// </summary>
    public sealed class FightCardTests
    {
        private static readonly HashSet<string> TwoGroupBeats = new HashSet<string> { "beat.confrontation", "beat.interview" };

        private static bool TwoGroups(string key) => TwoGroupBeats.Contains(key);

        [Test]
        public void OneGroupBeatPutsEveryoneOnTheirOwnSide()
        {
            var beats = new List<BeatRow> { new BeatRow("beat.promo", new[] { "a", "b" }) };
            Assert.That(AngleBeats.AssignSides(beats, TwoGroups, out Dictionary<string, int> sides, out _), Is.True);
            Assert.That(sides["a"], Is.EqualTo(0));
            Assert.That(sides["b"], Is.EqualTo(1));
        }

        [Test]
        public void TwoGroupBeatSharesGroupOneAndOpposesGroupTwo()
        {
            var beats = new List<BeatRow> { new BeatRow("beat.confrontation", new[] { "a", "b" }, new[] { "c", "d" }) };
            Assert.That(AngleBeats.AssignSides(beats, TwoGroups, out Dictionary<string, int> sides, out _), Is.True);
            Assert.That(sides["a"], Is.EqualTo(sides["b"]));
            Assert.That(sides["c"], Is.EqualTo(sides["d"]));
            Assert.That(sides["a"], Is.Not.EqualTo(sides["c"]));
        }

        [Test]
        public void TogetherThenOpposedIsAConflictWithAPlainMessage()
        {
            var beats = new List<BeatRow>
            {
                new BeatRow("beat.confrontation", new[] { "a", "b" }, new[] { "c" }),
                new BeatRow("beat.confrontation", new[] { "a" }, new[] { "b" }),
            };
            Assert.That(AngleBeats.AssignSides(beats, TwoGroups, out _, out SideConflict conflict), Is.False);
            Assert.That(conflict.BeatIndex, Is.EqualTo(1));
            string message = AngleBeats.ConflictMessage(beats, conflict, id => id.ToUpperInvariant(), TwoGroups);
            Assert.That(message, Is.EqualTo("A and B are together in beat 1 but opposed in beat 2; booking can't store that"));
        }

        [Test]
        public void StoredBeatsRoundTripThroughTheirSides()
        {
            var rows = new List<BeatRow> { new BeatRow("beat.interview", new[] { "host" }, new[] { "x", "y" }), new BeatRow("beat.promo", new[] { "x" }) };
            Assert.That(AngleBeats.AssignSides(rows, TwoGroups, out Dictionary<string, int> sides, out _), Is.True);
            List<(string beatKey, IReadOnlyList<string> personIds)> stored = AngleBeats.ToStored(rows)
                .Select(beat => (beat.beatKey, (IReadOnlyList<string>)beat.personIds)).ToList();
            List<BeatRow> back = AngleBeats.RowsOf(stored, sides, null, new List<string>(), TwoGroups);
            Assert.That(back[0].GroupOne, Is.EqualTo(new[] { "host" }));
            Assert.That(back[0].GroupTwo, Is.EqualTo(new[] { "x", "y" }));
            Assert.That(back[1].GroupOne, Is.EqualTo(new[] { "x" }));
        }

        [Test]
        public void DefaultBeatSplitsSideZeroFromTheRest()
        {
            var sides = new Dictionary<string, int> { ["a"] = 0, ["b"] = 1, ["c"] = 1 };
            List<BeatRow> rows = AngleBeats.RowsOf(null, sides, "beat.confrontation", new[] { "b", "a", "c" }, TwoGroups);
            Assert.That(rows, Has.Count.EqualTo(1));
            Assert.That(rows[0].GroupOne, Is.EqualTo(new[] { "a" }));
            Assert.That(rows[0].GroupTwo, Is.EqualTo(new[] { "b", "c" }));
            Assert.That(AngleBeats.RowsOf(null, sides, "beat.promo", new[] { "a", "b" }, TwoGroups)[0].GroupOne, Is.EqualTo(new[] { "a", "b" }));
        }

        [Test]
        public void FoundingChecksMatchTheEngine()
        {
            string[] takenNames = { "Altura Wrestling Entertainment" };
            string[] takenShort = { "AW" };
            Assert.That(FoundPromotion.NameProblem("", takenNames), Is.EqualTo("Enter a name for your promotion."));
            Assert.That(FoundPromotion.NameProblem("Ab", takenNames), Is.EqualTo("Use 3 to 48 characters."));
            Assert.That(FoundPromotion.NameProblem("altura wrestling entertainment", takenNames), Does.Contain("already exists"));
            Assert.That(FoundPromotion.NameProblem("Harbour City Wrestling", takenNames), Is.Null);
            Assert.That(FoundPromotion.ShortNameProblem("aw", takenShort), Is.EqualTo("AW is already taken by another promotion."));
            Assert.That(FoundPromotion.ShortNameProblem("H C", takenShort), Is.EqualTo("Use 2 to 8 letters or digits, no spaces."));
            Assert.That(FoundPromotion.ShortNameProblem(" hcw ", takenShort), Is.Null);
            Assert.That(FoundPromotion.ValidColour("#1a2B3c"), Is.True);
            Assert.That(FoundPromotion.ValidColour("1a2b3c"), Is.False);
        }

        [Test]
        public void FoundingFormSendsTheFoundPlayer()
        {
            var preview = JObject.Parse(@"{""takenNames"":[],""takenShortNames"":[],""regions"":[{""key"":""c"",""countries"":[{""key"":""k"",""regions"":[{""key"":""r1"",""name"":""North""}]}]}]}");
            var form = new FoundPromotion { Name = " Harbour City Wrestling ", ShortName = "hcw" };
            Assert.That(form.FirstProblem(preview), Is.EqualTo("Choose a home region."));
            form.HomeRegionKey = "r1";
            Assert.That(form.FirstProblem(preview), Is.EqualTo("Choose a style."));
            form.Style = "technical";
            Assert.That(form.FirstProblem(preview), Is.Null);
            JObject player = form.ToPlayer();
            Assert.That((string)player["mode"], Is.EqualTo("found"));
            Assert.That((string)player["name"], Is.EqualTo("Harbour City Wrestling"));
            Assert.That((string)player["shortName"], Is.EqualTo("HCW"));
            Assert.That((int)player["weeklyShowDay"], Is.EqualTo(4));
            Assert.That((bool)player["starterKit"], Is.True);
        }

        [Test]
        public void LengthsAreWordsNeverMinutes()
        {
            Assert.That(CardWords.Lengths.Select(CardWords.Length), Is.EqualTo(new[] { "Short", "Standard", "Long" }));
            Assert.That(AngleBeats.LimitMessage("short", 2), Is.EqualTo("Short slot: up to 2 beats"));
            Assert.That(AngleBeats.LimitMessage("long", 1), Is.EqualTo("Long slot: up to 1 beat"));
        }
    }
}
