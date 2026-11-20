using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.Screens.Trades;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// The trades smoke tour (TRD-02, TRD-03): run the player windowed with
    /// <c>-rbTradeShots &lt;folder&gt;</c> (add <c>-rbSeed &lt;seed&gt;</c> to fix the world). In a
    /// default-world game it:
    /// <list type="number">
    /// <item>books a show a week out with Auto-fill;</item>
    /// <item>opens a rival's best wrestler's profile and presses Offer in a trade;</item>
    /// <item>offers cash for them (refused), plays a day and follows the day button to the answer;</item>
    /// <item>builds an offer the rival counters, sends it, plays a day, follows the day button and accepts the counter;</item>
    /// <item>checks both rosters, the contracts, the news and the booked card;</item>
    /// <item>forces a rival offer (tunable overrides: no grace days, a sure weekly chance), follows the day button and refuses it.</item>
    /// </list>
    /// A PNG per step; logs <c>[TradeShots]</c>; exit 0 when every check passed, 1 otherwise. The
    /// save slot it creates is deleted when it quits (<see cref="TourSlots"/>).
    /// </summary>
    public sealed class TradeShots : MonoBehaviour
    {
        public const string Argument = "-rbTradeShots";

        private string folder;
        private int index;
        private readonly List<string> failures = new List<string>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("TradeShots");
                DontDestroyOnLoad(host);
                host.AddComponent<TradeShots>().folder = args[i + 1];
                return;
            }
        }

        private static EngineClient Client => EngineGame.Current.Client;

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 900f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);
            string me = EngineGame.Current.PromotionId;

            // ---- A rival and its best tradable wrestler ----------------------------------------------
            JToken promotions = null;
            yield return Query("promotions.list", new JObject(), data => promotions = data);
            JToken rival = Kit.Arr(promotions).First(row => Kit.Str(row, "controlledBy") == "computer" && Kit.Str(row, "status") == "active");
            string rivalId = Kit.Str(rival, "promotionId");
            string rivalName = Kit.Str(rival, "name");
            List<JToken> theirs = null, mine = null;
            yield return Query("trades.candidates", new JObject { ["promotionId"] = rivalId, ["partnerId"] = me, ["limit"] = 500 }, data => theirs = Kit.Arr(data, "rows").ToList());
            yield return Query("trades.candidates", new JObject { ["promotionId"] = me, ["partnerId"] = rivalId, ["limit"] = 500 }, data => mine = Kit.Arr(data, "rows").ToList());
            JToken ace = theirs.First(row => Kit.Bool(row, "tradable") && Kit.Str(row, "role") == "wrestler");
            Log($"rival {rivalName}; their best tradable wrestler {Kit.Str(ace, "name")} (value {Kit.Num(ace, "value")})");
            Check(theirs.Any(row => !Kit.Bool(row, "tradable") && Kit.Arr(row, "titleIds").Any()), "the rival has a champion the picker blocks");

            // ---- A show a week out, booked with Auto-fill --------------------------------------------
            string today = null;
            yield return Query("clock.get", new JObject(), data => today = Kit.Str(data, "date"));
            JToken shows = null;
            yield return Query("booking.shows", new JObject { ["limit"] = 30 }, data => shows = data);
            JToken future = Kit.Arr(shows, "rows")
                .FirstOrDefault(show => (Kit.Str(show, "date") ?? string.Empty).CompareTo(AddDays(today, 6)) >= 0);
            string futureId = Kit.Str(future, "eventInstanceId");
            if (futureId != null)
            {
                yield return Await(Kit.Run("aip.autoFillCard", new JObject { ["eventInstanceId"] = futureId, ["keepFilledSlots"] = true }));
                Log($"booked {Kit.Str(future, "name")} on {Kit.Str(future, "date")} ({futureId})");
            }
            else failures.Add("no show a week out to book");
            string card = string.Empty;
            if (futureId != null) yield return Query("booking.card", new JObject { ["eventInstanceId"] = futureId }, data => card = data?.ToString() ?? string.Empty);

            // ---- 1. Offer in a trade from the rival's wrestler's profile ------------------------------
            ShellController.Current.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", Kit.Str(ace, "personId")));
            yield return WaitIdle(1.5f);
            yield return Capture("profile-offer-in-a-trade");
            Button offer = Q<Button>(button => button.name == "worker-trade-action");
            Check(offer != null, "the profile has Offer in a trade");
            Click(offer);
            yield return WaitFor(() => TradeSheet.Current?.Draft?.PartnerId == rivalId && TradeSheet.Current.Draft.Get.Count == 1, 15f);
            TradeSheetView sheet = TradeSheet.Current;
            Check(sheet?.Draft?.Get.FirstOrDefault() == Kit.Str(ace, "employmentId"), "the sheet opens with the wrestler on You get and the rival picked");
            yield return WaitFor(() => sheet.PreviewCurrent, 15f);
            yield return Wait(0.6f);
            yield return Capture("sheet-preselected");

            // The champion shows blocked in their picker.
            Click(Q<Button>(button => button.name == "trade-add-get"));
            yield return Wait(0.8f);
            yield return Capture("picker-champion-blocked");
            Button championRow = Q<Button>(button => button.name.StartsWith("trade-pick-", StringComparison.Ordinal) && !button.enabledSelf);
            Check(championRow != null, "a champion row is disabled in the picker");
            ShellController.Current.Overlay.CloseTop();
            yield return Wait(0.4f);

            // ---- 2a. Cash for their ace: refused --------------------------------------------------------
            sheet.SetCash(true, 1_000_000);
            yield return WaitFor(() => sheet.PreviewCurrent, 15f);
            yield return Wait(0.6f);
            string likely = Kit.Str(sheet.Preview, "rival.likely");
            Log($"cash for {Kit.Str(ace, "name")}: {likely}; {string.Join(" | ", Kit.Arr(sheet.Preview, "rival.lines").Select(line => (string)line))}");
            Check(likely == "refuse", "cash for their best wrestler reads as a refusal");
            sheet.ShowTerms(Kit.Str(ace, "employmentId"));
            yield return Wait(0.6f);
            yield return Capture("cash-for-their-ace");
            Click(Q<Button>(button => button.name == "trade-send"));
            yield return WaitFor(() => TradeSheet.Current?.Trade != null, 15f);
            yield return Wait(0.6f);
            yield return Capture("offer-sent");
            string refusedId = Kit.Str(TradeSheet.Current?.Trade, "tradeId");
            ShellController.Current.Overlay.CloseAll();

            yield return PlayUntilTradeStop(GateHints.TradeAnsweredGateId, 4);
            yield return WaitFor(() => TradeSheet.Current?.Trade != null, 15f);
            yield return Wait(0.8f);
            yield return Capture("refused-answer");
            Check(Kit.Str(TradeSheet.Current?.Trade, "tradeId") == refusedId && Kit.Str(TradeSheet.Current?.Trade, "status") == "refused", "the day button opens the refused trade");
            yield return Await(SkipCheck.Settle());
            Check(!EngineGame.Current.DayControl.Gates.Any(hit => hit.GateId == GateHints.TradeAnsweredGateId), "opening the answer cleared its stop");

            // ---- 2b. An offer they counter --------------------------------------------------------------
            yield return Query("trades.candidates", new JObject { ["promotionId"] = me, ["partnerId"] = rivalId, ["limit"] = 500 }, data => mine = Kit.Arr(data, "rows").ToList());
            yield return Query("trades.candidates", new JObject { ["promotionId"] = rivalId, ["partnerId"] = me, ["limit"] = 500 }, data => theirs = Kit.Arr(data, "rows").ToList());
            var givers = mine.Where(row => Kit.Bool(row, "tradable") && !Kit.Bool(row, "noTradeClause") && Kit.Str(row, "role") == "wrestler")
                .OrderByDescending(row => card.Contains(Kit.Str(row, "personId") ?? "?")).ToList();
            var takers = theirs.Where(row => Kit.Bool(row, "tradable") && Kit.Str(row, "role") == "wrestler").Skip(1).Take(8).ToList();
            JToken give = null, get = null;
            foreach (JToken taker in takers)
            {
                foreach (JToken giver in givers.Take(40))
                {
                    JToken read = null;
                    var args = new JObject
                    {
                        ["promotionId"] = me, ["partnerId"] = rivalId,
                        ["give"] = new JObject { ["employmentIds"] = new JArray(Kit.Str(giver, "employmentId")), ["cash"] = 0 },
                        ["get"] = new JObject { ["employmentIds"] = new JArray(Kit.Str(taker, "employmentId")), ["cash"] = 0 },
                    };
                    yield return Query("trades.preview", args, data => read = data);
                    if (Kit.Str(read, "rival.likely") == "counter" && !Kit.Arr(read, "problems").Any())
                    {
                        give = giver;
                        get = taker;
                        break;
                    }
                }
                if (give != null) break;
            }
            if (give == null)
            {
                failures.Add("no offer the rival would counter");
                yield return Finish();
                yield break;
            }
            string givenPerson = Kit.Str(give, "personId");
            string gotPerson = Kit.Str(get, "personId");
            Log($"counter offer: {Kit.Str(give, "name")} for {Kit.Str(get, "name")} (on the booked card: {card.Contains(givenPerson)})");

            Click(Q<Button>(button => button.name == "trade-new"));
            yield return WaitFor(() => TradeSheet.Current?.Draft?.PartnerId == rivalId && TradeSheet.Current.Mine.Count > 0, 15f);
            sheet = TradeSheet.Current;
            sheet.AddWorker(Kit.Str(give, "employmentId"), true);
            sheet.AddWorker(Kit.Str(get, "employmentId"), false);
            yield return WaitFor(() => sheet.PreviewCurrent, 15f);
            yield return Wait(0.6f);
            yield return Capture("offer-they-counter");
            Check(Kit.Str(sheet.Preview, "rival.lean") == "close", "the offer reads as Close");
            Click(Q<Button>(button => button.name == "trade-send"));
            yield return WaitFor(() => TradeSheet.Current?.Trade != null, 15f);
            string counterId = Kit.Str(TradeSheet.Current?.Trade, "tradeId");
            ShellController.Current.Overlay.CloseAll();

            yield return PlayUntilTradeStop(GateHints.TradeOfferGateId, 4);
            yield return WaitFor(() => TradeSheet.Current?.Trade != null, 15f);
            yield return Wait(0.8f);
            yield return Capture("counter-offer");
            sheet = TradeSheet.Current;
            Check(Kit.Str(sheet?.Trade, "tradeId") == counterId && Kit.Bool(sheet?.Trade, "awaitingYou"), "the day button opens the counter-offer");
            Check(Q<Button>(button => button.name == "trade-change") != null && Q<Button>(button => button.name == "trade-refuse") != null, "the counter has Accept, Refuse and Change and send back");

            // A look at Change and send back, then back to their offer.
            Click(Q<Button>(button => button.name == "trade-change"));
            yield return WaitFor(() => TradeSheet.Current?.PreviewCurrent == true, 15f);
            yield return Wait(0.6f);
            yield return Capture("change-and-send-back");
            Check(!Kit.Arr(TradeSheet.Current?.Preview, "problems").Any(), "the counter's preview has no rule broken by its own trade");
            Click(Q<Button>(button => button.name == "trade-cancel-changes"));
            yield return WaitFor(() => TradeSheet.Current != null && !TradeSheet.Current.Loading && TradeSheet.Current.Draft == null && Q<Button>(button => button.name == "trade-accept") != null, 15f);

            // ---- 3. Accept the counter -----------------------------------------------------------------
            Click(Q<Button>(button => button.name == "trade-accept"));
            yield return WaitFor(() => Kit.Str(TradeSheet.Current?.Trade, "status") == "completed", 15f);
            yield return Wait(0.8f);
            yield return Capture("trade-done");
            Check(Kit.Str(TradeSheet.Current?.Trade, "status") == "completed", "accepting the counter completes the trade");
            ShellController.Current.Overlay.CloseAll();

            // ---- 4. Rosters, contracts, news, the booked card -----------------------------------------
            string myRoster = string.Empty, theirRoster = string.Empty, contracts = string.Empty, news = string.Empty, after = string.Empty;
            yield return Query("promotions.roster", new JObject { ["promotionId"] = me }, data => myRoster = data?.ToString() ?? string.Empty);
            yield return Query("promotions.roster", new JObject { ["promotionId"] = rivalId }, data => theirRoster = data?.ToString() ?? string.Empty);
            yield return Query("contracts.list", new JObject { ["tab"] = "active" }, data => contracts = data?.ToString() ?? string.Empty);
            yield return Query("news.feed", new JObject { ["limit"] = 40 }, data => news = data?.ToString() ?? string.Empty);
            if (futureId != null) yield return Query("booking.card", new JObject { ["eventInstanceId"] = futureId }, data => after = data?.ToString() ?? string.Empty);
            Check(myRoster.Contains(gotPerson) && !myRoster.Contains(givenPerson), "your roster has who you got, not who you gave");
            Check(theirRoster.Contains(givenPerson) && !theirRoster.Contains(gotPerson), "the rival's roster has who you gave");
            Check(contracts.Contains(gotPerson) && !contracts.Contains(givenPerson), "your active contracts follow the trade");
            Check(news.Contains("news.trade.headline") && news.Contains(givenPerson), "the news has the trade");
            Check(!after.Contains(givenPerson), "the booked card no longer has the traded wrestler");
            Log($"was on the card before: {card.Contains(givenPerson)}; after: {after.Contains(givenPerson)}");

            ShellController.Current.Navigator.Go(ShellRoute.With(ContractsScreen.ScreenId, "tab", ContractsScreen.TabTrades));
            yield return WaitIdle(1.2f);
            ContractsScreen.Current?.ShowTrades(ContractsView.TradesHistory);
            yield return Wait(0.6f);
            yield return Capture("contracts-trades-history");
            ShellController.Current.Navigator.Go(ShellRoute.With("roster"));
            yield return WaitIdle(1.2f);
            yield return Capture("roster-after");
            ShellController.Current.Navigator.Go(ShellRoute.With(PromotionsScreen.ProfileId, "id", rivalId));
            yield return WaitIdle(1.5f);
            yield return Capture("rival-page-after");
            ShellController.Current.Navigator.Go(ShellRoute.To("news"));
            yield return WaitIdle(1.5f);
            yield return Capture("news-after");
            if (futureId != null)
            {
                ShellController.Current.Navigator.Go(ShellRoute.With("booking", "event", futureId));
                yield return WaitIdle(1.5f);
                yield return Capture("booked-card-after");
            }

            // ---- 5. A rival's own offer, forced with tunable overrides, refused -----------------------
            yield return Await(Kit.Run("tunables.setOverride", new JObject { ["key"] = "trades.rivalOffer.graceDays", ["value"] = 0 }));
            yield return Await(Kit.Run("tunables.setOverride", new JObject { ["key"] = "trades.rivalOffer.weeklyChance", ["value"] = 1 }));
            yield return PlayUntilTradeStop(GateHints.TradeOfferGateId, 10);
            yield return WaitFor(() => TradeSheet.Current?.Trade != null, 15f);
            yield return Wait(0.8f);
            yield return Capture("rival-offer");
            sheet = TradeSheet.Current;
            Check(Kit.Bool(sheet?.Trade, "rivalInitiated") && Kit.Bool(sheet?.Trade, "awaitingYou"), "a rival's own offer opens from the day button");
            Check(Q<Button>(button => button.name == "trade-change")?.text != null, "the rival offer has Counter");
            Click(Q<Button>(button => button.name == "trade-refuse"));
            yield return WaitFor(() => Kit.Str(TradeSheet.Current?.Trade, "status") == "refused", 15f);
            yield return Wait(0.6f);
            yield return Capture("rival-offer-refused");
            Check(Kit.Str(TradeSheet.Current?.Trade, "status") == "refused", "refusing the rival's offer closes it");
            ShellController.Current.Overlay.CloseAll();
            yield return Await(Kit.Run("tunables.clearOverride", new JObject { ["key"] = "trades.rivalOffer.graceDays" }));
            yield return Await(Kit.Run("tunables.clearOverride", new JObject { ["key"] = "trades.rivalOffer.weeklyChance" }));

            yield return Finish();
        }

        /// <summary>Plays days (shows on Auto, other stops cleared) until a trade stop leads, then follows the day button.</summary>
        private IEnumerator PlayUntilTradeStop(string gateId, int maxDays)
        {
            EngineDayControl day = EngineGame.Current.DayControl;
            int days = 0;
            for (int step = 0; step < maxDays * 6; step++)
            {
                yield return Await(SkipCheck.Settle());
                var lead = day.Gates.Count == 0 ? null : DayControlLogic.LeadingGate(day.Gates);
                var trade = day.Gates.FirstOrDefault(hit => hit.GateId == gateId);
                if (trade != null && (lead == trade || lead.ActionHint == GateHints.Trades))
                {
                    var state = DayControlLogic.Derive(day.Gates, false);
                    Log($"stop: {trade.Reason} → day button \"{state.Primary.Label}\"");
                    ShellController.Current.DayControl.RunPrimary();
                    yield return WaitIdle(1.5f);
                    ShellRoute route = ShellController.Current.Navigator.Current;
                    Check(route?.ScreenId == ContractsScreen.ScreenId && route.Param("tab") == ContractsScreen.TabTrades, $"the {gateId} stop opens Contracts › Trades");
                    yield break;
                }
                if (lead == null)
                {
                    if (days++ >= maxDays) break;
                    day.NextDay();
                    yield return Wait(0.3f);
                    while (day.Advancing) yield return null;
                    continue;
                }
                if (lead.GateId == EngineGateActions.ShowsTonight) yield return Await(SkipCheck.ShowNight(EngineGame.Current, lead));
                else if (lead.GateId.StartsWith("contracts.", StringComparison.Ordinal)) yield return Await(SkipCheck.ClearOnContracts(lead));
                else yield return Await(SkipCheck.ClearStop(lead));
                ShellController.Current.Overlay.CloseAll();
            }
            failures.Add($"no {gateId} stop within {maxDays} days");
        }

        private IEnumerator Finish()
        {
            ShellController.Current?.Overlay.CloseAll();
            foreach (string failure in failures) Debug.LogError("[TradeShots] FAILED: " + failure);
            Log(failures.Count == 0 ? $"PASSED: {folder}" : $"{failures.Count} check(s) failed");
            yield return Wait(0.5f);
            Application.Quit(failures.Count == 0 ? 0 : 1);
        }

        private void Check(bool ok, string what)
        {
            Log((ok ? "ok: " : "FAIL: ") + what);
            if (!ok) failures.Add(what);
        }

        private static string AddDays(string iso, int days) =>
            DateTime.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out DateTime date)
                ? date.AddDays(days).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)
                : iso ?? string.Empty;

        private static IEnumerator Query(string name, JObject args, Action<JToken> done)
        {
            Task<QueryResult<JToken>> task = Client.Query(name, args);
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted || !task.Result.Ok) Debug.LogWarning($"[TradeShots] {name}: {(task.IsFaulted ? task.Exception?.Message : task.Result.ReasonText)}");
            done(task.IsCompletedSuccessfully && task.Result.Ok ? task.Result.Data : null);
        }

        private static void Log(string text) => Debug.Log("[TradeShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[TradeShots] timed out");
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

        private static IEnumerator WaitFor(Func<bool> done, float timeout)
        {
            float until = Time.realtimeSinceStartup + timeout;
            while (!done() && Time.realtimeSinceStartup < until) yield return null;
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
            Debug.Log($"[TradeShots] {path}");
        }
    }
}
