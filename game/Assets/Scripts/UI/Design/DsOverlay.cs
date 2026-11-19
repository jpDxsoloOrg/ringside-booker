using System;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// Side sheets, modals, popovers and toasts in the design system's look, opened into the panel's
    /// <see cref="OverlayLayer"/> (UNITY-07): Escape and the scrim close them, focus moves inside.
    /// </summary>
    public static class DsOverlay
    {
        /// <summary>A sheet on the right: the place for "one step away" detail (a Why?, a wrestler, a match).</summary>
        public static OverlayHandle SideSheet(VisualElement anyElement, string title, VisualElement body,
            string eyebrow = null, VisualElement footer = null, float width = 460f)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement sheet = Ui.El("ds-sheet");
            sheet.style.width = width;
            sheet.pickingMode = PickingMode.Position;
            OverlayHandle handle = null;
            sheet.Add(Header(title, eyebrow, () => handle?.Close()));
            var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("ds-sheet__body");
            VisualElement content = Ui.El("ds-sheet__content");
            content.Add(body);
            scroll.Add(content);
            sheet.Add(scroll);
            if (footer != null)
            {
                footer.AddToClassList("ds-sheet__footer");
                sheet.Add(footer);
            }
            handle = layer.Open(sheet, new OverlayOptions { Modal = true, Dismissable = true });
            handle.Entry.AddToClassList("ds-overlay--sheet");
            return handle;
        }

        /// <summary>A centred modal for a decision that blocks: title, body, buttons (the last is the default).</summary>
        public static OverlayHandle Modal(VisualElement anyElement, string title, VisualElement body,
            params (string text, DsButtonKind kind, Action onClick)[] buttons)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement modal = Ui.El("ds-modal");
            modal.pickingMode = PickingMode.Position;
            OverlayHandle handle = null;
            modal.Add(Header(title, null, () => handle?.Close()));
            body.AddToClassList("ds-modal__body");
            modal.Add(body);
            if (buttons.Length > 0)
            {
                VisualElement footer = Ui.El("ds-modal__footer");
                foreach ((string text, DsButtonKind kind, Action onClick) in buttons)
                {
                    Action click = onClick;
                    footer.Add(Ds.Button(text, () =>
                    {
                        click?.Invoke();
                        handle?.Close();
                    }, kind));
                }
                modal.Add(footer);
            }
            handle = layer.Open(modal, new OverlayOptions { Modal = true, Dismissable = true, Centered = true });
            handle.Entry.AddToClassList("ds-overlay--modal");
            return handle;
        }

        /// <summary>A popover under <paramref name="anchor"/> (menus, the column picker). Clicking outside closes it.</summary>
        public static OverlayHandle Popover(VisualElement anchor, VisualElement content, bool alignRight = true)
        {
            OverlayLayer layer = OverlayLayer.Of(anchor);
            if (layer == null) return null;
            content.AddToClassList("ds-popover");
            content.pickingMode = PickingMode.Position;
            OverlayHandle handle = layer.Open(content, new OverlayOptions { Modal = true, Dismissable = true });
            handle.Entry.AddToClassList("ds-overlay--popover");
            Rect bounds = layer.Layer.WorldToLocal(anchor.worldBound);
            content.style.position = Position.Absolute;
            content.style.top = bounds.yMax + 4;
            if (alignRight) content.style.right = layer.Layer.layout.width - bounds.xMax;
            else content.style.left = bounds.xMin;
            return handle;
        }

        /// <summary>A toast in the bottom-right corner that fades after <paramref name="seconds"/> (0 = stays).</summary>
        public static VisualElement Toast(VisualElement anyElement, string text, DsState state = DsState.Good,
            string detail = null, float seconds = 5f)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement stack = layer.Layer.Q<VisualElement>("ds-toasts");
            if (stack == null)
            {
                stack = Ui.El("ds-toasts").Named("ds-toasts");
                stack.pickingMode = PickingMode.Ignore;
                layer.Layer.Add(stack);
            }
            VisualElement toast = Ui.El("ds-toast", Ds.StateClass(state));
            toast.Add(new Icon(Ds.StateIcon(state), "ds-icon--md", "ds-toast__icon"));
            VisualElement words = Ui.El("ds-toast__words");
            words.Add(Ui.Text(text, "ds-toast__text"));
            if (detail != null) words.Add(Ui.Text(detail, "ds-toast__detail"));
            toast.Add(words);
            Button close = Ds.IconButton("close", "Dismiss", () => toast.RemoveFromHierarchy());
            toast.Add(close);
            stack.Add(toast);
            if (seconds > 0) toast.schedule.Execute(() => toast.RemoveFromHierarchy()).StartingIn((long)(seconds * 1000));
            return toast;
        }

        /// <summary>Opens a Why? breakdown in a side sheet: summary in words first, then each line's effect.</summary>
        public static OverlayHandle OpenWhy(VisualElement opener, WhyBreakdown breakdown)
        {
            VisualElement body = Ui.El("ds-why-sheet");
            VisualElement total = Ui.El("ds-why-sheet__total");
            total.Add(Ui.Text(breakdown.ValueText, "ds-why-sheet__value"));
            total.Add(Ui.Text(breakdown.Summary, "ds-why-sheet__summary"));
            body.Add(total);
            body.Add(Ds.SectionHeader("What went into it"));
            foreach (WhyLine line in breakdown.Lines)
            {
                VisualElement row = Ui.El("ds-why-line", Ds.StateClass(line.State));
                row.Add(new Icon(line.State == DsState.Good ? "up" : line.State == DsState.Bad ? "down" : "flat", "ds-icon--xs", "ds-why-line__icon"));
                VisualElement words = Ui.El("ds-why-line__words");
                words.Add(Ui.Text(line.Label, "ds-why-line__label"));
                if (line.Detail != null) words.Add(Ui.Text(line.Detail, "ds-why-line__detail"));
                row.Add(words);
                row.Add(Ui.Text(line.Effect, "ds-why-line__effect"));
                body.Add(row);
            }
            VisualElement footer = Ui.El("ds-row");
            footer.Add(Ds.Button("Copy as text", null, DsButtonKind.Ghost, "file-text"));
            footer.Add(Ds.Spacer());
            footer.Add(Ds.Button("Close", null, DsButtonKind.Secondary));
            OverlayHandle handle = SideSheet(opener, breakdown.Title, body, "WHY?", footer, 440f);
            if (handle != null)
            {
                footer.Q<Button>(className: "ds-btn--secondary").clicked += handle.Close;
                handle.Closed += () => opener?.Focus();
            }
            return handle;
        }

        private static VisualElement Header(string title, string eyebrow, Action onClose)
        {
            VisualElement header = Ui.El("ds-overlay-header");
            VisualElement words = Ui.El("ds-overlay-header__words");
            if (eyebrow != null) words.Add(Ui.Text(TextFormat.Upper(eyebrow), "ds-overlay-header__eyebrow"));
            words.Add(Ui.Text(TextFormat.Upper(title), "ds-overlay-header__title"));
            header.Add(words);
            Button close = Ds.IconButton("close", "Close (Esc)", onClose);
            // The overlay focuses its first control on open: no tooltip for that focus.
            close.AddToClassList(DsTooltip.NoFocusTipClass);
            header.Add(close);
            return header;
        }
    }

    /// <summary>
    /// Hover and focus tooltips: a small dark card near the element after a short delay (Unity's
    /// own <c>tooltip</c> only shows in the editor). Title optional, text wraps at 280 px.
    /// </summary>
    public static class DsTooltip
    {
        /// <summary>Elements with this class show their tooltip on hover only, not on focus.</summary>
        public const string NoFocusTipClass = "ds-no-focus-tip";

        private const long DelayMs = 350;
        private static VisualElement current;
        private static IVisualElementScheduledItem pending;

        public static void Attach(VisualElement element, string text, string title = null, Func<bool> when = null)
        {
            if (string.IsNullOrEmpty(text) && string.IsNullOrEmpty(title)) return;
            element.RegisterCallback<PointerEnterEvent>(_ =>
            {
                if (when == null || when()) Schedule(element, title, text);
            });
            element.RegisterCallback<PointerLeaveEvent>(_ => Hide());
            element.RegisterCallback<FocusInEvent>(_ =>
            {
                if (element.ClassListContains(NoFocusTipClass)) return;
                if (when == null || when()) Schedule(element, title, text);
            });
            element.RegisterCallback<FocusOutEvent>(_ => Hide());
            element.RegisterCallback<PointerDownEvent>(_ => Hide());
            element.RegisterCallback<DetachFromPanelEvent>(_ => Hide());
        }

        /// <summary>Shows a tooltip for <paramref name="element"/> at once (tours and screenshots).</summary>
        public static void ShowNow(VisualElement element, string text, string title = null) => Show(element, title, text);

        public static void Hide()
        {
            pending?.Pause();
            pending = null;
            current?.RemoveFromHierarchy();
            current = null;
        }

        private static void Schedule(VisualElement element, string title, string text)
        {
            Hide();
            pending = element.schedule.Execute(() => Show(element, title, text));
            pending.ExecuteLater(DelayMs);
        }

        private static void Show(VisualElement element, string title, string text)
        {
            Hide();
            OverlayLayer layer = OverlayLayer.Of(element);
            if (layer == null || element.panel == null) return;
            VisualElement tip = Ui.El("ds-tooltip");
            tip.pickingMode = PickingMode.Ignore;
            if (!string.IsNullOrEmpty(title)) tip.Add(Ui.Text(title, "ds-tooltip__title"));
            if (!string.IsNullOrEmpty(text)) tip.Add(Ui.Text(text, "ds-tooltip__text"));
            Rect anchor = layer.Layer.WorldToLocal(element.worldBound);
            tip.style.left = anchor.xMin;
            tip.style.top = anchor.yMax + 6;
            tip.style.visibility = Visibility.Hidden;
            layer.Layer.Add(tip);
            current = tip;
            // Keep it on screen once measured: flip above when there's no room below, clamp to the right edge.
            tip.RegisterCallback<GeometryChangedEvent>(_ =>
            {
                Rect area = layer.Layer.layout;
                float left = Mathf.Min(anchor.xMin, area.width - tip.layout.width - 8);
                float top = anchor.yMax + 6 + tip.layout.height > area.height - 8 ? anchor.yMin - tip.layout.height - 6 : anchor.yMax + 6;
                tip.style.left = Mathf.Max(8, left);
                tip.style.top = Mathf.Max(8, top);
                tip.style.visibility = Visibility.Visible;
            });
        }
    }
}
