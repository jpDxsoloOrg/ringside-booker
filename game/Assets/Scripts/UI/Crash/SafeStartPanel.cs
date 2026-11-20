using System;
using System.Collections.Generic;
using RingsideBooker.Diagnostics;
using RingsideBooker.Saves;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Crash
{
    /// <summary>The safe-start panel's words (pure, tested).</summary>
    public static class SafeStartText
    {
        public static string Lead(int streak, bool asked)
        {
            if (asked || streak < CrashStreak.SafeStartAfter)
            {
                return "Nothing has been loaded. Pick how to carry on.";
            }

            return $"Ringside Booker stopped {Times(streak)} in a row, so nothing has been loaded this time. Pick how to carry on.";
        }

        public static string Times(int count) => count switch
        {
            1 => "once",
            2 => "twice",
            _ => count + " times",
        };
    }

    /// <summary>
    /// Safe start (POL1-03 in the Unity game): after a crash loop, or when the crash screen's "Start
    /// safe" was chosen, the title screen opens on this panel instead of New game. Nothing loads by
    /// itself; the player picks: load a backup of the last save, open it anyway, start a new game,
    /// or send feedback.
    /// </summary>
    public static class SafeStartPanel
    {
        public const string ElementName = "safe-start";

        /// <param name="showNewGame">Opens the title's New game panel.</param>
        public static VisualElement Build(Action showNewGame)
        {
            bool asked = CrashGuard.SafeStartRequested;
            int streak = CrashGuard.Streak;
            CrashGuard.MarkOffered();
            var store = new SaveStore();
            SaveSlotInfo slot = Recovery.LastSlot(store);

            VisualElement panel = Ui.El("cx-safe").Named(ElementName);
            CrashStyles.Apply(panel);
            panel.Add(Ui.Text(SafeStartText.Lead(streak, asked), "cx-safe__lead", "t-wrap"));
            Label status = Ui.Text(string.Empty, "cx-safe__status", "t-wrap").Named("safe-start-status");
            status.SetShown(false);
            bool busy = false;

            void SetStatus(string text, bool problem)
            {
                status.text = text;
                status.EnableInClassList("cx-safe__status--problem", problem);
                status.SetShown(true);
            }

            async void Open(Func<System.Threading.Tasks.Task<string>> open, string loading)
            {
                if (busy) return;
                busy = true;
                SetStatus(loading, false);
                string problem = await open();
                busy = false;
                if (problem != null && panel.panel != null) SetStatus("It would not load: " + problem, true);
            }

            VisualElement choices = Ui.El("cx-safe__choices");
            if (slot != null)
            {
                choices.Add(Ui.Text(EngineStoppedText.LastSave(slot), "cx-safe__save", "t-wrap").Named("safe-start-save"));
                IReadOnlyList<BackupChoice> backups = Backups.Source.List(store, slot);
                bool primaryUsed = false;
                foreach (BackupChoice backup in backups)
                {
                    BackupChoice choice = backup;
                    Button button = Ds.Button("Load a backup: " + choice.Label,
                        () => Open(() => Recovery.LoadBackupAsync(store, slot, choice), "Loading the backup…"),
                        primaryUsed ? DsButtonKind.Secondary : DsButtonKind.Primary, "history");
                    button.name = "safe-backup-" + choice.Id;
                    primaryUsed = true;
                    choices.Add(Choice(button, choice.Detail));
                }

                Button anyway = Ds.Button("Open the last save anyway",
                    () => Open(() => Recovery.ReloadAsync(store, slot), "Loading " + (slot.Label ?? slot.SlotId) + "…"),
                    primaryUsed ? DsButtonKind.Secondary : DsButtonKind.Primary, "play");
                anyway.name = "safe-open-anyway";
                choices.Add(Choice(anyway, "If it stops again, try a backup or send feedback."));
            }

            Button newGame = Ds.Button("Start a new game", showNewGame, slot == null ? DsButtonKind.Primary : DsButtonKind.Secondary, "add");
            newGame.name = "safe-new-game";
            choices.Add(Choice(newGame, "Your saves stay where they are."));
            panel.Add(choices);
            panel.Add(status);
            panel.Add(Ui.Text("Tell us what happened: the bug report holds what we need to fix it. " + FeedbackUi.WhatsInIt, "field-hint", "t-wrap", "cx-safe__hint"));
            panel.Add(FeedbackUi.Block(namePrefix: "safe-feedback"));
            return panel;
        }

        private static VisualElement Choice(Button button, string hint)
        {
            VisualElement row = Ui.El("cx-safe__choice").With(button);
            if (!string.IsNullOrEmpty(hint)) row.Add(Ui.Text(hint, "cx-safe__choice-hint", "t-wrap"));
            return row;
        }
    }
}
