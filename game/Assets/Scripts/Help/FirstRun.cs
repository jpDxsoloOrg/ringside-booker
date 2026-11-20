using System;
using RingsideBooker.Diagnostics;
using RingsideBooker.Release;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Help
{
    /// <summary>Which first-run sheet to show when a game opens.</summary>
    public enum FirstRunSheet
    {
        None,
        /// <summary>The welcome after the new-game wizard (with the Alpha notice in an Alpha build, unless hidden).</summary>
        Welcome,
        /// <summary>Just the Alpha notice: the first game this machine opens was loaded, not new.</summary>
        AlphaOnly,
    }

    /// <summary>
    /// First run (POL5-05 with POL9-10's Alpha notice): the welcome sheet right after the new-game
    /// wizard (never after a load or Continue), with the Alpha notice when
    /// <see cref="ReleaseInfo.IsAlpha"/>. A machine whose first game is loaded still sees the Alpha
    /// notice once. "Don't show this for new games" and "Don't show the Alpha notice again" are in
    /// PlayerPrefs (<see cref="HelpPrefs"/>); Settings › Help &amp; tips turns them back on.
    /// Dev tours (any <c>-rb…</c> argument but <c>-rbHelpShots</c>) and batch mode never see it.
    /// </summary>
    public static class FirstRun
    {
        private static bool newGamePending;

        /// <summary>The welcome sheet open now, or null.</summary>
        public static OverlayHandle Current { get; private set; }

        /// <summary>Forces the sheet even under a dev argument (the help tour sets it).</summary>
        public static bool AllowInTours { get; set; }

        /// <summary>The new-game wizard calls this just before it enters the game.</summary>
        public static void MarkNewGame() => newGamePending = true;

        /// <summary>The decision, as a pure function of the flags.</summary>
        public static FirstRunSheet Decide(bool newGame, bool welcomeOn, bool isAlpha, bool alphaHidden, bool alphaSeen)
        {
            if (newGame && welcomeOn) return FirstRunSheet.Welcome;
            if (isAlpha && !alphaHidden && !alphaSeen) return FirstRunSheet.AlphaOnly;
            return FirstRunSheet.None;
        }

        /// <summary>Whether the welcome includes the Alpha notice.</summary>
        public static bool ShowsAlpha(FirstRunSheet sheet, bool isAlpha, bool alphaHidden) =>
            sheet == FirstRunSheet.AlphaOnly || sheet == FirstRunSheet.Welcome && isAlpha && !alphaHidden;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Wire()
        {
            ShellController.Opened -= OnShellOpened;
            ShellController.Opened += OnShellOpened;
        }

        private static void OnShellOpened(ShellController shell)
        {
            shell.Navigator.Navigated += route =>
            {
                if (route.ScreenId == ScreenIds.ShowResults) GettingStarted.Record(GettingStarted.ReadResults);
            };
            bool newGame = newGamePending;
            newGamePending = false;
            if (Suppressed()) return;
            FirstRunSheet sheet = Decide(newGame, HelpPrefs.WelcomeOn, ReleaseInfo.IsAlpha, HelpPrefs.AlphaHidden, HelpPrefs.AlphaSeen);
            if (sheet == FirstRunSheet.None) return;
            // After the Office has drawn, so the sheet opens over the game.
            shell.Shell.Root.schedule.Execute(() => Open(shell.Shell.Root, sheet)).ExecuteLater(300);
        }

        private static bool Suppressed()
        {
            if (Application.isBatchMode) return true;
            if (AllowInTours) return false;
            foreach (string arg in Environment.GetCommandLineArgs())
            {
                if (arg.StartsWith("-rb", StringComparison.OrdinalIgnoreCase) && !string.Equals(arg, "-rbHelpShots", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(arg, "-rbSeed", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Opens the welcome (or the Alpha notice alone) as a side sheet.</summary>
        public static OverlayHandle Open(VisualElement anyElement, FirstRunSheet sheet)
        {
            if (sheet == FirstRunSheet.None) return null;
            Current?.Close();
            bool alpha = ShowsAlpha(sheet, ReleaseInfo.IsAlpha, HelpPrefs.AlphaHidden);
            if (alpha) HelpPrefs.AlphaSeen = true;
            ShellSnapshot snapshot = ShellServices.IsInstalled ? ShellServices.Data.Snapshot : null;
            string promotion = snapshot?.Promotion?.Name;

            VisualElement body = Ds.Column("fr-body").Named("first-run");
            HelpScreen.Style(body);
            OverlayHandle handle = null;

            if (sheet == FirstRunSheet.Welcome)
            {
                if (promotion != null)
                {
                    body.Add(Para("You're the booker now. You decide who's on the card, who wins and who gets the push. The money is yours to worry about too."));
                    body.Add(Para("Start on the Office: it lists what needs you today. Your first show is close, so book it, run it and see what the crowd thinks. The Getting started list on the Office walks you through it."));
                }
                else
                {
                    body.Add(Para("You don't run a promotion yet. Look around the world from the sidebar: the workers, the promotions and the news."));
                }
                body.Add(Para("Every number has a quiet Why? next to it. Hover the number and click the ? to see how it was worked out. Help is in the sidebar whenever you want it."));
            }
            if (alpha) body.Add(AlphaNotice());

            VisualElement footer = Ds.Row("fr-footer");
            if (sheet == FirstRunSheet.Welcome)
            {
                Button never = CheckRow("Don't show this for new games", !HelpPrefs.WelcomeOn, value => HelpPrefs.WelcomeOn = !value);
                never.name = "first-run-never";
                body.Add(never);
            }
            Button help = Ds.Button("Open Help", () =>
            {
                handle?.Close();
                ShellController.Current?.Navigator.Go(ShellRoute.To(HelpScreen.ScreenId));
            }, DsButtonKind.Secondary, "help");
            help.name = "first-run-help";
            footer.Add(help);
            footer.Add(Ds.Spacer());
            Button go = Ds.Button(sheet == FirstRunSheet.Welcome ? "Let's go" : "Got it", () => handle?.Close(), DsButtonKind.Primary);
            go.name = "first-run-go";
            footer.Add(go);

            string title = sheet == FirstRunSheet.AlphaOnly ? "This is the Alpha" : promotion != null ? $"Welcome to {promotion}" : "Welcome to Ringside Booker";
            handle = DsOverlay.SideSheet(anyElement, title, body, sheet == FirstRunSheet.Welcome ? "WELCOME" : "RINGSIDE BOOKER", footer, 520f);
            if (handle == null) return null;
            handle.Content.name = "first-run-sheet";
            Current = handle;
            handle.Closed += () =>
            {
                if (Current == handle) Current = null;
            };
            go.schedule.Execute(() => go.Focus());
            return handle;
        }

        /// <summary>The Alpha notice (POL9-10 subtask 3): an early test build, saves may need a fresh start, Send feedback.</summary>
        private static VisualElement AlphaNotice()
        {
            VisualElement box = Ds.Column("fr-alpha", Ds.StateClass(DsState.Warn)).Named("first-run-alpha");
            VisualElement head = Ds.Row("fr-alpha__head");
            head.Add(Ds.Pill(DsState.Warn, "ALPHA", "warning", solid: true));
            head.Add(Ds.Text($"Version {ReleaseInfo.Version}", "ds-type-caption", "fr-alpha__version"));
            box.Add(head);
            box.Add(Para("This is an early test build. Some screens aren't built yet, and things will break."));
            box.Add(Para("Saves may need a fresh start between versions: a save from an older Alpha might not open in a newer one."));
            box.Add(Para("When something goes wrong or feels off, press Send feedback. It packs a bug report and opens an email you can send me. It's the best way to help."));
            VisualElement row = Ds.Row("fr-alpha__row");
            Button send = Ds.Button("Send feedback", Feedback.Send, DsButtonKind.Secondary, "megaphone");
            send.name = "first-run-feedback";
            row.Add(send);
            box.Add(row);
            Button hide = CheckRow("Don't show the Alpha notice again", HelpPrefs.AlphaHidden, value => HelpPrefs.AlphaHidden = value);
            hide.name = "first-run-alpha-hide";
            box.Add(hide);
            return box;
        }

        private static Label Para(string text) => Ds.Text(text, "ds-type-body", "fr-para");

        /// <summary>A checkbox row: a box with a tick and its words; the whole row toggles.</summary>
        public static Button CheckRow(string text, bool on, Action<bool> changed)
        {
            bool value = on;
            Button row = null;
            row = new Button(() =>
            {
                value = !value;
                row.EnableInClassList("fr-check--on", value);
                changed(value);
            }) { text = string.Empty };
            row.AddToClassList("fr-check");
            row.EnableInClassList("fr-check--on", value);
            VisualElement box = Ui.El("fr-check__box");
            box.Add(new Icon("check", "ds-icon--xs", "fr-check__tick"));
            row.Add(box);
            row.Add(Ui.Text(text, "fr-check__label"));
            return row;
        }
    }
}
