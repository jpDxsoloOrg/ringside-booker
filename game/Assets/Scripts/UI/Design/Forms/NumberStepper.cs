using System;
using System.Globalization;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// A whole-number stepper (EVT8): − and + buttons around a typed input. Typing accepts values
    /// outside the range so the caller can show the engine's words for them ("A show needs at least
    /// 3 slots"); the buttons stop at the range, with a tooltip on the one that is disabled. Up and
    /// Down step the value from the keyboard.
    /// </summary>
    public sealed class NumberStepper : VisualElement
    {
        private readonly int min;
        private readonly int max;
        private readonly Action<int> changed;
        private readonly TextField input;
        private readonly Button minus;
        private readonly Button plus;
        private readonly Label error;
        private readonly Label hint;
        private bool silent;

        public NumberStepper(string label, int value, int min, int max, Action<int> onChange,
            string minTooltip = null, string maxTooltip = null, string name = null, string hintText = null)
        {
            this.min = min;
            this.max = max;
            changed = onChange;
            Value = value;
            DsForm.Style(this);
            AddToClassList("dsf-field");
            AddToClassList("dsf-stepper");
            if (name != null) this.name = name;
            if (label != null) Add(DsForm.Label(label));
            VisualElement row = Ds.Row("dsf-stepper__row");
            minus = Ds.IconButton("decrease", minTooltip ?? "Fewer", () => Set(Step(Value, -1, min, max)), false);
            minus.AddToClassList("dsf-stepper__button");
            if (name != null) minus.name = name + "-minus";
            plus = Ds.IconButton("add", maxTooltip ?? "More", () => Set(Step(Value, 1, min, max)), false);
            plus.AddToClassList("dsf-stepper__button");
            if (name != null) plus.name = name + "-plus";
            input = new TextField { value = value.ToString(CultureInfo.InvariantCulture), maxLength = 4 };
            input.AddToClassList("dsf-stepper__input");
            if (name != null) input.name = name + "-input";
            input.RegisterValueChangedCallback(evt =>
            {
                if (silent) return;
                if (TryParse(evt.newValue, out int typed))
                {
                    Value = typed;
                    Refresh();
                    changed?.Invoke(typed);
                }
            });
            input.RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.keyCode == UnityEngine.KeyCode.UpArrow) { Set(Step(Value, 1, min, max)); evt.StopPropagation(); }
                else if (evt.keyCode == UnityEngine.KeyCode.DownArrow) { Set(Step(Value, -1, min, max)); evt.StopPropagation(); }
            }, TrickleDown.TrickleDown);
            row.Add(minus);
            row.Add(input);
            row.Add(plus);
            Add(row);
            hint = Ds.Text(hintText ?? string.Empty, "dsf-hint");
            hint.SetShown(!string.IsNullOrEmpty(hintText));
            Add(hint);
            error = Ds.Text(string.Empty, "dsf-error");
            error.SetShown(false);
            Add(error);
            Refresh();
        }

        public int Value { get; private set; }

        /// <summary>Sets the value as if the player had picked it (raises the change).</summary>
        public void Set(int value)
        {
            Value = value;
            SetWithoutNotify(value);
            changed?.Invoke(value);
        }

        /// <summary>Shows a value without raising the change (e.g. a default from another field).</summary>
        public void SetWithoutNotify(int value)
        {
            Value = value;
            silent = true;
            input.value = value.ToString(CultureInfo.InvariantCulture);
            silent = false;
            Refresh();
        }

        public void SetError(string text)
        {
            error.text = text ?? string.Empty;
            error.SetShown(!string.IsNullOrEmpty(text));
            EnableInClassList("dsf-field--error", !string.IsNullOrEmpty(text));
        }

        public void SetHint(string text)
        {
            hint.text = text ?? string.Empty;
            hint.SetShown(!string.IsNullOrEmpty(text));
        }

        private void Refresh()
        {
            minus.SetEnabled(Value > min);
            plus.SetEnabled(Value < max);
        }

        /// <summary>
        /// One step from <paramref name="value"/>, kept inside the range; a value already outside
        /// it comes back to the nearest end first.
        /// </summary>
        public static int Step(int value, int delta, int min, int max)
        {
            if (value < min) return min;
            if (value > max) return max;
            return Math.Max(min, Math.Min(max, value + delta));
        }

        /// <summary>A typed whole number (spaces allowed, nothing else), in or out of range.</summary>
        public static bool TryParse(string text, out int value) =>
            int.TryParse((text ?? string.Empty).Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value);
    }
}
