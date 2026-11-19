using System.Threading.Tasks;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Saves on quit: <c>Application.wantsToQuit</c> holds the quit while the running game has
    /// unsaved changes or a save is still writing (a running advance is stopped first), then quits
    /// once the save is on disk, or after <see cref="QuitSaveCapMs"/> at most.
    /// </summary>
    public static class QuitGuard
    {
        /// <summary>The longest the quit waits for the save (a year-old save takes about half a second).</summary>
        public const int QuitSaveCapMs = 5000;

        private static bool allowQuit;
        private static bool waiting;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Install()
        {
            allowQuit = false;
            waiting = false;
            Application.wantsToQuit -= OnWantsToQuit;
            Application.wantsToQuit += OnWantsToQuit;
        }

        private static bool OnWantsToQuit()
        {
            if (allowQuit) return true;
            if (waiting) return false;

            GameSession session = GameSession.Current;
            Task work = session != null ? session.EndAsync(alwaysSave: false) : GameSession.Ending;
            if (work.IsCompleted) return true;

            waiting = true;
            WaitThenQuit(work);
            return false;
        }

        private static async void WaitThenQuit(Task work)
        {
            Task first = await Task.WhenAny(work, Task.Delay(QuitSaveCapMs));
            if (first != work) Debug.LogWarning($"QuitGuard: the save did not finish within {QuitSaveCapMs} ms; quitting anyway");
            allowQuit = true;
            Application.Quit();
        }
    }
}
