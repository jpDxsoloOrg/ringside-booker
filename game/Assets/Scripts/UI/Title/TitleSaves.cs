using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Engine;
using RingsideBooker.Saves;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Title
{
    /// <summary>
    /// The title screen's save panels: Continue (the latest slot), Load (every slot: load, backups,
    /// export, delete, import a file, open the folder), the interim quick start, the Backups sheet
    /// (UNITY-27), and the sheets for a save that will not load ("Made with an older build" and
    /// "Could not load", which offers every backup).
    /// </summary>
    internal sealed class TitleSaves
    {
        private const string StyleResource = "Saves/SaveSlots";
        private const string QuickStartName = "New career";

        private static StyleSheet styles;

        private readonly Func<string, VisualElement> resetPanel;
        private readonly OverlayLayer overlay;
        private readonly Action showNewGame;
        private readonly SaveStore store = new SaveStore();
        private bool busy;

        /// <param name="resetPanel">Clears the title's right panel and returns its content element with a heading.</param>
        public TitleSaves(Func<string, VisualElement> resetPanel, OverlayLayer overlay, Action showNewGame)
        {
            this.resetPanel = resetPanel;
            this.overlay = overlay;
            this.showNewGame = showNewGame;
            ApplyStyles(overlay.Layer);
        }

        /// <summary>Continue: loads the most recent save, or says there is none.</summary>
        public async void Continue()
        {
            if (busy) return;
            VisualElement inner = Panel("Continue");
            Label status = Status(inner, "Finding your latest save…");
            try
            {
                await GameSession.Ending;
                EngineClient engine = await SaveEngine.GetAsync();
                IReadOnlyList<SaveSlotInfo> slots = await store.ListAsync(engine);
                if (inner.parent == null) return;
                SaveSlotInfo latest = slots.FirstOrDefault(slot => !slot.NeedsInspect);
                if (latest == null)
                {
                    status.text = "No saves yet. Start a new game and it saves itself as you play.";
                    inner.Add(Ui.Btn("NEW GAME", showNewGame, "btn--primary").Named("continue-new-game"));
                    return;
                }

                Open(latest, null);
            }
            catch (Exception error)
            {
                ShowError(status, error);
            }
        }

        /// <summary>Load: the list of slots.</summary>
        public async void ShowLoad(string message = null, bool messageIsError = false)
        {
            VisualElement inner = Panel("Load");
            VisualElement toolbar = Ui.El("save-toolbar").With(
                Ui.Btn("IMPORT A SAVE…", Import).Named("load-import"),
                Ui.Btn("OPEN SAVES FOLDER", OpenFolder, "btn--ghost").Named("load-open-folder"));
            inner.Add(toolbar);
            Label status = Status(inner, message ?? "Reading your saves…");
            if (messageIsError) status.AddToClassList("save-status--error");
            try
            {
                await GameSession.Ending;
                EngineClient engine = await SaveEngine.GetAsync();
                IReadOnlyList<SaveSlotInfo> slots = await store.ListAsync(engine);
                if (inner.parent == null) return;
                string fingerprint = engine.Ready.Result.SchemaFingerprint;
                if (message == null)
                {
                    status.text = slots.Count == 0
                        ? "No saves yet. Saves are files in " + store.Directory + "; a .rbsave from the web app can be imported."
                        : slots.Count + (slots.Count == 1 ? " save" : " saves") + " in " + store.Directory;
                }

                // A long list scrolls inside the panel instead of squeezing the rows (UNITY-13 layout rule).
                inner.AddToClassList("save-panel");
                var list = new ScrollView(ScrollViewMode.Vertical) { name = "save-list", horizontalScrollerVisibility = ScrollerVisibility.Hidden };
                list.AddToClassList("save-list");
                foreach (SaveSlotInfo slot in slots) list.Add(SlotRow(slot, fingerprint));
                inner.Add(list);
                list.Q<Button>(className: "btn--primary")?.Focus();
            }
            catch (Exception error)
            {
                ShowError(status, error);
            }
        }

        /// <summary>Adds the interim quick start (a default-world game, saved to a new slot) to the New game card.</summary>
        public void AddQuickStart(VisualElement card)
        {
            Button start = Ui.Btn("START A DEFAULT-WORLD GAME", StartDefaultGame, "btn--primary").Named("start-default-world");
            start.style.alignSelf = Align.FlexStart;
            start.style.marginTop = 12;
            card.Add(start);
        }

        private VisualElement Panel(string title)
        {
            VisualElement inner = resetPanel(title);
            ApplyStyles(inner);
            return inner;
        }

        private VisualElement SlotRow(SaveSlotInfo slot, string fingerprint)
        {
            VisualElement meta = Ui.El("save-slot__meta").With(
                Ui.Text($"Saved {slot.SavedAtText()} · {slot.SizeText()}", "save-slot__meta-text"));
            if (SaveCompat.FromOtherBuild(slot, fingerprint))
            {
                Label tag = Ui.Text("Older build", "save-tag");
                tag.tooltip = "Saved by a build with a different save format. It may not open.";
                meta.Add(tag);
            }

            if (slot.NeedsInspect) meta.Add(Ui.Text("Unreadable", "save-tag"));
            if (slot.MadeByAlpha)
            {
                Label alpha = Ui.Text("Alpha", "save-tag", "save-tag--quiet").Named("save-alpha-" + slot.SlotId);
                alpha.tooltip = "Saved by an Alpha build" + (slot.BuildVersion == null ? "." : " (" + slot.BuildVersion + ").");
                meta.Add(alpha);
            }

            VisualElement main = Ui.El("save-slot__main").With(
                Ui.Text(slot.Label ?? slot.SlotId, "save-slot__label"),
                Ui.Text(slot.Subtitle, "save-slot__subtitle"),
                meta);

            Button load = Ui.Btn("LOAD", () => Open(slot, null), "btn--primary");
            load.SetEnabled(!slot.NeedsInspect);
            Button backups = Ui.Btn(slot.BackupCount > 0 ? $"BACKUPS ({slot.BackupCount})" : "BACKUPS", () => OpenBackupsSheet(slot)).Named("backups-" + slot.SlotId);
            backups.tooltip = slot.BackupCount > 0 ? "Earlier versions of this save" : "No backups yet: the next save keeps this one";
            VisualElement actions = Ui.El("save-slot__actions").With(
                load,
                backups,
                Ui.Btn("EXPORT", () => Export(slot)),
                Ui.Btn("DELETE", () => ConfirmDelete(slot, null), "btn--ghost"));
            return Ui.El("card", "save-slot").With(main, actions).Named("save-slot-" + slot.SlotId);
        }

        /// <param name="backup">A backup of the slot to load instead of its latest save; null for the save.</param>
        private async void Open(SaveSlotInfo slot, SaveBackupInfo backup)
        {
            if (busy) return;
            busy = true;
            VisualElement inner = Panel(backup != null ? "Load backup" : "Continue");
            Label status = Status(inner, backup != null ? $"Loading the backup of {slot.Label} from {BackupDate(backup)}…" : $"Loading {slot.Label}…");
            try
            {
                EngineClient engine = await SaveEngine.GetAsync();
                OpenResult result = backup != null
                    ? await GameSession.OpenBackupAsync(engine, slot, backup.BackupId, store)
                    : await GameSession.OpenSlotAsync(engine, slot, store);
                busy = false;
                switch (result.Status)
                {
                    case OpenStatus.Opened:
                        GameEntry.Enter(engine, result.Session.Seat);
                        return;
                    case OpenStatus.OlderBuild:
                        ShowLoad();
                        OpenOlderBuildSheet(slot, result);
                        return;
                    default:
                        ShowLoad();
                        OpenLoadErrorSheet(slot, result);
                        return;
                }
            }
            catch (Exception error)
            {
                busy = false;
                ShowError(status, error);
            }
        }

        private async void StartDefaultGame()
        {
            if (busy) return;
            busy = true;
            VisualElement inner = Panel("New game");
            Label status = Status(inner, "Building the default world…");
            try
            {
                EngineClient engine = await SaveEngine.GetAsync();
                await GameSession.EndCurrentAsync();
                string seed = "rb-" + DateTime.UtcNow.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
                NewGameResult created = await engine.NewGame(DesktopSaveSettings.DefaultWorldGame(QuickStartName, seed));
                if (!created.Ok)
                {
                    busy = false;
                    status.text = "The game could not be made: " + created.ReasonText;
                    status.AddToClassList("save-status--error");
                    return;
                }

                status.text = "Saving…";
                await GameSession.BeginNewAsync(engine, QuickStartName, created.Revision, created.Seat, store);
                busy = false;
                GameEntry.Enter(engine, created.Seat);
            }
            catch (Exception error)
            {
                busy = false;
                ShowError(status, error);
            }
        }

        private async void Export(SaveSlotInfo slot)
        {
            string fileName = slot.SlotId + SaveStore.SaveExtension;
            string target;
            if (FileDialogs.IsAvailable)
            {
                target = FileDialogs.SaveFile("Export save", fileName, Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
                if (target == null) return;
            }
            else
            {
                target = Path.Combine(store.Directory, "Exports", fileName);
            }

            try
            {
                await Task.Run(() => store.Export(slot.SlotId, target));
                ShowLoad("Exported " + slot.Label + " to " + target);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                ShowLoad("Could not export: " + error.Message, true);
            }
        }

        private async void Import()
        {
            if (busy) return;
            if (!FileDialogs.IsAvailable)
            {
                ShowLoad("Copy a .rbsave file into " + store.Directory + " and it shows up in this list.");
                return;
            }

            string source = FileDialogs.OpenFile("Import a save", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
            if (source == null) return;
            busy = true;
            try
            {
                EngineClient engine = await SaveEngine.GetAsync();
                ImportResult result = await store.ImportAsync(engine, source);
                busy = false;
                if (result.Ok)
                {
                    ShowLoad("Imported " + result.Slot.Label + ".");
                }
                else
                {
                    ShowLoad(result.Problem, true);
                }
            }
            catch (Exception error)
            {
                busy = false;
                ShowLoad("Could not import: " + error.GetBaseException().Message, true);
            }
        }

        private void OpenFolder()
        {
            Directory.CreateDirectory(store.Directory);
            Application.OpenURL("file:///" + store.Directory.Replace('\\', '/'));
        }

        private void ConfirmDelete(SaveSlotInfo slot, Action deleted)
        {
            Sheet sheet = Sheet.Open(overlay, $"Delete {slot.Label}?", SheetPlacement.Center, small: true);
            ApplyStyles(sheet.Root);
            sheet.Body.Add(Ui.Text("This also deletes its backup. This can't be undone.", "save-sheet__body"));
            sheet.AddFooterButton("Cancel", sheet.Close, "btn--ghost");
            Button confirm = sheet.AddFooterButton("Delete", () =>
            {
                try
                {
                    store.Delete(slot.SlotId);
                    sheet.Close();
                    deleted?.Invoke();
                    ShowLoad("Deleted " + slot.Label + ".");
                }
                catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
                {
                    sheet.Close();
                    ShowLoad("Could not delete: " + error.Message, true);
                }
            }, "btn--primary");
            confirm.name = "confirm-delete";
            confirm.schedule.Execute(() => confirm.Focus());
        }

        /// <summary>The web's older-build sheet: copy details, export, delete, start a new game.</summary>
        private void OpenOlderBuildSheet(SaveSlotInfo slot, OpenResult result)
        {
            Sheet sheet = Sheet.Open(overlay, SaveCompat.OlderBuildTitle, SheetPlacement.Right);
            ApplyStyles(sheet.Root);
            sheet.Root.name = "older-build";
            sheet.Body.Add(Ui.Text(SaveCompat.OlderBuildBody, "save-sheet__body"));
            Label copyStatus = Ui.Text(string.Empty, "save-status");
            sheet.Body.Add(copyStatus);
            AddCopyButton(sheet, result.Report, copyStatus);
            sheet.AddFooterButton("Export this save", () =>
            {
                sheet.Close();
                Export(slot);
            });
            sheet.AddFooterButton("Delete this save", () => ConfirmDelete(slot, sheet.Close), "btn--ghost");
            sheet.AddFooterButton("Start a new game", () =>
            {
                sheet.Close();
                showNewGame();
            }, "btn--primary");
        }

        private void OpenLoadErrorSheet(SaveSlotInfo slot, OpenResult result)
        {
            Sheet sheet = Sheet.Open(overlay, "Could not load", SheetPlacement.Right);
            ApplyStyles(sheet.Root);
            sheet.Root.name = "load-error";
            sheet.Body.Add(Ui.Text($"{slot.Label} would not load. {result.Problem}", "save-sheet__body"));
            Label copyStatus = Ui.Text(string.Empty, "save-status");
            sheet.Body.Add(copyStatus);
            // Every backup, newest first: one of them may still load (UNITY-27).
            VisualElement backups = Ui.El("save-backup-list").Named("load-error-backups");
            sheet.Body.Add(backups);
            FillBackups(backups, slot, sheet, "Or go back to an earlier version of this save:");
            AddCopyButton(sheet, result.Report, copyStatus);

            sheet.AddFooterButton("Export this save", () =>
            {
                sheet.Close();
                Export(slot);
            });
            sheet.AddFooterButton("Delete this save", () => ConfirmDelete(slot, sheet.Close), "btn--ghost");
        }

        /// <summary>The Backups sheet (UNITY-27): every backup of the slot, newest first, each loadable after a confirm.</summary>
        private void OpenBackupsSheet(SaveSlotInfo slot)
        {
            Sheet sheet = Sheet.Open(overlay, "Backups of " + (slot.Label ?? slot.SlotId), SheetPlacement.Right);
            ApplyStyles(sheet.Root);
            sheet.Root.name = "backups-sheet";
            int keep = SaveSettings.BackupsPerSlot;
            sheet.Body.Add(Ui.Text(
                $"Each save keeps its last {keep} {(keep == 1 ? "version" : "versions")}. Loading one leaves your latest save in the slot until you save over it.",
                "save-sheet__body"));
            VisualElement list = Ui.El("save-backup-list").Named("backup-list");
            sheet.Body.Add(list);
            FillBackups(list, slot, sheet, null);
            sheet.AddFooterButton("Close", sheet.Close, "btn--ghost");
        }

        // Lists the slot's backups into list (read off the main thread); "Load this backup" asks first.
        private async void FillBackups(VisualElement list, SaveSlotInfo slot, Sheet sheet, string heading)
        {
            Label status = Ui.Text("Reading backups…", "save-status");
            list.Add(status);
            try
            {
                EngineClient engine = await SaveEngine.GetAsync();
                IReadOnlyList<SaveBackupInfo> backups = await store.ListBackupsAsync(engine, slot.SlotId);
                list.Clear();
                if (backups.Count == 0)
                {
                    if (heading == null) list.Add(Ui.Text("This save has no backups yet. The next save keeps this one as a backup.", "save-status"));
                    return;
                }

                if (heading != null) list.Add(Ui.Text(heading, "save-sheet__body"));
                foreach (SaveBackupInfo backup in backups)
                {
                    SaveBackupInfo chosen = backup;
                    VisualElement info = Ui.El("save-backup__info").With(
                        Ui.Text(BackupDate(backup), "save-backup__date"),
                        Ui.Text($"Saved {backup.Info.SavedAtText()} · {backup.Info.SizeText()}", "save-backup__meta"));
                    Button load = Ui.Btn("LOAD THIS BACKUP", () => ConfirmLoadBackup(slot, chosen, sheet)).Named("load-backup-" + backup.BackupId);
                    list.Add(Ui.El("save-backup").With(info, load).Named("backup-" + backup.BackupId));
                }
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                status.text = "Could not read the backups: " + error.GetBaseException().Message;
                status.AddToClassList("save-status--error");
            }
        }

        private void ConfirmLoadBackup(SaveSlotInfo slot, SaveBackupInfo backup, Sheet from)
        {
            Sheet confirm = Sheet.Open(overlay, "Load this backup?", SheetPlacement.Center, small: true);
            ApplyStyles(confirm.Root);
            confirm.Root.name = "confirm-load-backup";
            confirm.Body.Add(Ui.Text(
                $"Load the backup from {BackupDate(backup)}? Your latest save stays in the slot until you save over it.",
                "save-sheet__body"));
            confirm.AddFooterButton("Cancel", confirm.Close, "btn--ghost");
            Button go = confirm.AddFooterButton("Load backup", () =>
            {
                confirm.Close();
                from?.Close();
                Open(slot, backup);
            }, "btn--primary");
            go.name = "confirm-load-backup-go";
            go.schedule.Execute(() => go.Focus());
        }

        /// <summary>The game date a backup holds ("Apr 10, 2026"), or when it was saved if its header was lost.</summary>
        private static string BackupDate(SaveBackupInfo backup)
        {
            if (backup.GameDate != null && DateTime.TryParseExact(backup.GameDate, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out DateTime date))
            {
                return date.ToString("MMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture);
            }

            return "the save of " + backup.Info.SavedAtText();
        }

        private static void AddCopyButton(Sheet sheet, string report, Label copyStatus)
        {
            sheet.AddFooterButton("Copy details", () =>
            {
                GUIUtility.systemCopyBuffer = report ?? string.Empty;
                copyStatus.text = "Copied. Paste it into your bug report.";
            });
        }

        private static Label Status(VisualElement inner, string text)
        {
            Label status = Ui.Text(text, "save-status").Named("save-status");
            inner.Add(status);
            return status;
        }

        private static void ShowError(Label status, Exception error)
        {
            Debug.LogException(error);
            status.text = "Something went wrong: " + error.GetBaseException().Message;
            status.AddToClassList("save-status--error");
        }

        private static void ApplyStyles(VisualElement element)
        {
            if (styles == null) styles = Resources.Load<StyleSheet>(StyleResource);
            if (styles != null && !element.styleSheets.Contains(styles)) element.styleSheets.Add(styles);
        }
    }
}
