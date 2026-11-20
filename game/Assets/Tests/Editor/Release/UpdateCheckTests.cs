using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RingsideBooker.Release;
using RingsideBooker.Release.Updates;
using RingsideBooker.UI.Updates;
using UnityEngine;

namespace RingsideBooker.Tests.Release
{
    /// <summary>
    /// The update check's rules (POL9-11): semver ordering, channel filtering, drafts, the installer
    /// asset, the size check and the once-a-day schedule. Fixed JSON fixtures; no network.
    /// </summary>
    public sealed class UpdateCheckTests
    {
        private static string Fixture(string name) =>
            File.ReadAllText(Path.Combine(Application.dataPath, "Tests", "Editor", "Release", "Fixtures", name));

        private static int Compare(string left, string right) => SemVersion.Parse(left).CompareTo(SemVersion.Parse(right));

        [TestCase("0.1.0-alpha.2", "0.1.0-alpha.1")]
        [TestCase("0.1.0-alpha.10", "0.1.0-alpha.9")]
        [TestCase("0.1.0-beta.1", "0.1.0-alpha.9")]
        [TestCase("0.1.0", "0.1.0-beta.3")]
        [TestCase("0.1.1-alpha.1", "0.1.0")]
        [TestCase("0.2.0-alpha.1", "0.1.9")]
        [TestCase("1.0.0", "0.99.99")]
        [TestCase("0.1.0-alpha.1.1", "0.1.0-alpha.1")]
        [TestCase("0.1.0-alpha.beta", "0.1.0-alpha.1")]
        public void SemVerOrdersPreReleases(string newer, string older)
        {
            Assert.That(Compare(newer, older), Is.GreaterThan(0), $"{newer} > {older}");
            Assert.That(Compare(older, newer), Is.LessThan(0), $"{older} < {newer}");
        }

        [Test]
        public void SemVerIgnoresTheTagPrefixAndBuildMetadata()
        {
            Assert.That(Compare("v0.1.0-alpha.2", "0.1.0-alpha.2+1a2b3c4d"), Is.EqualTo(0));
            Assert.That(SemVersion.Parse("V0.1.0-alpha.2+abc").ToString(), Is.EqualTo("0.1.0-alpha.2"));
            Assert.That(SemVersion.Parse("0.1.0-alpha.2").PreLabel, Is.EqualTo("alpha"));
        }

        [TestCase("")]
        [TestCase(null)]
        [TestCase("nightly")]
        [TestCase("0.1")]
        [TestCase("0.1.0-")]
        [TestCase("0.1.0-alpha..1")]
        [TestCase("0.1.x")]
        public void SemVerRejectsNonVersions(string text)
        {
            Assert.That(SemVersion.TryParse(text, out _), Is.False);
        }

        [Test]
        public void ParsesTheReleasesApi()
        {
            List<ReleaseEntry> releases = UpdateFeed.Parse(Fixture("releases-alpha.json"));
            Assert.That(releases.Count, Is.EqualTo(4));
            ReleaseEntry alpha2 = releases.Single(r => r.Tag == "v0.1.0-alpha.2");
            Assert.That(alpha2.Version.ToString(), Is.EqualTo("0.1.0-alpha.2"));
            Assert.That(alpha2.Channel, Is.EqualTo(ReleaseInfo.ChannelAlpha));
            Assert.That(alpha2.Assets.Count, Is.EqualTo(2));
            Assert.That(alpha2.Installer.Name, Is.EqualTo("RingsideBooker-Setup-0.1.0-alpha.2+1a2b3c4d.exe"));
            Assert.That(alpha2.Installer.Size, Is.EqualTo(40255784));
            Assert.That(alpha2.PublishedDay, Is.EqualTo("26 Nov 2026"));
            Assert.That(releases.Single(r => r.Tag == "nightly").Version, Is.Null);
            Assert.That(releases.Single(r => r.Tag == "v0.1.0-alpha.9").Draft, Is.True);
        }

        [TestCase("not json")]
        [TestCase("{\"message\": \"API rate limit exceeded\"}")]
        [TestCase("")]
        [TestCase(null)]
        public void BrokenAnswersGiveNoReleases(string json)
        {
            Assert.That(UpdateFeed.Parse(json), Is.Empty);
            Assert.That(UpdateFeed.Newest(UpdateFeed.Parse(json), "0.1.0-alpha.1", ReleaseInfo.ChannelAlpha), Is.Null);
        }

        [Test]
        public void AlphaBuildGetsTheNewestPublishedAlphaAndNeverADraft()
        {
            List<ReleaseEntry> releases = UpdateFeed.Parse(Fixture("releases-alpha.json"));
            ReleaseEntry offer = UpdateFeed.Newest(releases, "0.1.0-alpha.1+fe25d981", ReleaseInfo.ChannelAlpha);
            Assert.That(offer, Is.Not.Null);
            Assert.That(offer.Version.ToString(), Is.EqualTo("0.1.0-alpha.2"), "the alpha.9 draft is skipped");

            Assert.That(UpdateFeed.Newest(releases, "0.1.0-alpha.2+1a2b3c4d", ReleaseInfo.ChannelAlpha), Is.Null, "same version");
            Assert.That(UpdateFeed.Newest(releases, "0.1.0-alpha.3", ReleaseInfo.ChannelAlpha), Is.Null, "newer than every published one");
        }

        [Test]
        public void ChannelsFilterReleases()
        {
            List<ReleaseEntry> releases = UpdateFeed.Parse(Fixture("releases-channels.json"));
            Assert.That(UpdateFeed.Newest(releases, "0.1.0-alpha.3", ReleaseInfo.ChannelAlpha).Tag, Is.EqualTo("v0.2.0-alpha.1"));
            Assert.That(UpdateFeed.Newest(releases, "0.1.0-beta.1", ReleaseInfo.ChannelBeta).Tag, Is.EqualTo("v0.1.0"), "a beta build skips alphas");
            Assert.That(UpdateFeed.Newest(releases, "0.0.9", ReleaseInfo.ChannelRelease).Tag, Is.EqualTo("v0.1.0"), "a release build takes only releases");
            Assert.That(UpdateFeed.Newest(releases, "0.1.0", ReleaseInfo.ChannelRelease), Is.Null, "0.2.0-alpha.1 is not for a release build; 0.3.0 is a draft");
            Assert.That(UpdateFeed.Newest(releases, "0.1.0-alpha.3", ReleaseInfo.ChannelLocal).Tag, Is.EqualTo("v0.2.0-alpha.1"), "local is treated like alpha");
        }

        [Test]
        public void ChannelComesFromTheVersion()
        {
            Assert.That(UpdateFeed.ChannelOf(SemVersion.Parse("0.1.0-alpha.1"), true), Is.EqualTo(ReleaseInfo.ChannelAlpha));
            Assert.That(UpdateFeed.ChannelOf(SemVersion.Parse("0.1.0-beta.1"), true), Is.EqualTo(ReleaseInfo.ChannelBeta));
            Assert.That(UpdateFeed.ChannelOf(SemVersion.Parse("0.1.0-rc.1"), false), Is.EqualTo(ReleaseInfo.ChannelBeta));
            Assert.That(UpdateFeed.ChannelOf(SemVersion.Parse("0.1.0"), true), Is.EqualTo(ReleaseInfo.ChannelBeta), "GitHub's prerelease flag on a plain version");
            Assert.That(UpdateFeed.ChannelOf(SemVersion.Parse("0.1.0"), false), Is.EqualTo(ReleaseInfo.ChannelRelease));
        }

        [Test]
        public void InstallerAssetNameMustMatch()
        {
            Assert.That(UpdateFeed.IsInstallerName("RingsideBooker-Setup-0.1.0-alpha.2+1a2b3c4d.exe"), Is.True);
            Assert.That(UpdateFeed.IsInstallerName("RingsideBooker-0.1.0-alpha.2-win64.zip"), Is.False);
            Assert.That(UpdateFeed.IsInstallerName("RingsideBooker-Setup-0.1.0.zip"), Is.False);
            Assert.That(UpdateFeed.IsInstallerName("..\\RingsideBooker-Setup-x.exe"), Is.False);
            Assert.That(UpdateFeed.IsInstallerName(null), Is.False);
        }

        [Test]
        public void CacheRoundTrips()
        {
            ReleaseEntry offer = UpdateFeed.Newest(UpdateFeed.Parse(Fixture("releases-alpha.json")), "0.1.0-alpha.1", ReleaseInfo.ChannelAlpha);
            ReleaseEntry back = UpdateFeed.Parse(UpdateFeed.ToJson(offer)).Single();
            Assert.That(back.Version.ToString(), Is.EqualTo("0.1.0-alpha.2"));
            Assert.That(back.Installer.Size, Is.EqualTo(40255784));
            Assert.That(back.Body, Is.EqualTo(offer.Body));
            Assert.That(back.HtmlUrl, Is.EqualTo(offer.HtmlUrl));
        }

        [Test]
        public void SizeCheck()
        {
            Assert.That(UpdateFeed.CheckSize(40255784, 40255784), Is.Null);
            Assert.That(UpdateFeed.CheckSize(1000, 40255784), Is.Not.Null);
            Assert.That(UpdateFeed.CheckSize(40255785, 40255784), Is.Not.Null);
            Assert.That(UpdateFeed.CheckSize(0, 0), Is.Not.Null, "an unknown size can't be checked");
            Assert.That(UpdateFeed.CheckSize(-1, 10), Is.Not.Null, "missing file");
        }

        [Test]
        public void ChecksAtMostOnceADay()
        {
            var now = new DateTime(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);
            Assert.That(UpdateSchedule.ShouldCheck(true, null, now), Is.True, "never checked");
            Assert.That(UpdateSchedule.ShouldCheck(true, now.AddHours(-23), now), Is.False);
            Assert.That(UpdateSchedule.ShouldCheck(true, now.AddHours(-24), now), Is.True);
            Assert.That(UpdateSchedule.ShouldCheck(true, now.AddDays(2), now), Is.True, "clock moved back");
            Assert.That(UpdateSchedule.ShouldCheck(false, null, now), Is.False, "setting off");
        }

        [Test]
        public void UserAgentIsGeneric()
        {
            Assert.That(UpdateFeed.UserAgent("0.1.0-alpha.1"), Is.EqualTo("RingsideBooker/0.1.0-alpha.1"));
            Assert.That(UpdateFeed.UserAgent(""), Is.EqualTo("RingsideBooker/dev"));
            StringAssert.DoesNotContain("token", UpdateFeed.ApiUrl);
            StringAssert.Contains("/releases?per_page=10", UpdateFeed.ApiUrl);
            StringAssert.DoesNotContain("/releases/latest", UpdateFeed.ApiUrl);
        }

        [Test]
        public void StatusLineInPlainWords()
        {
            ReleaseEntry offer = UpdateFeed.Parse(Fixture("releases-alpha.json")).Single(r => r.Tag == "v0.1.0-alpha.2");
            Assert.That(UpdateUi.StatusText(UpdateStatus.Available, offer, null), Is.EqualTo("Version 0.1.0-alpha.2 is out."));
            StringAssert.Contains("skipped", UpdateUi.StatusText(UpdateStatus.Available, offer, null, skipped: true));
            Assert.That(UpdateUi.StatusText(UpdateStatus.UpToDate, null, null), Is.EqualTo("You have the newest version."));
            StringAssert.StartsWith("Couldn't check", UpdateUi.StatusText(UpdateStatus.Failed, null, null));
            Assert.That(UpdateUi.StatusText(UpdateStatus.Idle, null, null), Is.Empty);
            Assert.That(UpdateUi.ChipText(offer), Is.EqualTo("Update available: v0.1.0-alpha.2"));
        }

        [Test]
        public void ReleaseNotesBecomeGroups()
        {
            ReleaseEntry offer = UpdateFeed.Parse(Fixture("releases-alpha.json")).Single(r => r.Tag == "v0.1.0-alpha.2");
            List<(string heading, List<string> items)> notes = UpdateSheet.NotesFrom(offer.Body);
            Assert.That(notes.Select(n => n.heading), Is.EqualTo(new[] { "Added", "Fixed" }));
            Assert.That(notes[0].items, Is.EqualTo(new[] { "I added an update check.", "I added Skip this version." }));
            Assert.That(notes[1].items, Is.EqualTo(new[] { "I fixed long names." }));
            Assert.That(UpdateSheet.NotesFrom(""), Is.Empty);
        }
    }
}
