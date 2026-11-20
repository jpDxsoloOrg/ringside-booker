using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Help
{
    /// <summary>One thing worth doing in a new game, and where "Show me" goes.</summary>
    public sealed class ChecklistItem
    {
        public ChecklistItem(string id, string label, string hint, ShellRoute showMe)
        {
            Id = id;
            Label = label;
            Hint = hint;
            ShowMe = showMe;
        }

        public string Id { get; }
        public string Label { get; }
        public string Hint { get; }
        public ShellRoute ShowMe { get; }
    }

    /// <summary>
    /// The Getting started checklist (POL5-05): the first things worth doing in a game, ticked off as
    /// the player does them, per save slot (<see cref="HelpPrefs"/>, never in the save). Booking,
    /// running and signing are read from the engine; reading the results and a help article are
    /// recorded by the UI. A done item stays done. It sits at the top of the Office (the Unity
    /// game's Office has no panel registry, so it is that screen's first block) and on the Help
    /// index, and hides itself once every item has been seen done or the player hides it.
    /// </summary>
    public static class GettingStarted
    {
        public const string BookShow = "book";
        public const string RunShow = "run";
        public const string ReadResults = "results";
        public const string SignSomeone = "sign";
        public const string ReadArticle = "help";

        public static readonly IReadOnlyList<ChecklistItem> Items = new[]
        {
            new ChecklistItem(BookShow, "Book your first show", "Fill a card in Booking. Auto-fill is a fine start.", ShellRoute.To("booking")),
            new ChecklistItem(RunShow, "Run it", "When show night comes, the day button takes you there.", HelpRoute("show-night")),
            new ChecklistItem(ReadResults, "Read the results", "See how the night went and why.", ShellRoute.To(ScreenIds.ShowResults)),
            new ChecklistItem(SignSomeone, "Sign someone", "Make an offer to a free agent in Contracts.", ShellRoute.With("contracts", "tab", "free-agents")),
            new ChecklistItem(ReadArticle, "Read a help article", "Every main screen has a short guide.", ShellRoute.To(HelpScreen.ScreenId)),
        };

        /// <summary>The save slot the checklist belongs to ("session" for a game without a slot).</summary>
        public static string SlotKey => Saves.GameSession.Current?.SlotId is string slot && slot.Length > 0 ? slot : "session";

        /// <summary>Raised when an item is newly done (an open checklist redraws).</summary>
        public static event Action Changed;

        /// <summary>Records a UI signal (an article read, the results opened) for the current game.</summary>
        public static void Record(string itemId)
        {
            if (EngineGame.Current == null) return;
            if (HelpPrefs.MarkDone(SlotKey, itemId)) Changed?.Invoke();
        }

        /// <summary>How many of the items are done.</summary>
        public static int CountDone(ICollection<string> done) => Items.Count(item => done.Contains(item.Id));

        /// <summary>Whether the checklist shows for this slot: a promotion to run, not hidden, not finished and seen.</summary>
        public static bool ShouldShow(string slot, bool hasPromotion) =>
            hasPromotion && !HelpPrefs.ChecklistHidden(slot) && !HelpPrefs.ChecklistComplete(slot);

        /// <summary>
        /// Reads the engine signals (a booked segment or a run show, a show run, a contract signed in
        /// talks) and marks those items done. Never throws; a failed read leaves the list as it was.
        /// </summary>
        public static async Task RefreshFromEngine(EngineGame game)
        {
            if (game?.Client == null || game.PromotionId == null) return;
            string promotionId = game.PromotionId;
            string slot = SlotKey;
            (bool booked, bool ran, bool signed) signals;
            try
            {
                signals = await game.Client.Read("help.checklist", reader =>
                {
                    QueryResult<JToken> last = reader.Query("shows.lastCompleted", new JObject { ["scope"] = "mine" });
                    bool ranShow = last.Ok && Kit.Str(last.Data, "eventInstanceId") != null;
                    QueryResult<JToken> shows = reader.Query("booking.shows", new JObject { ["limit"] = 20 });
                    bool bookedShow = ranShow || shows.Ok && Kit.Arr(shows.Data, "rows").Any(row => (Kit.Num(row, "filledMain") ?? 0) + (Kit.Num(row, "filledPreShow") ?? 0) > 0);
                    QueryResult<JToken> offers = reader.Query("contracts.offers", new JObject { ["promotionId"] = promotionId, ["status"] = "closed" });
                    bool signedSomeone = offers.Ok && Kit.Arr(offers.Data).Any(row => Kit.Str(row, "status") == "signed");
                    return (bookedShow, ranShow, signedSomeone);
                });
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[GettingStarted] {exception.Message}");
                return;
            }
            bool changed = false;
            if (signals.booked) changed |= HelpPrefs.MarkDone(slot, BookShow);
            if (signals.ran) changed |= HelpPrefs.MarkDone(slot, RunShow);
            if (signals.signed) changed |= HelpPrefs.MarkDone(slot, SignSomeone);
            if (changed) Changed?.Invoke();
        }

        /// <summary>The Office's first block, while the checklist shows (Office redraws call this each time).</summary>
        public static void AddToOffice(VisualElement host, ScreenContext context)
        {
            EngineGame game = EngineGame.Current;
            string slot = SlotKey;
            if (game == null || !ShouldShow(slot, game.PromotionId != null)) return;
            VisualElement block = Block(context, hideable: true);
            block.name = "office-getting-started";
            host.Add(block);
        }

        /// <summary>The Help index's "Getting started" card (in a game with a promotion; shown even when hidden on the Office).</summary>
        public static VisualElement HelpCard(ScreenContext context)
        {
            EngineGame game = EngineGame.Current;
            if (game == null || game.PromotionId == null) return null;
            VisualElement block = Block(context, hideable: false);
            block.name = "help-getting-started";
            return block;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register() => HelpScreen.GettingStartedSlot = HelpCard;

        private static VisualElement Block(ScreenContext context, bool hideable)
        {
            VisualElement panel = Ds.Panel("Getting started", hideable ? "Hide" : null, null, "gs-panel");
            HelpScreen.Style(panel);
            VisualElement body = Ds.Column("gs-body");
            panel.Add(body);
            if (hideable)
            {
                Button hide = panel.Q<Button>(className: "ds-btn--link");
                if (hide != null)
                {
                    hide.name = "getting-started-hide";
                    hide.clicked += () =>
                    {
                        HelpPrefs.SetChecklistHidden(SlotKey, true);
                        VisualElement parent = panel.parent;
                        panel.RemoveFromHierarchy();
                        if (parent != null) DsOverlay.Toast(parent, "Checklist hidden. Bring it back from Settings › Help & tips.", DsState.Info);
                    };
                }
            }
            Draw(body, context, hideable);

            void Redraw() => Draw(body, context, hideable);
            panel.RegisterCallback<AttachToPanelEvent>(_ => Changed += Redraw);
            panel.RegisterCallback<DetachFromPanelEvent>(_ => Changed -= Redraw);
            _ = RefreshFromEngine(EngineGame.Current);
            return panel;
        }

        private static void Draw(VisualElement body, ScreenContext context, bool onOffice)
        {
            body.Clear();
            string slot = SlotKey;
            HashSet<string> done = HelpPrefs.Done(slot);
            int count = CountDone(done);
            bool all = count == Items.Count;

            VisualElement head = Ds.Row("gs-head");
            head.Add(Ds.Text(all ? "You're set. Help is always under Help in the sidebar." : $"{count} of {Items.Count} done", "ds-type-body", "gs-count").Named("getting-started-count"));
            head.Add(Ds.Spacer());
            VisualElement meter = Ds.Meter(count / (float)Items.Count, all ? DsState.Good : DsState.Info);
            meter.AddToClassList("gs-meter");
            head.Add(meter);
            body.Add(head);
            if (all && onOffice) HelpPrefs.SetChecklistComplete(slot);

            VisualElement list = Ds.Row("gs-items");
            foreach (ChecklistItem item in Items)
            {
                bool isDone = done.Contains(item.Id);
                VisualElement row = Ds.Column("gs-item", isDone ? "gs-item--done" : "gs-item--open").Named("getting-started-" + item.Id);
                VisualElement top = Ds.Row("gs-item__top");
                top.Add(isDone ? new Icon("check-circle", "ds-icon--sm", "gs-item__icon") : Ui.El("gs-item__ring"));
                top.Add(Ds.Text(item.Label, "gs-item__label"));
                row.Add(top);
                row.Add(Ds.Text(isDone ? "Done" : item.Hint, "ds-type-caption", "gs-item__hint"));
                if (!isDone && context?.Navigator != null && IsReachable(item.ShowMe))
                {
                    ShellRoute route = item.ShowMe;
                    Button show = Ds.Button("Show me", () => context.Navigator.Go(route), DsButtonKind.Ghost, "chevron-right");
                    show.AddToClassList("ds-btn--link");
                    show.AddToClassList("gs-item__show");
                    show.name = "getting-started-show-" + item.Id;
                    row.Add(show);
                }
                list.Add(row);
            }
            body.Add(list);
        }

        /// <summary>"Show me" only for a screen that is built (an item for an unbuilt screen just says what to do).</summary>
        private static bool IsReachable(ShellRoute route) => route != null && ScreenRegistry.IsLive(route.ScreenId);

        private static ShellRoute HelpRoute(string slug) => ShellRoute.With(HelpScreen.ScreenId, "slug", slug);
    }
}
