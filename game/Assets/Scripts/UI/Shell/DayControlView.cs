using System;
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
            skip = Ui.Btn("»", () => this.openSkip(), null);
            skip.name = "skip-days";
            skip.AddToClassList("btn--icon");
            skip.tooltip = "Skip days";
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

        /// <summary>Presses the main button: one day, or go to the stop, or list the stops.</summary>
        public void RunPrimary()
        {
            if (day == null || state == null) return;
            DayPrimaryAction action = state.Primary;
            switch (action.Kind)
            {
                case DayPrimaryKind.Next:
                    day.NextDay();
                    break;
                case DayPrimaryKind.Gate when action.Destination != null:
                    navigator.Go(action.Destination);
                    break;
                case DayPrimaryKind.Gate:
                    OpenWaitingSheet();
                    break;
            }
        }

        /// <summary>Every stop waiting today, in the player's words, for a stop no screen handles yet.</summary>
        private void OpenWaitingSheet()
        {
            Sheet sheet = Sheet.Open(overlay, "Waiting on you", SheetPlacement.Center, small: true);
            sheet.Body.Add(Ui.Text("The day can't move until these are dealt with.", "field-hint"));
            var list = new VisualElement();
            list.style.marginTop = 12;
            foreach (GateHit hit in day.Gates)
            {
                list.Add(Ui.El("list-row").With(Ui.Text(hit.Reason, "t-sm", "t-wrap")));
            }
            sheet.Body.Add(list);
        }
    }
}
