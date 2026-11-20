using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Screens;
using RingsideBooker.Screens.Dev;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Help.Dev
{
    /// <summary>
    /// A developer tour of help and first run (POL5-02/05): run the player with
    /// <c>-rbHelpShots &lt;folder&gt;</c>. It resets help progress, opens Help from the title screen
    /// (index and an article, where screen links are plain text), starts a default-world game, and
    /// captures the welcome sheet with the Alpha notice, the Office's Getting started checklist,
    /// the screen header's "?" and its sheet, the Help index, a search, an article, an anchor, an
    /// unknown slug and a fixture with every block and link kind (and inert script). It then plays
    /// to the first show, opens the results and captures the checklist's progress and Settings ›
    /// Help &amp; tips. A PNG per step; logs <c>[HelpShots]</c>; exit 1 on a time-out.
    /// </summary>
    public sealed class HelpShots : MonoBehaviour
    {
        public const string Argument = "-rbHelpShots";

        /// <summary>Every block, run and link kind, and things that must stay inert.</summary>
        public const string Fixture =
            "Plain words, **bold**, _italic_, a key `Shift+N`, a term [[push|the push]], and links: [an article](help:booking), " +
            "[a heading](help:booking#the-card-check), [a screen](screen:roster), [a screen not built](screen:inbox) and [a web page](https://example.com).\n\n" +
            "## A heading\n\n### A smaller heading\n\n- One item\n- Two items with **bold**\n\n1. First\n2. Second\n\n" +
            "> **Tip:** A tip callout with a [link](help:roster).\n\n> **Note:** A note callout.\n\n" +
            "Inert: <script>alert(1)</script>, <color=red>not red</color>, [a script link](javascript:alert(1)) and **unclosed bold.\n\n::example-why\n";

        private string folder;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("HelpShots");
                DontDestroyOnLoad(host);
                host.AddComponent<HelpShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 420f);
            Directory.CreateDirectory(folder);
            HelpPrefs.ResetAll();
            FirstRun.AllowInTours = true;
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);

            // Help before a game: the title screen's menu.
            VisualElement title = FindAnyObjectByType<UI.Title.TitleController>()?.GetComponent<UIDocument>().rootVisualElement;
            Click(title?.Q<Button>("menu-help"));
            yield return Wait(0.8f);
            yield return Capture("title-help");
            Click(title?.Q<Button>("help-card-getting-started"));
            yield return Wait(0.8f);
            yield return Capture("title-help-article");
            Click(title?.Q<Button>("menu-new-game"));
            yield return Wait(0.8f);

            // A new game: the welcome sheet with the Alpha notice.
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return WaitIdle(1.5f);
            float until = Time.realtimeSinceStartup + 10f;
            while (FirstRun.Current == null && Time.realtimeSinceStartup < until) yield return null;
            yield return Wait(0.6f);
            Log($"welcome open: {FirstRun.Current != null}");
            yield return Capture("welcome-alpha");
            FirstRun.Current?.Close();
            yield return WaitIdle(1f);
            yield return Capture("office-checklist");

            // The screen header's "?" and its sheet.
            Button help = Root().Q<Button>("screen-help");
            Log($"screen help button: {help != null}");
            if (help != null) DsTooltip.ShowNow(help, "Help: The Office");
            yield return Wait(0.4f);
            yield return Capture("screen-help-button");
            DsTooltip.Hide();
            Click(help);
            yield return Wait(0.8f);
            yield return Capture("screen-help-sheet");
            ShellController.Current.Overlay.CloseAll();

            // The Help center.
            Go(new HelpLocation());
            yield return WaitIdle(0.8f);
            yield return Capture("help-index");
            HelpScreen.Current.Search("save");
            yield return Wait(0.5f);
            Log($"search 'save': {string.Join(", ", HelpScreen.Current.Results.Select(result => result.Slug))}");
            yield return Capture("help-search");
            HelpScreen.Current.Search(string.Empty);
            Go(new HelpLocation { Slug = "booking" });
            yield return WaitIdle(0.8f);
            yield return Capture("help-article");
            Go(new HelpLocation { Slug = "booking", Anchor = "the-card-check" });
            yield return WaitIdle(0.8f);
            yield return Capture("help-article-anchor");
            Go(new HelpLocation { Slug = "no-such-article" });
            yield return WaitIdle(0.6f);
            yield return Capture("help-not-found");

            // A fixture with every construct, in a sheet.
            VisualElement body = HelpRenderer.Render(HelpMarkdown.Parse(Fixture), new HelpRenderOptions
            {
                Followable = link => HelpLinks.Followable(link, true),
                Follow = link => Log($"followed {link}"),
            });
            HelpScreen.Style(body);
            DsOverlay.SideSheet(Root(), "Renderer fixture", body, "HELP", null, 560f);
            yield return Wait(0.8f);
            yield return Capture("help-fixture");
            ShellController.Current.Overlay.CloseAll();

            // Play to the first show, then read the results: the checklist ticks.
            yield return PlayFirstShow();
            ShellController.Current.Navigator.Go(ShellRoute.To(ScreenIds.ShowResults));
            yield return WaitIdle(1.5f);
            ShellController.Current.Navigator.Go(ShellRoute.To(NavigationModel.HomeItemId));
            yield return WaitIdle(2f);
            Log($"checklist done: {string.Join(",", HelpPrefs.Done(GettingStarted.SlotKey))}");
            yield return Capture("office-checklist-progress");

            ShellController.Current.Navigator.Go(ShellRoute.To(ScreenIds.Settings));
            yield return WaitIdle(1f);
            ScrollTo(Root().Q<VisualElement>("settings-help-tips"));
            yield return Wait(0.5f);
            yield return Capture("settings-help-tips");

            Log($"done: {folder}");
            Application.Quit(0);
        }

        private static IEnumerator PlayFirstShow()
        {
            EngineDayControl day = EngineGame.Current.DayControl;
            for (int step = 0; step < 80; step++)
            {
                yield return Await(SkipCheck.Settle());
                var gates = day.Gates;
                if (gates.Count == 0)
                {
                    day.NextDay();
                    yield return Wait(0.2f);
                    while (day.Advancing) yield return null;
                    continue;
                }
                GateHit lead = DayControlLogic.LeadingGate(gates);
                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    Task<bool?> show = SkipCheck.ShowNight(EngineGame.Current, lead);
                    yield return Await(show);
                    Log($"show night: {(show.Result == true ? "live" : show.Result == false ? "auto" : "did not run")}");
                    yield return Await(SkipCheck.Settle());
                    yield break;
                }
                yield return Await(SkipCheck.ClearStop(lead));
            }
            Log("no show came up");
        }

        private static void Go(HelpLocation location) => ShellController.Current.Navigator.Go(location.ToRoute());

        private static VisualElement Root() => ShellController.Current.GetComponent<UIDocument>().rootVisualElement;

        private static void Log(string text) => Debug.Log("[HelpShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[HelpShots] timed out");
            Application.Quit(1);
        }

        private static void ScrollTo(VisualElement element)
        {
            ScrollView scroll = element?.GetFirstAncestorOfType<ScrollView>();
            if (scroll == null) return;
            Vector2 local = scroll.contentContainer.WorldToLocal(element.worldBound.position);
            scroll.scrollOffset = new Vector2(0, Mathf.Max(0, local.y - 12));
        }

        private static void Click(Button button)
        {
            if (button == null)
            {
                Debug.LogWarning("[HelpShots] button missing");
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

        private static IEnumerator WaitIdle(float atLeast)
        {
            yield return new WaitForSecondsRealtime(0.4f);
            float until = Time.realtimeSinceStartup + 30f;
            while (EngineRuntime.Client != null && EngineRuntime.Client.IsBusy && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(atLeast);
        }

        private static IEnumerator Await(Task task)
        {
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted) Debug.LogException(task.Exception);
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            index++;
            string path = Path.Combine(folder, $"{index:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[HelpShots] {path}");
        }
    }
}
