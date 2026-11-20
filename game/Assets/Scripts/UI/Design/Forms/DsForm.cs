using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// The form kit's stylesheet (<c>Resources/Design/DsForm.uss</c>, <c>dsf-</c> classes): text
    /// fields with an error line, number steppers, date fields, the recurrence builder and the
    /// upcoming-dates strip (EVT8). Each component adds it to itself, so it is styled inside a
    /// screen and inside an overlay alike.
    /// </summary>
    public static class DsForm
    {
        private static StyleSheet sheet;

        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Design/DsForm");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        /// <summary>A small upper-case label over a control.</summary>
        public static Label Label(string text) => Ds.Text(TextFormat.Upper(text), "dsf-label");
    }

    /// <summary>A labelled text input with a hint and an error line under it.</summary>
    public sealed class DsTextField : VisualElement
    {
        private readonly Label hint;
        private readonly Label error;

        public DsTextField(string label, string value, System.Action<string> changed, string hintText = null, string name = null, int maxLength = 0, string placeholder = null)
        {
            DsForm.Style(this);
            AddToClassList("dsf-field");
            if (label != null) Add(DsForm.Label(label));
            VisualElement box = Ds.Row("dsf-input");
            Input = new TextField { value = value ?? string.Empty };
            if (maxLength > 0) Input.maxLength = maxLength;
            if (name != null) Input.name = name;
            if (placeholder != null) Input.textEdition.placeholder = placeholder;
            Input.AddToClassList("dsf-input__field");
            Input.RegisterValueChangedCallback(evt => changed?.Invoke(evt.newValue));
            box.Add(Input);
            Add(box);
            hint = Ds.Text(hintText ?? string.Empty, "dsf-hint");
            hint.SetShown(!string.IsNullOrEmpty(hintText));
            Add(hint);
            error = Ds.Text(string.Empty, "dsf-error");
            error.SetShown(false);
            Add(error);
        }

        public TextField Input { get; }

        public string Value => Input.value;

        public void SetHint(string text)
        {
            hint.text = text ?? string.Empty;
            hint.SetShown(!string.IsNullOrEmpty(text));
        }

        public void SetError(string text)
        {
            error.text = text ?? string.Empty;
            error.SetShown(!string.IsNullOrEmpty(text));
            EnableInClassList("dsf-field--error", !string.IsNullOrEmpty(text));
        }
    }
}
