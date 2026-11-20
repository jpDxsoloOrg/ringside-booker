using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Newtonsoft.Json;
using NUnit.Framework;
using RingsideBooker.Diagnostics;
using RingsideBooker.Engine;
using RingsideBooker.Saves;
using RingsideBooker.UI.Crash;

namespace RingsideBooker.Tests.Crash
{
    /// <summary>UNITY-24 / POL1-02 / POL9-10: the load notice, crash screen words, bug report zip, feedback draft and safe start rules.</summary>
    public sealed class CrashTests
    {
        private string folder;

        [SetUp]
        public void MakeFolder()
        {
            folder = Path.Combine(Path.GetTempPath(), "rb-crash-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
        }

        [TearDown]
        public void DeleteFolder()
        {
            if (Directory.Exists(folder)) Directory.Delete(folder, true);
        }

        // ---- Load notice ----------------------------------------------------------------------------

        [Test]
        public void LoadResultReadsTheEnginesMigrationObjects()
        {
            // The engine sends migrations as {from, to, title}; a string list used to throw here.
            const string json = @"{""ok"":true,""revision"":3,""summary"":{""label"":""Career"",""gameDate"":""2026-03-01"",
                ""migrationsApplied"":[{""from"":4,""to"":5,""title"":""Adds venue capacity""},{""from"":5,""to"":6,""title"":""Moves bonuses""}]},
                ""warnings"":[{""path"":""tunables.match.injuryRate"",""message"":""no longer exists""},{""path"":"""",""message"":""Old setting left out""}]}";
            var load = JsonConvert.DeserializeObject<LoadResult>(json, EngineClient.JsonSettings);

            LoadNotice notice = LoadNotice.From(load);
            Assert.IsNotNull(notice);
            CollectionAssert.AreEqual(new[] { "Adds venue capacity", "Moves bonuses" }, notice.Upgrades);
            Assert.AreEqual("This save was upgraded to work with this version.", notice.Headline);
            CollectionAssert.AreEqual(new[]
            {
                "Upgraded this save: Adds venue capacity, Moves bonuses.",
                "The save loaded with these changes:",
                "• tunables.match.injuryRate: no longer exists",
                "• Old setting left out",
            }, notice.DetailLines);
        }

        [Test]
        public void LoadNoticeWithOnlyChangesSaysSo()
        {
            var notice = new LoadNotice(null, new[] { "x: y" });
            Assert.AreEqual("This save loaded with a few changes.", notice.Headline);
            CollectionAssert.AreEqual(new[] { "The save loaded with these changes:", "• x: y" }, notice.DetailLines);
        }

        [Test]
        public void NoNoticeForACleanOrFailedLoad()
        {
            Assert.IsNull(LoadNotice.From(new LoadResult { Ok = true, Summary = new LoadSummary() }));
            Assert.IsNull(LoadNotice.From(new LoadResult { Ok = false, Warnings = new List<SaveIssue> { new SaveIssue { Message = "m" } } }));
            Assert.IsNull(LoadNotice.From(null));
        }

        [Test]
        public void ANewLoadReplacesTheNoticeAndDismissClearsIt()
        {
            int changes = 0;
            void Count() => changes++;
            LoadNotice.Changed += Count;
            try
            {
                LoadNotice.Show(new LoadNotice(new[] { "A" }, null));
                Assert.AreEqual("A", LoadNotice.Pending.Upgrades[0]);
                LoadNotice.ShowFor(new LoadResult { Ok = true, Summary = new LoadSummary() });
                Assert.IsNull(LoadNotice.Pending, "a clean load clears the old notice");
                LoadNotice.Show(new LoadNotice(new[] { "B" }, null));
                LoadNotice.Dismiss();
                Assert.IsNull(LoadNotice.Pending);
                Assert.AreEqual(4, changes);
            }
            finally
            {
                LoadNotice.Changed -= Count;
                LoadNotice.Dismiss();
            }
        }

        // ---- Engine-stopped words --------------------------------------------------------------------

        [Test]
        public void StoppedScreenWords()
        {
            var fault = new EngineFault("advanceDays", new JsEngineException("bad day"), new DateTimeOffset(2026, 11, 19, 14, 30, 0, TimeSpan.Zero));
            var start = new EngineFault("start", new FileNotFoundException("engine.js missing"), DateTimeOffset.UtcNow, atStart: true);
            Assert.AreEqual("The simulation stopped", EngineStoppedText.Title(fault));
            Assert.AreEqual("The simulation could not start", EngineStoppedText.Title(start));
            StringAssert.Contains("Your last save is safe", EngineStoppedText.Body(fault, true));
            StringAssert.Contains("hadn't been saved yet", EngineStoppedText.Body(fault, false));
            StringAssert.Contains("didn't start", EngineStoppedText.Body(start, true));

            string report = EngineStoppedText.Report(fault, "0.1.0-alpha.1+abc");
            StringAssert.StartsWith("Ringside Booker 0.1.0-alpha.1+abc: the simulation stopped", report);
            StringAssert.Contains("Call: advanceDays", report);
            StringAssert.Contains("Error: bad day", report);
            StringAssert.Contains("At: 2026-11-19 14:30:00 UTC", report);
        }

        [Test]
        public void LastSaveLine()
        {
            var slot = new SaveSlotInfo { SlotId = "career-1", Label = "Altura career", GameDate = "2026-03-14", SavedAt = DateTimeOffset.Now };
            string line = EngineStoppedText.LastSave(slot);
            StringAssert.StartsWith("Last save: Altura career · game date 2026-03-14 · saved ", line);
            Assert.IsNull(EngineStoppedText.LastSave(null));
        }

        // ---- Bug report zip --------------------------------------------------------------------------

        [Test]
        public void ZipHoldsTextAndFilesAndNotesMissingOnes()
        {
            string log = Path.Combine(folder, "Player.log");
            File.WriteAllText(log, "log line");
            string zip = Path.Combine(folder, "out", BugReport.FileName(new DateTime(2026, 11, 19, 14, 32, 5)));
            // The log is still open for writing, as Player.log is while the game runs.
            using (new FileStream(log, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
            {
                BugReport.WriteZip(zip, new[]
                {
                    BugReportEntry.FromText("report.txt", "hello"),
                    BugReportEntry.FromFile("Player.log", log),
                    BugReportEntry.FromFile("save/gone.rbsave", Path.Combine(folder, "gone.rbsave")),
                });
            }

            Assert.AreEqual("ringside-bug-report-2026-11-19-1432-05.zip", Path.GetFileName(zip));
            Assert.IsFalse(File.Exists(zip + ".part"));
            using (var archive = new ZipArchive(File.OpenRead(zip), ZipArchiveMode.Read))
            {
                CollectionAssert.AreEquivalent(new[] { "report.txt", "Player.log", "save/gone.rbsave.missing.txt" }, archive.Entries.Select(entry => entry.FullName));
                Assert.AreEqual("log line", Read(archive, "Player.log"));
                Assert.AreEqual("hello", Read(archive, "report.txt"));
                StringAssert.Contains("Could not add gone.rbsave", Read(archive, "save/gone.rbsave.missing.txt"));
            }
        }

        [Test]
        public void SummarySaysWhatHappenedAndWhatTheZipHolds()
        {
            var facts = new BugReportFacts
            {
                Version = "0.1.0-alpha.2+1234abcd",
                Channel = "alpha",
                ChannelName = "Alpha",
                Commit = "1234abcd",
                MadeAt = new DateTimeOffset(2026, 11, 19, 10, 0, 0, TimeSpan.Zero),
                Fault = new EngineFault("query sim.status", new JsEngineException("kaput"), DateTimeOffset.UtcNow),
                SlotId = "career-1",
                SlotLabel = "Altura career",
                GameDate = "2026-03-14",
            };
            string text = BugReport.Summary(facts);
            StringAssert.StartsWith("Ringside Booker bug report (Alpha 0.1.0-alpha.2+1234abcd)", text);
            StringAssert.Contains("commit 1234abcd", text);
            StringAssert.Contains("What happened: the simulation stopped.", text);
            StringAssert.Contains("Error: kaput", text);
            StringAssert.Contains("Save: Altura career (career-1), game date 2026-03-14", text);
            StringAssert.Contains("- save/: the current save", text);

            facts.Fault = null;
            facts.SlotId = null;
            text = BugReport.Summary(facts);
            StringAssert.Contains("no engine error this session", text);
            StringAssert.Contains("Save: none", text);
            StringAssert.DoesNotContain("Error details", text);
        }

        [Test]
        public void PruneKeepsTheNewestReports()
        {
            for (int i = 0; i < 5; i++)
            {
                string path = Path.Combine(folder, $"ringside-bug-report-2026-11-19-100{i}-00.zip");
                File.WriteAllText(path, "x");
                File.SetLastWriteTimeUtc(path, new DateTime(2026, 11, 19, 10, i, 0, DateTimeKind.Utc));
            }

            File.WriteAllText(Path.Combine(folder, "other.zip"), "keep");
            BugReport.Prune(folder, 2);
            CollectionAssert.AreEquivalent(
                new[] { "ringside-bug-report-2026-11-19-1003-00.zip", "ringside-bug-report-2026-11-19-1004-00.zip", "other.zip" },
                Directory.GetFiles(folder).Select(Path.GetFileName));
        }

        [Test]
        public void ChannelNames()
        {
            Assert.AreEqual("Alpha", BugReport.ChannelName("alpha"));
            Assert.AreEqual("Beta", BugReport.ChannelName("BETA"));
            Assert.AreEqual(string.Empty, BugReport.ChannelName("release"));
            Assert.AreEqual(string.Empty, BugReport.ChannelName(null));
            Assert.AreEqual("dev build", BugReport.ChannelName("local"));
        }

        // ---- Send feedback -------------------------------------------------------------------------

        [Test]
        public void FeedbackSubjectAndBody()
        {
            Assert.AreEqual("Ringside Booker Alpha 0.1.0-alpha.3 feedback", Feedback.Subject("0.1.0-alpha.3", "alpha"));
            Assert.AreEqual("Ringside Booker 1.0.0 feedback", Feedback.Subject("1.0.0", "release"));
            string body = Feedback.Body("0.1.0-alpha.3", @"C:\Reports\r.zip");
            StringAssert.Contains("Version: 0.1.0-alpha.3", body);
            StringAssert.Contains("What happened:", body);
            StringAssert.Contains("What I expected:", body);
            StringAssert.Contains("Steps to make it happen again:", body);
            StringAssert.Contains(@"C:\Reports\r.zip", body);
            StringAssert.DoesNotContain("attach", Feedback.Body("v", null));
        }

        [Test]
        public void MailtoUrlEncodesSubjectAndBody()
        {
            string url = MailtoFeedback.Url("feedback@example.invalid", "Ringside Booker Alpha 0.1 feedback", "Line one\nC:\\a b\\r.zip & more");
            Assert.AreEqual(
                "mailto:feedback@example.invalid?subject=Ringside%20Booker%20Alpha%200.1%20feedback&body=Line%20one%0D%0AC%3A%5Ca%20b%5Cr.zip%20%26%20more",
                url);
        }

        [Test]
        public void TheAddressIsThePlaceholder()
        {
            Assert.AreEqual("feedback@example.invalid", FeedbackConfig.Address);
            Assert.IsTrue(FeedbackConfig.IsPlaceholder);
        }

        [Test]
        public void MailtoChannelOpensTheDraftAndReportsAFailureInWords()
        {
            Action<string> original = MailtoFeedback.Opener;
            string opened = null;
            try
            {
                MailtoFeedback.Opener = url => opened = url;
                var draft = new FeedbackDraft { Address = "a@example.invalid", Subject = "S", Body = "B", ZipPath = "z.zip" };
                FeedbackResult sent = new MailtoFeedback().Send(draft);
                Assert.IsTrue(sent.Ok);
                Assert.AreEqual("z.zip", sent.ZipPath);
                Assert.AreEqual("mailto:a@example.invalid?subject=S&body=B", opened);

                MailtoFeedback.Opener = _ => throw new InvalidOperationException("no mail app");
                FeedbackResult failed = new MailtoFeedback().Send(draft);
                Assert.IsFalse(failed.Ok);
                Assert.AreEqual("z.zip", failed.ZipPath, "the file is still there to attach");
                StringAssert.Contains("a@example.invalid", failed.Problem);
            }
            finally
            {
                MailtoFeedback.Opener = original;
            }
        }

        // ---- Safe start ------------------------------------------------------------------------------

        [Test]
        public void CrashStreakRules()
        {
            Assert.AreEqual(0, CrashStreak.AfterStart(0, false));
            Assert.AreEqual(1, CrashStreak.AfterStart(0, true), "a run that ended inside a game counts");
            Assert.AreEqual(2, CrashStreak.AfterFault(1));
            Assert.IsFalse(CrashStreak.OfferSafeStart(1));
            Assert.IsTrue(CrashStreak.OfferSafeStart(2));
        }

        [Test]
        public void SafeStartWords()
        {
            Assert.AreEqual("Ringside Booker stopped twice in a row, so nothing has been loaded this time. Pick how to carry on.", SafeStartText.Lead(2, false));
            StringAssert.Contains("3 times", SafeStartText.Lead(3, false));
            Assert.AreEqual("Nothing has been loaded. Pick how to carry on.", SafeStartText.Lead(5, true));
        }

        private static string Read(ZipArchive archive, string name)
        {
            using (var reader = new StreamReader(archive.GetEntry(name).Open()))
            {
                return reader.ReadToEnd();
            }
        }
    }
}
