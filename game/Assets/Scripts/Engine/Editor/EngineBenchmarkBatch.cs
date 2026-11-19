using System;
using UnityEditor;
using UnityEngine;

namespace RingsideBooker.Engine.EditorTools
{
    /// <summary>
    /// Editor entry point for the engine benchmark (game/tools/engine-benchmark.sh runs it in batch
    /// mode with <c>-executeMethod RingsideBooker.Engine.EditorTools.EngineBenchmarkBatch.Run</c>).
    /// </summary>
    public static class EngineBenchmarkBatch
    {
        /// <summary>Runs the benchmark on StreamingAssets/engine/engine.js and exits (batch mode).</summary>
        public static void Run()
        {
            int exitCode = 0;
            try
            {
                EngineBenchmark.Run(JsEngineHost.DefaultBundlePath, EngineBenchmark.ReadDays(Environment.GetCommandLineArgs()));
            }
            catch (Exception error)
            {
                Debug.LogError($"{EngineBenchmark.LogPrefix} FAILED: {error}");
                exitCode = 1;
            }

            if (Application.isBatchMode)
            {
                EditorApplication.Exit(exitCode);
            }
        }

        [MenuItem("Ringside Booker/Engine Benchmark (30 days)")]
        private static void RunFromMenu()
        {
            EngineBenchmark.Run(JsEngineHost.DefaultBundlePath, 30);
        }
    }
}
