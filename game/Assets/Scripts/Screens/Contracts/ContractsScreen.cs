using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// Business › Contracts in the Windows game (UNITY-17), the web's ContractsScreen on the UNITY-11
    /// design system. It leads with what needs a decision (workers who want to leave, counter-offers
    /// waiting, contracts close to their end, answers you have not read), then the lists: Active,
    /// Expiring, Wants to leave, Ended, Free agents and Offers, each a compact sortable table with a
    /// column picker, a search box and filters behind one button. A row opens the contract (release
    /// with the severance preview, answer a request to leave, renew) or the Negotiation sheet.
    /// <para>
    /// The day button's contract stops land here (<see cref="UI.Day.DayControlLogic.ContractsDestination"/>):
    /// <c>tab=expiring</c>, <c>tab=active&amp;wantsToLeave=1&amp;employment=…</c> (opens that contract) and
    /// <c>tab=offers&amp;negotiation=…</c> (opens those talks, which marks an answer as seen). The screen
    /// clears them itself, so the "Needs attention" sheet no longer handles contract stops.
    /// </para>
    /// </summary>
    public static class ContractsScreen
    {
        public const string ScreenId = "contracts";

        public const string TabActive = "active";
        public const string TabExpiring = "expiring";
        public const string TabLeaving = "leaving";
        public const string TabEnded = "ended";
        public const string TabFreeAgents = "free-agents";
        public const string TabOffers = "offers";

        /// <summary>The most rows a table draws; search or filter to narrow a long list.</summary>
        public const int MaxRows = 250;

        /// <summary>The screen built last (dev tours read it).</summary>
        public static ContractsView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new ContractsView(context);
            Current = view;
            return view.Root;
        }

        /// <summary>
        /// Opens the Negotiation sheet over whatever screen is showing (UNITY-15's worker profile
        /// calls this for its Offer contract / Renew contract button). <paramref name="kind"/> is
        /// <c>"offer"</c> (a new contract), <c>"renew"</c> (a renewal of your contract with them) or
        /// <c>"auto"</c>: your open talks with them if any, else a renewal when they work for you,
        /// else a new offer. Returns null when it opened, else why it could not.
        /// </summary>
        public static Task<string> OpenNegotiation(string personId, string kind = "auto", VisualElement anchor = null) =>
            NegotiationSheet.OpenForPerson(anchor ?? ShellController.Current?.Overlay?.Layer, personId, kind);

        /// <summary>
        /// The worker profile's contract button for <paramref name="personId"/> (the web's
        /// ProfileContractAction): "Open talks", "Renew contract", "Offer contract", or the same
        /// disabled with the reason; null when no contract action applies (retired, no promotion).
        /// </summary>
        public static Task<ContractAction> ActionFor(string personId) => ContractAction.ForAsync(personId);
    }

    /// <summary>The worker profile's contract button, worked out for one person (see <see cref="ContractsScreen.ActionFor"/>).</summary>
    public sealed class ContractAction
    {
        public string Label { get; private set; }
        public bool Enabled { get; private set; }
        /// <summary>Why it is disabled, in words, or null.</summary>
        public string Reason { get; private set; }
        /// <summary>What to pass to <see cref="ContractsScreen.OpenNegotiation"/>: <c>talks</c>, <c>renew</c> or <c>offer</c>.</summary>
        public string Kind { get; private set; }

        /// <summary>Opens the Negotiation sheet for it.</summary>
        public Task<string> Open(string personId, VisualElement anchor = null) =>
            ContractsScreen.OpenNegotiation(personId, Kind == "talks" ? "auto" : Kind, anchor);

        internal static async Task<ContractAction> ForAsync(string personId)
        {
            EngineGame game = Kit.Game;
            string promotionId = game?.PromotionId;
            if (game == null || promotionId == null || personId == null) return null;
            EngineClient client = game.Client;
            QueryResult<JToken> open = await client.Query("contracts.offers", new JObject { ["promotionId"] = promotionId, ["status"] = "open" });
            if (open.Ok && Kit.Arr(open.Data).Any(row => Kit.Str(row, "personId") == personId))
            {
                return new ContractAction { Label = "Open talks", Enabled = true, Kind = "talks" };
            }
            JToken own = await NegotiationSheet.OwnContractOf(client, personId);
            if (own != null)
            {
                if (Kit.Str(own, "endsOn") == null) return null;
                ContractRules rules = await ContractRules.LoadAsync(client);
                double? daysLeft = Kit.Num(own, "daysLeft");
                bool inside = daysLeft.HasValue && daysLeft.Value <= rules.RenewalWindowDays;
                return new ContractAction
                {
                    Label = "Renew contract",
                    Enabled = inside,
                    Reason = inside ? null : ContractText.RenewalWindow(rules.RenewalWindowDays),
                    Kind = "renew",
                };
            }
            QueryResult<JToken> ask = await client.Query("contracts.askingTerms", new JObject { ["promotionId"] = promotionId, ["personId"] = personId });
            string situation = ask.Ok ? Kit.Str(ask.Data, "eligibility.situation") : null;
            if (situation == null || situation == "unavailable") return null;
            if (situation == "freeAgent" || situation == "perAppearanceElsewhere" || situation == "endingSoonElsewhere")
            {
                return new ContractAction { Label = "Offer contract", Enabled = true, Kind = "offer" };
            }
            string reason = Kit.Arr(ask.Data, "eligibility.reasons").Select(item => Kit.Str(item, "message")).FirstOrDefault();
            return reason == null ? null : new ContractAction { Label = "Offer contract", Enabled = false, Reason = reason, Kind = "offer" };
        }
    }

    /// <summary>The Contracts screen's state and drawing (one per visit).</summary>
    public sealed class ContractsView
    {
        private readonly ScreenContext context;
        private readonly VisualElement countsLine;
        private readonly VisualElement decisions;
        private readonly VisualElement tabsHost;
        private readonly VisualElement toolbar;
        private readonly VisualElement listHost;
        private readonly Dictionary<string, DsTable<JToken>> tables = new Dictionary<string, DsTable<JToken>>();
        private readonly Dictionary<string, string> searches = new Dictionary<string, string>();
        private readonly ContractFilters contractFilters = new ContractFilters();
        private readonly FreeAgentFilters freeAgentFilters = new FreeAgentFilters();
        private string tab;
        private bool closedOffers;
        private bool focusPending;
        private Snapshot data;

        public ContractsView(ScreenContext context)
        {
            this.context = context;
            ShellRoute route = context.Route;
            tab = route.Param("tab") ?? ContractsScreen.TabActive;
            if (tab == ContractsScreen.TabActive && route.Param("wantsToLeave") == "1") tab = ContractsScreen.TabLeaving;
            if (!Tabs.Any(entry => entry.id == tab)) tab = ContractsScreen.TabActive;
            focusPending = route.Param("employment") != null || route.Param("negotiation") != null ||
                           route.Param("person") != null || route.Param("renew") != null;

            Root = Ds.Column("ct-page").Named("screen-contracts");
            ContractUi.Style(Root);
            VisualElement head = Ds.Row("ct-head");
            VisualElement titles = Ds.Column("ct-head__titles");
            titles.Add(Ds.Text("CONTRACTS", "ds-type-headline", "ct-head__title"));
            countsLine = Ds.Row("ct-head__counts");
            titles.Add(countsLine);
            head.Add(titles);
            head.Add(Ds.Spacer());
            Root.Add(head);

            decisions = Ds.Column("ct-decisions").Named("contracts-decisions");
            Root.Add(decisions);
            tabsHost = Ds.Row("ct-tabs").Named("contracts-tabs");
            Root.Add(tabsHost);
            toolbar = Ds.Row("ct-toolbar").Named("contracts-toolbar");
            Root.Add(toolbar);
            listHost = Ds.Column("ct-list").Named("contracts-list");
            Root.Add(listHost);

            Kit.Live(Root, Render);
        }

        public static readonly (string id, string label)[] Tabs =
        {
            (ContractsScreen.TabActive, "Active"),
            (ContractsScreen.TabExpiring, "Expiring"),
            (ContractsScreen.TabLeaving, "Wants to leave"),
            (ContractsScreen.TabEnded, "Ended"),
            (ContractsScreen.TabFreeAgents, "Free agents"),
            (ContractsScreen.TabOffers, "Offers"),
        };

        public VisualElement Root { get; }
        public string Tab => tab;
        public ContractRules Rules => data?.Rules ?? ContractRules.Defaults;

        /// <summary>The table on the current tab (tours sort it and open its column picker).</summary>
        public DsTable<JToken> Table => tables.TryGetValue(tab, out DsTable<JToken> table) ? table : null;

        /// <summary>The rows on the current tab after filters and search.</summary>
        public IReadOnlyList<JToken> ShownRows { get; private set; } = Array.Empty<JToken>();

        public void SelectTab(string id)
        {
            if (id == tab || !Tabs.Any(entry => entry.id == id)) return;
            tab = id;
            Redraw();
        }

        public void ShowClosedOffers(bool closed)
        {
            closedOffers = closed;
            Redraw();
        }

        private void Redraw()
        {
            if (data == null) return;
            DrawTabs();
            DrawToolbar();
            DrawList();
        }

        // ---- Loading --------------------------------------------------------------------------------

        private sealed class Snapshot
        {
            public ContractRules Rules;
            public JToken Counts;
            public List<JToken> Active = new List<JToken>();
            public List<JToken> Leaving = new List<JToken>();
            public List<JToken> OpenOffers = new List<JToken>();
            public List<JToken> ClosedOffers = new List<JToken>();
            public Dictionary<string, List<JToken>> Lists = new Dictionary<string, List<JToken>>();
            public string Problem;
        }

        private async Task Render()
        {
            EngineGame game = Kit.Game;
            EngineClient client = game.Client;
            string promotionId = game.PromotionId;
            var next = new Snapshot { Rules = await ContractRules.LoadAsync(client) };
            QueryResult<JToken> active = await client.Query("contracts.list", new JObject { ["tab"] = "active" });
            if (!active.Ok)
            {
                next.Problem = "Start or load a game to see your contracts.";
            }
            else
            {
                next.Active = Kit.Arr(active.Data).ToList();
                next.Leaving = next.Active.Where(row => Kit.Str(row, "request.status") == "open").ToList();
                next.Counts = (await client.Query("contracts.counts")).Data;
                if (promotionId != null)
                {
                    next.OpenOffers = Kit.Arr((await client.Query("contracts.offers", new JObject { ["promotionId"] = promotionId, ["status"] = "open" })).Data).ToList();
                    next.ClosedOffers = Kit.Arr((await client.Query("contracts.offers", new JObject { ["promotionId"] = promotionId, ["status"] = "closed" })).Data).ToList();
                }
                next.Lists[ContractsScreen.TabActive] = next.Active;
                next.Lists[ContractsScreen.TabLeaving] = Kit.Arr((await client.Query("contracts.list", new JObject { ["tab"] = "active", ["wantsToLeave"] = true })).Data).ToList();
                next.Lists[ContractsScreen.TabExpiring] = Kit.Arr((await client.Query("contracts.list", new JObject { ["tab"] = "expiring" })).Data).ToList();
                if (tab == ContractsScreen.TabEnded)
                {
                    next.Lists[ContractsScreen.TabEnded] = Kit.Arr((await client.Query("contracts.list", new JObject { ["tab"] = "ended" })).Data).ToList();
                }
                if (tab == ContractsScreen.TabFreeAgents && promotionId != null)
                {
                    var args = new JObject { ["promotionId"] = promotionId, ["situation"] = freeAgentFilters.FreeAgentsOnly ? "freeAgent" : "all" };
                    QueryResult<JToken> freeAgents = await client.Query("contracts.freeAgents", args);
                    next.Lists[ContractsScreen.TabFreeAgents] = Kit.Arr(freeAgents.Data).ToList();
                }
            }
            data = next;
            DrawHead();
            DrawDecisions();
            DrawTabs();
            DrawToolbar();
            DrawList();
            if (focusPending)
            {
                focusPending = false;
                FocusFromRoute();
            }
        }

        /// <summary>Loads the list a tab needs that the last draw did not fetch, then draws it.</summary>
        private async void LoadAndDraw()
        {
            EngineGame game = Kit.Game;
            if (game == null || data == null) return;
            string promotionId = game.PromotionId;
            if (tab == ContractsScreen.TabEnded && !data.Lists.ContainsKey(tab))
            {
                data.Lists[tab] = Kit.Arr((await game.Client.Query("contracts.list", new JObject { ["tab"] = "ended" })).Data).ToList();
            }
            else if (tab == ContractsScreen.TabFreeAgents && promotionId != null)
            {
                var args = new JObject { ["promotionId"] = promotionId, ["situation"] = freeAgentFilters.FreeAgentsOnly ? "freeAgent" : "all" };
                data.Lists[tab] = Kit.Arr((await game.Client.Query("contracts.freeAgents", args)).Data).ToList();
            }
            if (Root.panel == null) return;
            DrawToolbar();
            DrawList();
        }

        private void FocusFromRoute()
        {
            ShellRoute route = context.Route;
            if (route.Param("employment") is string employmentId)
            {
                OpenContract(employmentId);
            }
            else if (route.Param("negotiation") is string negotiationId)
            {
                NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId));
            }
            else if (route.Param("renew") is string renewId)
            {
                NegotiationSheet.Open(Root, NegotiationTarget.Renewal(renewId));
            }
            else if (route.Param("person") is string personId)
            {
                NegotiationSheet.Open(Root, NegotiationTarget.Signing(personId));
            }
        }

        // ---- Header and decisions -------------------------------------------------------------------

        private void DrawHead()
        {
            countsLine.Clear();
            if (data.Problem != null) return;
            ContractRules rules = data.Rules;
            int expiring = data.Active.Count(row => Kit.Num(row, "daysLeft") is double days && days <= rules.ExpiringWindowDays);
            double monthly = data.Active.Sum(row => Kit.Num(row, "monthlyWage") ?? 0);
            int leaving = (int)(Kit.Num(data.Counts, "wantsToLeave") ?? data.Leaving.Count);
            countsLine.Add(Ds.Text(ContractText.CountsLine(data.Active.Count, monthly, expiring, leaving), "ds-type-caption", "ct-head__counts-text"));
        }

        /// <summary>
        /// "Needs your decision": one card per thing the player must answer, most urgent first. Empty
        /// (and hidden) when nothing waits, so a quiet day shows the lists straight away.
        /// </summary>
        private void DrawDecisions()
        {
            decisions.Clear();
            if (data.Problem != null) return;
            var cards = new List<VisualElement>();

            foreach (JToken row in data.Leaving)
            {
                string employmentId = Kit.Str(row, "employmentId");
                cards.Add(DecisionCard(DsState.Bad, "user-minus", "WANTS TO LEAVE", Kit.Str(row, "ringName"), Kit.Str(row, "imageRef"),
                    $"Answer by {ContractText.Date(Kit.Str(row, "request.answerBy"))}",
                    ("Answer", () => OpenContract(employmentId), true), $"decision-leave-{employmentId}"));
            }
            foreach (JToken row in data.OpenOffers.Where(row => Kit.Str(row, "status") == "countered"))
            {
                string negotiationId = Kit.Str(row, "negotiationId");
                cards.Add(DecisionCard(DsState.Warn, "handshake", "COUNTER-OFFER", Kit.Str(row, "ringName"), Kit.Str(row, "imageRef"),
                    ContractText.OnTheTable(row) + (ContractText.OfferDue(row) is string due ? " · " + due : string.Empty),
                    ("Answer", () => NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId)), true), $"decision-counter-{negotiationId}"));
            }
            int unseen = (int)(Kit.Num(data.Counts, "unseenExpiring") ?? 0);
            if (unseen > 0)
            {
                VisualElement card = DecisionCard(DsState.Warn, "clock", "ENDING SOON", null, null,
                    ContractText.ExpiringBanner(unseen, data.Rules.ExpiringStop),
                    ("Mark all seen", MarkAllSeen, true), "decision-expiring");
                Button review = Ds.Button("Review", () => SelectTab(ContractsScreen.TabExpiring), DsButtonKind.Ghost);
                review.name = "decision-expiring-review";
                card.Q<VisualElement>(className: "ct-decision__actions")?.Insert(0, review);
                cards.Add(card);
            }
            foreach (JToken row in data.ClosedOffers.Where(row => Kit.Bool(row, "answerUnseen")))
            {
                string negotiationId = Kit.Str(row, "negotiationId");
                string status = Kit.Str(row, "status");
                cards.Add(DecisionCard(ContractText.OfferState(status), status == "signed" ? "check-circle" : "inbox", "NEW ANSWER", Kit.Str(row, "ringName"), Kit.Str(row, "imageRef"),
                    ContractText.OfferStatus(row),
                    ("Open", () => NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId)), false), $"decision-answer-{negotiationId}"));
            }

            if (cards.Count == 0) return;
            VisualElement header = Ds.SectionHeader("Needs your decision");
            decisions.Add(header);
            VisualElement strip = Ds.Row("ds-row--wrap", "ds-row--top", "ct-decisions__cards");
            foreach (VisualElement card in cards) strip.Add(card);
            decisions.Add(strip);
        }

        private VisualElement DecisionCard(DsState state, string icon, string eyebrow, string ringName, string imageRef, string line,
            (string text, Action onClick, bool primary) action, string name)
        {
            VisualElement card = Ds.Row("ct-decision", Ds.StateClass(state)).Named(name);
            card.Add(Ds.El("ct-decision__edge"));
            if (ringName != null) card.Add(ContractUi.Portrait(imageRef, "ds-portrait--sm"));
            else card.Add(Ds.El("ct-decision__icon-box").With(new Icon(icon, "ds-icon--lg", "ct-decision__icon")));
            VisualElement words = Ds.Column("ct-decision__words");
            VisualElement top = Ds.Row("ct-decision__top");
            top.Add(new Icon(icon, "ds-icon--xs", "ct-decision__eyebrow-icon"));
            top.Add(Ds.Text(eyebrow, "ct-decision__eyebrow"));
            words.Add(top);
            if (ringName != null) words.Add(Ds.Text(ringName, "ct-decision__name"));
            Label lineLabel = Ds.Text(line, "ct-decision__line");
            DsTooltip.Attach(lineLabel, line);
            words.Add(lineLabel);
            card.Add(words);
            VisualElement actions = Ds.Row("ct-decision__actions");
            Button button = Ds.Button(action.text, action.onClick, action.primary ? DsButtonKind.Primary : DsButtonKind.Secondary);
            button.name = name + "-go";
            actions.Add(button);
            card.Add(actions);
            return card;
        }

        private async void MarkAllSeen()
        {
            CommandResult<JToken> result = await Kit.Run("contracts.acknowledgeExpiries", new JObject { ["employmentIds"] = "all" });
            if (!result.Ok) DsOverlay.Toast(Root, Kit.Reasons(result.Reasons), DsState.Bad);
        }

        // ---- Tabs and toolbar -----------------------------------------------------------------------

        private int? TabCount(string id)
        {
            switch (id)
            {
                case ContractsScreen.TabActive: return data.Active.Count;
                case ContractsScreen.TabExpiring: return data.Lists.TryGetValue(id, out List<JToken> expiring) ? expiring.Count : (int?)null;
                case ContractsScreen.TabLeaving: return data.Leaving.Count;
                case ContractsScreen.TabOffers: return data.OpenOffers.Count;
                default: return null;
            }
        }

        private void DrawTabs()
        {
            tabsHost.Clear();
            var tabs = new DsTabs();
            foreach ((string id, string label) in Tabs)
            {
                int? count = data.Problem == null ? TabCount(id) : null;
                tabs.Add(id, label, count);
            }
            tabs.Select(tab, false);
            // A counter waiting or someone leaving: the tab's count turns into the red badge.
            MarkUrgent(tabs, ContractsScreen.TabLeaving, data.Leaving.Count > 0);
            MarkUrgent(tabs, ContractsScreen.TabOffers, data.OpenOffers.Any(row => Kit.Str(row, "status") == "countered"));
            MarkUrgent(tabs, ContractsScreen.TabExpiring, (Kit.Num(data.Counts, "unseenExpiring") ?? 0) > 0);
            tabs.Selected += id =>
            {
                tab = id;
                LoadAndDraw();
                DrawToolbar();
                DrawList();
            };
            tabsHost.Add(tabs);
        }

        private static void MarkUrgent(DsTabs tabs, string id, bool urgent)
        {
            Button button = tabs.Q<Button>("tab-" + id);
            button?.Q<Label>(className: "ds-tab__count")?.EnableInClassList("ct-tab-count--urgent", urgent);
        }

        private void DrawToolbar()
        {
            toolbar.Clear();
            if (data.Problem != null) return;
            searches.TryGetValue(tab, out string search);
            toolbar.Add(ContractUi.Search(SearchPlaceholder(), search, text =>
            {
                searches[tab] = text;
                DrawList();
            }, "contracts-search"));

            int filters = FilterCount();
            if (tab != ContractsScreen.TabOffers)
            {
                Button filter = Ds.Button(filters > 0 ? $"Filter ({filters})" : "Filter", null, filters > 0 ? DsButtonKind.Primary : DsButtonKind.Secondary, "filter");
                filter.name = "contracts-filter";
                filter.clicked += () => OpenFilters(filter);
                toolbar.Add(filter);
                if (filters > 0)
                {
                    Button clear = Ds.Button("Clear", () =>
                    {
                        contractFilters.Clear();
                        bool reload = freeAgentFilters.FreeAgentsOnly;
                        freeAgentFilters.Clear();
                        if (reload && tab == ContractsScreen.TabFreeAgents) LoadAndDraw();
                        DrawToolbar();
                        DrawList();
                    }, DsButtonKind.Ghost, "close");
                    clear.name = "contracts-filter-clear";
                    toolbar.Add(clear);
                }
            }
            else
            {
                var which = new DsTabs(segmented: true);
                which.Add("open", "Open talks").Add("closed", "Closed talks");
                which.Select(closedOffers ? "closed" : "open", false);
                which.name = "offers-open-closed";
                which.Selected += id => ShowClosedOffers(id == "closed");
                toolbar.Add(which);
            }
            toolbar.Add(Ds.Spacer());
            Label shown = Ds.Text(string.Empty, "ds-type-caption", "ct-toolbar__shown").Named("contracts-shown");
            toolbar.Add(shown);
        }

        private string SearchPlaceholder() => tab switch
        {
            ContractsScreen.TabFreeAgents => "Find a worker",
            ContractsScreen.TabOffers => "Find talks",
            _ => "Find a contract",
        };

        private int FilterCount() => tab == ContractsScreen.TabFreeAgents ? freeAgentFilters.Count : tab == ContractsScreen.TabOffers ? 0 : contractFilters.Count(tab);

        private void OpenFilters(VisualElement anchor)
        {
            VisualElement panel = Ds.Column("ct-filters").Named("contracts-filters");
            ContractUi.Style(panel);
            panel.Add(Ds.Text("FILTERS", "ds-column-picker__title"));
            void Changed()
            {
                DrawList();
                UpdateFilterButton();
            }
            if (tab == ContractsScreen.TabFreeAgents)
            {
                List<JToken> rows = data.Lists.TryGetValue(tab, out List<JToken> list) ? list : new List<JToken>();
                freeAgentFilters.Build(panel, rows, Changed, () =>
                {
                    LoadAndDraw();
                    UpdateFilterButton();
                });
            }
            else
            {
                contractFilters.Build(panel, tab, data.Active, Changed);
            }
            DsOverlay.Popover(anchor, panel, alignRight: false);
        }

        private void UpdateFilterButton()
        {
            Button filter = toolbar.Q<Button>("contracts-filter");
            if (filter == null) return;
            int count = FilterCount();
            Label label = filter.Q<Label>(className: "ds-btn__label");
            if (label != null) label.text = TextFormat.Upper(count > 0 ? $"Filter ({count})" : "Filter");
            filter.EnableInClassList("ds-btn--primary", count > 0);
            filter.EnableInClassList("ds-btn--secondary", count == 0);
        }

        // ---- Lists ----------------------------------------------------------------------------------

        private void DrawList()
        {
            listHost.Clear();
            if (data.Problem != null)
            {
                listHost.Add(Ds.Empty("contracts", data.Problem, null));
                return;
            }
            string promotionId = Kit.Game?.PromotionId;
            if ((tab == ContractsScreen.TabFreeAgents || tab == ContractsScreen.TabOffers) && promotionId == null)
            {
                listHost.Add(Ds.Empty("contracts", "Run a promotion to talk contracts.", null));
                return;
            }

            if (tab == ContractsScreen.TabExpiring) listHost.Add(ExpiringIntro());
            if (tab == ContractsScreen.TabOffers) AddNewAnswers();

            List<JToken> all = RowsFor(tab, out bool loading);
            if (loading)
            {
                listHost.Add(Ds.Loading("Loading the list…"));
                return;
            }
            List<JToken> filtered = Filter(all);
            ShownRows = filtered;
            Label shown = toolbar.Q<Label>("contracts-shown");
            if (shown != null)
            {
                bool narrowed = filtered.Count != all.Count;
                string noun = tab == ContractsScreen.TabFreeAgents ? "free agents" : tab == ContractsScreen.TabOffers ? "talks" : "contracts";
                shown.text = narrowed ? $"{TextFormat.Number(filtered.Count)} of {TextFormat.Number(all.Count)} {noun}" : $"{TextFormat.Number(all.Count)} {noun}";
            }

            if (filtered.Count == 0)
            {
                bool narrowed = all.Count > 0;
                listHost.Add(narrowed
                    ? Ds.Empty("filter", "Nothing matches these filters", "Loosen a filter, or clear them all.")
                    : Ds.Empty("contracts", EmptyText(), EmptyHint()));
                return;
            }

            DsTable<JToken> table = TableFor(tab);
            table.SetRows(filtered.Take(ContractsScreen.MaxRows));
            listHost.Add(table);
            if (filtered.Count > ContractsScreen.MaxRows)
            {
                listHost.Add(Ds.Text($"Showing the first {ContractsScreen.MaxRows} of {TextFormat.Number(filtered.Count)}. Search or filter to narrow the list.", "ct-quiet"));
            }
        }

        private List<JToken> RowsFor(string id, out bool loading)
        {
            loading = false;
            switch (id)
            {
                case ContractsScreen.TabOffers:
                    return closedOffers ? data.ClosedOffers : data.OpenOffers;
                default:
                    if (data.Lists.TryGetValue(id, out List<JToken> rows)) return rows;
                    loading = true;
                    return new List<JToken>();
            }
        }

        private List<JToken> Filter(List<JToken> rows)
        {
            IEnumerable<JToken> kept = rows;
            if (tab == ContractsScreen.TabFreeAgents) kept = kept.Where(freeAgentFilters.Keeps);
            else if (tab != ContractsScreen.TabOffers) kept = kept.Where(row => contractFilters.Keeps(row, tab));
            searches.TryGetValue(tab, out string search);
            if (!string.IsNullOrWhiteSpace(search))
            {
                string needle = search.Trim();
                kept = kept.Where(row => (Kit.Str(row, "ringName") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            return kept.ToList();
        }

        private string EmptyText() => tab switch
        {
            ContractsScreen.TabExpiring => "No contracts end in the next few weeks",
            ContractsScreen.TabLeaving => "Nobody wants to leave",
            ContractsScreen.TabEnded => "No contracts have ended yet",
            ContractsScreen.TabFreeAgents => "No free agents match",
            ContractsScreen.TabOffers => closedOffers ? "No closed talks yet" : "No open offers",
            _ => "No contracts to show",
        };

        private string EmptyHint() => tab == ContractsScreen.TabOffers && !closedOffers ? "Make one from Free agents, or Renew an expiring contract." : null;

        private VisualElement ExpiringIntro()
        {
            VisualElement intro = Ds.Column("ct-intro");
            int unseen = (int)(Kit.Num(data.Counts, "unseenExpiring") ?? 0);
            if (unseen > 0)
            {
                VisualElement banner = Ds.Row("ct-banner", Ds.StateClass(DsState.Warn)).Named("expiring-banner");
                banner.Add(new Icon("clock", "ds-icon--md", "ct-banner__icon"));
                banner.Add(Ds.Text(ContractText.ExpiringBanner(unseen, data.Rules.ExpiringStop), "ct-banner__text"));
                banner.Add(Ds.Spacer());
                Button mark = Ds.Button("Mark all seen", MarkAllSeen, DsButtonKind.Primary, "check");
                mark.name = "contracts-mark-all-seen";
                banner.Add(mark);
                intro.Add(banner);
            }
            intro.Add(Ds.Text(ContractText.RenewPointer(data.Rules.RenewalWindowDays), "ct-quiet", "ds-wrap"));
            return intro;
        }

        /// <summary>Answers not opened yet (ECO5-10), above the Offers list either way: each opens its talks.</summary>
        private void AddNewAnswers()
        {
            List<JToken> unseen = data.ClosedOffers.Where(row => Kit.Bool(row, "answerUnseen")).ToList();
            if (unseen.Count == 0) return;
            VisualElement box = Ds.Column("ct-answers").Named("offers-new-answers");
            box.Add(Ds.Text("NEW ANSWERS", "ct-answers__title"));
            VisualElement row = Ds.Row("ds-row--wrap");
            foreach (JToken offer in unseen)
            {
                string negotiationId = Kit.Str(offer, "negotiationId");
                Button open = Ds.Button($"{Kit.Str(offer, "ringName")}: {ContractText.OfferStatus(offer)}",
                    () => NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId)), DsButtonKind.Secondary,
                    Kit.Str(offer, "status") == "signed" ? "check-circle" : "inbox");
                open.name = "new-answer-" + negotiationId;
                open.AddToClassList("ct-answers__item");
                row.Add(open);
            }
            box.Add(row);
            listHost.Add(box);
        }

        // ---- Tables ---------------------------------------------------------------------------------

        private DsTable<JToken> TableFor(string id)
        {
            if (tables.TryGetValue(id, out DsTable<JToken> table)) return table;
            switch (id)
            {
                case ContractsScreen.TabEnded:
                    table = new DsTable<JToken>(EndedColumns(), Array.Empty<JToken>());
                    table.SortBy("ended", true);
                    table.RowClicked += row => OpenContract(Kit.Str(row, "employmentId"));
                    break;
                case ContractsScreen.TabFreeAgents:
                    table = new DsTable<JToken>(FreeAgentColumns(), Array.Empty<JToken>());
                    table.RowClicked += OpenFreeAgent;
                    break;
                case ContractsScreen.TabOffers:
                    table = new DsTable<JToken>(OfferColumns(), Array.Empty<JToken>());
                    table.SortBy("status", false);
                    table.RowClicked += row => NegotiationSheet.Open(Root, NegotiationTarget.Talks(Kit.Str(row, "negotiationId")));
                    break;
                default:
                    table = new DsTable<JToken>(ContractColumns(id), Array.Empty<JToken>());
                    if (id == ContractsScreen.TabExpiring) table.SortBy("ends", false);
                    else table.SortBy("name", false);
                    table.RowClicked += row => OpenContract(Kit.Str(row, "employmentId"));
                    break;
            }
            table.name = "contracts-table-" + id;
            table.AddToClassList("ct-table");
            tables[id] = table;
            return table;
        }

        private static DsColumn<JToken> NameColumn(string header = "Name") =>
            new DsColumn<JToken>("name", header, row => ContractUi.NameCell(Kit.Str(row, "ringName"), Kit.Str(row, "imageRef"), Kit.Arr(row, "titles").Any()))
            {
                Grow = 2.4f, MinWidth = 200, Pinned = true, SortKey = row => Kit.Str(row, "ringName") ?? string.Empty,
            };

        private List<DsColumn<JToken>> ContractColumns(string id)
        {
            ContractRules Rules() => data?.Rules ?? ContractRules.Defaults;
            var columns = new List<DsColumn<JToken>>
            {
                NameColumn(),
                new DsColumn<JToken>("role", "Role", row => ContractUi.Cell(ContractText.RoleText(Kit.Str(row, "role"), Kit.Str(row, "push"))))
                {
                    Grow = 1.3f, MinWidth = 120, SortKey = row => ContractText.PushRank(Kit.Str(row, "push")),
                    Help = "Their role and card position with you.",
                },
                new DsColumn<JToken>("wage", "Wage", row => ContractUi.NumCell(ContractText.WageText(row)))
                {
                    Width = 150, Align = DsAlign.Right, SortKey = row => ContractText.WageValue(row),
                    Help = "What they cost: a monthly wage, a fee per show, or both.",
                },
                new DsColumn<JToken>("ends", "Ends", EndsCell)
                {
                    Width = 160, SortKey = row => Kit.Num(row, "daysLeft") ?? double.MaxValue, Help = "The end date and the days left.",
                },
                new DsColumn<JToken>("status", "Status", row => ContractUi.Chips(ContractText.StatusChips(row, Rules().ExpiringSoonDays, Rules().ExpiringWindowDays)))
                {
                    Grow = 2f, MinWidth = 180, Help = "What needs a look: a request to leave, an unhappy worker, a contract close to its end.",
                },
            };
            if (id == ContractsScreen.TabExpiring || id == ContractsScreen.TabLeaving)
            {
                columns.Add(new DsColumn<JToken>("action", string.Empty, row => RowAction(row, id)) { Width = 150, Align = DsAlign.Right });
            }
            columns.Add(new DsColumn<JToken>("kind", "Kind", row => ContractUi.Cell(ContractText.KindLabel(Kit.Str(row, "kind")) + (Kit.Bool(row, "exclusive") ? ", exclusive" : string.Empty)))
            {
                Grow = 1.2f, Default = false, SortKey = row => Kit.Str(row, "kind") ?? string.Empty,
            });
            columns.Add(new DsColumn<JToken>("popularity", "Popularity", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "popularity"))))
            {
                Width = 100, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "popularity") ?? 0,
                Help = "How popular they are with your fans, 0 to 100.",
            });
            columns.Add(new DsColumn<JToken>("morale", "Morale", row => ContractUi.NumCell(ContractText.Signed(Kit.Num(row, "morale") ?? 0)))
            {
                Width = 90, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "morale") ?? 0,
                Help = "Their morale here, −100 to 100.",
            });
            columns.Add(new DsColumn<JToken>("perks", "Perks", row =>
            {
                List<string> perks = Kit.Arr(row, "perks").Select(perk => ContractText.PerkLabel((string)perk)).ToList();
                return perks.Count == 0 ? ContractUi.Muted("No perks") : ContractUi.Cell(string.Join(", ", perks));
            }) { Grow = 1.4f, Default = false });
            columns.Add(new DsColumn<JToken>("titles", "Titles", row =>
            {
                List<string> titles = Kit.Arr(row, "titles").Select(title => Kit.Str(title, "name")).ToList();
                return titles.Count == 0 ? ContractUi.Muted(ContractText.NoValue) : ContractUi.Cell(string.Join(", ", titles), "ct-gold");
            }) { Grow = 1.4f, Default = false });
            return columns;
        }

        private static VisualElement EndsCell(JToken row)
        {
            string endsOn = Kit.Str(row, "endsOn");
            if (endsOn == null) return ContractUi.Muted(ContractText.NoEndDate);
            VisualElement cell = Ds.Row("ct-ends");
            cell.Add(ContractUi.Cell(ContractText.Date(endsOn)));
            if (Kit.Num(row, "daysLeft") is double days) cell.Add(Ds.Text(ContractText.Days(days), "ct-ends__days"));
            return cell;
        }

        /// <summary>The Expiring row's Got it / Renew, or the Wants to leave row's Answer.</summary>
        private VisualElement RowAction(JToken row, string id)
        {
            string employmentId = Kit.Str(row, "employmentId");
            VisualElement cell = Ds.Row("ct-row-actions");
            if (id == ContractsScreen.TabLeaving)
            {
                Button answer = Ds.Button("Answer", () => OpenContract(employmentId), DsButtonKind.Primary);
                answer.name = "answer-" + employmentId;
                cell.Add(answer);
                return cell;
            }
            if (Kit.Str(row, "notice") == "unseen")
            {
                Button gotIt = Ds.Button("Got it", async () =>
                {
                    CommandResult<JToken> result = await Kit.Run("contracts.acknowledgeExpiries", new JObject { ["employmentIds"] = new JArray(employmentId) });
                    if (!result.Ok) DsOverlay.Toast(Root, Kit.Reasons(result.Reasons), DsState.Bad);
                }, DsButtonKind.Ghost);
                gotIt.name = "got-it-" + employmentId;
                cell.Add(gotIt);
            }
            cell.Add(RenewButton(row, small: true));
            return cell;
        }

        /// <summary>Renew (or Open talks while renewal talks are open); disabled outside the renewal window with the reason.</summary>
        internal VisualElement RenewButton(JToken row, bool small)
        {
            string employmentId = Kit.Str(row, "employmentId");
            string personId = Kit.Str(row, "personId");
            JToken talks = data?.OpenOffers.FirstOrDefault(offer => Kit.Str(offer, "personId") == personId && Kit.Str(offer, "kind") == "renewal");
            if (talks != null)
            {
                string negotiationId = Kit.Str(talks, "negotiationId");
                Button open = Ds.Button("Open talks", () => NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId)), DsButtonKind.Secondary, "handshake");
                open.name = "renew-" + employmentId;
                return open;
            }
            bool inside = Kit.Num(row, "daysLeft") is double days && days <= Rules.RenewalWindowDays;
            Button renew = Ds.Button("Renew", () => NegotiationSheet.Open(Root, NegotiationTarget.Renewal(employmentId)), small ? DsButtonKind.Secondary : DsButtonKind.Primary, "handshake");
            renew.name = "renew-" + employmentId;
            if (inside) return renew;
            renew.SetEnabled(false);
            VisualElement wrap = Ds.El("ct-choice-wrap");
            wrap.Add(renew);
            DsTooltip.Attach(wrap, ContractText.RenewalWindow(Rules.RenewalWindowDays), "Renew");
            return wrap;
        }

        private List<DsColumn<JToken>> EndedColumns() => new List<DsColumn<JToken>>
        {
            NameColumn(),
            new DsColumn<JToken>("role", "Role", row => ContractUi.Cell(ContractText.RoleText(Kit.Str(row, "role"), Kit.Str(row, "push"))))
            {
                Grow = 1.3f, MinWidth = 120, SortKey = row => ContractText.PushRank(Kit.Str(row, "push")),
            },
            new DsColumn<JToken>("ended", "Ended", row => ContractUi.Cell(ContractText.Date(Kit.Str(row, "endedOn"))))
            {
                Width = 130, SortKey = row => Kit.Str(row, "endedOn") ?? string.Empty,
            },
            new DsColumn<JToken>("how", "How", row => ContractUi.Chips(ContractText.StatusChips(row, 0, 0), 1)) { Grow = 1.6f, MinWidth = 160 },
            new DsColumn<JToken>("severance", "Severance paid", row =>
            {
                double paid = Kit.Num(row, "severancePaid") ?? 0;
                if (paid <= 0) return ContractUi.Muted("None");
                return ContractUi.Value(ContractText.Money(paid),
                    ContractWhy.Ref($"{Kit.Str(row, "ringName")}'s severance", paid, Kit.Obj(row, "severanceTraceRef"), "money"), "ds-cell__text--num");
            }) { Width = 150, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "severancePaid") ?? 0 },
            new DsColumn<JToken>("kind", "Kind", row => ContractUi.Cell(ContractText.KindLabel(Kit.Str(row, "kind"))))
            {
                Grow = 1f, Default = false, SortKey = row => Kit.Str(row, "kind") ?? string.Empty,
            },
            new DsColumn<JToken>("popularity", "Popularity", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "popularity"))))
            {
                Width = 100, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "popularity") ?? 0,
            },
        };

        private List<DsColumn<JToken>> FreeAgentColumns()
        {
            string promotionId = Kit.Game?.PromotionId;
            return new List<DsColumn<JToken>>
            {
                NameColumn(),
                new DsColumn<JToken>("situation", "Situation", row =>
                {
                    bool free = Kit.Str(row, "situation") == "freeAgent";
                    return free ? Ds.Dot(DsState.Good, ContractText.SituationOf(row)) : Ds.Dot(DsState.Neutral, ContractText.SituationOf(row));
                }) { Grow = 1.6f, MinWidth = 150, SortKey = row => Kit.Str(row, "situation") ?? string.Empty, Help = "Where they are now: free, or with someone else and free soon." },
                new DsColumn<JToken>("rating", "Rating", row =>
                {
                    VisualElement cell = Ds.Row("ct-rating");
                    cell.Add(ContractUi.NumCell(Kit.Whole(Kit.Num(row, "rating"))));
                    cell.Add(Ds.Text(Kit.Str(row, "grade") ?? string.Empty, "ct-grade"));
                    return cell;
                }) { Width = 100, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "rating") ?? 0, Help = "Their rating in the role they would be hired for, with its grade." },
                new DsColumn<JToken>("ask", "Ask", row => AskCell(row, promotionId))
                {
                    Width = 170, Align = DsAlign.Right, SortKey = row => ContractText.AskValue(row), Help = "What they ask of your promotion. The ? shows how they got there.",
                },
                new DsColumn<JToken>("talks", "Talks", row => ContractUi.Cell(ContractText.TalksState(row), Kit.Str(row, "openNegotiationId") != null ? "ct-data" : "ds-cell__text--muted"))
                {
                    Grow = 1.4f, MinWidth = 130,
                },
                new DsColumn<JToken>("action", string.Empty, FreeAgentAction) { Width = 140, Align = DsAlign.Right },
                new DsColumn<JToken>("roles", "Roles", row => ContractUi.Cell(string.Join(", ", Kit.Arr(row, "roles").Select(role => ContractText.PersonRoleLabel((string)role)))))
                {
                    Grow = 1.4f, Default = false,
                },
                new DsColumn<JToken>("age", "Age", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "age"))))
                {
                    Width = 70, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "age") ?? 0,
                },
                new DsColumn<JToken>("style", "Style", row => ContractUi.Cell(ContractText.StyleLabel(Kit.Str(row, "style"))))
                {
                    Grow = 1f, Default = false, SortKey = row => ContractText.StyleLabel(Kit.Str(row, "style")),
                },
                new DsColumn<JToken>("peakPop", "Peak popularity", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "peakPop"))))
                {
                    Width = 130, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "peakPop") ?? 0, Help = "Their popularity in their best country.",
                },
                new DsColumn<JToken>("popularityHere", "Your fans", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "popularityHere"))))
                {
                    Width = 100, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "popularityHere") ?? 0, Help = "Their popularity among your promotion's fans.",
                },
                new DsColumn<JToken>("pushExpectation", "Expects", row => ContractUi.Cell(Kit.PushLabel(Kit.Str(row, "pushExpectation"))))
                {
                    Grow = 1f, Default = false, SortKey = row => ContractText.PushRank(Kit.Str(row, "pushExpectation")), Help = "The card position they would expect with you.",
                },
                new DsColumn<JToken>("marketValue", "Market value", row => ContractUi.NumCell($"{ContractText.Money(Kit.Num(row, "marketValue"))}/mo"))
                {
                    Width = 130, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "marketValue") ?? 0,
                },
            };
        }

        private static VisualElement AskCell(JToken row, string promotionId)
        {
            string text = ContractText.AskText(row);
            if (text == null) return ContractUi.Muted("None you can offer");
            bool perAppearance = Kit.Str(row, "bestKind") == "perAppearance" || (Kit.Num(row, "askMonthly") == null && Kit.Num(row, "askPerAppearance") != null);
            string ringName = Kit.Str(row, "ringName");
            var args = new JObject
            {
                ["promotionId"] = promotionId,
                ["personId"] = Kit.Str(row, "personId"),
                ["kind"] = perAppearance ? "perAppearance" : "written",
            };
            double value = perAppearance ? Kit.Num(row, "askPerAppearance") ?? 0 : Kit.Num(row, "askMonthly") ?? 0;
            // The Why? loads their ask when opened (the list has the plain numbers only).
            UI.Why.WhyButton why = AskWhy($"{ringName}'s ask", value, args, perAppearance ? "perAppearanceFee" : "monthlyWage");
            return ContractUi.Value(text, why, "ds-cell__text", "ds-cell__text--num");
        }

        /// <summary>A Why? that reads one traced field of <c>contracts.askingTerms</c> when opened.</summary>
        internal static UI.Why.WhyButton AskWhy(string label, double value, JObject args, string field)
        {
            EngineGame game = Kit.Game;
            if (game == null) return null;
            UI.Why.WhySource source = UI.Why.WhySource.FromLoader(done => game.Client.Query("contracts.askingTerms", args).Then(
                result =>
                {
                    JToken trace = result.Ok ? Kit.Obj(result.Data, field + ".trace") : null;
                    if (trace == null)
                    {
                        done(UI.Why.TraceLoadResult.Failed(result.Ok ? "No breakdown for that number." : result.ReasonText));
                        return;
                    }
                    var answer = new JObject { ["value"] = Kit.Obj(result.Data, field + ".value"), ["trace"] = trace };
                    done(UI.Why.TraceReader.ReadExplainAnswer(answer.ToString(Newtonsoft.Json.Formatting.None)));
                },
                error => done(UI.Why.TraceLoadResult.Failed(error.Message))));
            return new UI.Why.WhyButton(label, UI.Why.TraceValue.Of(value), source, "money") { PanelTitle = label };
        }

        private VisualElement FreeAgentAction(JToken row)
        {
            string personId = Kit.Str(row, "personId");
            string negotiationId = Kit.Str(row, "openNegotiationId");
            if (negotiationId != null)
            {
                Button open = Ds.Button("Open talks", () => NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId)), DsButtonKind.Secondary);
                open.name = "offer-" + personId;
                return open;
            }
            Button offer = Ds.Button("Make offer", () => NegotiationSheet.Open(Root, NegotiationTarget.Signing(personId)), DsButtonKind.Primary);
            offer.name = "offer-" + personId;
            if (Kit.Str(row, "cooldownUntil") is string until)
            {
                offer.SetEnabled(false);
                VisualElement wrap = Ds.El("ct-choice-wrap");
                wrap.Add(offer);
                DsTooltip.Attach(wrap, ContractText.CooldownReason(until), "Make offer");
                return wrap;
            }
            return offer;
        }

        private void OpenFreeAgent(JToken row)
        {
            string negotiationId = Kit.Str(row, "openNegotiationId");
            if (negotiationId != null) NegotiationSheet.Open(Root, NegotiationTarget.Talks(negotiationId));
            else if (Kit.Str(row, "cooldownUntil") == null) NegotiationSheet.Open(Root, NegotiationTarget.Signing(Kit.Str(row, "personId")));
        }

        private List<DsColumn<JToken>> OfferColumns() => new List<DsColumn<JToken>>
        {
            NameColumn("Worker"),
            new DsColumn<JToken>("kind", "Kind", row => Ds.Tag(Kit.Str(row, "kind") == "renewal" ? "Renewal" : "New"))
            {
                Width = 100, SortKey = row => Kit.Str(row, "kind") ?? string.Empty,
            },
            new DsColumn<JToken>("status", "Status", row =>
            {
                VisualElement cell = Ds.Row("ct-chips");
                if (Kit.Bool(row, "answerUnseen")) cell.Add(Ds.Pill(DsState.Live, "New answer", "bell", solid: true));
                string status = Kit.Str(row, "status");
                VisualElement pill = Ds.Pill(ContractText.OfferState(status), ContractText.OfferStatus(row));
                DsTooltip.Attach(pill, ContractText.OfferStatus(row));
                cell.Add(pill);
                UI.Why.WhyButton why = ContractWhy.Words($"{Kit.Str(row, "ringName")}'s decision", ContractText.OfferStatus(row), Kit.Obj(row, "reviewTrace"));
                if (why != null) cell.Add(why);
                return cell;
            }) { Grow = 2.6f, MinWidth = 220, SortKey = row => ContractText.OfferStatusRank(Kit.Str(row, "status")) },
            new DsColumn<JToken>("terms", "On the table", row => ContractUi.Cell(ContractText.OnTheTable(row)))
            {
                Grow = 2.2f, MinWidth = 200, SortKey = row => ContractText.OnTheTableValue(row),
            },
            new DsColumn<JToken>("due", "Next", row => ContractText.OfferDue(row) is string due ? ContractUi.Cell(due) : ContractUi.Muted(ContractText.NoValue))
            {
                Width = 170, SortKey = row => Kit.Str(row, "status") == "awaitingReview" ? Kit.Str(row, "reviewOn") ?? string.Empty : Kit.Str(row, "counterExpiresOn") ?? string.Empty,
            },
            new DsColumn<JToken>("round", "Round", row => ContractUi.NumCell(Kit.Whole(Kit.Num(row, "round"))))
            {
                Width = 80, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row, "round") ?? 0,
            },
            new DsColumn<JToken>("patience", "Patience", row => ContractUi.Cell(ContractText.Patience(Kit.Num(row, "patienceLeft") ?? 0, Kit.Num(row, "startPatience") ?? 0)))
            {
                Grow = 1.4f, Default = false, SortKey = row => Kit.Num(row, "patienceLeft") ?? 0,
            },
        };

        // ---- Sheets ---------------------------------------------------------------------------------

        public void OpenContract(string employmentId)
        {
            if (employmentId == null) return;
            ContractSheet.Open(Root, employmentId, Rules, this);
        }
    }
}
