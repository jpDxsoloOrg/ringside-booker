using System;
using System.Collections;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Shell;
using UnityEngine;

namespace RingsideBooker.UI.Crash
{
    /// <summary>
    /// Dev flag <c>-rbForceEngineFault [seconds]</c> (UNITY-24): once a game is on screen and the
    /// engine is idle, waits the given seconds (default 3) and makes the engine throw inside V8, so
    /// the engine-stopped screen can be seen and its ways back tried by hand. Does nothing without
    /// the flag.
    /// </summary>
    public sealed class CrashDev : MonoBehaviour
    {
        public const string Argument = "-rbForceEngineFault";

        private float delay = 3f;

        /// <summary>Stops the shared engine now, as a real fault would (tours and the flag).</summary>
        public static void ForceFault()
        {
            EngineRuntime.Client?.ForceFaultForTesting();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.FindIndex(args, arg => string.Equals(arg, Argument, StringComparison.OrdinalIgnoreCase));
            if (at < 0 || Application.isBatchMode) return;
            var host = new GameObject("CrashDev");
            DontDestroyOnLoad(host);
            CrashDev dev = host.AddComponent<CrashDev>();
            if (at + 1 < args.Length && float.TryParse(args[at + 1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float seconds))
            {
                dev.delay = seconds;
            }
        }

        private IEnumerator Start()
        {
            while (EngineGame.Current == null || ShellController.Current == null || EngineRuntime.Client == null || EngineRuntime.Client.IsBusy) yield return null;
            yield return new WaitForSecondsRealtime(delay);
            Debug.Log("[CrashDev] forcing an engine fault (-rbForceEngineFault)");
            ForceFault();
            Destroy(gameObject);
        }
    }
}
