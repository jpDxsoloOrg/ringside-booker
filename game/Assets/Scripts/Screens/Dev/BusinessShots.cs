using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens.Business;
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
    /// A developer tour of the money screens (UNITY-18): run the player with
    /// <c>-rbBusinessShots &lt;folder&gt;</c>. It starts a default-world game, captures Finances on day 1
    /// (too early for a forecast), plays two weeks (shows on Auto, other stops cleared as SkipCheck
    /// does), then visits Finances (overview, ledger, filters, policies), Production (the change
    /// dialog for a raise and a cut, never confirmed), and Networks (your deals, a deal sheet, the
    /// renewal preview, the cancel dialog with its exit fee, available networks and the Propose
    /// sheet). Nothing is signed, cancelled or changed. A PNG per step; logs <c>[BusinessShots]</c>;
    /// exit 1 on a time-out.
    /// </summary>
    public sealed class BusinessShots : MonoBehaviour
    {
        public const string Argument = "-rbBusinessShots";
        private const int DaysToPlay = 14;

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
                var host = new GameObject("BusinessShots");
                DontDestroyOnLoad(host);
                host.AddComponent<BusinessShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 420f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);

            Go(ShellRoute.To(FinancesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            yield return Capture("finances-day1");

            yield return PlayDays(DaysToPlay);

            // ---- Finances --------------------------------------------------------------------------
            Go(ShellRoute.To(FinancesScreen.ScreenId));
            yield return WaitIdle(1.5f);
            yield return Capture("finances-overview");
            yield return ScrollToBottom();
            yield return Capture("finances-overview-bottom");

            FinancesView finances = FinancesScreen.Current;
            finances.SelectTab(FinancesScreen.TabLedger);
            yield return WaitIdle(1f);
            yield return Capture("finances-ledger");
            Log($"ledger rows {finances.LedgerRowCount}");
            Click(Q<Button>(button => button.name == "ledger-filter"));
            yield return Wait(0.6f);
            yield return Capture("finances-ledger-filters");
            ShellController.Current.Overlay.CloseAll();
            finances.FilterLedger(null, "wages");
            yield return WaitIdle(1f);
            yield return Capture("finances-ledger-wages");
            finances.FilterLedger(null, null);
            yield return WaitIdle(0.5f);
            finances.LedgerTable?.SetColumnVisible("from", true);
            yield return Wait(0.4f);
            yield return Capture("finances-ledger-from");

            finances.SelectTab(FinancesScreen.TabPolicies);
            yield return WaitIdle(1f);
            yield return Capture("finances-policies");

            // ---- Production ------------------------------------------------------------------------
            Go(ShellRoute.To(ProductionScreen.ScreenId));
            yield return WaitIdle(1.5f);
            yield return Capture("production");
            yield return ScrollToBottom();
            yield return Capture("production-bottom");
            ProductionView production = ProductionScreen.Current;
            JToken camera = Kit.Arr(production.Overview, "rows").FirstOrDefault(row => Kit.Str(row, "area") == "camera") ?? Kit.Arr(production.Overview, "rows").FirstOrDefault();
            if (camera != null)
            {
                int level = (int)(Kit.Num(camera, "level") ?? 0);
                ProductionChangeDialog dialog = ProductionChangeDialog.Open(production.Root, camera, Kit.Str(production.Overview, "tvDeal.networkName"), level + 2);
                yield return WaitFor(() => dialog?.Preview != null, 10f);
                yield return Wait(0.6f);
                yield return Capture("production-raise");
                Log($"raise {Kit.Str(camera, "area")} {level}→{dialog?.To}: canApply {dialog?.CanApply}");
                ShellController.Current.Overlay.CloseAll();
            }
            JToken marketing = Kit.Arr(production.Overview, "rows").FirstOrDefault(row => Kit.Str(row, "area") == "marketing" && (Kit.Num(row, "level") ?? 0) > 0);
            if (marketing != null)
            {
                ProductionChangeDialog dialog = ProductionChangeDialog.Open(production.Root, marketing, null, (int)(Kit.Num(marketing, "level") ?? 1) - 1);
                yield return WaitFor(() => dialog?.Preview != null, 10f);
                yield return Wait(0.6f);
                yield return Capture("production-cut");
                ShellController.Current.Overlay.CloseAll();
            }

            // ---- Networks --------------------------------------------------------------------------
            Go(ShellRoute.To(NetworksScreen.ScreenId));
            yield return WaitIdle(1.5f);
            NetworksView networks = NetworksScreen.Current;
            yield return Capture("networks-deals");
            Log($"deals {networks.Deals.Count}");
            networks.Table?.SetColumnVisible("targets", true);
            yield return Wait(0.4f);
            yield return Capture("networks-deals-targets");
            JToken deal = networks.Deals.FirstOrDefault(row => Kit.Str(row, "status") == "active");
            if (deal != null)
            {
                DealSheet sheet = networks.OpenDeal(Kit.Str(deal, "dealId"));
                yield return WaitFor(() => sheet?.Deal != null, 10f);
                yield return Wait(0.8f);
                yield return Capture("deal-sheet");
                yield return Await(sheet.Renew(networks.DefaultMonths));
                yield return Wait(0.8f);
                yield return Capture("deal-renew");
                Log($"renew verdict {Kit.Str(sheet.Valuation, "verdict")}");
                ShellController.Current.Overlay.CloseAll();
                yield return Wait(0.3f);
                sheet = networks.OpenDeal(Kit.Str(deal, "dealId"));
                yield return WaitFor(() => sheet?.Deal != null, 10f);
                yield return Wait(0.3f);
                Click(Q<Button>(button => button.name == "deal-cancel"));
                yield return WaitFor(() => CancelDealDialog.Current?.Ready == true, 10f);
                yield return Wait(0.6f);
                yield return Capture("deal-cancel");
                ShellController.Current.Overlay.CloseAll();
            }

            networks.SelectTab(NetworksScreen.TabAvailable);
            yield return WaitIdle(1.5f);
            yield return Capture("networks-available");
            Log($"networks {networks.Networks.Count}");
            JToken network = networks.Networks.FirstOrDefault(row => Kit.Str(row, "bestOffer.verdict") == "accept") ?? networks.Networks.FirstOrDefault();
            if (network != null)
            {
                ProposeSheet propose = networks.OpenPropose(Kit.Str(network, "networkId"));
                yield return WaitFor(() => propose?.Valuation != null, 10f);
                yield return Wait(0.8f);
                yield return Capture("propose");
                Log($"propose {Kit.Str(network, "name")}: {Kit.Str(propose?.Valuation, "verdict")}");
                yield return Await(propose.Change(newTimeslot: "lateNight", newLive: true));
                yield return Wait(0.8f);
                yield return Capture("propose-late-live");
                ShellController.Current.Overlay.CloseAll();
            }

            Log($"done: {folder}");
            Application.Quit(0);
        }

        /// <summary>Plays <paramref name="days"/> days: shows on Auto, other stops through the day button (as SkipCheck does).</summary>
        private static IEnumerator PlayDays(int days)
        {
            EngineDayControl day = EngineGame.Current.DayControl;
            for (int step = 0; step < days * 4; step++)
            {
                yield return Await(SkipCheck.Settle());
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    if (--days < 0) break;
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
                yield return Await(SkipCheck.ClearStop(lead));
                ShellController.Current.Overlay.CloseAll();
            }
            Log("played the days");
        }

        private static void Go(ShellRoute route) => ShellController.Current.Navigator.Go(route);

        private static IEnumerator ScrollToBottom()
        {
            ScrollView scroll = ShellController.Current.Shell.Scroll;
            yield return Wait(0.3f);
            scroll.verticalScroller.value = scroll.verticalScroller.highValue;
            yield return Wait(0.4f);
        }

        private static void Log(string text) => Debug.Log("[BusinessShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[BusinessShots] timed out");
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
            if (found == null) Debug.LogWarning($"[BusinessShots] no {typeof(T).Name} found");
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
            Debug.Log($"[BusinessShots] {path}");
        }
    }
}
