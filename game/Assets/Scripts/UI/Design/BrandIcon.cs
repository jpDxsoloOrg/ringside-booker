using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// The game's app icon (the ring, variant B) inside the UI: the sidebar's brand mark and the title
    /// screen. Textures live in <c>Assets/UI/Branding/Resources/Branding/</c>, made from the same
    /// renders as the exe icon (<c>game/branding/blender/build_ring_icons.py</c>): the simplified
    /// small render for small spots, the full render for large ones.
    /// </summary>
    public static class BrandIcon
    {
        /// <summary>The simplified render, for spots about 32 px across (64 px texture for scaled UIs).</summary>
        public const string Small = "Branding/app-icon-small-64";

        /// <summary>The full render, for the title screen.</summary>
        public const string Large = "Branding/app-icon-256";

        /// <summary>An element showing the icon at <paramref name="size"/> px, or null when the texture is missing.</summary>
        public static VisualElement Create(string resource, float size, string className)
        {
            var texture = Resources.Load<Texture2D>(resource);
            if (texture == null) return null;
            var icon = new VisualElement { name = "brand-icon", pickingMode = PickingMode.Ignore };
            icon.style.backgroundImage = new StyleBackground(texture);
            icon.style.width = size;
            icon.style.height = size;
            icon.style.flexShrink = 0;
            if (!string.IsNullOrEmpty(className)) icon.AddToClassList(className);
            return icon;
        }
    }
}
