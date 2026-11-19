using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The dialog over the shell while a multi-day skip runs (the web's AdvanceOverlay): the date it
    /// has reached, "12 of 30 days", a progress bar and Stop. A one-day advance shows none.
    /// </summary>
    public sealed class AdvanceProgressOverlay
    {
        private readonly OverlayLayer overlay;
        private OverlayHandle handle;
        private Label date;
        private Label count;
        private VisualElement fill;
        private Button stop;

        public AdvanceProgressOverlay(OverlayLayer overlay)
        {
            this.overlay = overlay;
        }

        public void Render(IDayControl day)
        {
            AdvanceProgress progress = day.Progress;
            bool show = day.Advancing && progress != null && progress.DaysRequested > 1;
            if (!show)
            {
                handle?.Close();
                handle = null;
                return;
            }
            if (handle == null || !handle.IsOpen) Open(day);

            date.text = TextFormat.Upper(progress.CurrentDate.Long);
            count.text = $"{TextFormat.Number(progress.DaysDone)} of {TextFormat.DayCount(progress.DaysRequested)}";
            float ratio = progress.DaysRequested <= 0 ? 0 : (float)progress.DaysDone / progress.DaysRequested;
            fill.style.width = Length.Percent(UnityEngine.Mathf.Clamp01(ratio) * 100f);
            stop.text = day.Stopping ? "STOPPING…" : "STOP";
            stop.SetEnabled(!day.Stopping);
        }

        private void Open(IDayControl day)
        {
            VisualElement card = Ui.El("sheet", "sheet--center", "sheet--small").Named("advance-progress");
            card.pickingMode = PickingMode.Position;
            VisualElement body = Ui.El("sheet__body-content");
            date = Ui.Text(string.Empty, "advance-overlay__date");
            count = Ui.Text(string.Empty, "t-muted", "t-sm");
            fill = Ui.El("progress__fill");
            stop = Ui.Btn("STOP", day.Cancel, null);
            stop.name = "advance-stop";
            body.With(
                Ui.Text(TextFormat.Upper("Skipping days"), "section-label"),
                date,
                Ui.El("progress").With(fill),
                count);
            VisualElement footer = Ui.El("sheet__footer").With(stop);
            card.With(body, footer);
            handle = overlay.Open(card, new OverlayOptions { Dismissable = false, Centered = true });
        }
    }
}
