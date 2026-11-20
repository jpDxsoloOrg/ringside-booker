using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
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
    /// Sprint 13 saves: rotating backups per slot (UNITY-27), verify before and after writing
    /// (POL1-04), the schema fingerprint on load (POL1-01) and the build's channel and version in
    /// the slot header (POL9-10). The last test needs the engine bundle in StreamingAssets.
    /// </summary>
    public sealed class SaveBackupsTests
    {
        private const string Fingerprint = "0123456789abcdef0123456789abcdef";
        private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(120);

        private string directory;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Path.GetTempPath(), "rb-backups-test-" + Guid.NewGuid().ToString("N"));
            SaveBuild.Set(null, null);
        }

        [TearDown]
        public void TearDown()
        {
            SaveBuild.Set(null, null);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }

        [Test]
        public void EachWriteRotatesTheSaveIntoBackupsAndKeepsTheNewest()
        {
            var store = new SaveStore(directory) { BackupsToKeep = 3 };
            for (int day = 1; day <= 6; day++) Write(store, "slot", day);

            Assert.AreEqual("save-6", Text(store.Read("slot")), "the latest save is the slot's save");
            var backups = store.ListBackups("slot");
            Assert.AreEqual(3, backups.Count, "only the newest three are kept");
            Assert.AreEqual(new[] { "save-5", "save-4", "save-3" }, backups.Select(backup => Text(store.LoadBackup("slot", backup.BackupId))).ToArray(), "newest first");
            Assert.AreEqual(new[] { "2027-01-05", "2027-01-04", "2027-01-03" }, backups.Select(backup => backup.GameDate).ToArray(), "each backup keeps the header it had");
            Assert.IsTrue(backups.All(backup => !backup.NeedsInspect && backup.SizeBytes == 6));
            Assert.AreEqual("save-5", Text(store.Read("slot", backup: true)), "the bool overload reads the newest backup");
            Assert.AreEqual(3, store.Find("slot").BackupCount);
            Assert.AreEqual(1, store.List().Count, "backups are not slots");

            // Fewer backups: the next write prunes to the new number, oldest first.
            store.BackupsToKeep = 1;
            SaveSlotInfo written = Write(store, "slot", 7);
            Assert.AreEqual(1, written.BackupCount);
            Assert.AreEqual("save-6", Text(store.LoadBackup("slot", store.ListBackups("slot")[0].BackupId)));
            Assert.AreEqual(2, Directory.GetFiles(store.BackupFolder("slot")).Length, "one backup and its header");

            store.Delete("slot");
            Assert.IsFalse(Directory.Exists(store.BackupFolder("slot")), "deleting the slot deletes its backups");
            Assert.AreEqual(0, store.List().Count);
        }

        [Test]
        public void TheOldSingleBackupBecomesARotatingBackup()
        {
            var store = new SaveStore(directory) { BackupsToKeep = 5 };
            Directory.CreateDirectory(directory);
            File.WriteAllText(store.SavePath("old"), "current");
            File.WriteAllText(store.LegacyBackupPath("old"), "previous");
            Assert.AreEqual(1, store.Find("old").BackupCount);

            var backups = store.ListBackups("old");
            Assert.AreEqual(1, backups.Count);
            Assert.IsTrue(backups[0].NeedsInspect, "an old .bak has no header");
            Assert.AreEqual("previous", Text(store.LoadBackup("old", backups[0].BackupId)));
            Assert.IsFalse(File.Exists(store.LegacyBackupPath("old")), "moved into the backups folder");
        }

        [Test]
        public void AWriteThatDoesNotReadBackReplacesNothing()
        {
            var store = new SaveStore(directory) { BackupsToKeep = 5 };
            Write(store, "slot", 1);
            Write(store, "slot", 2);
            string path = store.SavePath("slot");
            string newBackup = store.BackupPath("slot", "29991231-235959-999");
            byte[] expected = Encoding.UTF8.GetBytes("save-3");

            // The disk keeps something other than what the game wrote.
            var thrown = Assert.Throws<SaveVerifyException>(() => AtomicFile.Write(path, stream =>
            {
                byte[] other = Encoding.UTF8.GetBytes("save-X");
                stream.Write(other, 0, other.Length);
            }, newBackup, expected));
            StringAssert.Contains("different byte", thrown.Message);

            Assert.AreEqual("save-2", Text(store.Read("slot")), "the save is untouched");
            var backups = store.ListBackups("slot");
            Assert.AreEqual(1, backups.Count, "no backup was rotated");
            Assert.AreEqual("save-1", Text(store.LoadBackup("slot", backups[0].BackupId)));
            Assert.IsFalse(File.Exists(path + AtomicFile.TempSuffix), "the temp file is removed");
            Assert.IsFalse(File.Exists(newBackup));

            // A short write is caught the same way.
            Assert.Throws<SaveVerifyException>(() => AtomicFile.Write(path, stream => stream.WriteByte(1), newBackup, expected));
            Assert.AreEqual("save-2", Text(store.Read("slot")));
        }

        [Test]
        public void VerifyBeforeWritingRefusesBytesThatDoNotCheckOut()
        {
            JObject header = Header("Career", "2027-03-01", Fingerprint);
            byte[] good = Gzip(Document(header));
            Assert.IsNull(SaveVerifier.Check(good, header, Fingerprint));
            Assert.IsNull(SaveVerifier.Check(Encoding.UTF8.GetBytes(Document(header).ToString()), header, Fingerprint), "plain JSON is a save too");

            byte[] truncated = good.Take(good.Length / 2).ToArray();
            Assert.IsNotNull(SaveVerifier.Check(truncated, header, Fingerprint), "a cut-off file");
            Assert.IsNotNull(SaveVerifier.Check(Gzip("{\"format\":\"ringside-booker/save\",\"header\":{"), header, Fingerprint), "JSON that ends early");
            Assert.IsNotNull(SaveVerifier.Check(good, Header("Other", "2027-03-01", Fingerprint), Fingerprint), "another label than the engine reported");
            Assert.IsNotNull(SaveVerifier.Check(good, Header("Career", "2027-03-02", Fingerprint), Fingerprint), "another game date");
            Assert.IsNotNull(SaveVerifier.Check(good, header, "ffffffffffffffffffffffffffffffff"), "not this build's fingerprint");
            JObject wrongFormat = Document(header);
            wrongFormat["format"] = "something-else";
            Assert.IsNotNull(SaveVerifier.Check(Gzip(wrongFormat), header, Fingerprint));
            Assert.IsNotNull(SaveVerifier.Check(Array.Empty<byte>(), header, Fingerprint));
        }

        [Test]
        public void TheSlotHeaderKeepsTheBuildChannelAndVersion()
        {
            var store = new SaveStore(directory) { BackupsToKeep = 5 };
            SaveSlotInfo info = Info("slot", 1);
            info.BuildVersion = "0.1.0-alpha.3+1a2b3c4d";
            info.BuildChannel = "alpha";
            store.Write(info, Encoding.UTF8.GetBytes("save-1"));
            Write(store, "slot", 2);

            SaveSlotInfo listed = store.Find("slot");
            Assert.IsNull(listed.BuildChannel, "the second save came from an unknown build");
            Assert.IsFalse(listed.MadeByAlpha);
            SaveSlotInfo backup = store.ListBackups("slot")[0].Info;
            Assert.AreEqual("0.1.0-alpha.3+1a2b3c4d", backup.BuildVersion, "the backup keeps the build that wrote it");
            Assert.AreEqual("alpha", backup.BuildChannel);
            Assert.IsTrue(backup.MadeByAlpha);

            SaveBuild.Set(" 0.1.0-alpha.4+ffff ", "ALPHA");
            Assert.AreEqual("0.1.0-alpha.4+ffff", SaveBuild.Version);
            Assert.AreEqual("alpha", SaveBuild.Channel);
        }

        /// <summary>
        /// A real game: the save carries this build's fingerprint and the build stamp; a save that
        /// fails to validate without a fingerprint (an older build) opens as OlderBuild, the same
        /// failure with this build's fingerprint is a real problem (Failed); a backup still loads.
        /// </summary>
        [UnityTest]
        [Timeout(300000)]
        public IEnumerator FingerprintDecidesOlderBuildAndBackupsLoad()
        {
            var store = new SaveStore(directory) { BackupsToKeep = 5 };
            var client = new EngineClient();
            try
            {
                yield return Await(client.Ready);
                string current = client.Ready.Result.SchemaFingerprint;
                StringAssert.IsMatch("^[0-9a-f]{32}$", current);

                SaveBuild.Set("0.1.0-alpha.7+abcdef12", "alpha");
                JObject options = DesktopSaveSettings.DefaultWorldGame("Compat test", "s13-saves");
                options["player"]["starterKit"] = false;
                var created = client.NewGame(options);
                yield return Await(created);
                Assert.IsTrue(created.Result.Ok, created.Result.ReasonText);
                var begun = GameSession.BeginNewAsync(client, "Compat test", created.Result.Revision, created.Result.Seat, store);
                yield return Await(begun);
                GameSession session = begun.Result;
                Assert.IsNull(session.LastProblem, session.LastProblem);
                Assert.AreEqual(SaveKind.Created, session.LastSaveKind);
                var saved = session.SaveNowAsync();
                yield return Await(saved);
                Assert.IsTrue(saved.Result.Ok, saved.Result.Problem);
                Assert.AreEqual(1, saved.Result.Slot.BackupCount, "the first save became a backup");
                string slotId = session.SlotId;
                yield return Await(session.EndAsync(alwaysSave: false));

                SaveSlotInfo slot = store.Find(slotId);
                Assert.AreEqual(current, slot.SchemaFingerprint, "the slot header records this build's fingerprint");
                Assert.AreEqual("0.1.0-alpha.7+abcdef12", slot.BuildVersion);
                Assert.IsTrue(slot.MadeByAlpha, "the Load list tags it Alpha");
                byte[] goodBytes = store.Read(slotId);
                var inspected = client.InspectSave(goodBytes);
                yield return Await(inspected);
                Assert.AreEqual(current, inspected.Result.Header.Value<string>("schemaFingerprint"), "the save's own header carries the fingerprint");

                // An older build's save: no fingerprint, and a field this build's schema refuses.
                JObject older = Decode(goodBytes);
                ((JObject)older["header"]).Remove("schemaFingerprint");
                older["state"]["world"]["tables"]["people"][0]["legacyMicSkill"] = 12;
                store.Write(Clone(slot), Gzip(older));
                var openOlder = GameSession.OpenSlotAsync(client, store.Find(slotId), store);
                yield return Await(openOlder);
                Assert.AreEqual(OpenStatus.OlderBuild, openOlder.Result.Status, openOlder.Result.Report);
                Assert.AreEqual("validate", openOlder.Result.Load.Stage);
                Assert.AreEqual(SaveCompat.OlderBuildBody, openOlder.Result.Problem);
                StringAssert.Contains("Save schema: none", openOlder.Result.Report);
                Assert.IsNull(GameSession.Current);

                // The same bad field with this build's fingerprint is a real bug: the detailed report.
                JObject broken = Decode(goodBytes);
                broken["state"]["world"]["tables"]["people"][0]["legacyMicSkill"] = 12;
                byte[] brokenBytes = Gzip(broken);
                store.Write(Clone(slot), brokenBytes);
                var openBroken = GameSession.OpenSlotAsync(client, store.Find(slotId), store);
                yield return Await(openBroken);
                Assert.AreEqual(OpenStatus.Failed, openBroken.Result.Status);
                Assert.AreEqual("validate", openBroken.Result.Load.Stage);

                // The backups still hold the good saves (newest first): the newest good one loads.
                var backups = store.ListBackups(slotId);
                Assert.AreEqual(3, backups.Count, "the first save, the second save and the older-build file");
                SaveBackupInfo good = backups.First(backup => backup.Info.SchemaFingerprint == current
                    && Decode(store.LoadBackup(slotId, backup.BackupId))["state"]["world"]["tables"]["people"][0]["legacyMicSkill"] == null);
                var openBackup = GameSession.OpenBackupAsync(client, store.Find(slotId), good.BackupId, store);
                yield return Await(openBackup);
                Assert.AreEqual(OpenStatus.Opened, openBackup.Result.Status, openBackup.Result.Report);
                Assert.AreEqual(SaveKind.LoadedBackup, GameSession.Current.LastSaveKind);
                Assert.AreEqual("Compat test", GameSession.Current.LastSaved.Label);
                CollectionAssert.AreEqual(brokenBytes, store.Read(slotId), "loading a backup leaves the slot's save until the next save");
                yield return Await(GameSession.EndCurrentAsync(alwaysSave: false));
            }
            finally
            {
                GameSession.Current?.EndAsync(alwaysSave: false);
                client.Dispose();
            }
        }

        private static SaveSlotInfo Write(SaveStore store, string slotId, int day)
        {
            return store.Write(Info(slotId, day), Encoding.UTF8.GetBytes("save-" + day));
        }

        private static SaveSlotInfo Info(string slotId, int day)
        {
            return new SaveSlotInfo
            {
                SlotId = slotId,
                Label = "Career",
                GameDate = $"2027-01-{day:00}",
                SavedAt = new DateTimeOffset(2026, 11, 19, 12, day, 0, TimeSpan.Zero),
            };
        }

        private static SaveSlotInfo Clone(SaveSlotInfo slot) => slot.Clone();

        private static string Text(byte[] bytes) => Encoding.UTF8.GetString(bytes);

        private static JObject Header(string label, string gameDate, string fingerprint)
        {
            return new JObject
            {
                ["label"] = label,
                ["gameDate"] = gameDate,
                ["schemaFingerprint"] = fingerprint,
                ["worldName"] = "Test world",
            };
        }

        private static JObject Document(JObject header)
        {
            return new JObject
            {
                ["engineVersion"] = "0.1.0",
                ["format"] = SaveVerifier.Format,
                ["formatVersion"] = 1,
                ["header"] = header.DeepClone(),
                ["state"] = new JObject { ["world"] = new JObject { ["tables"] = new JObject { ["people"] = new JArray(new JObject { ["id"] = "per_1" }) } } },
            };
        }

        private static byte[] Gzip(JObject document) => Gzip(document.ToString(Newtonsoft.Json.Formatting.None));

        private static byte[] Gzip(string json)
        {
            using (var output = new MemoryStream())
            {
                using (var gzip = new GZipStream(output, CompressionMode.Compress, true))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    gzip.Write(bytes, 0, bytes.Length);
                }

                return output.ToArray();
            }
        }

        private static JObject Decode(byte[] gzipped)
        {
            using (var input = new GZipStream(new MemoryStream(gzipped), CompressionMode.Decompress))
            using (var reader = new StreamReader(input, Encoding.UTF8))
            {
                return JObject.Parse(reader.ReadToEnd());
            }
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
