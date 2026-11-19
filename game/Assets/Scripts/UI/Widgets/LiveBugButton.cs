using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Widgets
{
    /// <summary>
    /// The broadcast "live bug": the red-orange button that moves time, skewed like a TV graphic (the
    /// web's LiveBugButton). USS cannot skew, so the parallelogram is drawn with Painter2D in the
    /// colours of the <c>--bug-fill</c> and <c>--bug-edge</c> custom properties (hover and focus
    /// change them in Components.uss). Click, Enter or Space presses it.
    /// </summary>
    public sealed class LiveBugButton : VisualElement
    {
        public const string UssClass = "live-bug";
        public const string BusyClass = "live-bug--busy";

        /// <summary>tan(12°): the web's --skew-broadcast.</summary>
        private const float SkewRatio = 0.2126f;

        private static readonly CustomStyleProperty<Color> FillProperty = new CustomStyleProperty<Color>("--bug-fill");
        private static readonly CustomStyleProperty<Color> EdgeProperty = new CustomStyleProperty<Color>("--bug-edge");

        private readonly Label label;
        private readonly Label arrow;
        private Color fill = new Color32(0xd7, 0x30, 0x1a, 0xff);
        private Color edge = new Color32(0xff, 0x3b, 0x1d, 0xff);

        public LiveBugButton()
        {
            AddToClassList(UssClass);
            focusable = true;
            tabIndex = 0;
            label = Ui.Text(string.Empty, "live-bug__label");
            arrow = Ui.Text("›", "live-bug__arrow");
            Add(label);
            Add(arrow);

            this.AddManipulator(new Clickable(Press));
            RegisterCallback<NavigationSubmitEvent>(_ => Press());
            RegisterCallback<CustomStyleResolvedEvent>(OnStyleResolved);
            generateVisualContent += Draw;
        }

        /// <summary>Raised when the button is pressed (unless busy).</summary>
        public event Action Clicked;

        public string Text
        {
            get => label.text;
            set => label.text = TextFormat.Upper(value);
        }

        /// <summary>Shows the trailing chevron (a gate's button goes somewhere).</summary>
        public bool ShowArrow
        {
            get => arrow.resolvedStyle.display != DisplayStyle.None;
            set => arrow.SetShown(value);
        }

        public bool Busy
        {
            get => ClassListContains(BusyClass);
            set => EnableInClassList(BusyClass, value);
        }

        private void Press()
        {
            if (!Busy) Clicked?.Invoke();
        }

        private void OnStyleResolved(CustomStyleResolvedEvent evt)
        {
            if (evt.customStyle.TryGetValue(FillProperty, out Color resolvedFill)) fill = resolvedFill;
            if (evt.customStyle.TryGetValue(EdgeProperty, out Color resolvedEdge)) edge = resolvedEdge;
            MarkDirtyRepaint();
        }

        private void Draw(MeshGenerationContext context)
        {
            float width = layout.width;
            float height = layout.height;
            if (width <= 0 || height <= 0) return;
            float offset = height * SkewRatio;

            Painter2D painter = context.painter2D;
            painter.BeginPath();
            painter.MoveTo(new Vector2(offset, 0));
            painter.LineTo(new Vector2(width, 0));
            painter.LineTo(new Vector2(width - offset, height));
            painter.LineTo(new Vector2(0, height));
            painter.ClosePath();
            painter.fillColor = fill;
            painter.Fill();

            painter.lineWidth = 1f;
            painter.strokeColor = edge;
            painter.Stroke();
        }
    }
}
