using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Engine;
using UnityEngine.TestTools;

namespace RingsideBooker.Saves.Tests
{
    /// <summary>
    /// Saves as files (UNITY-05): a new game gets a slot file and a header, an advance autosaves it,
    /// the list reads it (and rebuilds a lost header with inspectSave), loading it gives the same
    /// world hash; and a write that fails half way leaves the old file. Needs the engine bundle in
    /// StreamingAssets (npm run build:engine-bundle).
    /// </summary>
    public sealed class SaveStoreTests
    {
        private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(120);

        private string directory;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Path.GetTempPath(), "rb-saves-test-" + Guid.NewGuid().ToString("N"));
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator SaveListAndLoadKeepTheWorldHash()
        {
            var store = new SaveStore(directory);
            var client = new EngineClient();
            try
            {
                yield return Await(client.Ready);

                JObject options = DesktopSaveSettings.DefaultWorldGame("Saves test", "unity-05-saves");
                options["player"]["starterKit"] = false;
                Assert.AreEqual(DesktopSaveSettings.HistoryKeepDetailDays, options["tunableOverrides"].Value<int>(DesktopSaveSettings.HistoryKeepDetailDaysKey));
                var created = client.NewGame(options);
                yield return Await(created);
                Assert.IsTrue(created.Result.Ok, created.Result.ReasonText);

                var begun = GameSession.BeginNewAsync(client, "Saves test", created.Result.Revision, created.Result.Seat, store);
                yield return Await(begun);
                GameSession session = begun.Result;
                Assert.AreSame(session, GameSession.Current);
                string slotId = session.SlotId;
                Assert.IsTrue(File.Exists(store.SavePath(slotId)), "the slot file is written");
                Assert.IsTrue(File.Exists(store.HeaderPath(slotId)), "the slot header is written");
                Assert.AreEqual(0x1f, File.ReadAllBytes(store.SavePath(slotId))[0], "the engine's gzipped save as it is");
                string firstDate = session.LastSaved.GameDate;

                // An advance autosaves (debounced) without being asked.
                for (int attempt = 0; ; attempt++)
                {
                    Assert.Less(attempt, 5, "the game would not advance");
                    var advance = client.AdvanceDays(AdvanceOptions.Days(2));
                    yield return Await(advance);
                    Assert.IsTrue(advance.Result.Ok, advance.Result.ReasonText);
                    if (advance.Result.DaysAdvanced > 0) break;
                    Assert.IsTrue(advance.Result.GateHits.All(hit => hit.GateId == GateIds.NewsAlert), "unexpected gate");
                    var ack = client.Command(EngineCommands.AckNewsAlerts);
                    yield return Await(ack);
                }

                var clockQuery = client.Query<ClockView>(EngineQueries.Clock);
                yield return Await(clockQuery);
                string gameDate = clockQuery.Result.Data.Date;
                Assert.AreNotEqual(firstDate, gameDate);
                var clock = Stopwatch.StartNew();
                while (session.LastSaved.GameDate != gameDate || session.HasUnsavedChanges)
                {
                    Assert.Less(clock.Elapsed.TotalSeconds, 30, "the autosave did not run after the advance");
                    yield return null;
                }

                var hashBefore = client.WorldHash();
                yield return Await(hashBefore);
                Assert.IsTrue(hashBefore.Result.Ok, hashBefore.Result.ReasonText);

                yield return Await(session.EndAsync());
                Assert.IsNull(GameSession.Current);

                var listed = store.List();
                Assert.AreEqual(1, listed.Count);
                SaveSlotInfo slot = listed[0];
                Assert.AreEqual(slotId, slot.SlotId);
                Assert.AreEqual("Saves test", slot.Label);
                Assert.AreEqual("Golden State Wrestling", slot.PromotionName);
                Assert.AreEqual(gameDate, slot.GameDate);
                Assert.AreEqual(client.Ready.Result.EngineVersion, slot.EngineVersion);
                Assert.AreEqual(client.Ready.Result.SchemaFingerprint, slot.SchemaFingerprint);
                Assert.IsFalse(SaveCompat.FromOtherBuild(slot, client.Ready.Result.SchemaFingerprint));
                Assert.AreEqual(new FileInfo(store.SavePath(slotId)).Length, slot.SizeBytes);
                Assert.IsTrue(slot.HasBackup, "the previous save is kept as the backup");

                // A save with no header (copied into the folder by hand) is read with inspectSave.
                File.Delete(store.HeaderPath(slotId));
                Assert.IsTrue(store.List()[0].NeedsInspect);
                var repaired = store.ListAsync(client);
                yield return Await(repaired);
                Assert.IsFalse(repaired.Result[0].NeedsInspect);
                Assert.AreEqual("Golden State Wrestling", repaired.Result[0].PromotionName);
                Assert.AreEqual(gameDate, repaired.Result[0].GameDate);

                var unloaded = client.Unload();
                yield return Await(unloaded);

                var opened = GameSession.OpenSlotAsync(client, repaired.Result[0], store);
                yield return Await(opened);
                Assert.AreEqual(OpenStatus.Opened, opened.Result.Status, opened.Result.Report);

                var hashAfter = client.WorldHash();
                yield return Await(hashAfter);
                Assert.AreEqual(hashBefore.Result.Hash, hashAfter.Result.Hash, "the loaded world is the saved one");

                // Junk is not a save: import refuses it and leaves no slot behind.
                string junk = Path.Combine(directory, "junk.bin");
                File.WriteAllText(junk, "not a save");
                var imported = store.ImportAsync(client, junk);
                yield return Await(imported);
                Assert.IsFalse(imported.Result.Ok);
                Assert.AreEqual(1, store.List().Count);

                yield return Await(GameSession.EndCurrentAsync(alwaysSave: false));
            }
            finally
            {
                GameSession.Current?.EndAsync(alwaysSave: false);
                client.Dispose();
            }
        }

        [Test]
        public void AFailedWriteLeavesTheOldFileAndItsBackup()
        {
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, "slot.rbsave");
            string backup = path + SaveStore.BackupSuffix;
            AtomicFile.WriteAllBytes(path, Encoding.UTF8.GetBytes("first"), backup);
            AtomicFile.WriteAllBytes(path, Encoding.UTF8.GetBytes("second"), backup);
            Assert.AreEqual("second", File.ReadAllText(path));
            Assert.AreEqual("first", File.ReadAllText(backup), "the replaced save becomes the backup");

            Assert.Throws<IOException>(() => AtomicFile.Write(path, stream =>
            {
                byte[] half = Encoding.UTF8.GetBytes("thi");
                stream.Write(half, 0, half.Length);
                throw new IOException("disk full (simulated)");
            }, backup));

            Assert.AreEqual("second", File.ReadAllText(path), "the old save is untouched");
            Assert.AreEqual("first", File.ReadAllText(backup), "the backup is untouched");
            Assert.IsFalse(File.Exists(path + AtomicFile.TempSuffix), "the half-written temp file is removed");
            Assert.AreEqual(new[] { "slot.rbsave", "slot.rbsave.bak" }, Directory.GetFiles(directory).Select(Path.GetFileName).OrderBy(name => name, StringComparer.Ordinal).ToArray());
        }

        [Test]
        public void OlderBuildIsAFailureWhileCheckingTheDataWithAnotherFingerprint()
        {
            const string current = "0123456789abcdef0123456789abcdef";
            Assert.IsTrue(SaveCompat.IsOlderBuild("validate", "ffffffffffffffffffffffffffffffff", current));
            Assert.IsTrue(SaveCompat.IsOlderBuild("integrity", null, current), "no fingerprint counts as different");
            Assert.IsFalse(SaveCompat.IsOlderBuild("build", current, current), "same build: a real bug");
            Assert.IsFalse(SaveCompat.IsOlderBuild("version", null, current), "a newer build keeps its own message");
            Assert.IsFalse(SaveCompat.IsOlderBuild(null, null, current));
        }

        private static IEnumerator Await(Task task)
        {
            var clock = Stopwatch.StartNew();
            while (!task.IsCompleted)
            {
                if (clock.Elapsed > CallTimeout) Assert.Fail($"the call did not finish within {CallTimeout.TotalSeconds} s");
                yield return null;
            }

            if (task.IsFaulted) Assert.Fail("the call faulted: " + task.Exception?.GetBaseException());
            Assert.IsFalse(task.IsCanceled, "the call was cancelled");
        }
    }
}
