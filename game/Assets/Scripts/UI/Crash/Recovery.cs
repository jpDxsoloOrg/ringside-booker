using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Diagnostics;
using RingsideBooker.Engine;
using RingsideBooker.Saves;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Title;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Crash
{
    /// <summary>One backup of a save the player can go back to.</summary>
    public sealed class BackupChoice
    {
        public string Id { get; set; }

        /// <summary>What the button says ("Previous save").</summary>
        public string Label { get; set; }

        /// <summary>A quiet second line (when it was written).</summary>
        public string Detail { get; set; }
    }

    /// <summary>
    /// Where "Load a backup" finds backups: the slot's rotating backups (UNITY-27,
    /// <see cref="SaveStore.ListBackups"/>). A ticketing or cloud source could replace it with
    /// <see cref="Backups.Source"/>.
    /// </summary>
    public interface IBackupSource
    {
        IReadOnlyList<BackupChoice> List(SaveStore store, SaveSlotInfo slot);

        Task<OpenResult> OpenAsync(EngineClient engine, SaveStore store, SaveSlotInfo slot, BackupChoice choice);
    }

    public static class Backups
    {
        public static IBackupSource Source { get; set; } = new SlotBackupSource();

        /// <summary>The most backups the crash screen and safe start offer (newest first).</summary>
        public const int MaxShown = 3;
    }

    /// <summary>The slot's rotating backups (UNITY-27), newest first: "Previous save", then "Earlier save".</summary>
    public sealed class SlotBackupSource : IBackupSource
    {
        public IReadOnlyList<BackupChoice> List(SaveStore store, SaveSlotInfo slot)
        {
            if (slot == null) return Array.Empty<BackupChoice>();
            IReadOnlyList<SaveBackupInfo> backups;
            try
            {
                backups = store.ListBackups(slot.SlotId);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                Debug.LogWarning("[Recovery] could not list backups: " + error.Message);
                return Array.Empty<BackupChoice>();
            }

            var choices = new List<BackupChoice>();
            foreach (SaveBackupInfo backup in backups.OrderByDescending(item => item.SavedAt).Take(Backups.MaxShown))
            {
                string date = backup.GameDate != null ? "game date " + backup.GameDate + " · " : string.Empty;
                choices.Add(new BackupChoice
                {
                    Id = backup.BackupId,
                    Label = choices.Count == 0 ? "Previous save" : "Earlier save",
                    Detail = date + "saved " + backup.SavedAt.ToLocalTime().ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture),
                });
            }

            return choices;
        }

        public Task<OpenResult> OpenAsync(EngineClient engine, SaveStore store, SaveSlotInfo slot, BackupChoice choice) =>
            GameSession.OpenBackupAsync(engine, slot, choice.Id, store);
    }

    /// <summary>
    /// The ways back from a crash (UNITY-24, POL1-03): reload the last save, load a backup, go back
    /// to the title (optionally on the safe-start panel). Each one drops the stopped engine, ends the
    /// old game without saving over the last good save, and starts a fresh engine when one is needed.
    /// </summary>
    public static class Recovery
    {
        /// <summary>The save to recover: the game that was open, else the last one opened, else the newest.</summary>
        public static SaveSlotInfo LastSlot(SaveStore store)
        {
            try
            {
                string slotId = GameSession.Current?.SlotId ?? CrashGuard.LastSlotId;
                return (slotId != null ? store.Find(slotId) : null) ?? store.Latest();
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is Newtonsoft.Json.JsonException)
            {
                Debug.LogWarning("[Recovery] could not read the saves: " + error.Message);
                return null;
            }
        }

        /// <summary>Reloads the slot's last save. Returns null when the game opened, else the reason in words.</summary>
        public static Task<string> ReloadAsync(SaveStore store, SaveSlotInfo slot) =>
            OpenAsync(engine => GameSession.OpenSlotAsync(engine, slot, store));

        /// <summary>Loads one of the slot's backups. Returns null when the game opened, else the reason.</summary>
        public static Task<string> LoadBackupAsync(SaveStore store, SaveSlotInfo slot, BackupChoice choice) =>
            OpenAsync(engine => Backups.Source.OpenAsync(engine, store, slot, choice));

        /// <summary>Back to the title screen; with <paramref name="safe"/> it opens on the safe-start panel.</summary>
        public static void BackToTitle(bool safe)
        {
            EndOldGame();
            CrashGuard.SafeStartRequested = safe;
            EngineStoppedScreen.Hide();
            SceneFlow.LoadTitle();
        }

        private static async Task<string> OpenAsync(Func<EngineClient, Task<OpenResult>> open)
        {
            try
            {
                EndOldGame();
                await GameSession.Ending;
                EngineClient engine = await EngineRuntime.GetClientAsync();
                OpenResult result = await open(engine);
                if (!result.Ok) return result.Problem ?? "The save would not load.";
                LoadNotice.ShowFor(result.Load);
                EngineStoppedScreen.Hide();
                GameEntry.Enter(engine, result.Session.Seat);
                return null;
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                return "Something went wrong: " + error.GetBaseException().Message;
            }
        }

        // The stopped engine can't save, and nothing it holds is worth saving: end without a final
        // save, take the shell down and let the next use start a fresh engine.
        private static void EndOldGame()
        {
            _ = GameSession.EndCurrentAsync(alwaysSave: false);
            EngineGame.Current?.Dispose();
            if (ShellServices.IsInstalled) ShellServices.Clear();
            if (EngineRuntime.Client != null && EngineRuntime.Client.IsStopped) EngineRuntime.Reset();
        }
    }

    /// <summary>The crash screen and load notice styles (Resources "Crash/Crash", <c>cx-</c> classes).</summary>
    public static class CrashStyles
    {
        private static StyleSheet sheet;

        public static void Apply(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Crash/Crash");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }
    }
}
