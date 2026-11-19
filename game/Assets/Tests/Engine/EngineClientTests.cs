using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine.TestTools;

namespace RingsideBooker.Engine.Tests
{
    /// <summary>
    /// The engine bridge end to end, in the editor: start the engine thread, make a default-world
    /// game, advance a week (clearing news alerts, the only gate a founded promotion with no shows
    /// meets), query, save, unload, reload and compare the world hash. Needs the bundle in
    /// StreamingAssets (npm run build:engine-bundle).
    /// </summary>
    public sealed class EngineClientTests
    {
        private const int WeekDays = 7;
        private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(120);

        private static readonly JObject NewGameOptions = JObject.Parse(@"{
  ""rootPackId"": ""default-world"",
  ""seed"": ""unity-04-bridge"",
  ""playerName"": ""Alex Booker"",
  ""saveName"": ""Bridge test"",
  ""seasonLength"": { ""preset"": ""12m"" },
  ""player"": {
    ""mode"": ""found"", ""name"": ""Bridge Test Wrestling"", ""shortName"": ""BTW"",
    ""homeRegionKey"": ""us-california"", ""style"": ""traditional"", ""size"": ""small"",
    ""color"": ""#335577"", ""starterKit"": false, ""weeklyShowDay"": 3
  },
  ""settings"": {}
}");

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator NewGameAdvanceSaveAndReloadKeepTheWorldHash()
        {
            var client = new EngineClient();
            var progressDays = new List<AdvanceProgress>();
            var finished = new List<AdvanceReport>();
            var revisions = new List<long>();
            client.OnAdvanceProgress += progressDays.Add;
            client.OnAdvanceFinished += finished.Add;
            client.OnStateChanged += revisions.Add;
            var reported = new CountingProgress();

            try
            {
                var ready = client.Ready;
                yield return Await(ready);
                Assert.IsFalse(ready.Result.WorldLoaded, "no game before newGame");

                var noWorld = client.WorldHash();
                yield return Await(noWorld);
                Assert.IsFalse(noWorld.Result.Ok);
                Assert.IsTrue(noWorld.Result.HasReason(EngineReasonCodes.NoWorld), noWorld.Result.ReasonText);

                var created = client.NewGame(NewGameOptions);
                yield return Await(created);
                Assert.IsTrue(created.Result.Ok, created.Result.ReasonText);
                Assert.IsNotNull(created.Result.Seat?.PromotionId, "the player runs the founded promotion");

                var startClock = client.Query<ClockView>(EngineQueries.Clock);
                yield return Await(startClock);
                Assert.IsTrue(startClock.Result.Ok, startClock.Result.ReasonText);
                Assert.AreEqual(1, startClock.Result.Data.DayNumber);

                int daysDone = 0;
                for (int attempt = 0; daysDone < WeekDays; attempt++)
                {
                    Assert.Less(attempt, 20, "the week did not finish");
                    var advance = client.AdvanceDays(AdvanceOptions.Days(WeekDays - daysDone), reported);
                    yield return Await(advance);
                    AdvanceReport report = advance.Result;
                    Assert.IsTrue(report.Ok, report.ReasonText);
                    Assert.AreEqual(WeekDays - daysDone, report.DaysRequested);
                    daysDone += report.DaysAdvanced;
                    if (report.StoppedAtGate)
                    {
                        string gates = string.Join(", ", report.GateHits.Select(hit => hit.GateId + " " + hit.Reason));
                        Assert.IsTrue(report.GateHits.All(hit => hit.GateId == GateIds.NewsAlert), "unexpected gate: " + gates);
                        var ack = client.Command(EngineCommands.AckNewsAlerts);
                        yield return Await(ack);
                        Assert.IsTrue(ack.Result.Ok, ack.Result.ReasonText);
                    }
                }

                Assert.AreEqual(WeekDays, daysDone);
                Assert.IsFalse(client.IsAdvancing);

                var clock = client.Query<ClockView>(EngineQueries.Clock);
                yield return Await(clock);
                Assert.AreEqual(1 + WeekDays, clock.Result.Data.DayNumber);
                Assert.AreEqual(AddDays(startClock.Result.Data.Date, WeekDays), clock.Result.Data.Date);

                var status = client.Query<SimStatus>(EngineQueries.SimStatus);
                yield return Await(status);
                Assert.IsTrue(status.Result.Ok, status.Result.ReasonText);
                Assert.AreEqual("Bridge Test Wrestling", status.Result.Data.Promotion?.Name);
                Assert.AreEqual(clock.Result.Data.Date, status.Result.Data.Date);

                var unknown = client.Command("no.suchCommand");
                yield return Await(unknown);
                Assert.IsFalse(unknown.Result.Ok, "an unknown command is refused");
                Assert.IsNotEmpty(unknown.Result.Reasons);

                var hashBefore = client.WorldHash();
                yield return Await(hashBefore);
                Assert.IsTrue(hashBefore.Result.Ok, hashBefore.Result.ReasonText);
                StringAssert.IsMatch("^[0-9a-f]{16}$", hashBefore.Result.Hash);

                var saved = client.Save("Bridge test", new DateTimeOffset(2026, 11, 19, 12, 0, 0, TimeSpan.Zero));
                yield return Await(saved);
                Assert.IsTrue(saved.Result.Ok, saved.Result.ReasonText);
                Assert.IsNotNull(saved.Result.Bytes);
                Assert.AreEqual(saved.Result.ByteLength, saved.Result.Bytes.Length);
                Assert.AreEqual(0x1f, saved.Result.Bytes[0], "a gzipped save");

                var unloaded = client.Unload();
                yield return Await(unloaded);
                Assert.IsTrue(unloaded.Result.Ok, unloaded.Result.ReasonText);

                var loaded = client.Load(saved.Result.Bytes);
                yield return Await(loaded);
                Assert.IsTrue(loaded.Result.Ok, loaded.Result.ProblemText);
                Assert.AreEqual(clock.Result.Data.Date, loaded.Result.Summary.GameDate);

                var hashAfter = client.WorldHash();
                yield return Await(hashAfter);
                Assert.AreEqual(hashBefore.Result.Hash, hashAfter.Result.Hash, "the reloaded world is the saved one");

                // Events are posted to the main thread; give the editor loop a few ticks to deliver them.
                for (int frame = 0; frame < 10 && progressDays.Count < WeekDays; frame++)
                {
                    yield return null;
                }

                Assert.AreEqual(WeekDays, progressDays.Count, "one progress event per simulated day");
                Assert.AreEqual(WeekDays, reported.Count, "IProgress gets every day too");
                Assert.AreEqual(clock.Result.Data.Date, progressDays.Last().CurrentDate);
                Assert.AreEqual(finished.Count, finished.Distinct().Count());
                Assert.IsNotEmpty(finished, "OnAdvanceFinished");
                Assert.IsNotEmpty(revisions, "OnStateChanged");
                Assert.IsFalse(client.IsBusy);
            }
            finally
            {
                client.Dispose();
            }
        }

        private static IEnumerator Await(Task task)
        {
            var clock = Stopwatch.StartNew();
            while (!task.IsCompleted)
            {
                if (clock.Elapsed > CallTimeout)
                {
                    Assert.Fail($"engine call did not finish within {CallTimeout.TotalSeconds} s");
                }

                yield return null;
            }

            if (task.IsFaulted)
            {
                Assert.Fail("engine call faulted: " + task.Exception?.GetBaseException());
            }

            Assert.IsFalse(task.IsCanceled, "engine call was cancelled");
        }

        private static string AddDays(string date, int days)
        {
            return DateTime.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture)
                .AddDays(days)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        private sealed class CountingProgress : IProgress<AdvanceProgress>
        {
            public int Count { get; private set; }

            public void Report(AdvanceProgress value) => Count++;
        }
    }
}
