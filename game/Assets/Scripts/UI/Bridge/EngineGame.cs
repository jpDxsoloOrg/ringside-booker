using System;
using RingsideBooker.Engine;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;
using WhyEntityRef = RingsideBooker.UI.Why.EntityRef;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// The running engine game: the shared client, the local seat and the shell adapters
    /// (<see cref="EngineShellData"/>, <see cref="EngineDayControl"/>). Screens reach the engine
    /// through <see cref="Current"/>. Start one with <see cref="Enter"/> after a successful
    /// <c>NewGame</c> or <c>Load</c>.
    /// </summary>
    public sealed class EngineGame : IDisposable
    {
        private EngineGame(EngineClient client, LocalSeat seat)
        {
            Client = client;
            Seat = seat;
            ShellData = new EngineShellData(this);
            DayControl = new EngineDayControl(this);
        }

        /// <summary>The game on screen, or null outside a real game (title screen, demo).</summary>
        public static EngineGame Current { get; private set; }

        public EngineClient Client { get; }
        public LocalSeat Seat { get; }
        /// <summary>The promotion the player runs, or null while unemployed.</summary>
        public string PromotionId => ShellData.Snapshot.Promotion?.Id ?? Seat?.PromotionId;
        public EngineShellData ShellData { get; }
        public EngineDayControl DayControl { get; }

        /// <summary>
        /// Installs the game the engine now holds into the shell and opens the Game scene. Call on
        /// the main thread after <c>client.NewGame</c> or <c>client.Load</c> succeeded.
        /// </summary>
        public static EngineGame Enter(EngineClient client, LocalSeat seat)
        {
            if (client == null) throw new ArgumentNullException(nameof(client));
            Current?.Detach();
            var game = new EngineGame(client, seat);
            Current = game;
            game.ShellData.Refresh();
            game.DayControl.Refresh();
            ShellServices.Install(game.ShellData, game.DayControl);
            SceneFlow.LoadGame();
            return game;
        }

        /// <summary>A Why? source for a stored trace ref (<c>{kind, id}</c> JSON), fetched with <c>trace.get</c> when opened.</summary>
        public WhySource TraceRefSource(Newtonsoft.Json.Linq.JToken traceRef)
        {
            string kind = (string)traceRef?["kind"];
            string id = (string)traceRef?["id"];
            if (string.IsNullOrEmpty(kind) || id == null) return null;
            return WhySource.FromRef(new TraceRef(kind, id), LoadTraceRef);
        }

        /// <summary>The <see cref="TraceRefLoader"/> over this game's client.</summary>
        public void LoadTraceRef(TraceRef traceRef, Action<TraceLoadResult> done)
        {
            Client.QueryRaw(EngineQueries.Trace, traceRef.ToTraceGetArgs()).Then(
                json => done(TraceReader.ReadTraceGetAnswer(json)),
                error => done(TraceLoadResult.Failed(error.Message)));
        }

        /// <summary>Called by <see cref="ShellServices.Clear"/> (main menu): stop listening and unload the world.</summary>
        public void Dispose()
        {
            Detach();
            if (Client.IsAdvancing) Client.CancelAdvance();
            Client.Unload().Then(_ => { }, error => Debug.LogWarning($"[EngineGame] unload: {error.Message}"));
        }

        private void Detach()
        {
            ShellData.Detach();
            DayControl.Detach();
            if (Current == this) Current = null;
        }

        /// <summary>Wires UNITY-08's Why? panels into the shell: the overlay layer, and links that open screens.</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void WireWhyPanels()
        {
            WhyPanelHost.Presenter = (opener, panel) =>
            {
                OverlayLayer layer = OverlayLayer.Of(opener);
                if (layer == null) return null;
                OverlayHandle handle = layer.Open(panel, new OverlayOptions { Modal = true, Dismissable = true });
                handle.Closed += panel.Close;
                return handle.Close;
            };
            WhyPanelHost.DefaultLinks = new WhyLinks(OpenEntity, entity => EntityRoute(entity) != null && ShellController.Current != null);
            Day.DayControlLogic.RosterInjuriesTabAvailable = true;
            TopBarView.CashChipDecorator = DecorateCashChip;
            // UNITY-05's saves share this client and enter games through this bridge.
            Saves.SaveEngine.Provider = EngineRuntime.GetClientAsync;
            Title.GameEntry.Handler = (client, seat) => Enter(client, seat);
        }

        private static void OpenEntity(WhyEntityRef entity)
        {
            ShellRoute route = EntityRoute(entity);
            if (route != null) ShellController.Current?.Navigator.Go(route);
        }

        /// <summary>The screen a Why? input links to, among the screens that exist.</summary>
        public static ShellRoute EntityRoute(WhyEntityRef entity)
        {
            if (entity == null) return null;
            switch (entity.Kind)
            {
                case "eventInstance":
                case "show":
                    return ShellRoute.With(ScreenIds.ShowResults, "event", entity.Id);
                case "person":
                case "employment":
                    return ScreenRegistry.IsLive(ScreenIds.Worker) ? ShellRoute.With(ScreenIds.Worker, "id", entity.Id) : ShellRoute.To("roster");
                case "promotion":
                    return ShellRoute.To(NavigationModel.HomeItemId);
                default:
                    return null;
            }
        }

        /// <summary>The cash chip's Why?: a small "?" after the amount, over <c>finance.cash</c>.</summary>
        private static void DecorateCashChip(VisualElement chip, ShellSnapshot snapshot)
        {
            EngineGame game = Current;
            if (game == null || string.IsNullOrEmpty(snapshot.CashTraceRef)) return;
            int split = snapshot.CashTraceRef.IndexOf(':');
            if (split <= 0) return;
            var source = WhySource.FromRef(new TraceRef(snapshot.CashTraceRef.Substring(0, split), snapshot.CashTraceRef.Substring(split + 1)), game.LoadTraceRef);
            var button = new WhyButton("Cash", TraceValue.Of(snapshot.CashCents), source, "money") { PanelTitle = "Cash" };
            button.AddToClassList("status-chip__why");
            chip.Add(button);
        }
    }
}
