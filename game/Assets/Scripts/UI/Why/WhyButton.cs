using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// A small "?" button for a derived number (the web's <c>WhyButton</c>/<c>LazyWhyButton</c>):
    /// it opens the Why? panel with the number's breakdown. Place it next to the number. Its
    /// tooltip (and accessible name) is <c>Why is Attendance 12,400?</c>. Only one panel is open
    /// at a time, and closing it returns focus here.
    ///
    /// <code>
    /// row.Add(new WhyButton("Attendance", TraceValue.Of(12400), WhySource.FromTrace(trace)));
    /// row.Add(new WhyButton("Match rating", TraceValue.Of(71), WhySource.FromRef(traceRef, engineLoader), "points"));
    /// </code>
    /// </summary>
    public sealed class WhyButton : Button
    {
        public const string UssClassName = "why-why-button";

        public WhyButton(string label, TraceValue value, WhySource source, string unit = null)
        {
            Label = label;
            Value = value;
            Unit = unit;
            Source = source;
            text = "?";
            AddToClassList("why-button");
            AddToClassList(UssClassName);
            WhyStyles.Apply(this);
            tooltip = ButtonLabel(label, TraceFormat.Value(value, unit));
            clicked += OpenPanel;
        }

        /// <summary>What the number is, as the player reads it: "Attendance".</summary>
        public string Label { get; }

        public TraceValue Value { get; }

        public string Unit { get; }

        /// <summary>The trace, the reference to fetch it by, or the loader that builds it.</summary>
        public WhySource Source { get; set; }

        /// <summary>The panel's heading. The label by default.</summary>
        public string PanelTitle { get; set; }

        /// <summary>Where the panel opens. <see cref="WhyPanelHost.DefaultRoot"/> by default.</summary>
        public VisualElement PanelRoot { get; set; }

        /// <summary>Entity links for the panel. <see cref="WhyPanelHost.DefaultLinks"/> by default.</summary>
        public WhyLinks Links { get; set; }

        /// <summary>The panel this button opened, while it is open.</summary>
        public WhyPanel OpenedPanel { get; private set; }

        /// <summary>The button's name: <c>Why is Attendance 12,400?</c>.</summary>
        public static string ButtonLabel(string label, string formattedValue) => $"Why is {label} {formattedValue}?";

        /// <summary>Opens the panel, as a click does.</summary>
        public void OpenPanel()
        {
            if (Source == null) return;
            OpenedPanel = WhyPanelHost.Open(PanelTitle ?? Label, Source, PanelRoot, this, Links);
            WhyPanel opened = OpenedPanel;
            opened.Closed += () =>
            {
                if (OpenedPanel == opened) OpenedPanel = null;
            };
        }
    }

    /// <summary>
    /// A derived number with its Why? button beside it (the web's <c>Explained</c>): the one
    /// element a screen needs to show an explained number. With no source it shows just the
    /// number, never a button that opens nothing.
    /// </summary>
    public sealed class WhyValue : VisualElement
    {
        public const string UssClassName = "why-value";

        public WhyValue(string label, TraceValue value, WhySource source, string unit = null)
        {
            AddToClassList(UssClassName);
            WhyStyles.Apply(this);
            var number = new UnityEngine.UIElements.Label(TraceFormat.Value(value, unit));
            number.AddToClassList("why-value__number");
            Add(number);
            if (source != null)
            {
                Button = new WhyButton(label, value, source, unit);
                Add(Button);
            }
        }

        /// <summary>The Why? button, or null when there is no breakdown.</summary>
        public WhyButton Button { get; }
    }
}
