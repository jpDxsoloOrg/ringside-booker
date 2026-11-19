using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// The placeholder portrait options side by side for the owner (UNITY-11 portrait follow-up):
    /// (A) silhouette without the neck, (B) monogram with a sports-card stripe (the default), (C) the
    /// monogram over a faint silhouette; each at table (28 px), matchup (52×60), card (200×200) and
    /// hero (150×172) size, for a face, a heel and a free agent from the default world.
    /// </summary>
    public static class PortraitCompareMockup
    {
        private static readonly (string name, Alignment side, string label)[] Workers =
        {
            ("Calder Voss", Alignment.Face, "Face"),
            ("Ewan Thackeray", Alignment.Heel, "Heel"),
            ("Nicolás Abreu", Alignment.Tweener, "Free agent"),
        };

        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            page.Add(Ds.Text("PLACEHOLDER PORTRAITS", "ds-type-headline"));
            page.Add(Ds.Text("For workers with no picture. Default world: Calder Voss (face), Ewan Thackeray (heel), Nicolás Abreu (free agent). Sizes: table, matchup, card, hero.", "ds-type-caption", "mk-gap-bottom"));
            Row(page, PortraitStyle.Silhouette, "A", "Silhouette, no neck");
            Row(page, PortraitStyle.Monogram, "B", "Monogram (default)");
            Row(page, PortraitStyle.MonogramSilhouette, "C", "Monogram over a faint silhouette");
            return page;
        }

        private static void Row(VisualElement page, PortraitStyle style, string letter, string title)
        {
            VisualElement row = Ds.Row("ds-row--top", "mk-pc-row");
            if (style == Portrait.DefaultStyle) row.AddToClassList("mk-pc-row--default");
            VisualElement head = Ds.Column("mk-pc-head");
            head.Add(Ds.Text(letter, "mk-pc-head__letter"));
            head.Add(Ds.Text(title, "mk-pc-head__title"));
            row.Add(head);
            foreach ((string name, Alignment side, string label) in Workers)
            {
                VisualElement group = Ds.Column("mk-pc-group");
                group.Add(Ds.Text($"{name} · {label}", "mk-label"));
                VisualElement sizes = Ds.Row("ds-row--top", "mk-pc-sizes");
                sizes.Add(Box(name, side, style, "ds-portrait--xs"));
                sizes.Add(Box(name, side, style, "ds-portrait--sm"));
                sizes.Add(Box(name, side, style, "mk-pc-card"));
                sizes.Add(Box(name, side, style, "ds-portrait--lg"));
                group.Add(sizes);
                row.Add(group);
            }
            page.Add(row);
        }

        private static VisualElement Box(string name, Alignment side, PortraitStyle style, string sizeClass)
        {
            VisualElement box = Ds.El("ds-portrait", sizeClass, "mk-pc-box");
            box.Add(new Portrait(null, DsCards.Tone(side), name, style));
            return box;
        }
    }
}
