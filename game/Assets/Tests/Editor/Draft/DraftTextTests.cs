using System.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Draft;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Bridge;

namespace RingsideBooker.Tests.Draft
{
    /// <summary>DRF-02/06/07: the draft start's words and small rules (wizard counts, fit hint, Why? lines, clock, sim steps, the gate).</summary>
    public sealed class DraftTextTests
    {
        [Test]
        public void TheActiveSummaryCountsPromotionsAndWrestlers()
        {
            Assert.That(DraftText.ActiveSummary(12, 40, 380), Is.EqualTo("12 active promotions, 380 wrestlers"));
            Assert.That(DraftText.ActiveSummary(14, 14, 549), Is.EqualTo("All 14 promotions active, 549 wrestlers"));
            Assert.That(DraftText.ActiveSummary(1, 14, 1), Is.EqualTo("1 active promotion, 1 wrestler"));
        }

        [Test]
        public void OnlyTheBiggestKeepsYourOwnPromotion()
        {
            string[] biggest = { "a", "b", "c", "d", "e" };
            Assert.That(DraftText.Biggest(biggest, 2, "e"), Is.EqualTo(new[] { "a", "b", "e" }));
            Assert.That(DraftText.Biggest(biggest, 2, "b"), Is.EqualTo(new[] { "a", "b" }));
            Assert.That(DraftText.Biggest(biggest, 0, null), Is.EqualTo(new[] { "a" }));
        }

        [Test]
        public void DraftChoicesReadInPlainWords()
        {
            Assert.That(DraftText.OptionLabel(DraftText.OrderKey, "bySize"), Is.EqualTo("Smallest first"));
            Assert.That(DraftText.OptionLabel(DraftText.ScheduleKey, "weekly"), Is.EqualTo("One show a week"));
            Assert.That(DraftText.OptionLabel(DraftText.PoolSizeKey, "all"), Is.EqualTo("Everyone"));
            Assert.That(DraftText.OptionLabel(DraftText.RosterSizeKey, "20"), Is.Null, "numbers fall back to the default label");
        }

        [Test]
        public void MoneyInTheDraftReadsPlainly()
        {
            Assert.That(DraftText.OptionLabel(DraftText.StartingCashKey, "median"), Is.EqualTo("World median"));
            Assert.That(DraftText.OptionLabel(DraftText.StartingCashKey, "1m"), Is.EqualTo("$1M"));
            Assert.That(DraftText.CannotAfford(12_000_000, 8_000_050), Is.EqualTo("Costs $120,000; you have $80,001."));
            Assert.That(DraftText.LevelLine(82_500_000, 13, 51, "median"), Does.StartWith("Every promotion starts with $825,000 (the world median), "));
            Assert.That(DraftText.LevelLine(100_000_000, 13, 51, "1m"), Does.StartWith("Every promotion starts with $1,000,000, "));
            Assert.That(DraftText.CostDetail(0, 26, 1_014_000, true), Is.EqualTo("Their whole season contract (26 appearances for $10,140), paid when you draft them."));
            Assert.That(DraftText.ShortRosterLine(0, true), Is.Null);
            Assert.That(DraftText.ShortRosterLine(3, true), Does.StartWith("You ran out of money 3 wrestlers short."));
            Assert.That(DraftText.ShortRosterLine(1, false), Does.Contain("per-appearance deals in Contracts"));
        }

        [Test]
        public void TheReserveHintOnlyShowsWhenAPickLeavesLittle()
        {
            Assert.That(DraftText.ReserveHint(10_000_000, 2_000_000, 3), Is.Null, "five months left");
            Assert.That(DraftText.ReserveHint(5_000_000, 2_000_000, 3), Is.EqualTo("Leaves you $50,000: under 3 months of running costs ($20,000 a month for shows, venues and medical)."));
            Assert.That(DraftText.ReserveHint(5_000_000, 0, 3), Is.Null, "no running costs known");
        }

        [Test]
        public void DraftGamesForceExclusiveOnDraftedJobsOnly()
        {
            Assert.That(DraftText.ForcesExclusive(true, false, "wrestler"), Is.True);
            Assert.That(DraftText.ForcesExclusive(true, false, "referee"), Is.False);
            Assert.That(DraftText.ForcesExclusive(true, true, "referee"), Is.True);
            Assert.That(DraftText.ForcesExclusive(true, true, "booker"), Is.False);
            Assert.That(DraftText.ForcesExclusive(false, true, "wrestler"), Is.False, "no draft, no rule");
        }

        [Test]
        public void FitIsWhatTheRosterNeedsAddToTheValue()
        {
            Assert.That(DraftText.Fit(50, 62).word, Is.EqualTo("Big need"));
            Assert.That(DraftText.Fit(50, 54).state, Is.EqualTo(DsState.Good));
            Assert.That(DraftText.Fit(50, 50).word, Is.EqualTo("Fits"));
            Assert.That(DraftText.Fit(50, 40).state, Is.EqualTo(DsState.Warn));
            Assert.That(DraftText.Fit(50, null).state, Is.EqualTo(DsState.Neutral));
            // Ranked among the rows on screen: an empty roster needs everyone, so the biggest needs lead.
            Assert.That(DraftText.Fit(50, 70, 10, 20).word, Is.EqualTo("Big need"));
            Assert.That(DraftText.Fit(50, 65, 10, 20).word, Is.EqualTo("Good fit"));
            Assert.That(DraftText.Fit(50, 61, 10, 20).word, Is.EqualTo("Fits"));
            Assert.That(DraftText.Fit(50, 45, -5, 20).word, Is.EqualTo("Have enough"));
            Assert.That(DraftText.Fit(50, 62, 12, 12.5).word, Is.EqualTo("Big need"), "no spread: the plain rule");
        }

        [Test]
        public void WhyLinesSplitLabelsAndEffects()
        {
            WhyLine[] lines = DraftText.WhyLines(new[] { "Skill: 43.2 (rating 72)", "+5: their style suits the promotion", "−3: the roster already has its share of this gender", "Draft value 61" });
            Assert.That(lines.Length, Is.EqualTo(4));
            Assert.That(lines[0].Label, Is.EqualTo("Skill"));
            Assert.That(lines[0].Effect, Is.EqualTo("43.2 (rating 72)"));
            Assert.That(lines[1].Label, Is.EqualTo("Their style suits the promotion"));
            Assert.That(lines[1].Effect, Is.EqualTo("+5"));
            Assert.That(lines[1].State, Is.EqualTo(DsState.Good));
            Assert.That(lines[2].State, Is.EqualTo(DsState.Warn));
            Assert.That(lines[3].Label, Is.EqualTo("Draft value 61"));
        }

        [Test]
        public void TheClockSaysWhoIsPicking()
        {
            Assert.That(DraftText.ClockHeadline("running", true, "ALT"), Is.EqualTo("You're on the clock"));
            Assert.That(DraftText.ClockHeadline("running", false, "ALT"), Is.EqualTo("ALT is on the clock"));
            Assert.That(DraftText.ClockHeadline("complete", false, null), Is.EqualTo("Every pick is made"));
            Assert.That(DraftText.RoundLine(3, 20, 47), Is.EqualTo("Round 3 of 20 · Pick 47"));
            Assert.That(DraftText.NextTurnLine(false, 4, 3), Is.EqualTo("Your pick: 4 picks away (round 3)."));
            Assert.That(DraftText.NextTurnLine(false, null, null), Does.StartWith("Your roster is full"));
        }

        [Test]
        public void SimToMyPickTakesAboutEightSteps()
        {
            Assert.That(DraftText.SimStep(1), Is.EqualTo(1));
            Assert.That(DraftText.SimStep(13), Is.EqualTo(2));
            Assert.That(DraftText.SimStep(299), Is.EqualTo(38));
            Assert.That(DraftText.SimStep(5000), Is.EqualTo(40), "capped so one step stays quick");
            Assert.That(DraftText.Rounds(20, 6, true), Is.EqualTo(26));
            Assert.That(DraftText.Rounds(20, 6, false), Is.EqualTo(20));
        }

        [Test]
        public void TheUnfinishedDraftLeadsTheDayButtonToTheDraftRoom()
        {
            var draft = new GateHit("draft.unfinished", "Finish the draft before the season starts", GateHints.Draft);
            var show = new GateHit("calendar.showTonight", "Show tonight", GateHints.ShowNight);
            Assert.That(DayControlLogic.LeadingGate(new[] { show, draft }), Is.SameAs(draft));
            DayControlState state = DayControlLogic.Derive(new[] { show, draft }, false);
            Assert.That(state.Primary.Label, Is.EqualTo("Finish the draft"));
            Assert.That(state.Primary.Destination.ScreenId, Is.EqualTo("draft"));
            Assert.That(state.SkipEnabled, Is.False);
        }

        [Test]
        public void CardLevelsHaveWordsAndColoursTopDown()
        {
            Assert.That(DraftText.CardLevels.Select(DraftText.LevelWord), Is.EqualTo(new[] { "Main event", "Upper midcard", "Midcard", "Lower card", "Enhancement" }));
            Assert.That(DraftText.LevelState("mainEvent"), Is.EqualTo(DsState.Gold));
            Assert.That(DraftText.LevelState("enhancement"), Is.EqualTo(DsState.Neutral));
        }

        [Test]
        public void ContractStatesHaveWords()
        {
            Assert.That(DraftText.ContractWord("reserved").word, Is.EqualTo("Unsigned"));
            Assert.That(DraftText.ContractWord("signed").state, Is.EqualTo(DsState.Good));
            Assert.That(new[] { "signed", "reserved", "released", "lapsed" }.Select(c => DraftText.ContractWord(c).word).Distinct().Count(), Is.EqualTo(4));
        }
    }
}
