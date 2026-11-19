using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Screens.News;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the News screen and the sidebar badges (UNITY-19): run the player with
    /// <c>-rbNewsShots &lt;folder&gt; [-rbNewsShotsDays N]</c> (default 21). It starts a default-world
    /// game, plays N days (shows on Auto, other stops cleared as a player would; a news alert is
    /// followed from the day button to News, captured and cleared there), captures the sidebar's
    /// badges, then the front page, the feed, the kinds filter, a filtered feed, the column picker,
    /// a story sheet and its buzz Why?, and the alert settings. A PNG per step; logs
    /// <c>[NewsShots]</c> (badge counts, rows); exit 1 on a time-out.
    /// </summary>
    public sealed class NewsShots : MonoBehaviour
    {
        public const string Argument = "-rbNewsShots";
        public const string DaysArgument = "-rbNewsShotsDays";

        private string folder;
        private int days = 21;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("NewsShots");
                DontDestroyOnLoad(host);
                NewsShots shots = host.AddComponent<NewsShots>();
                shots.folder = args[i + 1];
                for (int j = 0; j < args.Length - 1; j++)
                {
                    if (string.Equals(args[j], DaysArgument, StringComparison.OrdinalIgnoreCase) && int.TryParse(args[j + 1], out int n)) shots.days = n;
                }
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 480f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return WaitIdle(1.5f);
            LogBadges("start");

            // Turn every news alert on, so an alert stop comes up while playing.
            Task<Engine.QueryResult<Newtonsoft.Json.Linq.JToken>> rules = EngineGame.Current.Client.Query("news.alertRules");
            yield return Await(rules);
            var allOn = new Newtonsoft.Json.Linq.JObject();
            foreach (Newtonsoft.Json.Linq.JToken rule in Kit.Arr(rules.Result.Data, "rules")) allOn[Kit.Str(rule, "id")] = true;
            yield return Await(EngineGame.Current.Client.Command("news.setAlertRules", new Newtonsoft.Json.Linq.JObject { ["rules"] = allOn }));

            // Play on, clearing stops; follow the first news alert to News.
            EngineDayControl day = EngineGame.Current.DayControl;
            GameDate start = EngineGame.Current.ShellData.Snapshot.Date;
            bool alertShot = false;
            for (int step = 0; step < 200; step++)
            {
                yield return Await(SkipCheck.Settle());
                if (start.DaysUntil(EngineGame.Current.ShellData.Snapshot.Date) >= days) break;
                IReadOnlyList<GateHit> gates = day.Gates;
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
                    yield return Await(SkipCheck.ShowNight(EngineGame.Current, lead));
                    continue;
                }
                if (lead.ActionHint == GateHints.News && !alertShot)
                {
                    ShellController.Current.DayControl.RunPrimary();
                    yield return WaitIdle(2f);
                    alertShot = true;
                    yield return Capture("stop-news-alert");
                    Log($"news alert: {lead.Reason} → {ShellController.Current.Navigator.Current}");
                    yield return Await(SkipCheck.ClearOnNews());
                    yield return Await(SkipCheck.Settle());
                    Log($"after the News screen: {day.Gates.Count(hit => hit.ActionHint == GateHints.News)} news stops left");
                    continue;
                }
                yield return Await(SkipCheck.ClearStop(lead));
            }

            // The sidebar's badges, seen from the Office.
            ShellController.Current.Navigator.Go(ShellRoute.To(NavigationModel.HomeItemId));
            yield return WaitIdle(2f);
            LogBadges("before News");
            yield return Capture("office-badges");

            ShellController.Current.Navigator.Go(ShellRoute.To(NewsScreen.ScreenId));
            yield return WaitIdle(2f);
            NewsView view = NewsScreen.Current;
            yield return Capture("front-page");
            Log($"lead {view.LeadId}, feed rows {view.Rows.Count}");
            LogBadges("after News");

            ScrollTo(view.Root.Q<VisualElement>("news-toolbar"));
            yield return Wait(0.6f);
            yield return Capture("feed");

            Click(view.Root.Q<Button>("news-kinds"));
            yield return Wait(0.6f);
            yield return Capture("kinds");
            Click(Q<Button>(button => button.name == "news-kind-signing"));
            Click(Q<Button>(button => button.name == "news-kind-result"));
            yield return WaitIdle(0.8f);
            ShellController.Current.Overlay.CloseAll();
            view.SetFilters(view.Filters.WithPeriod("30"));
            yield return WaitIdle(1f);
            ScrollTo(view.Root.Q<VisualElement>("news-toolbar"));
            yield return Wait(0.4f);
            yield return Capture("feed-filtered");
            Log($"filtered rows {view.Rows.Count}");

            view.SetFilters(view.Filters.WithKinds(Array.Empty<string>()).WithMine(true));
            yield return WaitIdle(1f);
            Click(view.Table.Q<Button>("table-columns"));
            yield return Wait(0.6f);
            yield return Capture("feed-mine-columns");
            ShellController.Current.Overlay.CloseAll();
            view.SetFilters(NewsFilters.None);
            yield return WaitIdle(1f);

            ScrollTo(view.Root.Q<VisualElement>("screen-news"));
            string storyId = view.LeadId ?? view.Rows.Select(row => Kit.Str(row, "id")).FirstOrDefault();
            view.OpenStory(storyId);
            yield return WaitIdle(1f);
            yield return Capture("story");
            WhyButton why = NewsStorySheet.Current?.Entry.Q<WhyButton>(className: "nw-why");
            if (why != null)
            {
                why.OpenPanel();
                yield return WaitIdle(1.5f);
                yield return Capture("story-buzz-why");
            }
            ShellController.Current.Overlay.CloseAll();
            WhyPanelHost.CloseCurrent();
            yield return Wait(0.4f);

            view.OpenAlerts();
            yield return WaitIdle(1f);
            yield return Capture("alerts");
            ShellController.Current.Overlay.CloseAll();

            Log($"done: {folder}");
            Application.Quit(0);
        }

        private static void LogBadges(string when)
        {
            ShellSnapshot snapshot = EngineGame.Current.ShellData.Snapshot;
            Log($"badges {when}: news {snapshot.Badge(NavBadgeKey.UnreadNews)}, decisions {snapshot.Badge(NavBadgeKey.PendingDecisions)}, " +
                $"wants to leave {snapshot.Badge(NavBadgeKey.WantsToLeave)}");
        }

        private static void Log(string text) => Debug.Log("[NewsShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[NewsShots] timed out");
            Application.Quit(1);
        }

        private static void ScrollTo(VisualElement element)
        {
            ScrollView scroll = element?.GetFirstAncestorOfType<ScrollView>();
            if (scroll == null) return;
            Vector2 local = scroll.contentContainer.WorldToLocal(element.worldBound.position);
            scroll.scrollOffset = new Vector2(0, Mathf.Max(0, local.y - 12));
        }

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            VisualElement root = ShellController.Current?.GetComponent<UIDocument>().rootVisualElement;
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null) Debug.LogWarning($"[NewsShots] no {typeof(T).Name} found");
            return found;
        }

        private static void Click(Button button)
        {
            if (button == null) return;
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
            Debug.Log($"[NewsShots] {path}");
        }
    }
}
