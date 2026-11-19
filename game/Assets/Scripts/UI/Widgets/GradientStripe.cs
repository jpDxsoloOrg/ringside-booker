using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Widgets
{
    /// <summary>
    /// A horizontal colour fade: the top bar's red-orange stripe that runs out to transparent at 40%
    /// of its width (USS has no linear-gradient). Drawn as one quad with per-vertex tints.
    /// </summary>
    public sealed class GradientStripe : VisualElement
    {
        private static readonly ushort[] QuadIndices = { 0, 1, 2, 0, 2, 3 };

        private readonly Color from;
        private readonly Color to;
        private readonly float extent;

        /// <param name="from">The colour at the start edge.</param>
        /// <param name="to">The colour it fades to.</param>
        /// <param name="extent">The fraction of the width the fade covers (the rest is <paramref name="to"/>, not drawn when clear).</param>
        public GradientStripe(Color from, Color to, float extent = 0.4f)
        {
            this.from = from;
            this.to = to;
            this.extent = Mathf.Clamp01(extent);
            pickingMode = PickingMode.Ignore;
            style.position = Position.Absolute;
            style.left = 0;
            style.top = 0;
            style.right = 0;
            style.bottom = 0;
            generateVisualContent += Draw;
        }

        /// <summary>The flame (#ff3b1d) to transparent stripe used under the top bar and on the title screen.</summary>
        public static GradientStripe Flame(float extent = 0.4f) =>
            new GradientStripe(new Color32(0xff, 0x3b, 0x1d, 0xff), new Color32(0xff, 0x3b, 0x1d, 0x00), extent);

        private void Draw(MeshGenerationContext context)
        {
            float width = layout.width * extent;
            float height = layout.height;
            if (width <= 0 || height <= 0) return;

            MeshWriteData mesh = context.Allocate(4, 6);
            mesh.SetAllVertices(new[]
            {
                new Vertex { position = new Vector3(0, 0, Vertex.nearZ), tint = from },
                new Vertex { position = new Vector3(width, 0, Vertex.nearZ), tint = to },
                new Vertex { position = new Vector3(width, height, Vertex.nearZ), tint = to },
                new Vertex { position = new Vector3(0, height, Vertex.nearZ), tint = from },
            });
            mesh.SetAllIndices(QuadIndices);
        }
    }
}
