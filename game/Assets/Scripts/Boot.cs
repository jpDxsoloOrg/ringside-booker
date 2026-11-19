using UnityEngine;

namespace RingsideBooker
{
    /// <summary>
    /// Bootstrap behaviour for the Boot scene. It logs a line so a player build (run with
    /// -batchmode -nographics -logFile) proves the game starts, then opens the title screen.
    /// </summary>
    public sealed class Boot : MonoBehaviour
    {
        public const string BootMessage = "Ringside Booker boot";

        private void Awake()
        {
            Debug.Log($"{BootMessage} (Unity {Application.unityVersion}, {Application.platform})");

            if (Application.isBatchMode)
            {
                // A headless smoke run has nothing else to do yet.
                Application.Quit(0);
                return;
            }

            UI.SceneFlow.LoadTitle();
        }
    }
}
