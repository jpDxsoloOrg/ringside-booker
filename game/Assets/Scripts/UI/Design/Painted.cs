using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// A broadcast-graphic parallelogram behind its children (USS cannot skew). Fill and edge come
    /// from the <c>--skew-fill</c> and <c>--skew-edge</c> custom properties, so hover and focus restyle
    /// it in USS. <see cref="SkewLeft"/>/<see cref="SkewRight"/> pick which ends are slanted.
    /// </summary>
    public class SkewShape : VisualElement
    {
        /// <summary>tan(12°): the web's --skew-broadcast.</summary>
        public const float SkewRatio = 0.2126f;

        private static readonly CustomStyleProperty<Color> FillProperty = new CustomStyleProperty<Color>("--skew-fill");
        private static readonly CustomStyleProperty<Color> EdgeProperty = new CustomStyleProperty<Color>("--skew-edge");

        private Color fill = DsColors.Action;
        private Color edge = Color.clear;

        public SkewShape()
        {
            AddToClassList("ds-skew");
            RegisterCallback<CustomStyleResolvedEvent>(OnStyle);
            generateVisualContent += Draw;
        }

        public bool SkewLeft { get; set; } = true;
        public bool SkewRight { get; set; } = true;

        private void OnStyle(CustomStyleResolvedEvent evt)
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
            painter.MoveTo(new Vector2(SkewLeft ? offset : 0, 0));
            painter.LineTo(new Vector2(width, 0));
            painter.LineTo(new Vector2(SkewRight ? width - offset : width, height));
            painter.LineTo(new Vector2(0, height));
            painter.ClosePath();
            painter.fillColor = fill;
            painter.Fill();
            if (edge.a > 0)
            {
                painter.lineWidth = 1f;
                painter.strokeColor = edge;
                painter.Stroke();
            }
        }
    }

    /// <summary>
    /// A vertical two-colour gradient filling its box (USS has no gradients), drawn with vertex tints.
    /// Colours come from <c>--grad-top</c> and <c>--grad-bottom</c> or the constructor.
    /// </summary>
    public sealed class GradientFill : VisualElement
    {
        private static readonly ushort[] QuadIndices = { 0, 1, 2, 0, 2, 3 };
        private static readonly CustomStyleProperty<Color> TopProperty = new CustomStyleProperty<Color>("--grad-top");
        private static readonly CustomStyleProperty<Color> BottomProperty = new CustomStyleProperty<Color>("--grad-bottom");

        public GradientFill(Color top, Color bottom, bool horizontal = false)
        {
            Top = top;
            Bottom = bottom;
            Horizontal = horizontal;
            AddToClassList("ds-fill");
            pickingMode = PickingMode.Ignore;
            RegisterCallback<CustomStyleResolvedEvent>(OnStyle);
            generateVisualContent += Draw;
        }

        public Color Top { get; set; }
        public Color Bottom { get; set; }
        public bool Horizontal { get; set; }

        private void OnStyle(CustomStyleResolvedEvent evt)
        {
            if (evt.customStyle.TryGetValue(TopProperty, out Color top)) Top = top;
            if (evt.customStyle.TryGetValue(BottomProperty, out Color bottom)) Bottom = bottom;
            MarkDirtyRepaint();
        }

        private void Draw(MeshGenerationContext context)
        {
            float width = layout.width;
            float height = layout.height;
            if (width <= 0 || height <= 0) return;
            Color a = Top;
            Color b = Bottom;
            MeshWriteData mesh = context.Allocate(4, 6);
            mesh.SetAllVertices(new[]
            {
                new Vertex { position = new Vector3(0, 0, Vertex.nearZ), tint = a },
                new Vertex { position = new Vector3(width, 0, Vertex.nearZ), tint = Horizontal ? b : a },
                new Vertex { position = new Vector3(width, height, Vertex.nearZ), tint = b },
                new Vertex { position = new Vector3(0, height, Vertex.nearZ), tint = Horizontal ? a : b },
            });
            mesh.SetAllIndices(QuadIndices);
        }
    }

    /// <summary>
    /// A wrestler's picture: the workshop mod's picture when there is one, otherwise a placeholder
    /// silhouette on a gradient in the side's colour (face blue, heel violet, neutral navy). Put it
    /// in a box with <c>overflow: hidden</c> and a radius (the <c>ds-portrait</c> classes do).
    /// </summary>
    public sealed class Portrait : VisualElement
    {
        private static readonly SvgPath Silhouette = SvgPath.Parse(
            // Head and shoulders on a 100×120 box, bottom-aligned.
            "M31 38A19 21 0 1 1 69 38A19 21 0 1 1 31 38Z" +
            "M43 52H57V84H43Z" +
            "M8 120C8 94 24 80 50 80C76 80 92 94 92 120Z");

        private readonly GradientFill background;
        private readonly VisualElement figure;
        private Color tone;

        public Portrait(Texture2D picture = null, PortraitTone tone = PortraitTone.Neutral)
        {
            AddToClassList("ds-portrait-art");
            pickingMode = PickingMode.Ignore;
            background = new GradientFill(Color.black, Color.black);
            figure = new VisualElement { pickingMode = PickingMode.Ignore };
            figure.AddToClassList("ds-portrait-art__figure");
            figure.generateVisualContent += DrawFigure;
            Add(background);
            Add(figure);
            SetTone(tone);
            SetPicture(picture);
        }

        public void SetPicture(Texture2D picture)
        {
            bool has = picture != null;
            figure.style.display = has ? DisplayStyle.None : DisplayStyle.Flex;
            style.backgroundImage = has ? new StyleBackground(picture) : new StyleBackground(StyleKeyword.Null);
            background.style.display = has ? DisplayStyle.None : DisplayStyle.Flex;
        }

        public void SetTone(PortraitTone value)
        {
            (Color top, Color bottom, Color shape) = value switch
            {
                PortraitTone.Face => (Hex(0x1d4ed8, 0.85f), Hex(0x0b1324), Hex(0x93c5fd, 0.30f)),
                PortraitTone.Heel => (Hex(0x6d28d9, 0.85f), Hex(0x0b1324), Hex(0xc4b5fd, 0.30f)),
                PortraitTone.Gold => (Hex(0xa16207, 0.9f), Hex(0x0b1324), Hex(0xfde68a, 0.32f)),
                PortraitTone.Action => (Hex(0xb91c1c, 0.9f), Hex(0x0b1324), Hex(0xfca5a5, 0.30f)),
                _ => (Hex(0x334155), Hex(0x0b1324), Hex(0xcbd5e1, 0.22f)),
            };
            background.Top = top;
            background.Bottom = bottom;
            tone = shape;
            background.MarkDirtyRepaint();
            figure.MarkDirtyRepaint();
        }

        private void DrawFigure(MeshGenerationContext context)
        {
            Rect box = figure.contentRect;
            if (box.width <= 0 || box.height <= 0) return;
            // Fit the 100×120 figure to 86% of the height, centred, standing on the bottom edge.
            float scale = Mathf.Min(box.width / 100f, box.height * 0.86f / 120f);
            var offset = new Vector2(box.x + (box.width - 100f * scale) / 2f, box.y + box.height - 120f * scale);
            Painter2D painter = context.painter2D;
            painter.BeginPath();
            Silhouette.AddTo(painter, scale, offset);
            painter.fillColor = tone;
            painter.Fill(FillRule.NonZero);
        }

        private static Color Hex(int rgb, float alpha = 1f) =>
            new Color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f, alpha);
    }

    public enum PortraitTone
    {
        Neutral,
        Face,
        Heel,
        Gold,
        Action,
    }

    /// <summary>Star rating (0–5 in halves) drawn with the star icon: filled, half and empty.</summary>
    public sealed class Stars : VisualElement
    {
        public Stars(float rating, string sizeClass = "ds-icon--sm")
        {
            AddToClassList("ds-stars");
            rating = Mathf.Clamp(Mathf.Round(rating * 2f) / 2f, 0f, 5f);
            for (int index = 0; index < 5; index++)
            {
                float left = rating - index;
                var cell = new VisualElement();
                cell.AddToClassList("ds-stars__cell");
                var empty = new Icon("star", sizeClass, "ds-stars__empty");
                cell.Add(empty);
                if (left > 0)
                {
                    var clip = new VisualElement();
                    clip.AddToClassList("ds-stars__clip");
                    if (left < 1) clip.AddToClassList("ds-stars__clip--half");
                    clip.Add(new Icon("star", sizeClass, "ds-stars__full") { Filled = true });
                    cell.Add(clip);
                }
                Add(cell);
            }
            tooltip = $"{rating:0.#} stars";
        }
    }

    /// <summary>The design system's colours for code that paints (keep in step with DsTokens.uss).</summary>
    public static class DsColors
    {
        public static readonly Color Action = new Color32(0xd7, 0x30, 0x1a, 0xff);
        public static readonly Color ActionBright = new Color32(0xff, 0x3b, 0x1d, 0xff);
        public static readonly Color Data = new Color32(0x00, 0xe5, 0xff, 0xff);
        public static readonly Color Gold = new Color32(0xfa, 0xcc, 0x15, 0xff);
        public static readonly Color Surface = new Color32(0x0f, 0x17, 0x2a, 0xff);
        public static readonly Color Canvas = new Color32(0x09, 0x0d, 0x16, 0xff);
    }
}
