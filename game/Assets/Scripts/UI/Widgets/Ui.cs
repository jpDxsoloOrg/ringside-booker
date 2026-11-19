using System;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Widgets
{
    /// <summary>Small builders so views read like markup.</summary>
    public static class Ui
    {
        /// <summary>A <see cref="VisualElement"/> with classes.</summary>
        public static VisualElement El(params string[] classes)
        {
            var element = new VisualElement();
            foreach (string className in classes) element.AddToClassList(className);
            return element;
        }

        /// <summary>A label with classes. Display faces (t-display-*) want capitals: pass <see cref="TextFormat.Upper"/>.</summary>
        public static Label Text(string text, params string[] classes)
        {
            var label = new Label(text);
            foreach (string className in classes) label.AddToClassList(className);
            return label;
        }

        /// <summary>A button with text and classes, calling <paramref name="onClick"/>.</summary>
        public static Button Button(string text, Action onClick, params string[] classes)
        {
            var button = new Button(onClick) { text = text };
            foreach (string className in classes) button.AddToClassList(className);
            return button;
        }

        /// <summary>The usual button: <c>btn</c> plus a variant (<c>btn--primary</c>, <c>btn--ghost</c>, <c>btn--link</c>).</summary>
        public static Button Btn(string text, Action onClick, string variant = null)
        {
            Button button = Button(text, onClick, "btn");
            if (variant != null) button.AddToClassList(variant);
            return button;
        }

        public static T With<T>(this T element, params VisualElement[] children) where T : VisualElement
        {
            foreach (VisualElement child in children)
            {
                if (child != null) element.Add(child);
            }
            return element;
        }

        public static T Named<T>(this T element, string name) where T : VisualElement
        {
            element.name = name;
            return element;
        }

        public static void SetShown(this VisualElement element, bool shown)
        {
            element.style.display = shown ? DisplayStyle.Flex : DisplayStyle.None;
        }

        /// <summary>A check box row that can't be changed (the Skip days sheet's "Always stops").</summary>
        public static VisualElement FixedCheckRow(string text, bool on = true)
        {
            VisualElement box = El("check-box");
            if (on)
            {
                box.AddToClassList("check-box--on");
                box.Add(Text("✓", "check-box__tick"));
            }
            return El("check-row").With(box, Text(text, "check-row__label"));
        }
    }
}
