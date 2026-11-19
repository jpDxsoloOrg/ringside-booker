using System;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    public enum SheetPlacement
    {
        /// <summary>A full-height panel on the right (Skip days).</summary>
        Right,
        /// <summary>A centred dialog.</summary>
        Center,
    }

    /// <summary>
    /// A titled panel with a scrolling body and an optional footer, opened into the overlay layer
    /// (the web's Sheet). Close with its × button, a click outside, or Escape.
    /// </summary>
    public sealed class Sheet
    {
        private Sheet(VisualElement root, VisualElement body, VisualElement footer)
        {
            Root = root;
            Body = body;
            Footer = footer;
        }

        public VisualElement Root { get; }
        /// <summary>Add the sheet's content here.</summary>
        public VisualElement Body { get; }
        /// <summary>Add footer buttons here (hidden while empty).</summary>
        public VisualElement Footer { get; }
        public OverlayHandle Handle { get; private set; }

        public static Sheet Open(OverlayLayer overlay, string title, SheetPlacement placement = SheetPlacement.Center, bool small = false, Action onClosed = null)
        {
            VisualElement root = Ui.El("sheet", placement == SheetPlacement.Right ? "sheet--right" : "sheet--center");
            if (small) root.AddToClassList("sheet--small");
            root.pickingMode = PickingMode.Position;

            Sheet sheet = null;
            Button close = Ui.Btn("×", () => sheet?.Close(), "btn--ghost");
            close.AddToClassList("btn--icon");
            close.tooltip = "Close (Esc)";
            VisualElement header = Ui.El("sheet__header").With(Ui.Text(TextFormat.Upper(title), "sheet__title"), close);

            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.AddToClassList("sheet__body");
            scroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
            VisualElement body = Ui.El("sheet__body-content");
            scroll.Add(body);

            VisualElement footer = Ui.El("sheet__footer");
            footer.SetShown(false);
            root.With(header, scroll, footer);

            sheet = new Sheet(root, body, footer);
            sheet.Handle = overlay.Open(root, new OverlayOptions { Centered = placement == SheetPlacement.Center });
            if (onClosed != null) sheet.Handle.Closed += onClosed;
            return sheet;
        }

        public Button AddFooterButton(string text, Action onClick, string variant = null)
        {
            Button button = Ui.Btn(TextFormat.Upper(text), onClick, variant);
            Footer.Add(button);
            Footer.SetShown(true);
            return button;
        }

        public void Close() => Handle?.Close();
    }
}
