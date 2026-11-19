using System;
using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The game's heartbeat (the web's DayControl). The live bug says "Next day" until something is
    /// waiting; then it names the stop ("Go live", "Roster", "Contracts", "Open news", "Offer
    /// answered", "2 decisions waiting") and goes where it is dealt with, because a day would not
    /// move anyway. Beside it, Skip days opens the multi-day sheet; it is off while a stop waits or
    /// days move. Shift+N presses the main button (ShellController).
    /// </summary>
    public sealed class DayControlView
    {
        public const string Shortcut = "Shift+N";

        private readonly ShellNavigator navigator;
        private readonly OverlayLayer overlay;
        private readonly Action openSkip;
        private readonly LiveBugButton primary;
        private readonly Button skip;
        private IDayControl day;
        private DayControlState state;

        public DayControlView(VisualElement container, ShellNavigator navigator, OverlayLayer overlay, Action openSkip)
        {
            this.navigator = navigator;
            this.overlay = overlay;
            this.openSkip = openSkip;

            primary = new LiveBugButton { name = "day-primary" };
            primary.Clicked += RunPrimary;
            skip = Design.Ds.IconButton("fast-forward", "Skip days…", () => this.openSkip(), quiet: false);
            skip.name = "skip-days";
            skip.AddToClassList("day-control__skip");
            container.Add(primary);
            container.Add(skip);
        }

        /// <summary>The state last drawn.</summary>
        public DayControlState State => state;

        public void Render(IDayControl dayControl)
        {
            day = dayControl;
            state = DayControlLogic.Derive(day.Gates, day.Advancing, day.ShowNight);
            DayPrimaryAction action = state.Primary;

            primary.Busy = action.Kind == DayPrimaryKind.Busy;
            primary.Text = action.Kind == DayPrimaryKind.Busy ? "Advancing…" : action.Label;
            primary.ShowArrow = action.Kind != DayPrimaryKind.Busy;
            primary.tooltip = action.Kind == DayPrimaryKind.Gate
                ? $"{action.Label} ({Shortcut}): {action.Reason}"
                : $"{action.Label} ({Shortcut})";
            primary.EnableInClassList("live-bug--gate", action.Kind == DayPrimaryKind.Gate);
            skip.SetEnabled(state.SkipEnabled);
        }

        /// <summary>
        /// Presses the main button: one day, or go to the stop, or (when no screen in this build deals
        /// with the stop) the "Needs attention" sheet that clears it in place.
        /// </summary>
        public void RunPrimary()
        {
            if (day == null || state == null) return;
            DayPrimaryAction action = state.Primary;
            switch (action.Kind)
            {
                case DayPrimaryKind.Next:
                    day.NextDay();
                    break;
                case DayPrimaryKind.Gate when action.Destination != null && ScreenRegistry.IsLive(action.Destination.ScreenId):
                    navigator.Go(action.Destination);
                    break;
                case DayPrimaryKind.Gate:
                    OpenWaitingSheet();
                    break;
            }
        }

        /// <summary>The "Needs attention" sheet, if open.</summary>
        public Sheet WaitingSheet { get; private set; }

        /// <summary>
        /// Every stop waiting today, in the player's words, each with what clears it here
        /// (<see cref="IGateActions"/>: Mark as seen, OK, Refuse…) and a link to its screen when the
        /// game has that screen. Redraws as stops clear and closes when none is left.
        /// </summary>
        public void OpenWaitingSheet()
        {
            WaitingSheet?.Close();
            IDayControl control = day;
            Sheet sheet = null;
            var list = new VisualElement { name = "waiting-list" };
            list.style.marginTop = 12;

            void Redraw()
            {
                if (sheet == null) return;
                if (control.Advancing || control.Gates.Count == 0)
                {
                    sheet.Close();
                    return;
                }
                list.Clear();
                foreach (GateHit hit in control.Gates) list.Add(Row(control, hit, sheet));
            }

            sheet = Sheet.Open(overlay, "Needs attention", SheetPlacement.Center, small: true, onClosed: () =>
            {
                control.Changed -= Redraw;
                if (WaitingSheet == sheet) WaitingSheet = null;
            });
            sheet.Root.name = "waiting-sheet";
            sheet.Body.Add(Ui.Text("The day can't move until these are dealt with.", "field-hint"));
            sheet.Body.Add(list);
            WaitingSheet = sheet;
            control.Changed += Redraw;
            Redraw();
        }

        private VisualElement Row(IDayControl control, GateHit hit, Sheet sheet)
        {
            VisualElement row = Ui.El("list-row").Named($"waiting-{hit.GateId}");
            row.Add(Ui.Text(hit.Reason, "t-sm", "t-wrap"));
            Label error = Ui.Text(string.Empty, "t-sm", "t-wrap", "t-muted");
            error.SetShown(false);
            VisualElement buttons = Ui.El("chip-row");
            buttons.style.marginTop = 6;

            IReadOnlyList<GateAction> actions = control is IGateActions source ? source.ActionsFor(hit) : Array.Empty<GateAction>();
            foreach (GateAction action in actions)
            {
                Button button = null;
                button = Ui.Btn(TextFormat.Upper(action.Label), async () =>
                {
                    button.SetEnabled(false);
                    string problem;
                    try
                    {
                        problem = await action.Run();
                    }
                    catch (Exception exception)
                    {
                        problem = exception.Message;
                    }
                    if (problem == null) return;
                    error.text = problem;
                    error.SetShown(true);
                    button.SetEnabled(true);
                }, action.Primary ? "btn--primary" : "btn--ghost");
                button.name = $"waiting-action-{hit.GateId}-{buttons.childCount}";
                button.tooltip = action.Hint;
                buttons.Add(button);
            }

            var destination = DayControlLogic.GateDestination(hit, control.Gates, control.ShowNight);
            if (destination.HasValue && ScreenRegistry.IsLive(destination.Value.to.ScreenId))
            {
                ShellRoute to = destination.Value.to;
                buttons.Add(Ui.Btn(TextFormat.Upper(destination.Value.label), () =>
                {
                    sheet.Close();
                    navigator.Go(to);
                }, actions.Count == 0 ? "btn--primary" : "btn--ghost"));
            }

            if (buttons.childCount == 0)
            {
                row.Add(Ui.Text("This build has no screen for this stop yet.", "t-sm", "t-muted"));
            }
            else
            {
                row.Add(buttons);
            }
            row.Add(error);
            return row;
        }
    }
}
