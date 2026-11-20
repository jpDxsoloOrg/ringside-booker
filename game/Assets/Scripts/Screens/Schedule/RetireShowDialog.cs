using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Schedule
{
    /// <summary>
    /// Retire a recurring show (EVT8-03): pick when the last show is (right away, or a later date),
    /// see the dates that come off the calendar and the shows that stay because they are booked or
    /// run (<c>calendar.previewRetire</c>), then confirm (<c>calendar.retireDefinition</c>). The
    /// show's past stays in its history; it moves to the Retired tab of Manage shows.
    /// </summary>
    public sealed class RetireShowDialog
    {
        public static RetireShowDialog Current { get; private set; }

        private readonly ScreenContext context;
        private readonly JToken row;
        private readonly VisualElement body = Ds.Column("sc-retire");
        private readonly VisualElement preview = Ds.Column("sc-retire__preview");
        private readonly VisualElement problem = Ds.Column("sc-problems");
        private OverlayHandle handle;
        private Button confirm;
        private string lastShowDate;
        private bool later;
        private int version;

        private RetireShowDialog(ScreenContext context, JToken row)
        {
            this.context = context;
            this.row = row;
        }

        public JToken Preview { get; private set; }

        public bool Busy { get; private set; }

        public static void Open(ScreenContext context, JToken definitionRow)
        {
            var dialog = new RetireShowDialog(context, definitionRow);
            Current = dialog;
            dialog.Build();
        }

        private void Build()
        {
            ScheduleEditor.Style(body);
            string name = Kit.Str(row, "name");
            body.Add(Ds.Text($"{name} stops running. Its past shows stay in the history.", "sc-lead"));
            GameDate today = Kit.Game.ShellData.Snapshot.Date;
            body.Add(ScheduleEditor.ChoiceField("Last show", new[] { (false, "Right away"), (true, "After a later date") }, false, picked =>
            {
                later = picked;
                body.Query<Button>().ForEach(chip =>
                {
                    if (chip.name != null && chip.name.StartsWith("retire-when-", System.StringComparison.Ordinal))
                        chip.EnableInClassList("ds-chip--selected", chip.name == "retire-when-" + picked);
                });
                dateSlot.SetShown(picked);
                lastShowDate = picked ? date.Value?.Iso ?? today.AddDays(28).Iso : null;
                RequestPreview();
            }, "retire-when"));
            dateSlot = Ds.Column("sc-slot");
            date = new DateField("Last show on", today.AddDays(28), today, today.AddDays(730), picked =>
            {
                lastShowDate = picked.Iso;
                RequestPreview();
            }, "retire-last-date");
            dateSlot.Add(date);
            dateSlot.SetShown(false);
            body.Add(dateSlot);
            body.Add(preview);
            body.Add(problem);

            VisualElement footer = Ds.Row("sc-footer");
            footer.Add(Ds.Spacer());
            Button cancel = Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost);
            cancel.name = "retire-cancel";
            footer.Add(cancel);
            confirm = Ds.Button("Retire show", () => _ = ConfirmAsync(), DsButtonKind.Danger, "trash");
            confirm.name = "retire-confirm";
            confirm.SetEnabled(false);
            footer.Add(confirm);

            OverlayLayer layer = context?.Overlay ?? ShellController.Current?.Overlay;
            if (layer == null) return;
            VisualElement modal = Ds.El("ds-modal", "sc-modal");
            ScheduleEditor.Style(modal);
            modal.name = "schedule-retire";
            modal.pickingMode = PickingMode.Position;
            VisualElement header = Ds.El("ds-overlay-header");
            VisualElement words = Ds.El("ds-overlay-header__words");
            words.Add(Ds.Text(TextFormat.Upper($"Retire {name}?"), "ds-overlay-header__title"));
            header.Add(words);
            Button close = Ds.IconButton("close", "Close (Esc)", () => handle?.Close());
            close.AddToClassList(DsTooltip.NoFocusTipClass);
            header.Add(close);
            modal.Add(header);
            var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("sc-modal__scroll");
            body.AddToClassList("ds-modal__body");
            scroll.Add(body);
            modal.Add(scroll);
            footer.AddToClassList("ds-modal__footer");
            modal.Add(footer);
            handle = layer.Open(modal, new OverlayOptions { Modal = true, Dismissable = true, Centered = true });
            handle.Entry.AddToClassList("ds-overlay--modal");
            handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };
            RequestPreview();
        }

        private VisualElement dateSlot;
        private DateField date;

        private void RequestPreview()
        {
            int ticket = ++version;
            confirm?.SetEnabled(false);
            Busy = true;
            body.schedule.Execute(() => _ = RunPreview(ticket)).StartingIn(120);
        }

        private async Task RunPreview(int ticket)
        {
            if (ticket != version) return;
            var args = new JObject { ["eventDefinitionId"] = Kit.Str(row, "eventDefinitionId") };
            if (later && lastShowDate != null) args["lastShowDate"] = lastShowDate;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.previewRetire", args);
            if (ticket != version) return;
            Busy = false;
            preview.Clear();
            problem.Clear();
            if (!answer.Ok)
            {
                problem.Add(ScheduleEditor.Notice(DsState.Bad, Kit.Reasons(answer.Reasons)));
                return;
            }
            Preview = answer.Data;
            List<string> reasons = Kit.Arr(Preview, "reasons").Select(reason => Kit.Str(reason, "message")).ToList();
            List<string> removed = Kit.Arr(Preview, "removed").Select(entry => Kit.Str(entry, "date")).ToList();
            List<JToken> kept = Kit.Arr(Preview, "kept").ToList();
            string until = Kit.Str(Preview, "activeUntil");
            preview.Add(Ds.Text(until != null ? $"No new dates after {Kit.Date(until, true)}." : string.Empty, "dsf-hint"));
            if (removed.Count > 0)
            {
                preview.Add(Ds.SectionHeader("These dates come off the calendar"));
                preview.Add(Ds.Text(ScheduleEditor.DateList(removed, 8), "sc-date-list").Named("retire-removed"));
            }
            else preview.Add(Ds.Text("No upcoming dates come off the calendar.", "dsf-hint"));
            if (kept.Count > 0)
            {
                preview.Add(Ds.SectionHeader("These stay because they are already booked or run"));
                foreach (JToken show in kept.Take(8))
                {
                    VisualElement line = Ds.Row("sc-kept__row");
                    string day = Kit.Str(show, "date");
                    line.Add(Ds.Text(GameDate.TryParse(day, out GameDate parsed) ? UpcomingDates.ShortDay(parsed) : day, "sc-kept__date"));
                    line.Add(Ds.Text(Kit.Str(show, "name"), "sc-kept__name"));
                    line.Add(Ds.Pill(DsState.Gold, Kit.Str(show, "reasonText"), "lock"));
                    preview.Add(line);
                }
            }
            foreach (string message in reasons) problem.Add(ScheduleEditor.Notice(DsState.Bad, message));
            confirm.SetEnabled(reasons.Count == 0);
        }

        /// <summary>Retires the show (tours call it); null when it worked, else the engine's words.</summary>
        public async Task<string> ConfirmAsync()
        {
            confirm.SetEnabled(false);
            Busy = true;
            var args = new JObject { ["eventDefinitionId"] = Kit.Str(row, "eventDefinitionId") };
            if (later && lastShowDate != null) args["lastShowDate"] = lastShowDate;
            (JToken data, string refused) = await ScheduleEditor.Run("calendar.retireDefinition", args);
            Busy = false;
            if (refused != null)
            {
                problem.Clear();
                problem.Add(ScheduleEditor.Notice(DsState.Bad, refused));
                confirm.SetEnabled(true);
                return refused;
            }
            int removed = Kit.Arr(data, "removed").Count();
            Debug.Log($"[Schedule] retired {Kit.Str(row, "name")}: {removed} dates removed");
            handle?.Close();
            DsOverlay.Toast(ShellController.Current?.Overlay?.Layer, $"{Kit.Str(row, "name")} retired",
                DsState.Good, removed > 0 ? $"{removed} upcoming {(removed == 1 ? "date" : "dates")} came off the calendar" : null);
            return null;
        }

        public void Close() => handle?.Close();
    }
}
