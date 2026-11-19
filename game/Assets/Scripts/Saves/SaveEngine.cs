using System;
using System.Threading.Tasks;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Where the save screens get the engine. The game's shared client (UNITY-09's
    /// <c>EngineRuntime.GetClientAsync</c>) is set as <see cref="Provider"/> at startup; without one,
    /// Saves starts a single client of its own. Call on the main thread.
    /// </summary>
    public static class SaveEngine
    {
        private static Task<EngineClient> own;

        /// <summary>The app's shared client, when the bridge provides one.</summary>
        public static Func<Task<EngineClient>> Provider { get; set; }

        public static Task<EngineClient> GetAsync()
        {
            if (Provider != null) return Provider();
            if (own == null || own.IsFaulted || own.IsCanceled) own = EngineClient.StartAsync();
            return own;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            own = null;
            Provider = null;
        }
    }
}
