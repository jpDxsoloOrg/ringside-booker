using System;
using System.Collections.Generic;
using System.IO;
using RingsideBooker.Saves;
using UnityEngine;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// Screenshot tours and checks (any <c>-rb…Shots</c>, <c>-rbSkipCheck</c>, <c>-rbProfileSkip</c> or
    /// <c>-rbImportCheck</c> run) start new games, and each new game is a save slot in the player's
    /// real saves folder. This remembers the slots such a run creates and deletes them when the run
    /// quits, so tours stop filling the saves list. Slots that were there before are never touched.
    /// Pass <c>-rbKeepSlots</c> to keep them.
    /// </summary>
    public static class TourSlots
    {
        public const string KeepArgument = "-rbKeepSlots";

        private static readonly string[] TourArguments = { "-rbSkipCheck", "-rbProfileSkip", "-rbImportCheck" };
        private static readonly List<(string Directory, string SlotId)> created = new List<(string, string)>();

        /// <summary>The slots this run created (newest last).</summary>
        public static IReadOnlyList<(string Directory, string SlotId)> Created => created;

        /// <summary>Whether these command-line arguments start a tour or check that cleans up its slots.</summary>
        public static bool IsTourRun(string[] args)
        {
            bool tour = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, KeepArgument, StringComparison.OrdinalIgnoreCase)) return false;
                if (!arg.StartsWith("-rb", StringComparison.OrdinalIgnoreCase)) continue;
                if (arg.EndsWith("Shots", StringComparison.OrdinalIgnoreCase)) tour = true;
                foreach (string name in TourArguments)
                {
                    if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) tour = true;
                }
            }

            return tour;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            created.Clear();
            GameSession.CurrentChanged -= OnSessionChanged;
            Application.quitting -= DeleteCreated;
            if (Application.isEditor || !IsTourRun(Environment.GetCommandLineArgs())) return;
            GameSession.CurrentChanged += OnSessionChanged;
            Application.quitting += DeleteCreated;
        }

        // A new game's session becomes Current before its first save is written, so a slot whose file
        // does not exist yet is one this run is creating; a loaded slot already has its file.
        private static void OnSessionChanged(GameSession session)
        {
            if (session?.Store == null) return;
            if (File.Exists(session.Store.SavePath(session.SlotId))) return;
            created.Add((session.Store.Directory, session.SlotId));
        }

        // Runs after QuitGuard has let the final save finish.
        private static void DeleteCreated()
        {
            foreach ((string directory, string slotId) in created)
            {
                try
                {
                    new SaveStore(directory).Delete(slotId);
                    Debug.Log($"[TourSlots] deleted the tour's save slot {slotId}");
                }
                catch (Exception error)
                {
                    Debug.LogWarning($"[TourSlots] could not delete {slotId}: {error.Message}");
                }
            }

            created.Clear();
        }
    }
}
