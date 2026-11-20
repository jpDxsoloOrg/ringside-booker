using System;
using System.Globalization;
using RingsideBooker.Saves;
using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.SaveUi
{
    /// <summary>
    /// The "Last saved" chip in the game's top bar (POL1-04): "Saved 11 Jan" (the game date of the
    /// latest save of the running slot), moving after every autosave and save. Hover or focus shows
    /// when and how it was saved and how many backups the slot keeps. A failed save turns it into a
    /// warning ("Not saved") with the reason. Hidden when no save session runs (the demo shell).
    /// </summary>
    public sealed class LastSavedChip
    {
        public const string ElementName = "last-saved";

        private readonly VisualElement host;
        private GameSession session;

        private LastSavedChip(VisualElement host)
        {
            this.host = host;
            GameSession.CurrentChanged += Follow;
            host.RegisterCallback<DetachFromPanelEvent>(_ => Dispose());
            Follow(GameSession.Current);
        }

        /// <summary>The chip's element (tours and tests).</summary>
        public VisualElement Element => host;

        /// <summary>Adds the chip to the top bar, before the scoreboard. Returns null when the shell has no top bar.</summary>
        public static LastSavedChip Attach(AppShell shell)
        {
            VisualElement topBar = shell?.Root.Q<VisualElement>("ds-topbar");
            VisualElement board = shell?.Root.Q<VisualElement>("ds-topbar-board");
            if (topBar == null || board == null) return null;
            var host = new VisualElement { name = ElementName };
            host.style.flexDirection = FlexDirection.Row;
            host.style.alignItems = Align.Center;
            host.style.alignSelf = Align.Center;
            host.style.flexShrink = 0;
            host.style.marginRight = 12;
            topBar.Insert(topBar.IndexOf(board), host);
            return new LastSavedChip(host);
        }

        /// <summary>"Saved 11 Jan" / "Not saved", and the tooltip's words (pure; tested).</summary>
        public static (string Text, string Detail, bool Warning) Words(SaveSlotInfo lastSaved, SaveKind kind, string problem, int backups)
        {
            if (problem != null)
            {
                string previous = lastSaved?.GameDate != null ? " The last good save is from " + LongDate(lastSaved.GameDate) + "." : string.Empty;
                return ("Not saved", problem + previous, true);
            }

            if (lastSaved == null) return (null, null, false);
            string when = lastSaved.SavedAt == default
                ? string.Empty
                : ", at " + lastSaved.SavedAt.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture);
            string how = kind switch
            {
                SaveKind.Autosave => " (saved automatically)",
                SaveKind.Created => " (new game)",
                SaveKind.Final => " (saved on exit)",
                SaveKind.Loaded => " (loaded)",
                SaveKind.LoadedBackup => " (loaded from a backup)",
                _ => string.Empty,
            };
            string backupWords = backups == 1 ? "1 backup kept." : backups + " backups kept.";
            string verb = kind == SaveKind.Loaded || kind == SaveKind.LoadedBackup ? "Loaded " : "Saved ";
            return (verb + ShortDate(lastSaved.GameDate), $"{LongDate(lastSaved.GameDate)}{when}{how}. {backupWords}", false);
        }

        private void Follow(GameSession next)
        {
            if (session != null) session.Saved -= OnSaved;
            session = next;
            if (session != null) session.Saved += OnSaved;
            Render();
        }

        private void OnSaved(SaveOutcome outcome) => Render();

        private void Render()
        {
            host.Clear();
            (string text, string detail, bool warning) = session == null
                ? (null, null, false)
                : Words(session.LastSaved, session.LastSaveKind, session.LastProblem, session.LastSaved?.BackupCount ?? 0);
            host.style.display = text == null ? DisplayStyle.None : DisplayStyle.Flex;
            if (text == null) return;
            VisualElement pill = Ds.Pill(warning ? DsState.Warn : DsState.Neutral, text, warning ? "warning" : "check-circle");
            pill.name = "last-saved-pill";
            pill.style.marginRight = 0;
            pill.focusable = true;
            host.Add(pill);
            host.userData = detail;
            DsTooltip.Attach(pill, detail, warning ? "Last save failed" : "Last saved");
        }

        private void Dispose()
        {
            GameSession.CurrentChanged -= Follow;
            if (session != null) session.Saved -= OnSaved;
            session = null;
        }

        private static string ShortDate(string iso) => Format(iso, "d MMM");

        private static string LongDate(string iso) => Format(iso, "d MMM yyyy");

        private static string Format(string iso, string pattern)
        {
            return DateTime.TryParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime date)
                ? date.ToString(pattern, CultureInfo.InvariantCulture)
                : iso ?? "an unknown date";
        }
    }
}
