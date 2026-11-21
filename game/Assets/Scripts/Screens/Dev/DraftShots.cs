using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.Screens.Draft;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;
using AdvanceReport = RingsideBooker.UI.Bridge.AdvanceReport;
using GateHit = RingsideBooker.UI.Bridge.GateHit;
using AdvanceRequest = RingsideBooker.UI.Bridge.AdvanceRequest;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// The draft start's smoke tour (DRF-02/03/06/07): run the player with
    /// <c>-rbDraftShots &lt;folder&gt;</c> (add <c>-rbDraftNegotiate</c> for "Negotiate contracts after
    /// the draft", <c>-rbDraftBiggest N</c> for how many promotions stay active, default 6). In the
    /// default world it keeps only the biggest N promotions, turns the draft on, starts, makes a pick,
    /// sims to the next pick, auto-picks the rest and finishes, then (negotiate-after) releases one
    /// draftee and offers the rest contracts, and plays two weeks so the first show (a week out, DRF-08) runs. A PNG per step; logs
    /// <c>[DraftShots]</c>; exit 0 when every check passes. Its save slot is deleted on quit (TourSlots).
    /// </summary>
    public sealed class DraftShots : MonoBehaviour
    {
        public const string Argument = "-rbDraftShots";
        public const string NegotiateArgument = "-rbDraftNegotiate";
        public const string BiggestArgument = "-rbDraftBiggest";
        private const int Days = 7;

        private string folder;
        private bool negotiate;
        private int biggest = 6;
        private int index;
        private bool failed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("DraftShots");
                DontDestroyOnLoad(host);
                DraftShots tour = host.AddComponent<DraftShots>();
                tour.folder = args[i + 1];
                tour.negotiate = args.Any(arg => string.Equals(arg, NegotiateArgument, StringComparison.OrdinalIgnoreCase));
                int at = Array.FindIndex(args, arg => string.Equals(arg, BiggestArgument, StringComparison.OrdinalIgnoreCase));
                if (at >= 0 && at + 1 < args.Length && int.TryParse(args[at + 1], out int count) && count > 0) tour.biggest = count;
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 600f);
            Directory.CreateDirectory(folder);
            Log($"negotiate after: {negotiate}; biggest {biggest} promotions");
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            NewGameWizard wizard = NewGameWizard.Last;
            yield return Await(wizard.UseDefaults(false));

            // ---- Wizard: the biggest N promotions, the draft on ----
            wizard.OpenPicker();
            float until = Time.realtimeSinceStartup + 20f;
            while (wizard.AllPromotionKeys == null && Time.realtimeSinceStartup < until) yield return null;
            Check(wizard.AllPromotionKeys != null, $"the picker lists {wizard.AllPromotionKeys?.Count} promotions");
            wizard.OnlyBiggest(biggest);
            yield return Await(wizard.WaitForSetup());
            yield return Wait(0.6f);
            int active = (int)(Kit.Num(wizard.SetupPreview, "promotions.active") ?? 0);
            Check(active == biggest, $"only the biggest {biggest} are active ({active}; {Kit.Num(wizard.SetupPreview, "wrestlers.onActiveRosters")} wrestlers on their rosters)");
            yield return Capture("wizard-active-promotions");
            wizard.ClosePicker();
            yield return Wait(0.6f);
            yield return Capture("wizard-options");
            wizard.SetSetting(DraftText.StartKey, "true");
            if (negotiate) wizard.SetSetting(DraftText.NegotiateAfterKey, "true");
            yield return Await(wizard.WaitForSetup());
            yield return Wait(0.6f);
            JToken plan = wizard.SetupPreview?["draft"];
            Check(plan != null && plan.Type == JTokenType.Object, $"the draft plan: {Kit.Num(plan, "promotions")} promotions, {Kit.Num(plan, "poolWrestlers")} in the pool, {Kit.Num(plan, "sittingOut")} sit out");
            ScrollToEnd(wizard);
            yield return Wait(0.6f);
            yield return Capture("wizard-draft-plan");

            // ---- Start: the draft room opens first ----
            yield return Await(wizard.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            until = Time.realtimeSinceStartup + 30f;
            while ((DraftScreen.Current?.Root.panel == null || DraftScreen.Current.State == null || DraftScreen.Current.PoolRows.Count == 0) && Time.realtimeSinceStartup < until) yield return null;
            yield return WaitIdle(1f);
            DraftView view = DraftScreen.Current;
            Check(view?.Root.panel != null && ShellController.Current.Navigator.Current?.ScreenId == DraftScreen.ScreenId, "the game opens on the draft room");
            Check(ShellController.Current.DayControl.State?.Primary.Label == DayControlLogic.FinishDraftLabel, $"the day button says \"{ShellController.Current.DayControl.State?.Primary.Label}\"");
            yield return Capture("draft-room");

            if (!view.YourTurn)
            {
                yield return Await(view.SimToMyPick());
                yield return WaitIdle(1f);
            }
            Check(view.YourTurn, "Sim to my pick stops on your pick");
            yield return Capture("draft-your-pick");

            // ---- Card level: filter to main eventers, then sort the whole pool by level ----
            view.FilterLevel("mainEvent");
            yield return WaitIdle(1f);
            Check(view.PoolRows.Count > 0 && view.PoolRows.All(row => Kit.Str(row, "level") == "mainEvent"), $"the card level filter shows {view.PoolRows.Count} main eventers");
            yield return Capture("draft-main-eventers");

            // ---- DRF-10: costs, cash left, and a profile from the board (Back keeps the filter) ----
            Check(view.PoolRows.All(row => Kit.Num(row, "cost") > 0), "every pool row shows a season cost");
            Check(view.Root.Q("draft-cash") != null, $"the header shows cash left ({Kit.Num(view.State, "you.cash")})");
            JToken star = view.PoolRows.First();
            view.OpenProfile(star);
            until = Time.realtimeSinceStartup + 10f;
            while (ShellController.Current.Navigator.Current?.ScreenId != ScreenIds.Worker && Time.realtimeSinceStartup < until) yield return null;
            yield return WaitIdle(1.5f);
            VisualElement screen = ShellController.Current.Navigator.Current?.ScreenId == ScreenIds.Worker ? ShellController.Current.GetComponent<UIDocument>().rootVisualElement : null;
            Check(screen != null, $"the board opens {Kit.Str(star, "name")}'s profile");
            Check(screen?.Q("worker-contract-action") == null && screen?.Q("worker-trade-action") == null, "the profile offers no contract or trade mid-draft");
            yield return Capture("draft-profile");
            ShellController.Current.Navigator.Back();
            until = Time.realtimeSinceStartup + 15f;
            while ((DraftScreen.Current == view || DraftScreen.Current?.Root.panel == null || DraftScreen.Current.PoolRows.Count == 0) && Time.realtimeSinceStartup < until) yield return null;
            yield return WaitIdle(1f);
            view = DraftScreen.Current;
            Check(ShellController.Current.Navigator.Current?.ScreenId == DraftScreen.ScreenId && view.PoolRows.All(row => Kit.Str(row, "level") == "mainEvent"),
                "Back returns to the draft room with the filter kept");
            view.FilterLevel(null);
            yield return WaitIdle(0.5f);
            view.SortPool("value", true);
            yield return WaitIdle(0.8f);

            // ---- A pick, with the confirm ----
            JToken first = view.PoolRows.FirstOrDefault();
            string firstId = Kit.Str(first, "personId");
            view.ConfirmPick(first);
            yield return Wait(0.8f);
            yield return Capture("draft-confirm");
            ShellController.Current.Overlay.CloseAll();
            Task<string> picked = view.Pick(firstId, Kit.Str(first, "name"));
            yield return Await(picked);
            Check(picked.Result == null, $"you drafted {Kit.Str(first, "name")} ({picked.Result ?? "ok"})");
            double cashBefore = Kit.Num(view.State, "you.cash") ?? 0;
            yield return WaitIdle(1.2f);
            if (!negotiate)
            {
                double cashAfter = Kit.Num(view.State, "you.cash") ?? 0;
                Check(Math.Abs(cashBefore - cashAfter - (Kit.Num(first, "cost") ?? -1)) < 1, $"the pick's season cost came off your cash ({cashBefore} to {cashAfter})");
            }
            yield return Capture("draft-after-pick");

            // ---- Sim to the next pick ----
            yield return Await(view.SimToMyPick());
            yield return WaitIdle(1f);
            Check(view.YourTurn || view.Status != "running", "Sim to my pick reaches your next pick");
            yield return Capture("draft-next-pick");

            // ---- A rival's roster, then auto-pick the rest and finish ----
            JToken rival = Kit.Arr(view.State, "rosters").FirstOrDefault(roster => !Kit.Bool(roster, "isYou"));
            if (rival != null)
            {
                view.OpenRoster(rival);
                yield return Wait(1.2f);
                yield return Capture("draft-rival-roster");
                ShellController.Current.Overlay.CloseAll();
            }
            Task<string> auto = view.AutoPickRest();
            yield return Await(auto);
            yield return WaitIdle(1.2f);
            Check(auto.Result == null && view.Status == "complete", $"auto-pick the rest completes the draft ({auto.Result ?? view.Status})");
            yield return Capture("draft-complete");
            Task<string> finish = view.Finish();
            yield return Await(finish);
            yield return WaitIdle(1.5f);
            Check(finish.Result == null && view.Status == "finished", $"finish closes the draft ({finish.Result ?? view.Status})");
            yield return SettleDay();
            Check(ShellController.Current.DayControl.State?.Primary.Label != DayControlLogic.FinishDraftLabel, "the draft stop is gone from the day button");
            yield return Capture("draft-finished");

            List<JToken> mine = Kit.Arr(view.State, "roster.picks").ToList();
            if (negotiate)
            {
                List<JToken> reserved = mine.Where(pick => Kit.Str(pick, "contract") == "reserved").ToList();
                Check(reserved.Count == mine.Count && mine.Count > 0, $"under negotiate-after every draftee joins unsigned ({reserved.Count} of {mine.Count})");
                if (reserved.Count > 2)
                {
                    JToken last = reserved[reserved.Count - 1];
                    Task<string> release = view.Release(Kit.Str(last, "personId"), Kit.Str(last, "name"));
                    yield return Await(release);
                    Check(release.Result == null, $"released {Kit.Str(last, "name")} back to the pool ({release.Result ?? "ok"})");
                    reserved.RemoveAt(reserved.Count - 1);
                    yield return WaitIdle(1f);
                }
                int offered = 0;
                foreach (JToken pick in reserved)
                {
                    Task<string> open = ContractsScreen.OpenNegotiation(Kit.Str(pick, "personId"), "auto");
                    yield return Await(open);
                    if (open.Result != null)
                    {
                        Log($"no talks with {Kit.Str(pick, "name")}: {open.Result}");
                        continue;
                    }
                    until = Time.realtimeSinceStartup + 15f;
                    while ((NegotiationSheet.Current?.Phase == null || NegotiationSheet.Current.Draft == null) && Time.realtimeSinceStartup < until) yield return null;
                    yield return Wait(0.3f);
                    if (offered == 0) yield return Capture("draft-negotiate-first");
                    if (NegotiationSheet.Current?.Phase == "new")
                    {
                        yield return Await(NegotiationSheet.Current.SubmitOffer());
                        offered++;
                    }
                    NegotiationSheet.Current?.Close();
                    yield return Wait(0.2f);
                }
                Check(offered > 0, $"offered contracts to {offered} draftees through the normal negotiation");
            }
            else
            {
                Check(mine.Count > 0 && mine.All(pick => Kit.Str(pick, "contract") == "signed"), $"every draftee is signed for the season ({mine.Count})");
            }

            // ---- Play a week so the shows run ----
            // Under negotiate-after a day-1 show comes before the answers: a second week shows a show running.
            int days = Days * 2;
            Task<(bool ok, int shows)> played = PlayDays(days);
            yield return Await(played);
            Check(played.Result.ok && played.Result.shows > 0, $"played {days} days with {played.Result.shows} show nights");
            Check(calledOff == 0, $"no show had to be called off ({calledOff})");
            Check(firstShow != null && startDay != null && startDay.Value.DaysUntil(firstShow.Value) >= 7, $"the first show is on {firstShow?.Iso}, at least a week after the start ({startDay?.Iso})");
            Check(doubleStops == 0, $"every stop cleared on the first visit ({doubleStops} came back)");
            ShellController.Current.Navigator.Go("roster");
            yield return WaitIdle(1.5f);
            yield return Capture("roster-after-a-week");

            Log(failed ? "FAILED" : "PASSED");
            Application.Quit(failed ? 1 : 0);
        }

        // ---- Days -----------------------------------------------------------------------------------

        private static async Task<(bool, int)> PlayDays(int days)
        {
            EngineGame game = EngineGame.Current;
            EngineDayControl day = game.DayControl;
            GameDate start = await Today(game);
            GameDate target = start.AddDays(days);
            int shows = 0;
            calledOff = 0;
            doubleStops = 0;
            firstShow = null;
            startDay ??= start;
            string lastStop = null;
            int same = 0;
            for (int step = 0; step < 200; step++)
            {
                await SkipCheck.Settle();
                GameDate today = await Today(game);
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    if (today >= target) return (true, shows);
                    var done = new TaskCompletionSource<AdvanceReport>();
                    void Finished(AdvanceReport report) => done.TrySetResult(report);
                    day.AdvanceFinished += Finished;
                    try
                    {
                        day.Skip(new AdvanceRequest(today.DaysUntil(target)));
                        AdvanceReport report = await done.Task;
                        if (report.Refused)
                        {
                            Log("skip refused: " + string.Join("; ", report.RefusalReasons));
                            return (false, shows);
                        }
                    }
                    finally
                    {
                        day.AdvanceFinished -= Finished;
                    }
                    continue;
                }
                GateHit lead = DayControlLogic.LeadingGate(gates);
                string key = $"{lead.GateId}|{lead.Reason}";
                same = key == lastStop ? same + 1 : 0;
                if (same > 0 && lead.GateId != EngineGateActions.ShowsTonight) doubleStops++;
                lastStop = key;
                if (same >= 3)
                {
                    Log($"stuck on {lead.GateId}: {lead.Reason}");
                    return (false, shows);
                }
                Log($"{today.Iso}: {lead.GateId} ({lead.Reason})");
                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    firstShow ??= today;
                    bool? live = await SkipCheck.ShowNight(game, lead);
                    if (live == null && await TooFewToBook(game))
                    {
                        // What a player does here: Booking's "Call off this show" (the signings land later).
                        CommandResult<JToken> off = await game.Client.Command("calendar.cancelShow", new JObject { ["eventInstanceId"] = lead.Subject?.Id });
                        Log($"too few signed to fill the card: called off ({(off.Ok ? "ok" : off.ReasonText)})");
                        if (!off.Ok) return (false, shows);
                        calledOff++;
                        continue;
                    }
                    if (live == null)
                    {
                        Log("the show could not run: " + lead.Reason);
                        return (false, shows);
                    }
                    if (same == 0) shows++;
                }
                else
                {
                    await SkipCheck.ClearStop(lead);
                }
            }
            return (false, shows);
        }

        private static int calledOff;
        private static int doubleStops;
        private static GameDate? firstShow;
        private static GameDate? startDay;

        private static async Task<bool> TooFewToBook(EngineGame game)
        {
            QueryResult<JToken> rows = await game.Client.Query("roster.rows");
            return rows.Ok && Signing.Needed(Signing.Wrestlers(rows.Data));
        }

        private static async Task<GameDate> Today(EngineGame game)
        {
            QueryResult<SimStatus> status = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
            return GameDate.Parse(status.Data.Date);
        }

        // ---- Helpers --------------------------------------------------------------------------------

        private static void ScrollToEnd(NewGameWizard wizard)
        {
            ScrollView scroll = wizard.Body;
            scroll.schedule.Execute(() => scroll.scrollOffset = new Vector2(0, Mathf.Max(0, scroll.contentContainer.layout.height - scroll.contentViewport.layout.height)));
        }

        private void Check(bool ok, string what)
        {
            if (!ok) failed = true;
            Debug.Log($"[DraftShots] {(ok ? "ok" : "FAIL")}: {what}");
        }

        private static void Log(string text) => Debug.Log("[DraftShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[DraftShots] timed out");
            Application.Quit(1);
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
            while (DraftScreen.Current != null && DraftScreen.Current.Busy && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(atLeast);
        }

        private static IEnumerator SettleDay()
        {
            yield return Await(SkipCheck.Settle());
            yield return new WaitForSecondsRealtime(0.5f);
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
            Debug.Log($"[DraftShots] {path}");
        }
    }
}
