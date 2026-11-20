using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using RingsideBooker.Engine;
using RingsideBooker.Release;
using RingsideBooker.Saves;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Crash
{
    /// <summary>The engine-stopped screen's words (pure, tested).</summary>
    public static class EngineStoppedText
    {
        public static string Title(EngineFault fault) =>
            fault != null && fault.AtStart ? "The simulation could not start" : "The simulation stopped";

        public static string Body(EngineFault fault, bool hasSave)
        {
            if (fault != null && fault.AtStart)
            {
                return "The game's engine didn't start, so no game can be played right now. Try again, or restart Ringside Booker. " +
                       "If it keeps happening, send feedback: the bug report helps us fix it.";
            }

            return hasSave
                ? "Something inside the game went wrong and it can't carry on. Your last save is safe: nothing was saved after the problem. Reload it to pick up from there."
                : "Something inside the game went wrong and it can't carry on. This game hadn't been saved yet, so go back to the title and start again.";
        }

        /// <summary>"Last save: Altura career · game date 2026-03-14 · saved 19 Nov 2026, 14:32".</summary>
        public static string LastSave(SaveSlotInfo slot)
        {
            if (slot == null) return null;
            var parts = new List<string> { slot.Label ?? slot.SlotId };
            if (!string.IsNullOrEmpty(slot.GameDate)) parts.Add("game date " + slot.GameDate);
            parts.Add("saved " + slot.SavedAt.ToLocalTime().ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture));
            return "Last save: " + string.Join(" · ", parts);
        }

        /// <summary>What "Copy details" puts on the clipboard (the web's errorReport).</summary>
        public static string Report(EngineFault fault, string version)
        {
            var text = new StringBuilder();
            text.AppendLine($"Ringside Booker {version}: {(fault != null && fault.AtStart ? "the simulation could not start" : "the simulation stopped")}");
            if (fault != null)
            {
                text.AppendLine($"Call: {fault.Call}");
                text.AppendLine($"Error: {fault.Message}");
                text.AppendLine($"At: {fault.At.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} UTC");
                if (!string.IsNullOrEmpty(fault.Detail))
                {
                    text.AppendLine();
                    text.AppendLine(fault.Detail);
                }
            }

            return text.ToString().TrimEnd();
        }
    }

    /// <summary>
    /// The engine-stopped screen (UNITY-24): shown over everything, in the title or the game, the
    /// moment the engine stops. It leads with the decision (Reload last save, Back to title); the
    /// other ways back (a backup, a safe start) and the bug report tools sit in a quieter row; the
    /// error text is one click away. It lives on its own UIDocument (drawn above the scene's) that
    /// survives until the player picks a way back.
    /// </summary>
    public sealed class EngineStoppedScreen : MonoBehaviour
    {
        public const string ElementName = "engine-stopped";

        private static EngineStoppedScreen current;

        private readonly List<UIDocument> hidden = new List<UIDocument>();
        private readonly SaveStore store = new SaveStore();
        private EngineFault fault;
        private UIDocument document;
        private PanelSettings settings;
        private Label status;
        private bool busy;

        /// <summary>True while the screen is up.</summary>
        public static bool IsShowing => current != null;

        /// <summary>The screen's root element (tours), or null.</summary>
        public static VisualElement Root => current != null && current.document != null ? current.document.rootVisualElement.Q(ElementName) : null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            EngineRuntime.Stopped -= Show;
            EngineRuntime.Stopped += Show;
        }

        /// <summary>Shows the screen for <paramref name="stopped"/> (replacing one already up).</summary>
        public static void Show(EngineFault stopped)
        {
            if (current != null)
            {
                current.fault = stopped;
                current.Render();
                return;
            }

            var host = new GameObject("EngineStopped");
            DontDestroyOnLoad(host);
            current = host.AddComponent<EngineStoppedScreen>();
            current.fault = stopped;
        }

        /// <summary>Takes the screen down (a way back was chosen).</summary>
        public static void Hide()
        {
            if (current == null) return;
            EngineStoppedScreen screen = current;
            current = null;
            screen.RestoreHidden();
            Destroy(screen.gameObject);
        }

        private void Update()
        {
            if (document != null) return;
            // Draw with the scene's panel settings (theme and scale), on a copy this screen owns.
            UIDocument sceneDocument = FindAnyObjectByType<UIDocument>();
            if (sceneDocument == null || sceneDocument.panelSettings == null) return;
            settings = Instantiate(sceneDocument.panelSettings);
            settings.name = "EngineStopped (runtime)";
            settings.sortingOrder = 1000;
            document = gameObject.AddComponent<UIDocument>();
            document.panelSettings = settings;
            document.sortingOrder = 1000;
            foreach (UIDocument other in FindObjectsByType<UIDocument>())
            {
                if (other == document || other.rootVisualElement == null) continue;
                other.rootVisualElement.style.display = DisplayStyle.None;
                hidden.Add(other);
            }

            Render();
        }

        private void OnDestroy()
        {
            if (settings != null) Destroy(settings);
            if (current == this) current = null;
        }

        private void RestoreHidden()
        {
            foreach (UIDocument other in hidden)
            {
                if (other != null && other.rootVisualElement != null) other.rootVisualElement.style.display = DisplayStyle.Flex;
            }

            hidden.Clear();
        }

        private void Render()
        {
            if (document == null) return;
            VisualElement root = document.rootVisualElement;
            root.Clear();
            CrashStyles.Apply(root);
            root.Add(Build());
        }

        private VisualElement Build()
        {
            bool atStart = fault != null && fault.AtStart;
            SaveSlotInfo slot = atStart ? null : Recovery.LastSlot(store);
            VisualElement screen = Ui.El("cx-stopped").Named(ElementName);
            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.AddToClassList("cx-stopped__scroll");
            VisualElement card = Ui.El("cx-stopped__card");

            card.Add(new Icon("warning", "ds-icon--2xl", "cx-stopped__icon"));
            card.Add(Ds.Display(EngineStoppedText.Title(fault), "cx-stopped__title").Named("engine-stopped-title"));
            card.Add(Ui.Text(EngineStoppedText.Body(fault, slot != null), "cx-stopped__body", "t-wrap"));
            string lastSave = EngineStoppedText.LastSave(slot);
            if (lastSave != null) card.Add(Ui.Text(lastSave, "cx-stopped__save", "t-wrap").Named("engine-stopped-save"));

            // The decision.
            VisualElement main = Ui.El("cx-stopped__actions");
            Button first;
            if (atStart)
            {
                first = Ds.Button("Try again", TryAgain, DsButtonKind.Primary, "reset");
                first.name = "stopped-try-again";
                main.Add(first);
                main.Add(Named(Ds.Button("Quit", SceneFlow.Quit, DsButtonKind.Secondary, "log-out"), "stopped-quit"));
            }
            else if (slot != null)
            {
                first = Ds.Button("Reload last save", () => Reload(slot), DsButtonKind.Primary, "history");
                first.name = "stopped-reload";
                main.Add(first);
                main.Add(Named(Ds.Button("Back to title", () => Recovery.BackToTitle(false), DsButtonKind.Secondary, "home"), "stopped-title"));
            }
            else
            {
                first = Ds.Button("Back to title", () => Recovery.BackToTitle(false), DsButtonKind.Primary, "home");
                first.name = "stopped-title";
                main.Add(first);
            }

            card.Add(main);
            status = Ui.Text(string.Empty, "cx-stopped__status", "t-wrap").Named("stopped-status");
            status.SetShown(false);
            card.Add(status);

            // The quieter ways back and the bug report.
            VisualElement more = Ui.El("cx-stopped__more");
            more.Add(Ui.Text(TextFormat.Upper("Other choices"), "cx-stopped__more-title"));
            VisualElement row = Ui.El("cx-stopped__more-row");
            if (slot != null)
            {
                IReadOnlyList<BackupChoice> backups = Backups.Source.List(store, slot);
                foreach (BackupChoice backup in backups)
                {
                    BackupChoice choice = backup;
                    Button button = Ds.Button("Load a backup: " + choice.Label, () => LoadBackup(slot, choice), DsButtonKind.Ghost, "history");
                    button.name = "stopped-backup-" + choice.Id;
                    if (choice.Detail != null) DsTooltip.Attach(button, choice.Detail);
                    row.Add(button);
                }
            }

            if (!atStart)
            {
                Button safe = Ds.Button("Start safe", () => Recovery.BackToTitle(true), DsButtonKind.Ghost, "lock");
                safe.name = "stopped-safe";
                DsTooltip.Attach(safe, "Back to the title without loading anything, with the choices for a save that keeps stopping.");
                row.Add(safe);
            }

            Button copy = null;
            copy = Ds.Button("Copy details", () =>
            {
                GUIUtility.systemCopyBuffer = EngineStoppedText.Report(fault, ReleaseInfo.Version);
                SetStatus("Copied. Paste it into your bug report.", false);
            }, DsButtonKind.Ghost, "clipboard");
            copy.name = "stopped-copy";
            row.Add(copy);
            more.Add(row);
            more.Add(FeedbackUi.Block(compact: true, namePrefix: "stopped-feedback"));
            card.Add(more);

            // The error itself, one step away.
            Label details = Ui.Text(EngineStoppedText.Report(fault, ReleaseInfo.Version), "cx-stopped__details", "mono", "t-wrap").Named("stopped-details");
            details.SetShown(false);
            Button toggle = null;
            toggle = Ds.Button("Error details", () =>
            {
                bool open = details.style.display == DisplayStyle.None;
                details.SetShown(open);
                toggle.Q<Label>(className: "ds-btn__label").text = TextFormat.Upper(open ? "Hide error details" : "Error details");
            }, DsButtonKind.Ghost, "chevron-down");
            toggle.name = "stopped-details-toggle";
            toggle.AddToClassList("cx-stopped__details-toggle");
            card.Add(toggle);
            card.Add(details);

            scroll.Add(Ui.El("cx-stopped__center").With(card));
            screen.Add(scroll);
            first.schedule.Execute(() => first.Focus()).ExecuteLater(50);
            return screen;
        }

        private static Button Named(Button button, string name)
        {
            button.name = name;
            return button;
        }

        private async void Reload(SaveSlotInfo slot)
        {
            if (busy) return;
            busy = true;
            SetStatus("Starting the engine and loading " + (slot.Label ?? slot.SlotId) + "…", false);
            string problem = await Recovery.ReloadAsync(store, slot);
            busy = false;
            if (problem != null && current == this) SetStatus("It would not load: " + problem + " Try a backup, or go back to the title.", true);
        }

        private async void LoadBackup(SaveSlotInfo slot, BackupChoice choice)
        {
            if (busy) return;
            busy = true;
            SetStatus("Starting the engine and loading the backup…", false);
            string problem = await Recovery.LoadBackupAsync(store, slot, choice);
            busy = false;
            if (problem != null && current == this) SetStatus("The backup would not load: " + problem, true);
        }

        private async void TryAgain()
        {
            if (busy) return;
            busy = true;
            SetStatus("Starting the engine…", false);
            try
            {
                EngineRuntime.Reset();
                await EngineRuntime.GetClientAsync();
                busy = false;
                Hide();
                SceneFlow.LoadTitle();
            }
            catch (Exception error)
            {
                busy = false;
                if (current == this) SetStatus("It still didn't start: " + error.GetBaseException().Message, true);
            }
        }

        private void SetStatus(string text, bool problem)
        {
            if (status == null) return;
            status.text = text;
            status.EnableInClassList("cx-stopped__status--problem", problem);
            status.SetShown(true);
        }
    }
}
