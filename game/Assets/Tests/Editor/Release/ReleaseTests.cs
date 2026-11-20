using System.Linq;
using NUnit.Framework;
using RingsideBooker.Release;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Title;
using RingsideBooker.UI.WhatsNew;
using UnityEngine.UIElements;

namespace RingsideBooker.Tests.Release
{
    /// <summary>Version stamps, channel, release notes and the What's new rule (POL9-01/10).</summary>
    public sealed class ReleaseTests
    {
        private const string AlphaJson =
            "{ \"version\": \"0.1.0-alpha.3+1a2b3c4d\", \"channel\": \"alpha\", \"commit\": \"1a2b3c4d5e6f7a8b9c0d\", \"built\": \"2026-11-20T09:15:00Z\" }";

        private const string Changelog = @"# Changelog

Intro text that is not a release.

## Unreleased

### Fixed

- I fixed the thing
  that wrapped.

## [0.1.0-alpha.2] - 2026-11-20

### Heads up

- Saves may need a fresh start.

### Added

- I added a sheet.
- I added a badge.

### Balance

- Crowds like ladders a bit less.

## [0.1.0-alpha.1] - 2026-11-19

### Added

- The first build.
";

        // ---- ReleaseInfo.Stamp ---------------------------------------------------------------------

        [Test]
        public void ParsesAnAlphaStamp()
        {
            ReleaseInfo.Stamp stamp = ReleaseInfo.Stamp.Parse(AlphaJson, "fallback");
            Assert.AreEqual("0.1.0-alpha.3+1a2b3c4d", stamp.Version);
            Assert.AreEqual("0.1.0-alpha.3", stamp.SemVer);
            Assert.AreEqual("0.1.0", stamp.Core);
            Assert.AreEqual(3, stamp.PreReleaseNumber);
            Assert.AreEqual(ReleaseInfo.ChannelAlpha, stamp.Channel);
            Assert.IsTrue(stamp.IsAlpha);
            Assert.AreEqual("1a2b3c4d", stamp.ShortCommit);
            Assert.AreEqual("20 Nov 2026", stamp.BuiltDay);
            Assert.AreEqual("Alpha 0.1.0 (3)", stamp.Label);
            Assert.AreEqual("Ringside Booker — Alpha 0.1.0 (3)", stamp.WindowTitle);
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase("not json")]
        [TestCase("{ \"channel\": \"alpha\" }")]
        public void MissingOrBrokenStampFallsBackToLocal(string json)
        {
            ReleaseInfo.Stamp stamp = ReleaseInfo.Stamp.Parse(json, "0.1.0-alpha.1");
            Assert.AreEqual(ReleaseInfo.ChannelLocal, stamp.Channel);
            Assert.AreEqual("0.1.0-alpha.1", stamp.Version);
            Assert.IsFalse(stamp.IsAlpha);
            Assert.AreEqual("", stamp.ShortCommit);
            Assert.AreEqual("", stamp.BuiltDay);
            Assert.AreEqual("This computer", stamp.ChannelName);
            Assert.AreEqual("0.1.0-alpha.1 (this computer)", stamp.Label);
        }

        [TestCase("alpha", "alpha")]
        [TestCase("BETA", "beta")]
        [TestCase(" release ", "release")]
        [TestCase("nightly", "local")]
        [TestCase(null, "local")]
        public void NormalisesTheChannel(string given, string expected)
        {
            Assert.AreEqual(expected, ReleaseInfo.Stamp.NormaliseChannel(given));
        }

        [Test]
        public void ReleaseChannelHasAPlainWindowTitle()
        {
            ReleaseInfo.Stamp stamp = ReleaseInfo.Stamp.Parse("{\"version\":\"1.0.0+abc\",\"channel\":\"release\"}", null);
            Assert.AreEqual("1.0.0", stamp.Label);
            Assert.AreEqual("Ringside Booker", stamp.WindowTitle);
            Assert.IsNull(stamp.PreReleaseNumber);
        }

        [Test]
        public void OverrideReplacesTheStaticStamp()
        {
            try
            {
                ReleaseInfo.Override(ReleaseInfo.Stamp.Parse(AlphaJson, null));
                Assert.IsTrue(ReleaseInfo.IsAlpha);
                Assert.AreEqual("alpha", ReleaseInfo.Channel);
                Assert.AreEqual("1a2b3c4d5e6f7a8b9c0d", ReleaseInfo.Commit);
                Assert.AreEqual("0.1.0-alpha.3+1a2b3c4d", ReleaseInfo.Version);
            }
            finally
            {
                ReleaseInfo.Override(null);
            }
        }

        // ---- ReleaseNotes --------------------------------------------------------------------------

        [Test]
        public void ParsesReleasesSectionsAndWrappedItems()
        {
            var releases = ReleaseNotes.Parse(Changelog);
            Assert.AreEqual(3, releases.Count);
            Assert.IsTrue(releases[0].IsUnreleased);
            Assert.AreEqual("I fixed the thing that wrapped.", releases[0].Sections.Single().Items.Single());
            Assert.AreEqual("0.1.0-alpha.2", releases[1].Version);
            Assert.AreEqual("2026-11-20", releases[1].Date);
            // Shown in the fixed order Added, Changed, Fixed, Balance, Heads up.
            CollectionAssert.AreEqual(new[] { "Added", "Balance", "Heads up" }, releases[1].Sections.Select(section => section.Title).ToArray());
            Assert.IsTrue(releases[1].Sections.Last().IsHeadsUp);
            Assert.AreEqual(2, releases[1].Sections[0].Items.Count);
        }

        [Test]
        public void TheTaggedBuildShowsItsOwnReleaseOnly()
        {
            ReleaseNotes.Notes notes = ReleaseNotes.For(ReleaseNotes.Parse(Changelog), "0.1.0-alpha.2");
            Assert.AreEqual("0.1.0-alpha.2", notes.Current.Version);
            Assert.IsNull(notes.SinceRelease);
            Assert.IsTrue(notes.HasContent);
        }

        [Test]
        public void ABuildAfterTheReleaseAddsTheUnreleasedItems()
        {
            ReleaseNotes.Notes notes = ReleaseNotes.For(ReleaseNotes.Parse(Changelog), "0.1.0-alpha.3");
            Assert.AreEqual("0.1.0-alpha.2", notes.Current.Version);
            Assert.IsNotNull(notes.SinceRelease);
            Assert.IsTrue(notes.SinceRelease.IsUnreleased);
        }

        [Test]
        public void NoChangelogMeansNoContent()
        {
            Assert.IsFalse(ReleaseNotes.For(ReleaseNotes.Parse(null), "0.1.0-alpha.1").HasContent);
            Assert.IsFalse(ReleaseNotes.For(ReleaseNotes.Parse("## Unreleased\n"), "0.1.0-alpha.1").HasContent);
        }

        [Test]
        public void TheRepoChangelogParses()
        {
            ReleaseNotes.Override(null);
            var releases = ReleaseNotes.Load();
            Assert.IsNotEmpty(releases, "CHANGELOG.md at the repo root");
            Assert.IsTrue(releases.Any(release => !release.IsEmpty));
            string[] known = ReleaseNotes.SectionOrder;
            foreach (ReleaseNotes.Release release in releases)
            {
                foreach (ReleaseNotes.Section section in release.Sections) CollectionAssert.Contains(known, section.Title);
            }
        }

        // ---- What's new: once per version ----------------------------------------------------------

        [Test]
        public void FirstRunEverRecordsAndStaysClosed()
        {
            Assert.AreEqual(WhatsNewState.Decision.Record, WhatsNewState.Decide(true, "", "0.1.0-alpha.1", true));
            Assert.AreEqual(WhatsNewState.Decision.Record, WhatsNewState.Decide(true, null, "0.1.0-alpha.1", true));
        }

        [Test]
        public void ANewVersionWithNotesOpensOnce()
        {
            Assert.AreEqual(WhatsNewState.Decision.Open, WhatsNewState.Decide(true, "0.1.0-alpha.1", "0.1.0-alpha.2", true));
            // After it recorded alpha.2, the same version stays closed.
            Assert.AreEqual(WhatsNewState.Decision.Stay, WhatsNewState.Decide(true, "0.1.0-alpha.2", "0.1.0-alpha.2", true));
        }

        [Test]
        public void ANewVersionWithoutNotesOnlyRecords()
        {
            Assert.AreEqual(WhatsNewState.Decision.Record, WhatsNewState.Decide(true, "0.1.0-alpha.1", "0.1.0-alpha.2", false));
        }

        [Test]
        public void AFailedReadNeverOpens()
        {
            Assert.AreEqual(WhatsNewState.Decision.Stay, WhatsNewState.Decide(false, "", "0.1.0-alpha.2", true));
            Assert.AreEqual(WhatsNewState.Decision.Stay, WhatsNewState.Decide(false, "0.1.0-alpha.1", "0.1.0-alpha.2", true));
        }

        // ---- Screens -------------------------------------------------------------------------------

        [Test]
        public void TheSheetShowsSinceReleaseThenSectionsWithHeadsUpWarned()
        {
            ReleaseInfo.Stamp stamp = ReleaseInfo.Stamp.Parse(AlphaJson, null);
            VisualElement body = WhatsNewSheet.Build(ReleaseNotes.For(ReleaseNotes.Parse(Changelog), "0.1.0-alpha.3"), stamp);
            Assert.AreEqual("Version 0.1.0-alpha.3 · build 1a2b3c4d · 20 Nov 2026", body.Q<Label>("whats-new-build").text);
            Assert.IsNotNull(body.Q("whats-new-since"));
            Assert.IsNotNull(body.Q("whats-new-release"));
            Assert.AreEqual(1, body.Query(className: "wn-group--heads-up").ToList().Count);
            Assert.IsNull(body.Q("whats-new-empty"));
        }

        [Test]
        public void TheSheetHasAnEmptyState()
        {
            VisualElement body = WhatsNewSheet.Build(new ReleaseNotes.Notes(), ReleaseInfo.Stamp.Local("0.1.0-alpha.1"));
            Assert.IsNotNull(body.Q("whats-new-empty"));
            Assert.AreEqual("Version 0.1.0-alpha.1", body.Q<Label>("whats-new-build").text);
        }

        [Test]
        public void TheBadgeShowsForAlphaAndBetaOnly()
        {
            Assert.AreEqual("ALPHA", ChannelBadge.Create(ReleaseInfo.Stamp.Parse(AlphaJson, null)).text);
            Assert.AreEqual("BETA", ChannelBadge.Create(ReleaseInfo.Stamp.Parse("{\"version\":\"0.2.0-beta.1\",\"channel\":\"beta\"}", null)).text);
            Assert.IsNull(ChannelBadge.Create(ReleaseInfo.Stamp.Parse("{\"version\":\"1.0.0\",\"channel\":\"release\"}", null)));
            Assert.IsNull(ChannelBadge.Create(ReleaseInfo.Stamp.Local("0.1.0-alpha.1")));
        }

        [Test]
        public void AboutListsVersionBuildBuiltAndChannel()
        {
            var facts = SettingsScreen.AboutFacts(ReleaseInfo.Stamp.Parse(AlphaJson, null));
            CollectionAssert.AreEqual(new[] { "Version", "Build", "Built", "Channel" }, facts.Select(fact => fact.key).ToArray());
            CollectionAssert.AreEqual(new[] { "0.1.0-alpha.3", "1a2b3c4d", "20 Nov 2026", "Alpha" }, facts.Select(fact => fact.value).ToArray());
            var local = SettingsScreen.AboutFacts(ReleaseInfo.Stamp.Local("0.1.0-alpha.1"));
            CollectionAssert.AreEqual(new[] { "Version", "Channel" }, local.Select(fact => fact.key).ToArray());
        }

        [Test]
        public void TheTitleLineShowsLabelCommitAndALink()
        {
            Assert.AreEqual("Alpha 0.1.0 (3) · 1a2b3c4d · What's new", TitleController.TitleVersionLine(ReleaseInfo.Stamp.Parse(AlphaJson, null)));
            Assert.AreEqual("0.1.0-alpha.1 (this computer) · What's new", TitleController.TitleVersionLine(ReleaseInfo.Stamp.Local("0.1.0-alpha.1")));
        }
    }
}
