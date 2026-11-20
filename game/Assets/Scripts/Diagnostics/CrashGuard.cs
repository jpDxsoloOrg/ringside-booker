using RingsideBooker.Engine;
using RingsideBooker.Saves;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RingsideBooker.Diagnostics
{
    /// <summary>
    /// The crash streak (POL1-03 safe start, UNITY-24): how many times in a row a game ended badly
    /// (the engine stopped, or the game closed while a game was open without reaching the title or
    /// quitting). It resets once a game plays a day without trouble. At
    /// <see cref="CrashStreak.SafeStartAfter"/> the title screen offers a safe start instead of its
    /// usual panel. Kept in PlayerPrefs.
    /// </summary>
    public static class CrashGuard
    {
        public const string StreakKey = "rb.crash.streak";
        public const string InGameKey = "rb.crash.inGame";
        public const string LastSlotKey = "rb.crash.lastSlot";

        private static EngineClient watched;
        private static bool offered;

        /// <summary>Bad endings in a row.</summary>
        public static int Streak => PlayerPrefs.GetInt(StreakKey, 0);

        /// <summary>The save of the last game opened (the bug report and recovery use it), or null.</summary>
        public static string LastSlotId
        {
            get
            {
                string slot = PlayerPrefs.GetString(LastSlotKey, string.Empty);
                return slot.Length == 0 ? null : slot;
            }
        }

        /// <summary>Set by the crash screen's "Start safe": the title opens on the safe-start panel.</summary>
        public static bool SafeStartRequested { get; set; }

        /// <summary>
        /// Whether the title screen should open on the safe-start panel: the player asked for it, or
        /// the streak is long enough (offered once per run).
        /// </summary>
        public static bool ShouldOfferSafeStart => SafeStartRequested || (!offered && CrashStreak.OfferSafeStart(Streak));

        /// <summary>The title showed the panel: don't offer it again this run unless asked.</summary>
        public static void MarkOffered()
        {
            offered = true;
            SafeStartRequested = false;
        }

        /// <summary>Forget the streak (a game played well, or the player chose to carry on).</summary>
        public static void Clear()
        {
            PlayerPrefs.SetInt(StreakKey, 0);
            PlayerPrefs.Save();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            watched = null;
            offered = false;
            SafeStartRequested = false;
            bool wasInGame = PlayerPrefs.GetInt(InGameKey, 0) == 1;
            int streak = CrashStreak.AfterStart(Streak, wasInGame);
            if (streak != Streak) Debug.LogWarning($"[CrashGuard] the last run ended inside a game; crash streak {streak}");
            PlayerPrefs.SetInt(StreakKey, streak);
            PlayerPrefs.SetInt(InGameKey, 0);
            PlayerPrefs.Save();

            SceneManager.sceneLoaded -= OnSceneLoaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
            EngineRuntime.Stopped -= OnStopped;
            EngineRuntime.Stopped += OnStopped;
            Application.quitting -= OnQuitting;
            Application.quitting += OnQuitting;
        }

        private static void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            if (scene.name == SceneFlow.TitleScene)
            {
                SetInGame(false);
                return;
            }

            if (scene.name != SceneFlow.GameScene || GameSession.Current == null) return;
            SetInGame(true);
            PlayerPrefs.SetString(LastSlotKey, GameSession.Current.SlotId);
            PlayerPrefs.Save();
            Watch(GameSession.Current.Engine);
        }

        private static void Watch(EngineClient client)
        {
            if (watched == client) return;
            if (watched != null) watched.OnAdvanceFinished -= OnAdvanceFinished;
            watched = client;
            if (client != null) client.OnAdvanceFinished += OnAdvanceFinished;
        }

        private static void OnAdvanceFinished(Engine.AdvanceReport report)
        {
            if (Streak == 0 || report == null || !report.Ok || report.DaysAdvanced <= 0) return;
            Debug.Log("[CrashGuard] a day played fine; crash streak cleared");
            Clear();
        }

        private static void OnStopped(EngineFault fault)
        {
            PlayerPrefs.SetInt(StreakKey, CrashStreak.AfterFault(Streak));
            PlayerPrefs.SetInt(InGameKey, 0);
            PlayerPrefs.Save();
            Watch(null);
        }

        private static void OnQuitting() => SetInGame(false);

        private static void SetInGame(bool inGame)
        {
            PlayerPrefs.SetInt(InGameKey, inGame ? 1 : 0);
            PlayerPrefs.Save();
        }
    }

    /// <summary>The crash streak's rules, pure (tested).</summary>
    public static class CrashStreak
    {
        /// <summary>Bad endings in a row before the title offers a safe start.</summary>
        public const int SafeStartAfter = 2;

        /// <summary>At start-up: a run that ended while a game was open (no title, no quit) counts as a crash.</summary>
        public static int AfterStart(int streak, bool lastRunEndedInGame) => lastRunEndedInGame ? streak + 1 : streak;

        /// <summary>The engine stopped.</summary>
        public static int AfterFault(int streak) => streak + 1;

        public static bool OfferSafeStart(int streak) => streak >= SafeStartAfter;
    }
}
