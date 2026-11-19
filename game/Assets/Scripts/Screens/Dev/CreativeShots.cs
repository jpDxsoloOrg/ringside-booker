using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Creative;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;
using GateHit = RingsideBooker.UI.Bridge.GateHit;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the Titles and Storylines screens (UNITY-16): run the player with
    /// <c>-rbCreativeShots &lt;folder&gt;</c>. It starts a default-world game and captures the titles
    /// list (both tabs), a title's page with its column picker and prestige Why?, the card menu, the
    /// edit, award and strip-confirm sheets, creates a title and awards it, vacates it; then the
    /// storylines desk, the create sheet with people picked, the new storyline's page; plays two
    /// weeks of shows so the timelines fill; then a storyline's page, a member's menu, Add people,
    /// End with the payoff preview, the ended page and the Ended tab. A PNG per step; logs
    /// <c>[CreativeShots]</c>; exit 1 on a time-out.
    /// </summary>
    public sealed class CreativeShots : MonoBehaviour
    {
        public const string Argument = "-rbCreativeShots";

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
                var host = new GameObject("CreativeShots");
                DontDestroyOnLoad(host);
                host.AddComponent<CreativeShots>().folder = args[i + 1];
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
            yield return Wait(2f);
            ShellNavigator nav = ShellController.Current.Navigator;

            // ---- Titles ----
            nav.Go(ShellRoute.To(TitlesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            TitlesView titles = TitlesScreen.Current;
            yield return Capture("titles-own");
            Log($"own titles {titles.ShownTitles.Count}");

            JToken held = titles.ShownTitles.FirstOrDefault(row => Kit.Obj(row, "champion") != null && Kit.Bool(row, "editable"));
            if (held != null)
            {
                Click(Q<Button>(button => button.name == "title-menu-" + Kit.Str(held, "titleId")));
                yield return Wait(0.6f);
                yield return Capture("titles-card-menu");
                ShellController.Current.Overlay.CloseAll();
            }

            titles.SelectTab("world");
            yield return WaitIdle(1f);
            yield return Capture("titles-world");
            titles.SelectStatus("retired");
            yield return WaitIdle(1f);
            yield return Capture("titles-world-retired");
            titles.SelectTab("own");
            titles.SelectStatus("active");
            yield return WaitIdle(1f);

            if (held != null)
            {
                string heldId = Kit.Str(held, "titleId");
                titles.Open(heldId);
                yield return WaitIdle(1.5f);
                titles = TitlesScreen.Current;
                yield return Capture("title-page");
                Click(Q<Button>(button => button.name == "table-columns"));
                yield return Wait(0.6f);
                yield return Capture("title-lineage-columns");
                ShellController.Current.Overlay.CloseAll();

                WhyButton prestigeWhy = titles.Root.Q("title-hero")?.Query<WhyButton>().First();
                if (prestigeWhy != null)
                {
                    prestigeWhy.OpenPanel();
                    yield return WaitIdle(1f);
                    yield return Capture("title-prestige-why");
                    WhyPanelHost.CloseCurrent();
                    ShellController.Current.Overlay.CloseAll();
                }

                Click(Q<Button>(button => button.name == "title-action-edit"));
                yield return WaitIdle(1f);
                yield return Capture("title-edit");
                Click(Q<Button>(button => button.name == "title-more-toggle"));
                yield return Wait(0.5f);
                yield return Capture("title-edit-more");
                ShellController.Current.Overlay.CloseAll();

                Click(Q<Button>(button => button.name == "title-action-award"));
                yield return WaitIdle(1.5f);
                yield return Capture("title-award");
                Button pick = Q<Button>(button => button.name != null && button.name.StartsWith("award-person-", StringComparison.Ordinal) && button.enabledSelf);
                Click(pick);
                yield return Wait(0.5f);
                Click(Q<Button>(button => button.name == "award-show-ineligible"));
                yield return WaitIdle(1f);
                yield return Capture("title-award-picked");
                Click(Q<Button>(button => button.name == "award-confirm"));
                yield return Wait(0.6f);
                yield return Capture("title-award-strip-confirm");
                ShellController.Current.Overlay.CloseAll();

                Click(Q<Button>(button => button.name == "title-action-vacate"));
                yield return Wait(0.6f);
                yield return Capture("title-vacate-confirm");
                ShellController.Current.Overlay.CloseAll();
            }

            // Create a title, land on its (vacant) page, award it, then vacate it.
            nav.Go(ShellRoute.To(TitlesScreen.ScreenId));
            yield return WaitIdle(1f);
            SendSubmit(Q<VisualElement>(element => element.name == "titles-new"));
            yield return WaitIdle(1.5f);
            TextField nameField = Q<TextField>(field => field.name == "title-name");
            if (nameField != null) nameField.value = "Tour Open Championship";
            yield return Wait(0.4f);
            yield return Capture("title-new");
            Click(Q<Button>(button => button.name == "title-form-save"));
            yield return WaitIdle(2f);
            yield return Capture("title-new-vacant-page");
            Log($"after create: {nav.Current}");
            if (nav.Current?.Param("title") != null)
            {
                SendSubmit(Q<VisualElement>(element => element.name == "title-award"));
                yield return WaitIdle(1.5f);
                Click(Q<Button>(button => button.name != null && button.name.StartsWith("award-person-", StringComparison.Ordinal) && button.enabledSelf));
                yield return Wait(0.4f);
                Click(Q<Button>(button => button.name == "award-confirm"));
                yield return WaitIdle(2f);
                yield return Capture("title-new-awarded");
                Click(Q<Button>(button => button.name == "title-action-vacate"));
                yield return Wait(0.5f);
                Click(Q<Button>(button => button.name == "title-vacate-confirm"));
                yield return WaitIdle(2f);
                yield return Capture("title-new-vacated");
            }

            // ---- Storylines ----
            nav.Go(ShellRoute.To(StorylinesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            StorylinesView desk = StorylinesScreen.Current;
            yield return Capture("storylines-desk");
            Log($"storylines {desk.Rows.Count}");

            SendSubmit(Q<VisualElement>(element => element.name == "storylines-new"));
            yield return WaitIdle(1.5f);
            TextField storyName = Q<TextField>(field => field.name == "storyline-name");
            if (storyName != null) storyName.value = "Tour Grudge";
            TextField summary = Q<TextField>(field => field.name == "storyline-summary");
            if (summary != null) summary.value = "Two rivals who can't stand each other. One more match settles it.";
            MemberPicker picker = StorylineSheets.Picker;
            if (picker != null)
            {
                foreach (JToken option in picker.Options.Where(option => Kit.Str(option, "role") == "wrestler").Skip(6).Take(2)) picker.Pick(option);
                if (picker.Chosen.Count == 2 && picker.Chosen[0].side == picker.Chosen[1].side) picker.SetSide(picker.Chosen[1].personId, picker.Chosen[0].side == "heel" ? "face" : "heel");
            }
            yield return Wait(0.5f);
            yield return Capture("storyline-new");
            Click(Q<Button>(button => button.name == "storyline-form-save"));
            yield return WaitIdle(2f);
            yield return Capture("storyline-new-page");
            Log($"after create: {nav.Current}");

            // Three weeks of shows so the timelines fill.
            yield return Await(PlayDays(24));
            yield return WaitIdle(1f);

            nav.Go(ShellRoute.To(StorylinesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            desk = StorylinesScreen.Current;
            yield return Capture("storylines-desk-later");
            JToken hottest = desk.Rows.Where(row => Kit.Str(row, "status") == "active" && Kit.Bool(row, "editable"))
                .OrderByDescending(row => Kit.Num(row, "linkedSegmentCount") ?? 0).FirstOrDefault();
            if (hottest != null)
            {
                desk.Open(Kit.Str(hottest, "id"));
                yield return WaitIdle(1.5f);
                StorylinesView page = StorylinesScreen.Current;
                yield return Capture("storyline-page");
                VisualElement timeline = page.Root.Q("storyline-timeline");
                if (timeline != null)
                {
                    ScrollTo(timeline);
                    yield return Wait(0.6f);
                    yield return Capture("storyline-timeline");
                }
                JToken member = Kit.Arr(page.Detail, "faces").FirstOrDefault();
                if (member != null)
                {
                    Click(Q<Button>(button => button.name == "storyline-member-menu-" + Kit.Str(member, "personId")));
                    yield return Wait(0.6f);
                    yield return Capture("storyline-member-menu");
                    ShellController.Current.Overlay.CloseAll();
                }
                Click(Q<Button>(button => button.name == "storyline-edit"));
                yield return WaitIdle(1f);
                yield return Capture("storyline-edit");
                ShellController.Current.Overlay.CloseAll();
                SendSubmit(Q<VisualElement>(element => element.name == "storyline-people")?.Q<Button>(className: "ds-btn--link"));
                yield return WaitIdle(1.5f);
                yield return Capture("storyline-add-people");
                ShellController.Current.Overlay.CloseAll();
                Click(Q<Button>(button => button.name == "storyline-end"));
                yield return WaitIdle(2f);
                yield return Capture("storyline-end-preview");
                Click(Q<Button>(button => button.name == "storyline-end-confirm"));
                yield return WaitIdle(2f);
                yield return Capture("storyline-ended-page");
            }

            nav.Go(StorylinesScreen.ListRoute("ended"));
            yield return WaitIdle(1.5f);
            yield return Capture("storylines-ended");

            // A rival's storyline: only the public facts.
            QueryResult<JToken> promotions = null;
            Task<QueryResult<JToken>> list = EngineGame.Current.Client.Query("promotions.list", new JObject());
            yield return Await(list);
            promotions = list.Result;
            string rival = Kit.Arr(promotions?.Data)
                .Select(row => Kit.Str(row, "promotionId"))
                .FirstOrDefault(id => id != null && id != EngineGame.Current.PromotionId);
            if (rival != null)
            {
                Task<QueryResult<JToken>> rivalList = EngineGame.Current.Client.Query("storylines.list", new JObject { ["promotionId"] = rival });
                yield return Await(rivalList);
                string rivalStory = Kit.Str(Kit.Arr(rivalList.Result?.Data, "rows").FirstOrDefault(), "id");
                if (rivalStory != null)
                {
                    nav.Go(StorylinesScreen.StorylineRoute(rivalStory));
                    yield return WaitIdle(1.5f);
                    yield return Capture("storyline-rival");
                }
            }

            nav.Go(ShellRoute.To(TitlesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            yield return Capture("titles-later");

            Log($"done: {folder}");
            Application.Quit(0);
        }

        // ---- Playing days -----------------------------------------------------------------------------

        /// <summary>
        /// Plays days the way the skip check does: show nights get Auto-fill and Auto results, contract
        /// stops are cleared on the Contracts screen, other stops through the day button.
        /// </summary>
        private static async Task PlayDays(int days)
        {
            EngineGame game = EngineGame.Current;
            EngineDayControl day = game.DayControl;
            QueryResult<SimStatus> start = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
            string startDate = start.Data?.Date;
            for (int step = 0; step < days * 4; step++)
            {
                await SkipCheck.Settle();
                QueryResult<SimStatus> now = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
                if (GameDate.TryParse(startDate, out GameDate from) && GameDate.TryParse(now.Data?.Date, out GameDate to) && from.DaysUntil(to) >= days) break;
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    day.NextDay();
                    await Task.Delay(200);
                    while (day.Advancing) await Task.Yield();
                    continue;
                }
                GateHit lead = DayControlLogic.LeadingGate(gates);
                if (lead.GateId == EngineGateActions.ShowsTonight) await SkipCheck.ShowNight(game, lead);
                else if (lead.GateId.StartsWith("contracts.", StringComparison.Ordinal)) await SkipCheck.ClearOnContracts(lead);
                else
                {
                    // A stop with an action of its own (injuries, news) is cleared with it; else the day button.
                    GateAction action = day.ActionsFor(lead).FirstOrDefault(entry => entry.Primary) ?? day.ActionsFor(lead).FirstOrDefault();
                    if (action != null) Log($"{lead.GateId}: {await action.Run() ?? "cleared"}");
                    else await SkipCheck.ClearStop(lead);
                }
            }
            ShellController.Current.Overlay.CloseAll();
        }

        // ---- Helpers --------------------------------------------------------------------------------

        private static void Log(string text) => Debug.Log("[CreativeShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[CreativeShots] timed out");
            Application.Quit(1);
        }

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            VisualElement root = ShellController.Current?.GetComponent<UIDocument>().rootVisualElement;
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null) Debug.LogWarning($"[CreativeShots] no {typeof(T).Name} found");
            return found;
        }

        private static void Click(Button button)
        {
            if (button == null) return;
            SendSubmit(button);
        }

        private static void SendSubmit(VisualElement element)
        {
            if (element == null) return;
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = element;
                element.SendEvent(submit);
            }
        }

        private static void ScrollTo(VisualElement element)
        {
            ScrollView scroll = element.GetFirstAncestorOfType<ScrollView>();
            scroll?.ScrollTo(element);
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
            Debug.Log($"[CreativeShots] {path}");
        }
    }
}
