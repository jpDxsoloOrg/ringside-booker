using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Newtonsoft.Json.Linq;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace RingsideBooker.Engine
{
    /// <summary>
    /// Times the embedded engine: load the bundle, start a default-world game with a founded
    /// promotion, advance a year (clearing news alerts, as the engine-host bundle test does) and
    /// print the world hashes so they can be compared with Node running the same bundle
    /// (game/docs/runtime.md). Runs from the editor (<c>EngineBenchmarkBatch.Run</c>) and from a player
    /// started with <c>-engineBenchmark</c>; every line it logs starts with <c>[EngineBenchmark]</c>.
    /// </summary>
    public static class EngineBenchmark
    {
        public const string LogPrefix = "[EngineBenchmark]";
        public const string CommandLineFlag = "-engineBenchmark";
        public const string DaysFlag = "-engineBenchmarkDays";
        public const int DefaultDays = 365;
        public const string Seed = "unity-03-runtime";

        private const string NewGameJson = @"{
  ""rootPackId"": ""default-world"",
  ""seed"": """ + Seed + @""",
  ""playerName"": ""Alex Booker"",
  ""saveName"": ""Runtime benchmark"",
  ""seasonLength"": { ""preset"": ""12m"" },
  ""player"": {
    ""mode"": ""found"", ""name"": ""Runtime Test Wrestling"", ""shortName"": ""RTW"",
    ""homeRegionKey"": ""us-california"", ""style"": ""traditional"", ""size"": ""small"",
    ""color"": ""#335577"", ""starterKit"": false, ""weeklyShowDay"": 3
  },
  ""settings"": {}
}";

        // Collation and a fingerprint of the floating-point Math functions the engine uses (via
        // `**` and the normal draw). Two runtimes whose fingerprints differ can simulate different
        // worlds from the same seed. Keep in step with game/tools/engine-benchmark-node.mjs.
        public const string RuntimeCheckScript = @"(function () {
  var view = new DataView(new ArrayBuffer(8));
  function fingerprint(fn) {
    var low = 0x811c9dc5 | 0, high = 0;
    for (var i = 1; i <= 20000; i++) {
      view.setFloat64(0, fn(i / 997 + i * 1e-7));
      low = Math.imul(low ^ view.getUint32(0), 16777619);
      high = Math.imul(high ^ view.getUint32(4), 16777619);
    }
    return (low >>> 0).toString(16) + (high >>> 0).toString(16);
  }
  return JSON.stringify({
    collation: ['b', 'A', 'a', 'B', '\u00e9', 'e', 'Z'].sort(function (x, y) { return x.localeCompare(y, 'en'); }).join(''),
    pow: fingerprint(function (x) { return Math.pow(x / 7, 1.37); }),
    cos: fingerprint(Math.cos),
    log: fingerprint(Math.log),
    sqrt: fingerprint(Math.sqrt)
  });
})()";

        /// <summary>The numbers one run produced.</summary>
        public sealed class Result
        {
            public double LoadMs;
            public double NewGameMs;
            public double AdvanceMs;
            public int DaysAdvanced;
            public int AlertsCleared;
            public int ProgressCalls;
            public string HashAfterNewGame;
            public string HashAfterAdvance;
            public string FinalDate;
            public double SaveMs;
            public int SaveBytes;
        }

        /// <summary>
        /// Runs the benchmark against a bundle file and logs each step. Call on Unity's main thread;
        /// the runtime itself lives on a dedicated engine thread, as it will in the game.
        /// </summary>
        public static Result Run(string bundlePath, int days)
        {
            JsEngineHost.ConfigureNativeSearchPath(Application.dataPath);
            Result result = null;
            Exception failure = null;
            var engineThread = new Thread(() =>
            {
                try
                {
                    result = RunOnThisThread(bundlePath, days);
                }
                catch (Exception error)
                {
                    failure = error;
                }
            }, 16 * 1024 * 1024)
            {
                Name = "RingsideEngine benchmark",
                IsBackground = true,
            };
            engineThread.Start();
            engineThread.Join();
            if (failure != null)
            {
                throw new InvalidOperationException("Engine benchmark failed on the engine thread", failure);
            }

            return result;
        }

        private static Result RunOnThisThread(string bundlePath, int days)
        {
            var result = new Result();
            var clock = Stopwatch.StartNew();
            using (JsEngineHost host = JsEngineHost.LoadFromFile(bundlePath))
            {
                result.LoadMs = clock.Elapsed.TotalMilliseconds;
                JObject info = JObject.Parse(host.Call("info"));
                Log($"runtime {JsEngineHost.RuntimeName}; engine {info["engineVersion"]}; shims {info["shims"]?.ToString(Newtonsoft.Json.Formatting.None)}; bundle loaded in {result.LoadMs:F0} ms");

                Log("runtime check: " + host.EvaluateDiagnostic(RuntimeCheckScript));

                clock.Restart();
                JObject created = JObject.Parse(host.Call("newGame", NewGameJson));
                result.NewGameMs = clock.Elapsed.TotalMilliseconds;
                if (created.Value<bool?>("ok") != true)
                {
                    throw new InvalidOperationException($"newGame failed: {created.ToString(Newtonsoft.Json.Formatting.None)}");
                }

                result.HashAfterNewGame = HashOf(host);
                DumpState(host, "newgame");
                Log($"newGame {result.NewGameMs:F0} ms, worldHash {result.HashAfterNewGame}");

                clock.Restart();
                int remaining = days;
                int progressCalls = 0;
                while (remaining > 0)
                {
                    string options = $"{{\"maxDays\":{remaining}}}";
                    JObject outcome = JObject.Parse(host.CallAsync("advanceDays", options, _ => progressCalls++));
                    if (outcome.Value<bool?>("ok") != true)
                    {
                        throw new InvalidOperationException($"advanceDays failed: {outcome.ToString(Newtonsoft.Json.Formatting.None)}");
                    }

                    int advanced = outcome.Value<int>("daysAdvanced");
                    remaining -= advanced;
                    result.DaysAdvanced += advanced;
                    JToken stoppedBy = outcome["stoppedBy"];
                    if (stoppedBy?.Value<string>("kind") == "gate")
                    {
                        string[] gates = (stoppedBy["hits"] ?? new JArray())
                            .Select(hit => hit.Value<string>("gateId")).ToArray();
                        if (gates.Any(gate => gate != "news.alert"))
                        {
                            throw new InvalidOperationException($"advance stopped at gates {string.Join(", ", gates)}");
                        }

                        host.Call("command", "news.ackAlerts", "{}");
                        result.AlertsCleared++;
                    }
                }

                result.AdvanceMs = clock.Elapsed.TotalMilliseconds;
                result.ProgressCalls = progressCalls;
                result.HashAfterAdvance = HashOf(host);
                DumpState(host, "advance");
                result.FinalDate = JObject.Parse(host.Call("query", "clock.get", "{}"))["result"]?["data"]?.Value<string>("date");
                Log($"advanceDays {result.DaysAdvanced} days in {result.AdvanceMs:F0} ms " +
                    $"({result.AdvanceMs / Math.Max(1, result.DaysAdvanced):F1} ms/day, {result.AlertsCleared} alerts cleared, " +
                    $"{result.ProgressCalls} progress calls), now {result.FinalDate}, worldHash {result.HashAfterAdvance}");

                clock.Restart();
                JObject saved = JObject.Parse(host.CallAsync("save", "{\"savedAt\":\"2027-01-01T00:00:00.000Z\"}"));
                result.SaveMs = clock.Elapsed.TotalMilliseconds;
                result.SaveBytes = saved.Value<int?>("byteLength") ?? -1;
                Log($"save {result.SaveBytes} bytes in {result.SaveMs:F0} ms");
            }

            Log($"RESULT load={result.LoadMs:F0}ms newGame={result.NewGameMs:F0}ms advance{result.DaysAdvanced}={result.AdvanceMs:F0}ms " +
                $"hashNewGame={result.HashAfterNewGame} hashAdvance={result.HashAfterAdvance}");
            return result;
        }

        /// <summary>With <c>-engineBenchmarkDump &lt;folder&gt;</c>: writes exportState() there (determinism checks).</summary>
        private static void DumpState(JsEngineHost host, string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, "-engineBenchmarkDump");
            if (index < 0 || index + 1 >= args.Length)
            {
                return;
            }

            string path = System.IO.Path.Combine(args[index + 1], $"state-{name}.json");
            System.IO.File.WriteAllText(path, host.Call("exportState"));
            Log($"wrote {path}");
        }

        private static string HashOf(JsEngineHost host)
        {
            return JObject.Parse(host.Call("worldHash")).Value<string>("hash");
        }

        private static void Log(string message)
        {
            Debug.Log($"{LogPrefix} {message}");
        }

        /// <summary>
        /// In a player started with <c>-engineBenchmark [-engineBenchmarkDays N]</c>: runs the benchmark
        /// on the bundled engine before the first scene loads, then quits (exit code 0 or 1).
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void RunFromCommandLine()
        {
            string[] args = Environment.GetCommandLineArgs();
            if (!args.Contains(CommandLineFlag))
            {
                return;
            }

            int days = ReadDays(args);
            int exitCode = 0;
            try
            {
                Run(JsEngineHost.DefaultBundlePath, days);
            }
            catch (Exception error)
            {
                Debug.LogError($"{LogPrefix} FAILED: {error}");
                exitCode = 1;
            }

            Application.Quit(exitCode);
        }

        /// <summary>Reads <c>-engineBenchmarkDays N</c> (default 365).</summary>
        public static int ReadDays(string[] args)
        {
            int index = Array.IndexOf(args, DaysFlag);
            if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out int days) && days > 0)
            {
                return days;
            }

            return DefaultDays;
        }
    }
}
