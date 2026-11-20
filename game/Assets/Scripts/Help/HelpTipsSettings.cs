using RingsideBooker.Release;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Help
{
    /// <summary>
    /// Settings › Help &amp; tips (POL5-05): the welcome and Alpha notice switches, bring the
    /// Getting started checklist back, reset all help progress, and open Help. Shared by the title
    /// screen's settings panel and the in-game Settings screen.
    /// </summary>
    public static class HelpTipsSettings
    {
        public static VisualElement Group()
        {
            VisualElement group = Ui.El("card", "settings-group").Named("settings-help-tips");
            HelpScreen.Style(group);
            group.Add(Ui.Text(TextFormat.Upper("Help & tips"), "settings-group__title"));
            group.Add(Ui.Text("The welcome for new games, the Alpha notice and each game's Getting started list. They are kept on this computer, not in your saves.",
                "field-hint", "settings-group__hint", "t-wrap"));

            VisualElement checks = Ds.Column("fr-settings__checks");
            Button welcome = FirstRun.CheckRow("Show the welcome for new games", HelpPrefs.WelcomeOn, value => HelpPrefs.WelcomeOn = value);
            welcome.name = "settings-welcome";
            checks.Add(welcome);
            if (ReleaseInfo.IsAlpha)
            {
                Button alpha = FirstRun.CheckRow("Show the Alpha notice for new games", !HelpPrefs.AlphaHidden, value => HelpPrefs.AlphaHidden = !value);
                alpha.name = "settings-alpha-notice";
                checks.Add(alpha);
            }
            group.Add(checks);

            VisualElement buttons = Ds.Row("fr-settings__buttons");
            bool inGame = EngineGame.Current != null && ShellController.Current != null;
            Button again = Ds.Button("Show the Getting started list again", () =>
            {
                HelpPrefs.SetChecklistHidden(GettingStarted.SlotKey, false);
                ShellController.Current?.Navigator.Go(NavigationModel.HomeItemId);
            }, DsButtonKind.Secondary, "check-circle");
            again.name = "settings-checklist-again";
            again.SetEnabled(inGame);
            buttons.Add(again);

            Button reset = Ds.Button("Reset help and tips", () => ConfirmReset(group), DsButtonKind.Ghost, "reset");
            reset.name = "settings-help-reset";
            buttons.Add(reset);

            if (inGame)
            {
                Button open = Ds.Button("Open Help", () => ShellController.Current?.Navigator.Go(HelpScreen.ScreenId), DsButtonKind.Ghost, "help");
                open.name = "settings-open-help";
                buttons.Add(open);
            }
            group.Add(buttons);
            if (!inGame) group.Add(Ui.Text("Load a game to bring its Getting started list back.", "field-hint", "t-wrap"));
            return group;
        }

        private static void ConfirmReset(VisualElement group)
        {
            VisualElement body = Ui.Text("The welcome, the Alpha notice and every game's Getting started list will show again.", "ds-type-body", "t-wrap");
            DsOverlay.Modal(group, "Reset help and tips?", body,
                ("Keep them", DsButtonKind.Secondary, null),
                ("Reset", DsButtonKind.Primary, () =>
                {
                    HelpPrefs.ResetAll();
                    VisualElement parent = group.parent;
                    if (parent == null) return;
                    int index = parent.IndexOf(group);
                    group.RemoveFromHierarchy();
                    parent.Insert(index, Group());
                    DsOverlay.Toast(parent, "Help and tips reset.", DsState.Good);
                }));
        }
    }
}
