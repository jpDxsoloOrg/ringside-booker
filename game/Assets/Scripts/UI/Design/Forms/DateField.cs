using System;
using System.Globalization;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// A date typed as <c>YYYY-MM-DD</c> (EVT8), with the day in words under it ("Saturday,
    /// January 16, 2027"). A date outside <c>min</c>..<c>max</c> is refused here with the range in
    /// words, so it never reaches the engine. Optional quick picks (chips) set common dates.
    /// </summary>
    public sealed class DateField : VisualElement
    {
        private readonly GameDate min;
        private readonly GameDate max;
        private readonly Action<GameDate> changed;
        private readonly TextField input;
        private readonly Label hint;
        private readonly Label error;
        private bool silent;

        public DateField(string label, GameDate? value, GameDate min, GameDate max, Action<GameDate> onChange, string name = null)
        {
            this.min = min;
            this.max = max;
            changed = onChange;
            Value = value;
            DsForm.Style(this);
            AddToClassList("dsf-field");
            AddToClassList("dsf-date");
            if (label != null) Add(DsForm.Label(label));
            VisualElement box = Ds.Row("dsf-input", "dsf-date__box");
            box.Add(new Icon("calendar", "ds-icon--sm", "dsf-date__icon"));
            input = new TextField { value = value?.Iso ?? string.Empty, maxLength = 10 };
            input.textEdition.placeholder = "YYYY-MM-DD";
            input.AddToClassList("dsf-input__field");
            if (name != null) input.name = name;
            input.RegisterValueChangedCallback(evt =>
            {
                if (silent) return;
                Apply(evt.newValue, true);
            });
            box.Add(input);
            Add(box);
            hint = Ds.Text(value?.Long ?? string.Empty, "dsf-hint");
            Add(hint);
            error = Ds.Text(string.Empty, "dsf-error");
            error.SetShown(false);
            Add(error);
        }

        /// <summary>The last valid date, or null while none has been given.</summary>
        public GameDate? Value { get; private set; }

        public TextField Input => input;

        /// <summary>Sets the date as if typed (raises the change when it is valid).</summary>
        public void Set(GameDate date)
        {
            silent = true;
            input.value = date.Iso;
            silent = false;
            Apply(date.Iso, true);
        }

        /// <summary>Shows an error from elsewhere (the engine's words); null clears it.</summary>
        public void SetError(string text)
        {
            error.text = text ?? string.Empty;
            error.SetShown(!string.IsNullOrEmpty(text));
            EnableInClassList("dsf-field--error", !string.IsNullOrEmpty(text));
        }

        private void Apply(string text, bool notify)
        {
            string problem = Check(text, min, max, out GameDate date);
            if (problem != null)
            {
                hint.text = string.Empty;
                SetError(problem);
                return;
            }
            SetError(null);
            Value = date;
            hint.text = date.Long;
            if (notify) changed?.Invoke(date);
        }

        /// <summary>
        /// Null when <paramref name="text"/> is a date from <paramref name="min"/> to
        /// <paramref name="max"/>; else what the player reads.
        /// </summary>
        public static string Check(string text, GameDate min, GameDate max, out GameDate date)
        {
            date = default;
            string trimmed = (text ?? string.Empty).Trim();
            if (trimmed.Length == 0) return "Pick a date";
            if (!DateTime.TryParseExact(trimmed, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime parsed))
                return "Type the date as YYYY-MM-DD";
            date = new GameDate(parsed.Year, parsed.Month, parsed.Day);
            if (date < min) return $"Pick a date from {min.DayMonthYear}";
            if (date > max) return $"Pick a date up to {max.DayMonthYear}";
            return null;
        }
    }
}
