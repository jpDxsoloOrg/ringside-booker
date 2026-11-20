using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Saves;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.SaveUi;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Title;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the Sprint 13 save pieces: run the player with
    /// <c>-rbSaveShots &lt;folder&gt;</c>. It starts a default-world game and captures the "Last saved"
    /// chip (and its tooltip), plays a few days so autosaves fill the slot's backups, goes back to
    /// the title, then captures Load (the Alpha tag needs a version.json with channel alpha), the
    /// slot's Backups sheet, the "Load this backup?" confirm, Settings (Backups per save), and the
    /// could-not-load sheet with every backup (it breaks the tour's own save file for that). The
    /// tour's slot is deleted at the end; no other save is touched. Logs <c>[SaveShots]</c>; exit 1 on
    /// a time-out.
    /// </summary>
    public sealed class SaveShots : MonoBehaviour
    {
        public const string Argument = "-rbSaveShots";
        private const int DaysToPlay = 4;

        private string folder;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("SaveShots");
                DontDestroyOnLoad(host);
                host.AddComponent<SaveShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 300f);
            Directory.CreateDirectory(folder);
            Log($"build {SaveBuild.Version ?? "?"} channel {SaveBuild.Channel ?? "?"}, backups per save {SaveSettings.BackupsPerSlot}");
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null || GameSession.Current == null) yield return null;
            string slotId = GameSession.Current.SlotId;
            var store = new SaveStore();
            yield return WaitIdle(2f);

            // ---- The "Last saved" chip ----------------------------------------------------------------
            yield return CaptureChip("chip-new-game");
            yield return PlayDays(DaysToPlay);
            yield return WaitFor(() => GameSession.Current != null && !GameSession.Current.HasUnsavedChanges, 20f);
            yield return WaitIdle(1.5f);
            yield return CaptureChip("chip-after-days");
            Log($"slot {slotId}: {store.ListBackups(slotId).Count} backups");

            // ---- Back to the title: Load, Backups, confirm ----------------------------------------------
            yield return Await(GameSession.EndCurrentAsync());
            ShellServices.Clear();
            SceneFlow.LoadTitle();
            yield return Wait(0.5f);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1f);

            Click(TitleQ<Button>(button => button.name == "menu-load"));
            yield return WaitFor(() => TitleQ<VisualElement>(element => element.name == "save-slot-" + slotId, quiet: true) != null, 20f);
            yield return Wait(0.8f);
            Log("alpha tag " + (TitleQ<Label>(label => label.name == "save-alpha-" + slotId, quiet: true) != null ? "shown" : "not shown (no alpha version.json)"));
            yield return Capture("load-list");

            Click(TitleQ<Button>(button => button.name == "backups-" + slotId));
            yield return WaitFor(() => TitleQ<Button>(button => button.name.StartsWith("load-backup-", StringComparison.Ordinal), quiet: true) != null, 20f);
            yield return Wait(0.8f);
            yield return Capture("backups-sheet");

            Click(TitleQ<Button>(button => button.name.StartsWith("load-backup-", StringComparison.Ordinal)));
            yield return WaitFor(() => TitleQ<Button>(button => button.name == "confirm-load-backup-go", quiet: true) != null, 10f);
            yield return Wait(0.6f);
            yield return Capture("confirm-load-backup");
            CloseTitleOverlays();
            yield return Wait(0.4f);

            Click(TitleQ<Button>(button => button.name == "menu-settings"));
            yield return WaitFor(() => TitleQ<VisualElement>(element => element.name == "settings-backups", quiet: true) != null, 10f);
            yield return Wait(0.4f);
            VisualElement backupsGroup = TitleQ<VisualElement>(element => element.name == "settings-backups");
            backupsGroup?.GetFirstAncestorOfType<ScrollView>()?.ScrollTo(backupsGroup);
            yield return Wait(0.6f);
            yield return Capture("settings-backups");

            // ---- A save that will not load offers every backup ------------------------------------------
            AtomicFile.WriteAllBytes(store.SavePath(slotId), System.Text.Encoding.UTF8.GetBytes("not a save (broken by the SaveShots tour)"));
            Click(TitleQ<Button>(button => button.name == "menu-load"));
            yield return WaitFor(() => TitleQ<VisualElement>(element => element.name == "save-slot-" + slotId, quiet: true) != null, 20f);
            yield return Wait(0.5f);
            VisualElement row = TitleQ<VisualElement>(element => element.name == "save-slot-" + slotId);
            Click(row?.Q<Button>(className: "btn--primary"));
            yield return WaitFor(() => TitleQ<Button>(button => button.name.StartsWith("load-backup-", StringComparison.Ordinal), quiet: true) != null, 30f);
            yield return Wait(0.8f);
            yield return Capture("could-not-load-backups");
            CloseTitleOverlays();

            store.Delete(slotId);
            Log($"deleted the tour's slot {slotId}");
            Log($"done: {folder}");
            Application.Quit(0);
        }

        private IEnumerator CaptureChip(string name)
        {
            VisualElement pill = ShellController.Current?.Shell.Root.Q<VisualElement>("last-saved-pill");
            VisualElement host = ShellController.Current?.Shell.Root.Q<VisualElement>(LastSavedChip.ElementName);
            Log($"{name}: {(pill == null ? "no chip" : pill.Q<Label>()?.text)} / {host?.userData}");
            yield return Capture(name);
            if (pill != null && host?.userData is string detail)
            {
                DsTooltip.ShowNow(pill, detail, "Last saved");
                yield return Wait(0.5f);
                yield return Capture(name + "-tooltip");
                DsTooltip.Hide();
            }
        }

        /// <summary>Plays <paramref name="days"/> days: shows on Auto, other stops cleared as SkipCheck does.</summary>
        private static IEnumerator PlayDays(int days)
        {
            EngineDayControl day = EngineGame.Current.DayControl;
            for (int step = 0; step < days * 4; step++)
            {
                yield return Await(SkipCheck.Settle());
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    if (--days < 0) break;
                    day.NextDay();
                    yield return Wait(0.2f);
                    while (day.Advancing) yield return null;
                    // A save a day, so the slot has a few backups to show.
                    if (GameSession.Current != null) yield return Await(GameSession.Current.SaveNowAsync());
                    continue;
                }

                GateHit lead = DayControlLogic.LeadingGate(gates);
                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    yield return Await(SkipCheck.ShowNight(EngineGame.Current, lead));
                    continue;
                }

                yield return Await(SkipCheck.ClearStop(lead));
                ShellController.Current.Overlay.CloseAll();
            }

            Log("played the days");
        }

        private static VisualElement TitleRoot()
        {
            TitleController title = FindAnyObjectByType<TitleController>();
            return title == null ? null : title.GetComponent<UIDocument>().rootVisualElement;
        }

        private static void CloseTitleOverlays()
        {
            VisualElement root = TitleRoot();
            VisualElement layer = root?.Q<VisualElement>(OverlayLayer.ElementName);
            if (layer != null) OverlayLayer.Of(layer)?.CloseAll();
        }

        private static T TitleQ<T>(Func<T, bool> match, bool quiet = false) where T : VisualElement
        {
            VisualElement root = TitleRoot();
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null && !quiet) Debug.LogWarning($"[SaveShots] no {typeof(T).Name} found");
            return found;
        }

        private static void Click(Button button)
        {
            if (button == null) return;
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static void Log(string text) => Debug.Log("[SaveShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[SaveShots] timed out");
            Application.Quit(1);
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

        private static IEnumerator WaitFor(Func<bool> done, float timeout)
        {
            float until = Time.realtimeSinceStartup + timeout;
            while (!done() && Time.realtimeSinceStartup < until) yield return null;
        }

        private static IEnumerator WaitIdle(float atLeast)
        {
            yield return new WaitForSecondsRealtime(0.4f);
            float until = Time.realtimeSinceStartup + 30f;
            while (EngineRuntime.Client != null && EngineRuntime.Client.IsBusy && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(atLeast);
        }

        private static IEnumerator Await(Task task)
        {
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted) Debug.LogException(task.Exception);
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            index++;
            string path = Path.Combine(folder, $"{index:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[SaveShots] {path}");
        }
    }
}
