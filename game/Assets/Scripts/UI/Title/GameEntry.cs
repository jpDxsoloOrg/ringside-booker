using System;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.UI.Title
{
    /// <summary>
    /// How the title screen enters a game it has just made or loaded. The engine shell bridge
    /// (UNITY-09) sets <see cref="Handler"/> (install the shell for the client, load the Game
    /// scene); until then the Game scene opens with the demo shell while the real game keeps
    /// autosaving.
    /// </summary>
    public static class GameEntry
    {
        public static Action<EngineClient, LocalSeat> Handler { get; set; }

        public static void Enter(EngineClient client, LocalSeat seat)
        {
            if (Handler != null)
            {
                Handler(client, seat);
                return;
            }

            SceneFlow.LoadGame();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => Handler = null;
    }
}
