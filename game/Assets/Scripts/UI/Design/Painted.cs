using System;
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
    /// How a worker with no picture is drawn (UNITY-11 portrait follow-up). All three are vectors on
    /// the side's colour gradient. Switch the game's default with <see cref="Portrait.DefaultStyle"/>.
    /// </summary>
    public enum PortraitStyle
    {
        /// <summary>(A) A head floating over rounded shoulders, no neck.</summary>
        Silhouette,
        /// <summary>(B) The worker's initials in the display face, with a faint diagonal sports-card stripe.</summary>
        Monogram,
        /// <summary>(C) The initials over a very faint head-and-shoulders silhouette, with the stripe.</summary>
        MonogramSilhouette,
    }

    /// <summary>
    /// A wrestler's picture: the workshop mod's picture when there is one, otherwise a placeholder on
    /// a gradient in the side's colour (face blue, heel violet, neutral navy, champions gold). The
    /// placeholder is <see cref="DefaultStyle"/> (the monogram) when the name is known, else the
    /// silhouette. Put it in a box with <c>overflow: hidden</c> and a radius (the <c>ds-portrait</c> classes do).
    /// </summary>
    public sealed class Portrait : VisualElement
    {
        /// <summary>The placeholder the game draws. Owner's choice: Monogram (B); A and C stay one edit away.</summary>
        public const PortraitStyle DefaultStyle = PortraitStyle.Monogram;

        private static readonly SvgPath Silhouette = SvgPath.Parse(
            // Head and rounded shoulders on a 100×120 box, bottom-aligned; the head floats (no neck).
            "M33 44A17 17 0 1 1 67 44A17 17 0 1 1 33 44Z" +
            "M12 120C12 92 28 70 50 70C72 70 88 92 88 120Z");

        private readonly GradientFill background;
        private readonly VisualElement stripe;
        private readonly VisualElement figure;
        private readonly Label initials;
        private readonly PortraitStyle placeholderStyle;
        private Color tone;
        private float figureAlpha;

        public Portrait(Texture2D picture = null, PortraitTone tone = PortraitTone.Neutral, string name = null, PortraitStyle? placeholder = null)
        {
            AddToClassList("ds-portrait-art");
            pickingMode = PickingMode.Ignore;
            string letters = Initials(name);
            placeholderStyle = letters == null ? PortraitStyle.Silhouette : placeholder ?? DefaultStyle;
            figureAlpha = placeholderStyle == PortraitStyle.MonogramSilhouette ? 0.32f : 1f;

            background = new GradientFill(Color.black, Color.black);
            stripe = new VisualElement { pickingMode = PickingMode.Ignore };
            stripe.AddToClassList("ds-portrait-art__stripe");
            stripe.generateVisualContent += DrawStripe;
            figure = new VisualElement { pickingMode = PickingMode.Ignore };
            figure.AddToClassList("ds-portrait-art__figure");
            figure.generateVisualContent += DrawFigure;
            initials = new Label(letters ?? string.Empty) { pickingMode = PickingMode.Ignore };
            initials.AddToClassList("ds-portrait-art__initials");
            Add(background);
            Add(stripe);
            Add(figure);
            Add(initials);
            // The initials scale with the box (USS sizes are fixed): about 42% of the shorter side.
            RegisterCallback<GeometryChangedEvent>(_ =>
            {
                float size = Mathf.Min(layout.width, layout.height);
                if (size > 0) initials.style.fontSize = Mathf.Max(9f, Mathf.Round(size * 0.42f));
            });
            SetTone(tone);
            SetPicture(picture);
        }

        /// <summary>The style this portrait draws when it has no picture.</summary>
        public PortraitStyle Style => placeholderStyle;

        /// <summary>
        /// Initials for a name: the first letters of the first and last words ("Calder Voss" → CV); a
        /// one-word ring name gives its first two letters ("Maestro" → MA). A leading "The" and quoted
        /// nicknames are skipped ("The Cheetah" → CH, Megan "Mariner" Warren → MW). Null for no name.
        /// </summary>
        public static string Initials(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            var words = new System.Collections.Generic.List<string>();
            foreach (string raw in name.Split(new[] { ' ', '\t', '-' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (raw.StartsWith("\"") || raw.StartsWith("“") || raw.StartsWith("'")) continue;
                string word = raw.Trim('"', '“', '”', '\'', '.', ',', '&', '(', ')');
                if (word.Length > 0 && char.IsLetterOrDigit(word[0])) words.Add(word);
            }
            if (words.Count > 1 && string.Equals(words[0], "The", StringComparison.OrdinalIgnoreCase)) words.RemoveAt(0);
            if (words.Count == 0) return null;
            if (words.Count == 1)
            {
                string only = words[0];
                return (only.Length > 1 ? only.Substring(0, 2) : only).ToUpperInvariant();
            }
            return $"{words[0][0]}{words[words.Count - 1][0]}".ToUpperInvariant();
        }

        public void SetPicture(Texture2D picture)
        {
            bool has = picture != null;
            bool monogram = placeholderStyle != PortraitStyle.Silhouette;
            figure.style.display = !has && placeholderStyle != PortraitStyle.Monogram ? DisplayStyle.Flex : DisplayStyle.None;
            stripe.style.display = !has && monogram ? DisplayStyle.Flex : DisplayStyle.None;
            initials.style.display = !has && monogram ? DisplayStyle.Flex : DisplayStyle.None;
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
            // Fit the 100×120 figure to 78% of the height, centred, standing on the bottom edge.
            float scale = Mathf.Min(box.width / 100f, box.height * 0.78f / 120f);
            var offset = new Vector2(box.x + (box.width - 100f * scale) / 2f, box.y + box.height - 120f * scale);
            Painter2D painter = context.painter2D;
            painter.BeginPath();
            Silhouette.AddTo(painter, scale, offset);
            painter.fillColor = new Color(tone.r, tone.g, tone.b, tone.a * figureAlpha);
            painter.Fill(FillRule.NonZero);
        }

        /// <summary>The sports-card stripe: a faint diagonal band (and a thinner one) from bottom-left to top-right.</summary>
        private void DrawStripe(MeshGenerationContext context)
        {
            Rect box = stripe.contentRect;
            if (box.width <= 0 || box.height <= 0) return;
            float w = box.width;
            float h = box.height;
            Painter2D painter = context.painter2D;
            Band(painter, w, h, 0.42f, 0.20f, 0.07f);
            Band(painter, w, h, 0.68f, 0.06f, 0.05f);
        }

        private static void Band(Painter2D painter, float w, float h, float at, float width, float alpha)
        {
            // A parallelogram leaning right: its bottom edge starts at `at` of the width, slanted by the height.
            float x0 = (at - 0.35f) * w;
            float band = width * w;
            float slant = h * 0.7f;
            painter.BeginPath();
            painter.MoveTo(new Vector2(x0, h));
            painter.LineTo(new Vector2(x0 + band, h));
            painter.LineTo(new Vector2(x0 + band + slant, 0));
            painter.LineTo(new Vector2(x0 + slant, 0));
            painter.ClosePath();
            painter.fillColor = new Color(1f, 1f, 1f, alpha);
            painter.Fill();
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
