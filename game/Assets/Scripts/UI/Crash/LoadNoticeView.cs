using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Crash
{
    /// <summary>
    /// The load notice banner (UNITY-24) at the top of the shell's content, above the advance summary
    /// and the screen: one quiet line ("This save was upgraded to work with this version."), a
    /// Details toggle with the upgrades and changes, and a close button. It follows
    /// <see cref="LoadNotice.Pending"/>.
    /// </summary>
    public static class LoadNoticeView
    {
        public const string ElementName = "load-notice";

        /// <summary>Adds the banner's slot to the shell (ShellController calls this once per Game scene).</summary>
        public static void Attach(AppShell shell)
        {
            VisualElement anchor = shell?.SummarySlot;
            if (anchor?.parent == null) return;
            var slot = new VisualElement { name = "load-notice-slot" };
            slot.AddToClassList("cx-load-notice-slot");
            CrashStyles.Apply(slot);
            anchor.parent.Insert(anchor.parent.IndexOf(anchor), slot);

            void Render()
            {
                slot.Clear();
                LoadNotice notice = LoadNotice.Pending;
                if (notice != null) slot.Add(Build(notice));
            }

            slot.RegisterCallback<AttachToPanelEvent>(_ => LoadNotice.Changed += Render);
            slot.RegisterCallback<DetachFromPanelEvent>(_ => LoadNotice.Changed -= Render);
            Render();
        }

        /// <summary>The banner for one notice.</summary>
        public static VisualElement Build(LoadNotice notice)
        {
            VisualElement banner = Ui.El("cx-load-notice", Ds.StateClass(DsState.Info)).Named(ElementName);
            VisualElement details = Ui.El("cx-load-notice__details").Named("load-notice-details");
            foreach (string line in notice.DetailLines) details.Add(Ui.Text(line, "cx-load-notice__line"));
            details.SetShown(false);

            Button toggle = null;
            toggle = Ds.Button("Details", () =>
            {
                bool open = details.style.display == DisplayStyle.None;
                details.SetShown(open);
                toggle.Q<Label>(className: "ds-btn__label").text = TextFormat.Upper(open ? "Hide details" : "Details");
            }, DsButtonKind.Ghost);
            toggle.name = "load-notice-toggle";
            Button close = Ds.IconButton("close", "Dismiss", LoadNotice.Dismiss);
            close.name = "load-notice-dismiss";

            VisualElement row = Ui.El("cx-load-notice__row").With(
                new Icon("info", "ds-icon--sm", "cx-load-notice__icon"),
                Ui.Text(notice.Headline, "cx-load-notice__headline"),
                toggle,
                close);
            return banner.With(row, details);
        }
    }
}
