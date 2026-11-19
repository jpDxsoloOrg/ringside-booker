using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// Opens Why? panels: one at a time (opening another replaces it), into the overlay layer,
    /// with focus returned to whatever opened it when it closes.
    ///
    /// Screens normally use a <see cref="WhyButton"/>. Set <see cref="DefaultRoot"/> once (the
    /// shell's overlay layer) and <see cref="DefaultLinks"/> (how to open a worker, promotion,
    /// title…); without a root, a panel opens into the top of the opener's panel.
    /// </summary>
    public static class WhyPanelHost
    {
        /// <summary>Where panels open when the caller names no root: the shell's overlay layer.</summary>
        public static VisualElement DefaultRoot { get; set; }

        /// <summary>Entity links for panels whose opener gives none.</summary>
        public static WhyLinks DefaultLinks { get; set; }

        /// <summary>Puts text on the system clipboard. Replace it in tests.</summary>
        public static Action<string> CopyToClipboard { get; set; } = text => GUIUtility.systemCopyBuffer = text;

        /// <summary>The panel that is open now, or null.</summary>
        public static WhyPanel Current { get; private set; }

        /// <summary>Raised after a panel opens.</summary>
        public static event Action<WhyPanel> Opened;

        /// <summary>
        /// Opens a Why? panel and closes any other. <paramref name="root"/> is where it goes
        /// (<see cref="DefaultRoot"/>, else the top of <paramref name="returnFocusTo"/>'s panel);
        /// <paramref name="returnFocusTo"/> gets keyboard focus back when it closes.
        /// </summary>
        public static WhyPanel Open(string title, WhySource source, VisualElement root = null,
            Focusable returnFocusTo = null, WhyLinks links = null)
        {
            VisualElement target = root ?? DefaultRoot ?? TopOf(returnFocusTo as VisualElement);
            if (target == null)
            {
                throw new InvalidOperationException(
                    "No root to open the Why? panel in: pass one, set WhyPanelHost.DefaultRoot, or open it from an element in a panel.");
            }
            CloseCurrent();
            var panel = new WhyPanel(title, source, links ?? DefaultLinks);
            panel.Closed += () =>
            {
                if (Current == panel) Current = null;
                if (returnFocusTo is VisualElement element && element.panel != null) element.Focus();
                else returnFocusTo?.Focus();
            };
            target.Add(panel);
            Current = panel;
            panel.FocusInside();
            // The rows take focus once laid out; try again on the next update if they could not yet.
            panel.schedule.Execute(() =>
            {
                if (!panel.IsClosed && !(panel.focusController?.focusedElement is VisualElement focused && panel.Contains(focused)))
                {
                    panel.FocusInside();
                }
            });
            Opened?.Invoke(panel);
            return panel;
        }

        /// <summary>Closes the open panel, if any.</summary>
        public static void CloseCurrent()
        {
            WhyPanel open = Current;
            Current = null;
            open?.Close();
        }

        private static VisualElement TopOf(VisualElement element)
        {
            if (element == null || element.panel == null) return null;
            return element.panel.visualTree;
        }
    }

    /// <summary>The Why? style sheet (<c>Assets/UI/Why/Resources/Why/WhyPanel.uss</c>).</summary>
    public static class WhyStyles
    {
        public const string ResourcePath = "Why/WhyPanel";
        private static StyleSheet sheet;

        /// <summary>The style sheet, loaded once from Resources.</summary>
        public static StyleSheet Sheet
        {
            get
            {
                if (sheet == null) sheet = Resources.Load<StyleSheet>(ResourcePath);
                return sheet;
            }
        }

        /// <summary>Adds the Why? styles to <paramref name="element"/> and its subtree.</summary>
        public static void Apply(VisualElement element)
        {
            StyleSheet styles = Sheet;
            if (styles == null)
            {
                Debug.LogWarning($"[Why] Style sheet Resources/{ResourcePath} not found");
                return;
            }
            if (!element.styleSheets.Contains(styles)) element.styleSheets.Add(styles);
        }
    }
}
