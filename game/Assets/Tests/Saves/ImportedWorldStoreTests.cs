using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Engine;
using UnityEngine;
using UnityEngine.TestTools;

namespace RingsideBooker.Saves.Tests
{
    /// <summary>
    /// Imported workshop worlds kept across restarts (UNITY-14): a world imported into one engine is
    /// stored, a fresh engine and store (a restart) list it, register it without the mod, and start
    /// a new game in it; removing it deletes the files. The world is a generated fictional world mod
    /// (<c>Fixtures/fictional-world-mod.json</c>, the tables of packages/engine-host/test/worldModFixture.ts;
    /// every name is invented). Needs the engine bundle in StreamingAssets (npm run build:engine-bundle).
    /// </summary>
    public sealed class ImportedWorldStoreTests
    {
        private const string PackId = "wm-900001";
        private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(120);

        private string directory;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Path.GetTempPath(), "rb-worlds-test-" + Guid.NewGuid().ToString("N"));
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator AStoredWorldIsListedAfterARestartAndStartsANewGame()
        {
            JObject input = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "Tests/Saves/Fixtures/fictional-world-mod.json")));
            input["packId"] = PackId;

            var first = new EngineClient();
            try
            {
                yield return Await(first.Ready);
                Task<string> imported = first.ImportWorldMod(input.ToString(Formatting.None));
                yield return Await(imported);
                Assert.IsTrue((bool)JObject.Parse(imported.Result)["ok"], "the fictional world imports");

                var world = new StoredWorld
                {
                    PackId = PackId,
                    Name = "Testverse Classic",
                    ItemId = "900001",
                    DatabasePath = Path.Combine(directory, "no-such-mod", "World.db"),
                    ImportedAt = DateTimeOffset.Now,
                    Counts = { ["person"] = 12 },
                };
                Task<StoredWorld> stored = new ImportedWorldStore(directory).StoreFromEngineAsync(first, world);
                yield return Await(stored);
                Assert.Greater(stored.Result.PackFileBytes, 0);
            }
            finally
            {
                first.Dispose();
            }

            // A restart: a new engine knows only the bundled worlds; the store lists the kept one.
            var store = new ImportedWorldStore(directory);
            var listed = store.List();
            Assert.AreEqual(1, listed.Count);
            Assert.AreEqual("Testverse Classic", listed[0].Name);
            Assert.AreEqual(12, listed[0].Counts["person"]);
            Assert.AreEqual(StoredModState.Missing, ImportedWorldStore.ModState(listed[0]), "the mod is not needed to play it");

            var second = new EngineClient();
            try
            {
                yield return Await(second.Ready);
                Task<WorldListResult> before = second.ListWorlds();
                yield return Await(before);
                Assert.IsFalse(before.Result.Packs.Any(pack => (string)pack["id"] == PackId));

                Task<string> registered = store.RegisterAsync(second, PackId);
                yield return Await(registered);
                Assert.IsNull(registered.Result, registered.Result);

                Task<WorldListResult> after = second.ListWorlds();
                yield return Await(after);
                JToken pack = after.Result.Packs.FirstOrDefault(entry => (string)entry["id"] == PackId);
                Assert.IsNotNull(pack, "the stored world is listed again");
                Assert.IsTrue((bool)pack["imported"]);

                Task<NewGameResult> created = second.NewGame(JObject.FromObject(new
                {
                    rootPackId = PackId,
                    seed = "unity-14-stored-world",
                    playerName = "Test Booker",
                    saveName = "Stored world test",
                    seasonLength = new { preset = "12m" },
                    player = new
                    {
                        mode = "found",
                        name = "Fixture Test Wrestling",
                        shortName = "FTW",
                        homeRegionKey = "us-texas",
                        style = "traditional",
                        size = "small",
                        color = "#335577",
                        starterKit = false,
                        weeklyShowDay = 3,
                    },
                    settings = new { },
                }));
                yield return Await(created);
                Assert.IsTrue(created.Result.Ok, created.Result.ReasonText);
            }
            finally
            {
                second.Dispose();
            }

            Assert.IsTrue(store.Remove(PackId));
            Assert.AreEqual(0, store.List().Count);
            Assert.IsFalse(File.Exists(store.PackPath(PackId)));
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
