using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using UnityEngine;

namespace RingsideBooker.UI.Demo
{
    /// <summary>
    /// A fake game for the shell until the engine bridge lands (UNITY-04/09). It keeps a date, cash
    /// and badges, and advances days on a timer, stopping on the same kinds of stops the engine
    /// raises: a show every Friday (alternately "Go live" and "Go to the show"), plus a decision, an
    /// injury, a contract, an answered offer and a news alert on fixed day cycles. Opening the screen
    /// a stop points to deals with it (as the real screens will), and a background step fails now
    /// and then so the failures link shows. Everything is deterministic and fictional.
    /// </summary>
    public sealed class DemoGame : IShellData, IDayControl, INavigationObserver, IDisposable
    {
        private const float SecondsPerSkipDay = 1f / 12f;
        private const float SecondsForNextDay = 0.25f;
        private static readonly GameDate StartDate = new GameDate(2031, 1, 6);

        private readonly PromotionInfo promotion =
            new PromotionInfo("pro_demo000001", "Harbor City Wrestling", "HCW", "Regional · Demo world");
        private readonly List<GateHit> gates = new List<GateHit>();
        private readonly Dictionary<string, ShowNightRoute> showRoutes = new Dictionary<string, ShowNightRoute>();
        private readonly List<ShowResultLink> showsToRun = new List<ShowResultLink>();
        private readonly Dictionary<NavBadgeKey, int> badges = new Dictionary<NavBadgeKey, int>
        {
            [NavBadgeKey.UnreadMail] = 3,
            [NavBadgeKey.PendingDecisions] = 0,
            [NavBadgeKey.WantsToLeave] = 0,
        };

        private GameDate date = StartDate;
        private long cashCents = 125_000_000;
        private int popularity = 42;
        private int prestige = 38;

        // The running advance.
        private AdvanceRequest active;
        private GameDate advanceStart;
        private int daysDone;
        private float timer;
        private bool cancelRequested;
        private List<AdvanceFailure> failures;
        private List<ShowResultLink> results;
        private List<string> contractLines;
        private List<string> offerLines;
        private DemoTicker ticker;

        public DemoGame()
        {
            Snapshot = BuildSnapshot();
        }

        public ShellSnapshot Snapshot { get; private set; }
        public IReadOnlyList<GateHit> Gates => gates;
        public ShowNightRoute ShowNight
        {
            get
            {
                GateHit show = gates.FirstOrDefault(hit => hit.ActionHint == GateHints.ShowNight);
                return show != null && showRoutes.TryGetValue(show.GateId, out ShowNightRoute route) ? route : null;
            }
        }
        public bool Advancing => active != null;
        public bool Stopping => active != null && cancelRequested;
        public AdvanceProgress Progress => active == null ? null : new AdvanceProgress(date, daysDone, active.MaxDays);
        public AdvanceReport LastReport { get; private set; }

        event Action IShellData.Changed
        {
            add => dataChanged += value;
            remove => dataChanged -= value;
        }

        event Action IDayControl.Changed
        {
            add => dayChanged += value;
            remove => dayChanged -= value;
        }

        private event Action dataChanged;
        private event Action dayChanged;

        /// <summary>Installs a fresh demo game into <see cref="ShellServices"/>, with a ticker to run its advances.</summary>
        public static DemoGame Install()
        {
            var game = new DemoGame();
            var host = new GameObject("DemoGame ticker") { hideFlags = HideFlags.HideAndDontSave };
            UnityEngine.Object.DontDestroyOnLoad(host);
            game.ticker = host.AddComponent<DemoTicker>();
            game.ticker.Game = game;
            ShellServices.Install(game, game);
            return game;
        }

        public void Dispose()
        {
            if (ticker != null) UnityEngine.Object.Destroy(ticker.gameObject);
            ticker = null;
        }

        public void NextDay() => Start(new AdvanceRequest(1));

        public void Skip(AdvanceRequest request) => Start(request);

        public void Cancel()
        {
            if (active == null || cancelRequested) return;
            cancelRequested = true;
            dayChanged?.Invoke();
        }

        public void DismissReport()
        {
            if (LastReport == null) return;
            LastReport = null;
            dayChanged?.Invoke();
        }

        /// <summary>Opening the screen a stop points to deals with it, as the real screens will.</summary>
        public void OnNavigated(ShellRoute route)
        {
            bool changed = false;
            for (int index = gates.Count - 1; index >= 0; index--)
            {
                GateHit hit = gates[index];
                var destination = DayControlLogic.GateDestination(hit, gates, ShowNight);
                if (!destination.HasValue || destination.Value.to.ScreenId != route.ScreenId) continue;
                if (hit.ActionHint == GateHints.ShowNight)
                {
                    showsToRun.Add(new ShowResultLink(hit.Subject.Id, ShowName(date)));
                }
                if (hit.ActionHint == GateHints.Inbox) badges[NavBadgeKey.PendingDecisions] = Math.Max(0, badges[NavBadgeKey.PendingDecisions] - 1);
                gates.RemoveAt(index);
                changed = true;
            }
            if (route.ScreenId == "inbox" && badges[NavBadgeKey.UnreadMail] > 0)
            {
                badges[NavBadgeKey.UnreadMail] = 0;
                changed = true;
            }
            if (route.ScreenId == "contracts" && badges[NavBadgeKey.WantsToLeave] > 0)
            {
                badges[NavBadgeKey.WantsToLeave] = 0;
                changed = true;
            }
            if (!changed) return;
            RefreshSnapshot();
            dayChanged?.Invoke();
        }

        /// <summary>Runs the advance; called every frame by the ticker.</summary>
        public void Tick(float deltaTime)
        {
            if (active == null) return;
            timer += deltaTime;
            float perDay = active.MaxDays == 1 ? SecondsForNextDay : SecondsPerSkipDay;
            bool moved = false;
            while (active != null && timer >= perDay)
            {
                timer -= perDay;
                SimulateDay();
                moved = true;
                if (gates.Count > 0) Finish(AdvanceStop.Gate);
                else if (daysDone >= active.MaxDays || (active.StopAtDate.HasValue && date >= active.StopAtDate.Value)) Finish(AdvanceStop.Completed);
                else if (cancelRequested) Finish(AdvanceStop.Cancelled);
            }
            if (!moved) return;
            RefreshSnapshot();
            dayChanged?.Invoke();
        }

        private void Start(AdvanceRequest request)
        {
            if (active != null || request == null || request.MaxDays < 1) return;
            if (gates.Count > 0)
            {
                // Like the engine: a waiting stop means the day doesn't move.
                LastReport = AdvanceReport.Advanced(date, date, 0, request.MaxDays, AdvanceStop.Gate, gates.ToList());
                dayChanged?.Invoke();
                return;
            }
            active = request;
            advanceStart = date;
            daysDone = 0;
            timer = 0;
            cancelRequested = false;
            failures = new List<AdvanceFailure>();
            results = new List<ShowResultLink>();
            contractLines = new List<string>();
            offerLines = new List<string>();
            LastReport = null;
            dayChanged?.Invoke();
        }

        private void Finish(AdvanceStop stop)
        {
            AdvanceReport report = AdvanceReport.Advanced(advanceStart, date, daysDone, active.MaxDays, stop,
                stop == AdvanceStop.Gate ? gates.ToList() : null, failures);
            results.Reverse();
            report.Results = results;
            report.ContractLines = contractLines;
            report.OfferLines = offerLines;
            GateHit tonight = gates.FirstOrDefault(hit => hit.ActionHint == GateHints.ShowNight);
            if (tonight != null)
            {
                report.Tonight = tonight;
                report.TonightRoute = ShowNight;
            }
            LastReport = report;
            active = null;
            cancelRequested = false;
        }

        private void SimulateDay()
        {
            // Shows the player ran on the stop day complete overnight.
            foreach (ShowResultLink show in showsToRun)
            {
                results.Add(show);
                cashCents += 2_400_000;
                popularity = Math.Min(100, popularity + 1);
            }
            showsToRun.Clear();

            date = date.AddDays(1);
            daysDone++;
            int dayIndex = StartDate.DaysUntil(date);
            cashCents -= 350_000 + (dayIndex % 5) * 40_000;
            string iso = date.Iso;

            if (date.DayOfWeek == DayOfWeek.Friday)
            {
                string gateId = $"shows.tonight.{iso}";
                bool goesLive = (dayIndex / 7) % 2 == 0;
                showRoutes[gateId] = new ShowNightRoute(goesLive, false);
                gates.Add(new GateHit(gateId, $"Tonight: {ShowName(date)}", GateHints.ShowNight,
                    new GateSubject("eventInstance", $"evi_demo_{iso.Replace("-", string.Empty)}")));
            }
            if (dayIndex % 23 == 15)
            {
                badges[NavBadgeKey.PendingDecisions]++;
                gates.Add(new GateHit($"inbox.decision.{iso}", "A worker is asking for a raise before Friday's show", GateHints.Inbox));
            }
            if (dayIndex % 17 == 11)
            {
                gates.Add(new GateHit($"health.ownInjury.{iso}", "Injured: Kenji Sato (sprained wrist, about 3 weeks)", GateHints.Roster,
                    new GateSubject("person", "per_demo000012")));
            }
            if (dayIndex % 13 == 7)
            {
                const string line = "Dex Marlow's contract ends in 14 days";
                contractLines.Add(line);
                badges[NavBadgeKey.WantsToLeave] = 1;
                gates.Add(new GateHit($"contracts.expiringSoon.{iso}", line, GateHints.Contracts,
                    new GateSubject("employment", "emp_demo000007")));
            }
            if (dayIndex % 11 == 6)
            {
                const string line = "Rhea Vance signed your offer: 2 years at $1,800 a show";
                offerLines.Add(line);
                gates.Add(new GateHit($"negotiation.offerAnswered.{iso}", $"Offer answered: {line}", GateHints.OfferAnswered,
                    new GateSubject("negotiation", "neg_demo000003")));
            }
            if (dayIndex % 9 == 4)
            {
                badges[NavBadgeKey.UnreadMail]++;
                gates.Add(new GateHit($"news.alert.{iso}", "News alert: a rival promotion signed a free agent you were watching", GateHints.News,
                    new GateSubject("news", $"nws_demo_{iso.Replace("-", string.Empty)}")));
            }
            if (dayIndex % 29 == 0)
            {
                failures.Add(new AdvanceFailure(date, "economy.merchandise", "Demo failure: the merchandise step threw and was rolled back."));
            }
        }

        private static string ShowName(GameDate showDate) =>
            $"Harbor City Fight Night {showDate.Month}/{showDate.Day}";

        private void RefreshSnapshot()
        {
            Snapshot = BuildSnapshot();
            dataChanged?.Invoke();
        }

        private ShellSnapshot BuildSnapshot()
        {
            int week = StartDate.DaysUntil(date) / 7 + 1;
            return new ShellSnapshot(
                date,
                promotion,
                cashCents,
                seasonLabel: $"Season 1 · Week {week}",
                popularity: popularity,
                prestige: prestige,
                badges: new Dictionary<NavBadgeKey, int>(badges),
                cashTraceRef: "demo:cash",
                sample: true);
        }
    }
}
