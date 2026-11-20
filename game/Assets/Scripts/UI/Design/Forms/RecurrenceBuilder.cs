using System;
using System.Collections.Generic;
using System.Globalization;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// How often a show runs (EVT8): a segmented choice of Weekly, Every few weeks, Monthly and
    /// Yearly, with the fields that kind needs (weekday chips, the gap in weeks, a start date, the
    /// week of the month, the month). It edits a <see cref="RecurrenceValue"/> and calls back on
    /// every change. A stored set-dates recurrence is shown read-only.
    /// </summary>
    public sealed class RecurrenceBuilder : VisualElement
    {
        private static readonly (string kind, string label)[] Kinds =
        {
            (RecurrenceValue.Weekly, "Weekly"),
            (RecurrenceValue.EveryNWeeks, "Every few weeks"),
            (RecurrenceValue.Monthly, "Monthly"),
            (RecurrenceValue.Annual, "Yearly"),
        };

        private readonly Action<RecurrenceValue> changed;
        private readonly GameDate effectiveFrom;
        private readonly GameDate maxDate;
        private readonly VisualElement fields;
        private readonly DsTabs tabs;

        public RecurrenceBuilder(RecurrenceValue value, Action<RecurrenceValue> onChange, GameDate effectiveFrom, GameDate maxDate, string name = "recurrence")
        {
            Value = value.Clone();
            changed = onChange;
            this.effectiveFrom = effectiveFrom;
            this.maxDate = maxDate;
            DsForm.Style(this);
            AddToClassList("dsf-field");
            AddToClassList("dsf-recurrence");
            this.name = name;
            Add(DsForm.Label("How often"));
            if (Value.Kind == RecurrenceValue.SetDates)
            {
                Add(Ds.Text("This show runs on set dates. Its dates can't be changed here.", "dsf-hint"));
                return;
            }
            tabs = new DsTabs(segmented: true) { name = name + "-kind" };
            foreach ((string kind, string label) in Kinds) tabs.Add(kind, label);
            tabs.Select(Value.Kind, false);
            tabs.Selected += picked =>
            {
                Value.SwitchTo(picked, effectiveFrom);
                Draw();
                changed?.Invoke(Value);
            };
            Add(tabs);
            fields = Ds.Column("dsf-recurrence__fields");
            Add(fields);
            Draw();
        }

        public RecurrenceValue Value { get; }

        private void Emit()
        {
            Draw();
            changed?.Invoke(Value);
        }

        private void Draw()
        {
            fields.Clear();
            switch (Value.Kind)
            {
                case RecurrenceValue.Weekly:
                    fields.Add(Caption("On"));
                    fields.Add(WeekdayChips(day => Value.Weekdays.Contains(day), day =>
                    {
                        Value.ToggleWeekday(day);
                        Emit();
                    }));
                    break;
                case RecurrenceValue.EveryNWeeks:
                    fields.Add(Caption("Every"));
                    fields.Add(ChipRow("interval", new[] { 2, 3, 4, 6, 8 }, weeks => $"{weeks} weeks", weeks => Value.IntervalWeeks == weeks, weeks =>
                    {
                        Value.IntervalWeeks = weeks;
                        Emit();
                    }));
                    fields.Add(Caption("On"));
                    fields.Add(WeekdayChips(day => Value.Weekday == day, day =>
                    {
                        Value.SetWeekday(day, effectiveFrom);
                        Emit();
                    }));
                    GameDate? anchor = GameDate.TryParse(Value.Anchor, out GameDate parsed) ? parsed : (GameDate?)null;
                    var start = new DateField("First show", anchor, anchor.HasValue && anchor.Value < effectiveFrom ? anchor.Value : effectiveFrom, maxDate, date =>
                    {
                        Value.SetAnchor(date);
                        Emit();
                    }, name + "-anchor");
                    fields.Add(start);
                    break;
                case RecurrenceValue.Monthly:
                case RecurrenceValue.Annual:
                    if (Value.Kind == RecurrenceValue.Annual)
                    {
                        fields.Add(Caption("Month"));
                        var months = new List<int>();
                        for (int month = 1; month <= 12; month++) months.Add(month);
                        fields.Add(ChipRow("month", months, month => RecurrenceValue.MonthShort[month - 1], month => Value.Month == month, month =>
                        {
                            Value.Month = month;
                            Emit();
                        }));
                    }
                    fields.Add(Caption("Week of the month"));
                    fields.Add(ChipRow("week", RecurrenceValue.Weeks, RecurrenceValue.WeekWord, week => Value.Week == week, week =>
                    {
                        Value.Week = week;
                        Emit();
                    }));
                    fields.Add(Caption("Day"));
                    fields.Add(WeekdayChips(day => Value.Weekday == day, day =>
                    {
                        Value.SetWeekday(day, effectiveFrom);
                        Emit();
                    }));
                    break;
            }
        }

        private static Label Caption(string text) => Ds.Text(text, "dsf-caption");

        private VisualElement WeekdayChips(Func<int, bool> selected, Action<int> pick) =>
            ChipRow("day", new[] { 0, 1, 2, 3, 4, 5, 6 }, day => RecurrenceValue.WeekdayShort[day], selected, pick);

        private VisualElement ChipRow<T>(string part, IEnumerable<T> options, Func<T, string> label, Func<T, bool> selected, Action<T> pick)
        {
            VisualElement row = Ds.Row("ds-row--wrap", "dsf-chips");
            foreach (T option in options)
            {
                T captured = option;
                Button chip = Ds.Chip(label(option), selected(option), () => pick(captured));
                chip.name = $"{name}-{part}-{Convert.ToString(option, CultureInfo.InvariantCulture)}";
                row.Add(chip);
            }
            return row;
        }
    }

    /// <summary>
    /// "Every Friday" and the next few dates as chips ("Fri 8 Jan"), with a quiet loading state that
    /// keeps the last dates showing, and an empty state.
    /// </summary>
    public sealed class UpcomingDates : VisualElement
    {
        private readonly Label summary;
        private readonly VisualElement chips;
        private readonly Label empty;

        public UpcomingDates(string name = "upcoming-dates")
        {
            DsForm.Style(this);
            AddToClassList("dsf-upcoming");
            this.name = name;
            VisualElement head = Ds.Row("dsf-upcoming__head");
            head.Add(new Icon("calendar", "ds-icon--sm", "dsf-upcoming__icon"));
            summary = Ds.Text(string.Empty, "dsf-upcoming__summary");
            head.Add(summary);
            Add(head);
            chips = Ds.Row("ds-row--wrap", "dsf-upcoming__dates");
            Add(chips);
            empty = Ds.Text("No dates in the next two years", "dsf-hint");
            empty.SetShown(false);
            Add(empty);
        }

        /// <summary>"Fri 8 Jan".</summary>
        public static string ShortDay(GameDate date) =>
            $"{RecurrenceValue.WeekdayShort[RecurrenceValue.WeekdayOf(date)]} {date.Day} {RecurrenceValue.MonthShort[date.Month - 1]}";

        public void SetLoading(bool loading) => EnableInClassList("dsf-upcoming--loading", loading);

        public void SetDates(string text, IReadOnlyList<GameDate> dates, string label = "Next dates")
        {
            SetLoading(false);
            summary.text = string.IsNullOrEmpty(text) ? label : $"{text} · {label.ToLowerInvariant()}";
            chips.Clear();
            foreach (GameDate date in dates)
            {
                Label chip = Ds.Text(ShortDay(date), "dsf-date-chip");
                DsTooltip.Attach(chip, date.Long);
                chips.Add(chip);
            }
            empty.SetShown(dates.Count == 0);
        }
    }
}
