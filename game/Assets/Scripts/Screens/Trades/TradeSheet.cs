using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Trades
{
    /// <summary>What the trade sheet opens on: a new offer (maybe with a rival and a worker picked) or a trade.</summary>
    public sealed class TradeTarget
    {
        private TradeTarget() { }

        public string TradeId { get; private set; }
        public string PartnerId { get; private set; }
        /// <summary>A worker to start the offer with (yours goes to You give, theirs to You get).</summary>
        public string PersonId { get; private set; }

        public static TradeTarget New(string partnerId = null, string personId = null) => new TradeTarget { PartnerId = partnerId, PersonId = personId };
        public static TradeTarget Trade(string tradeId) => new TradeTarget { TradeId = tradeId };

        public override string ToString() => TradeId != null ? "trade:" + TradeId : $"new:{PartnerId}:{PersonId}";
    }

    /// <summary>
    /// The trade sheet (TRD-02), built like the contract Negotiation sheet: pick a rival, put workers
    /// and cash on You give and You get, and read how the rival feels (a meter and plain lines) and
    /// what each worker says about the move, each with a quiet Why?, live from
    /// <c>trades.preview</c>. Send offer, and the answer comes after the next day. An open trade
    /// shows the rival's answer with its Why?; a counter or a rival's own offer can be accepted,
    /// refused, or changed and sent back (<c>trades.respond</c>). Opening a trade marks it seen
    /// (<c>trades.markSeen</c>), which clears its day stop.
    /// </summary>
    public static class TradeSheet
    {
        public static TradeSheetView Current { get; private set; }

        private static StyleSheet sheet;

        /// <summary>Adds the trade styles (Resources/Trades/Trades.uss) and the contract styles they build on.</summary>
        public static void Style(VisualElement element)
        {
            ContractUi.Style(element);
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Trades/Trades");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        public static TradeSheetView Open(VisualElement anchor, TradeTarget target)
        {
            anchor ??= ShellController.Current?.Overlay?.Layer;
            if (anchor == null || target == null) return null;
            Current?.Close();
            var view = new TradeSheetView(anchor, target);
            if (!view.IsOpen) return null;
            Current = view;
            view.Closed += () =>
            {
                if (Current == view) Current = null;
            };
            return view;
        }

        public static TradeSheetView OpenTrade(VisualElement anchor, string tradeId) => Open(anchor, TradeTarget.Trade(tradeId));

        /// <summary>"Propose a trade" on a rival promotion's page.</summary>
        public static TradeSheetView ProposeTo(string promotionId, VisualElement anchor = null) => Open(anchor, TradeTarget.New(promotionId));

        /// <summary>
        /// "Offer in a trade" on a worker's profile or quick look: the sheet with them picked, on
        /// You give when they work for you, else on You get with their promotion as the rival.
        /// Returns null when it opened, else why not.
        /// </summary>
        public static async Task<string> OfferWorker(string personId, VisualElement anchor = null)
        {
            EngineGame game = Kit.Game;
            if (game?.PromotionId == null) return "Run a promotion to trade.";
            QueryResult<JToken> profile = await game.Client.Query("workers.profile", new JObject { ["personId"] = personId });
            JToken header = profile.Ok ? Kit.Obj(profile.Data, "header") : null;
            string employer = Kit.Str(header, "employer.promotionId");
            if (employer == null) return "They're a free agent: offer them a contract instead.";
            bool yours = Kit.Bool(header, "employer.isViewers") || employer == game.PromotionId;
            return Open(anchor, TradeTarget.New(yours ? null : employer, personId)) == null ? "The trade sheet could not open." : null;
        }

        /// <summary>The worker's "Offer in a trade" button, or null when they have no promotion to trade them from.</summary>
        public static Button OfferButton(string personId, JToken header, Action before = null, DsButtonKind kind = DsButtonKind.Secondary)
        {
            if (Kit.Game?.PromotionId == null || personId == null || Kit.Str(header, "employer.promotionId") == null) return null;
            Button button = null;
            button = Ds.Button(TradeText.OfferInTradeLabel, async () =>
            {
                before?.Invoke();
                string refused = await OfferWorker(personId);
                if (refused != null) DsOverlay.Toast(ShellController.Current?.Overlay?.Layer, refused, DsState.Warn);
            }, kind, "handshake");
            button.name = "worker-trade-action";
            return button;
        }
    }

    /// <summary>One open trade sheet: its draft or trade, the live preview and the commands.</summary>
    public sealed class TradeSheetView
    {
        private const long PreviewDelayMs = 220;

        private readonly VisualElement anchor;
        private readonly OverlayHandle handle;
        private readonly VisualElement body;
        private readonly VisualElement footer;
        private readonly Label title;
        private readonly HashSet<string> expanded = new HashSet<string>();
        private readonly List<string> errors = new List<string>();
        private readonly Dictionary<string, JToken> candidates = new Dictionary<string, JToken>();
        private readonly Dictionary<string, (string imageRef, string alignment)> faces = new Dictionary<string, (string, string)>();
        private readonly Dictionary<string, VisualElement> sayHosts = new Dictionary<string, VisualElement>();
        private readonly Dictionary<string, (int side, int position)> places = new Dictionary<string, (int, int)>();
        private List<JToken> rivals = new List<JToken>();
        private List<JToken> mine = new List<JToken>();
        private List<JToken> theirs = new List<JToken>();
        private TradeTarget target;
        private string promotionId;
        private string pendingPerson;
        private TradeDraft draft;
        private JToken trade;
        private JToken preview;
        private string previewKey;
        private bool previewPending;
        private int previewVersion;
        private IVisualElementScheduledItem previewTimer;
        private string notice;
        private bool busy;
        private VisualElement readHost;
        private VisualElement problemsHost;
        private Label footerReaction;
        private Button sendButton;
        private ContractUi.Field giveCashField;
        private ContractUi.Field getCashField;
        private Label getCashHint;

        internal TradeSheetView(VisualElement anchor, TradeTarget target)
        {
            this.anchor = anchor;
            this.target = target;
            body = Ds.Column("tr-sheet").Named("trade-sheet");
            TradeSheet.Style(body);
            footer = Ds.Row("tr-footer").Named("trade-footer");
            handle = DsOverlay.SideSheet(anchor, "Trade", body, "TRADE", footer, 980f);
            if (handle == null) return;
            TradeSheet.Style(handle.Entry);
            title = handle.Entry.Q<Label>(className: "ds-overlay-header__title");
            handle.Closed += () =>
            {
                previewTimer?.Pause();
                Closed?.Invoke();
            };
            body.Add(Ds.Loading("Loading the trade…"));
            _ = Load();
        }

        public bool IsOpen => handle != null && handle.IsOpen;
        public event Action Closed;
        public void Close() => handle?.Close();
        public VisualElement Root => body;

        /// <summary>The offer being built (new or a counter), else null.</summary>
        public TradeDraft Draft => draft;
        /// <summary>The trade on show (<c>trades.get</c>), else null.</summary>
        public JToken Trade => trade;
        /// <summary>The last preview of the draft (<c>trades.preview</c>).</summary>
        public JToken Preview => preview;
        /// <summary>True once the preview answers the draft as it stands.</summary>
        public bool PreviewCurrent => draft != null && preview != null && !previewPending && previewKey == draft.Key;
        public bool Busy => busy;
        /// <summary>True while the sheet loads its trade or draft (tours wait for it).</summary>
        public bool Loading { get; private set; }
        public string Notice => notice;
        public IReadOnlyList<string> Errors => errors;
        public IReadOnlyList<JToken> Rivals => rivals;
        /// <summary>Your workers as this rival sees them (<c>trades.candidates</c>), best value first.</summary>
        public IReadOnlyList<JToken> Mine => mine;
        /// <summary>The rival's workers, best value first.</summary>
        public IReadOnlyList<JToken> Theirs => theirs;

        // ---- Loading ---------------------------------------------------------------------------------

        private async Task Load()
        {
            Loading = true;
            try
            {
                await LoadInner();
            }
            finally
            {
                Loading = false;
            }
        }

        private async Task LoadInner()
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            promotionId = game.PromotionId;
            if (promotionId == null)
            {
                ShowLine("Run a promotion to trade.");
                return;
            }
            if (rivals.Count == 0)
            {
                QueryResult<JToken> list = await game.Client.Query("promotions.list");
                rivals = Kit.Arr(list.Data)
                    .Where(row => Kit.Str(row, "controlledBy") == "computer" && Kit.Str(row, "status") == "active")
                    .OrderBy(row => Kit.Str(row, "name"), StringComparer.OrdinalIgnoreCase).ToList();
            }
            if (target.TradeId != null)
            {
                await LoadTrade(target.TradeId);
                return;
            }
            draft = new TradeDraft(promotionId, null);
            pendingPerson = target.PersonId;
            if (target.PartnerId != null) await SetRival(target.PartnerId);
            else Draw();
        }

        private async Task LoadTrade(string tradeId)
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> result = await game.Client.Query("trades.get", new JObject { ["tradeId"] = tradeId });
            if (!IsOpen) return;
            if (!result.Ok || result.Data == null || result.Data.Type == JTokenType.Null)
            {
                ShowLine("That trade could not be found.");
                return;
            }
            trade = result.Data;
            draft = null;
            preview = null;
            // Seeing the trade is reading its answer: it clears the day's trade stop.
            if (Kit.Bool(trade, "stopsSkip"))
            {
                await game.Client.Command("trades.markSeen", new JObject { ["tradeIds"] = new JArray(tradeId) });
            }
            await LoadFaces(Kit.Str(trade, "otherId"));
            Draw();
        }

        /// <summary>Picks the rival: loads both sides' workers and starts the offer over on their side.</summary>
        public async Task SetRival(string partnerId)
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null || partnerId == null) return;
            draft.SetPartner(partnerId);
            preview = null;
            errors.Clear();
            await LoadCandidates(partnerId);
            if (!IsOpen) return;
            if (pendingPerson != null)
            {
                JToken mineRow = mine.FirstOrDefault(row => Kit.Str(row, "personId") == pendingPerson);
                JToken theirRow = theirs.FirstOrDefault(row => Kit.Str(row, "personId") == pendingPerson);
                if (mineRow != null) draft.Add(Kit.Str(mineRow, "employmentId"), true);
                else if (theirRow != null) draft.Add(Kit.Str(theirRow, "employmentId"), false);
                pendingPerson = null;
            }
            Draw();
            SchedulePreview(0);
        }

        private async Task LoadCandidates(string partnerId)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> yours = await client.Query("trades.candidates", new JObject { ["promotionId"] = promotionId, ["partnerId"] = partnerId, ["limit"] = 500 });
            QueryResult<JToken> others = await client.Query("trades.candidates", new JObject { ["promotionId"] = partnerId, ["partnerId"] = promotionId, ["limit"] = 500 });
            mine = Kit.Arr(yours.Data, "rows").ToList();
            theirs = Kit.Arr(others.Data, "rows").ToList();
            candidates.Clear();
            foreach (JToken row in mine.Concat(theirs)) candidates[Kit.Str(row, "employmentId")] = row;
            await LoadFaces(partnerId);
        }

        /// <summary>Pictures and sides for both rosters (the candidate rows carry no picture).</summary>
        private async Task LoadFaces(string partnerId)
        {
            EngineClient client = Kit.Game.Client;
            foreach (string id in new[] { promotionId, partnerId }.Where(id => id != null).Distinct())
            {
                QueryResult<JToken> roster = await client.Query("promotions.roster", new JObject { ["promotionId"] = id });
                foreach (JToken row in Kit.Arr(roster.Data, "rows"))
                {
                    if (Kit.Str(row, "personId") is string personId) faces[personId] = (Kit.Str(row, "imageRef"), Kit.Str(row, "alignment"));
                }
            }
        }

        private void ShowLine(string text)
        {
            body.Clear();
            footer.Clear();
            body.Add(Ds.Empty("handshake", text, null));
        }

        private JToken RivalRow(string id) => rivals.FirstOrDefault(row => Kit.Str(row, "promotionId") == id);
        private string RivalName => Kit.Str(RivalRow(draft?.PartnerId ?? Kit.Str(trade, "otherId")), "name") ?? Kit.Str(trade, "otherName") ?? "the rival";

        // ---- Preview ---------------------------------------------------------------------------------

        private void SchedulePreview(long delay)
        {
            if (draft?.PartnerId == null) return;
            previewPending = true;
            UpdateSendButton();
            previewTimer?.Pause();
            int version = ++previewVersion;
            previewTimer = body.schedule.Execute(() => _ = RunPreview(version));
            previewTimer.ExecuteLater(delay);
        }

        private async Task RunPreview(int version)
        {
            EngineGame game = Kit.Game;
            if (game == null || draft?.PartnerId == null) return;
            string key = draft.Key;
            QueryResult<JToken> result = await game.Client.Query("trades.preview", draft.ToArgs(forPreview: true));
            if (version != previewVersion || !IsOpen) return;
            previewPending = false;
            if (result.Ok)
            {
                preview = result.Data;
                previewKey = key;
            }
            DrawLive();
        }

        // ---- Drawing ---------------------------------------------------------------------------------

        private void Draw()
        {
            if (!IsOpen) return;
            body.Clear();
            footer.Clear();
            sayHosts.Clear();
            places.Clear();
            readHost = null;
            problemsHost = null;
            footerReaction = null;
            sendButton = null;
            if (draft != null) DrawBuild();
            else if (trade != null) DrawTrade();
        }

        private void SetTitle(string text)
        {
            if (title != null) title.text = TextFormat.Upper(text);
        }

        private void DrawNotices()
        {
            if (notice != null) body.Add(ContractUi.Notice(DsState.Good, notice, "check-circle").Named("trade-notice"));
            foreach (string error in errors.Where(error => !string.IsNullOrEmpty(error)).Distinct()) body.Add(ContractUi.Notice(DsState.Bad, error).Named("trade-error"));
        }

        /// <summary>The offer being built: rival, the read on it, then the two sides.</summary>
        private void DrawBuild()
        {
            bool counter = draft.TradeId != null;
            SetTitle(draft.PartnerId == null ? "New trade" : counter ? $"Change the trade with {RivalName}" : $"Trade with {RivalName}");
            DrawNotices();

            VisualElement rivalRow = Ds.Row("tr-rival").Named("trade-rival-row");
            JToken rival = RivalRow(draft.PartnerId);
            if (rival != null) rivalRow.Add(W.Logo(Kit.Str(rival, "logoRef"), Kit.Str(rival, "shortName"), Kit.Str(rival, "color"), "ds-logo--md"));
            VisualElement words = Ds.Column("tr-rival__words");
            words.Add(Ds.Text("TRADE WITH", "ct-field__label"));
            if (counter)
            {
                words.Add(Ds.Text(RivalName, "tr-rival__name"));
            }
            else
            {
                var options = rivals.Select(row => (Kit.Str(row, "promotionId"), Kit.Str(row, "name"), $"{W.Int(Kit.Num(row, "rosterCount"))} on the roster")).ToList();
                Button picker = ScreenDs.Picker(rival == null ? "Pick a rival promotion" : Kit.Str(rival, "name"), options, id => _ = SetRival(id), searchable: options.Count > 8, name: "trade-rival");
                words.Add(picker);
            }
            rivalRow.Add(words);
            body.Add(rivalRow);

            if (draft.PartnerId == null)
            {
                string who = pendingPerson != null
                    ? "Pick who you'd trade them to, then add what you want back."
                    : "Pick who you'd trade with, then add workers and cash to each side.";
                body.Add(Ds.Empty("handshake", "Pick a rival promotion", who).Named("trade-pick-rival"));
                DrawFooter();
                return;
            }

            // The decision first: how they'd take it.
            readHost = Ds.Column("ct-meter-host", "tr-read").Named("trade-read");
            body.Add(readHost);
            problemsHost = Ds.Column("tr-problems").Named("trade-problems");
            body.Add(problemsHost);

            VisualElement columns = Ds.Row("ds-row--top", "tr-columns");
            columns.Add(SideColumn(true));
            columns.Add(SideColumn(false));
            body.Add(columns);
            body.Add(Ds.Text("Each worker can get one contract change (pay or length) under More terms. Cash goes one way only.", "ct-quiet", "ds-wrap"));
            if (counter) DrawHistory();
            DrawFooter();
            DrawLive();
        }

        private VisualElement SideColumn(bool yours)
        {
            VisualElement column = Ds.Column("tr-side", yours ? "tr-side--give" : "tr-side--get").Named(yours ? "trade-give" : "trade-get");
            column.Add(Ds.SectionHeader(yours ? "You give" : "You get"));
            IReadOnlyList<string> ids = yours ? draft.Give : draft.Get;
            int position = 0;
            foreach (string id in ids)
            {
                places[id] = (yours ? 0 : 1, position++);
                column.Add(WorkerCard(id, yours));
            }
            if (ids.Count == 0) column.Add(Ds.Text("Nobody yet.", "ct-quiet", "tr-side__empty"));
            Button add = Ds.Button(yours ? "Add one of yours" : "Add one of theirs", null, DsButtonKind.Ghost, "add");
            add.name = yours ? "trade-add-give" : "trade-add-get";
            add.clicked += () => OpenWorkerPicker(add, yours);
            add.SetEnabled(!busy && !draft.IsFull(yours));
            if (draft.IsFull(yours)) DsTooltip.Attach(add, $"Up to {TradeDraft.MaxPerSide} workers a side");
            column.Add(add);

            var cash = new ContractUi.Field(yours ? "Cash you send" : "Cash they send", ContractText.DollarsText(yours ? draft.GiveCash : draft.GetCash), text =>
            {
                long cents = ContractText.ParseDollars(text) ?? 0;
                draft.SetCash(yours, cents);
                if (cents > 0)
                {
                    ContractUi.Field other = yours ? getCashField : giveCashField;
                    other?.Input.SetValueWithoutNotify("0");
                }
                SchedulePreview(PreviewDelayMs);
            }, yours ? "Optional" : null, null, yours ? "trade-give-cash" : "trade-get-cash", "$");
            cash.SetEnabled(!busy);
            if (yours) giveCashField = cash;
            else
            {
                getCashField = cash;
                getCashHint = Ds.Text(string.Empty, "ct-field__hint").Named("trade-cash-limit");
                cash.Add(getCashHint);
            }
            column.Add(cash);
            return column;
        }

        private VisualElement WorkerCard(string employmentId, bool yours)
        {
            candidates.TryGetValue(employmentId, out JToken row);
            string name = Kit.Str(row, "name") ?? "Worker";
            string personId = Kit.Str(row, "personId");
            faces.TryGetValue(personId ?? string.Empty, out (string imageRef, string alignment) face);
            bool champion = Kit.Arr(row, "titleIds").Any();

            VisualElement card = Ds.Column("tr-worker").Named("trade-worker-" + employmentId);
            VisualElement top = Ds.Row("tr-worker__top");
            top.Add(ContractUi.Portrait(face.imageRef, "ds-portrait--sm", champion, name));
            VisualElement words = Ds.Column("tr-worker__words");
            VisualElement nameRow = Ds.Row("tr-worker__name-row");
            nameRow.Add(Ds.Text(name, "tr-worker__name"));
            if (champion) nameRow.Add(new Icon("crown", "ds-icon--xs", "ct-name-cell__crown"));
            if (Kit.Bool(row, "noTradeClause")) nameRow.Add(Ds.Tag("No-trade clause"));
            words.Add(nameRow);
            Label facts = Ds.Text(TradeText.WorkerFacts(row), "tr-worker__facts");
            DsTooltip.Attach(facts, TradeText.WorkerFacts(row));
            words.Add(facts);
            top.Add(words);
            Button remove = Ds.IconButton("close", $"Take {name} out", () =>
            {
                draft.Remove(employmentId);
                expanded.Remove(employmentId);
                Draw();
                SchedulePreview(0);
            });
            remove.name = "trade-remove-" + employmentId;
            remove.SetEnabled(!busy);
            top.Add(remove);
            card.Add(top);

            // Their say and any rule they break, filled in by the preview.
            VisualElement say = Ds.Column("tr-worker__say");
            sayHosts[employmentId] = say;
            card.Add(say);

            bool open = expanded.Contains(employmentId);
            Button more = Ds.Button(open ? "Fewer terms" : draft.HasChange(employmentId) ? "More terms (changed)" : "More terms", () =>
            {
                if (!expanded.Add(employmentId)) expanded.Remove(employmentId);
                Draw();
            }, DsButtonKind.Ghost, open ? "chevron-up" : "chevron-down");
            more.name = "trade-more-" + employmentId;
            more.AddToClassList("tr-worker__more");
            card.Add(more);
            if (open) card.Add(MoreTerms(employmentId, row));
            return card;
        }

        private VisualElement MoreTerms(string employmentId, JToken row)
        {
            VisualElement more = Ds.Column("ct-offer__more", "tr-terms").Named("trade-terms-" + employmentId);
            long? pay = draft.PayChange(employmentId);
            var payField = new ContractUi.Field($"New {TradeText.PayLabel(row).ToLowerInvariant()}", pay.HasValue ? ContractText.DollarsText(pay.Value) : string.Empty, text =>
            {
                draft.SetPay(employmentId, ContractText.ParseDollars(text));
                SchedulePreview(PreviewDelayMs);
            }, $"Now {TradeText.PayText(row)}. Leave it empty to keep it.", "Keep", "trade-pay-" + employmentId, "$");
            payField.SetEnabled(!busy);
            more.Add(payField);
            int months = draft.LengthChange(employmentId) ?? 0;
            more.Add(new ContractUi.ChoiceGroup<int>("New length",
                TradeText.LengthChoices.Select(choice => (choice, TradeText.LengthChoiceLabel(choice), !busy, (string)null)), months, choice =>
                {
                    draft.SetLength(employmentId, choice);
                    SchedulePreview(PreviewDelayMs);
                }, "trade-length-" + employmentId));
            double? left = Kit.Num(row, "contract.monthsLeft");
            more.Add(Ds.Text(left.HasValue ? $"{TradeText.MonthsText(left.Value)} left now; a new length runs from the trade day." : "Open-ended now.", "ct-field__hint"));
            return more;
        }

        /// <summary>Fills what the preview decides: the rival's read, the rules broken, each worker's say.</summary>
        private void DrawLive()
        {
            if (!IsOpen || draft == null || readHost == null) return;
            readHost.Clear();
            problemsHost.Clear();
            JToken rival = Kit.Obj(preview, "rival");
            VisualElement head = Ds.Row("ct-meter__head");
            head.Add(Ds.Text("HOW THEY'D TAKE IT", "ct-field__label"));
            head.Add(Ds.Spacer());
            if (previewPending) head.Add(Ds.Text("updating…", "ct-quiet"));
            readHost.Add(head);
            if (preview == null || rival == null)
            {
                readHost.Add(Ds.Text(draft.HasWorkers ? "Working out how they'd take it…" : "Add a worker to either side to see how they'd take it.", "ct-quiet"));
            }
            else
            {
                string lean = Kit.Str(rival, "lean");
                DsState state = TradeText.LeanState(lean);
                string label = TradeText.LeanLabel(lean);
                VisualElement reaction = Ds.Row("ct-meter__reaction", Ds.StateClass(state)).Named("trade-lean");
                reaction.Add(new Icon(Ds.StateIcon(state), "ds-icon--lg", "ct-meter__icon"));
                reaction.Add(Ds.Text(TextFormat.Upper(label), "ct-meter__label"));
                WhyButton why = ContractWhy.Words($"{RivalName}'s answer", label, Kit.Obj(rival, "trace"));
                if (why != null) reaction.Add(why);
                readHost.Add(reaction);
                readHost.Add(Ds.Meter(TradeText.MeterFraction(lean, Kit.Num(rival, "shortfall") ?? 0), state, TradeText.LikelyLine(Kit.Str(rival, "likely"), RivalName)));
                foreach (JToken line in Kit.Arr(rival, "lines")) readHost.Add(Ds.Text("• " + (string)line, "ct-meter__note", "ds-wrap"));
                if (getCashHint != null && Kit.Num(rival, "cashLimit") is double limit)
                {
                    getCashHint.text = $"They'd pay out {ContractText.Money(limit)} at most";
                }
            }

            List<JToken> problems = Kit.Arr(preview, "problems").ToList();
            var placed = new HashSet<JToken>();
            foreach (KeyValuePair<string, VisualElement> entry in sayHosts)
            {
                VisualElement host = entry.Value;
                host.Clear();
                string id = entry.Key;
                candidates.TryGetValue(id, out JToken row);
                string name = Kit.Str(row, "name");
                JToken worker = Kit.Arr(preview, "offer.sides").SelectMany(side => Kit.Arr(side, "workers")).FirstOrDefault(item => Kit.Str(item, "employmentId") == id);
                JToken say = Kit.Obj(worker, "say");
                if (say != null)
                {
                    DsState sayState = TradeText.SayState(say);
                    string line = Kit.Str(say, "line") ?? string.Empty;
                    VisualElement sayRow = Ds.Row("tr-say", Ds.StateClass(sayState)).Named("trade-say-" + id);
                    sayRow.Add(Ds.Dot(sayState, line));
                    if (TradeText.MoraleWords(Kit.Num(say, "moraleChange")) is string morale) sayRow.Add(Ds.Text(morale, "tr-say__morale"));
                    WhyButton why = ContractWhy.Words($"How {name ?? "they"} feel about the move", line, Kit.Obj(say, "trace"));
                    if (why != null) sayRow.Add(why);
                    host.Add(sayRow);
                }
                if (worker != null && draft.HasChange(id))
                {
                    string after = TradeText.PayText(worker, after: true);
                    string ends = Kit.Str(worker, "contract.endsOnAfter") is string end ? $" until {ContractText.Date(end)}" : " open-ended";
                    host.Add(Ds.Text($"With the change: {after}{ends}", "tr-worker__change"));
                }
                if (!places.TryGetValue(id, out (int side, int position) place)) continue;
                foreach (JToken problem in problems.Where(problem => TradeText.IsAbout(problem, place.side, place.position, id, name)))
                {
                    placed.Add(problem);
                    host.Add(ProblemLine(problem, id));
                }
            }
            foreach (JToken problem in problems.Where(problem => !placed.Contains(problem))) problemsHost.Add(ProblemLine(problem, null));
            UpdateSendButton();
        }

        /// <summary>A broken rule in plain words with its fix, and a button where one fixes it.</summary>
        private VisualElement ProblemLine(JToken problem, string employmentId)
        {
            string code = Kit.Str(problem, "code");
            VisualElement box = Ds.Column("tr-problem", Ds.StateClass(DsState.Bad)).Named("trade-problem-" + (code ?? "rule").Replace("trades.", string.Empty));
            VisualElement line = Ds.Row("tr-problem__line");
            line.Add(new Icon("warning", "ds-icon--sm", "ct-notice__icon"));
            line.Add(Ds.Text(TextFormat.Sentence(Kit.Str(problem, "message") ?? "This offer breaks a rule."), "ct-notice__text"));
            box.Add(line);
            VisualElement fixRow = Ds.Row("tr-problem__fix");
            if (TradeText.Fix(code) is string fix) fixRow.Add(Ds.Text(fix, "tr-problem__fix-text"));
            if (employmentId != null && TradeText.FixedByRemoving(code))
            {
                Button remove = Ds.Button("Take them out", () =>
                {
                    draft.Remove(employmentId);
                    Draw();
                    SchedulePreview(0);
                }, DsButtonKind.Ghost, "close");
                remove.name = "trade-fix-remove-" + employmentId;
                fixRow.Add(remove);
            }
            if (code == "trades.champion" && Kit.Str(problem, "subject.id") is string titleId && ScreenRegistry.IsLive("titles") && mine.Any(item => Kit.Str(item, "employmentId") == employmentId))
            {
                Button titles = Ds.Button("Open the title", () =>
                {
                    Close();
                    ShellController.Current?.Navigator.Go(Creative.TitlesScreen.TitleRoute(titleId));
                }, DsButtonKind.Ghost, "crown");
                titles.name = "trade-fix-title";
                fixRow.Add(titles);
            }
            if (code == "trades.talkOpen" && Kit.Str(problem, "subject.kind") == "trade" && Kit.Str(problem, "subject.id") is string tradeId)
            {
                Button openTrade = Ds.Button("Open that trade", () => _ = SwitchTo(tradeId), DsButtonKind.Ghost, "handshake");
                openTrade.name = "trade-fix-open";
                fixRow.Add(openTrade);
            }
            if (fixRow.childCount > 0) box.Add(fixRow);
            return box;
        }

        private void OpenWorkerPicker(VisualElement button, bool yours)
        {
            VisualElement content = Ds.Column("tr-picker").Named("trade-picker");
            TradeSheet.Style(content);
            content.Add(Ds.Text(yours ? "YOUR WORKERS" : $"{TextFormat.Upper(RivalName)}'S WORKERS", "ds-column-picker__title"));
            OverlayHandle popover = null;
            var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("tr-picker__scroll");
            List<JToken> rows = yours ? mine : theirs;
            void Fill(string filter)
            {
                scroll.Clear();
                int shown = 0;
                foreach (JToken row in rows)
                {
                    string name = Kit.Str(row, "name") ?? string.Empty;
                    if (!string.IsNullOrEmpty(filter) && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (shown++ >= 150) break;
                    string id = Kit.Str(row, "employmentId");
                    bool inDeal = draft.Contains(id);
                    string blocked = TradeText.BlockedWords(row);
                    var item = new Button(() =>
                    {
                        popover?.Close();
                        if (draft.Add(id, yours))
                        {
                            Draw();
                            SchedulePreview(0);
                        }
                    }) { text = string.Empty, name = "trade-pick-" + id };
                    item.AddToClassList("tr-picker__row");
                    VisualElement words = Ds.Column("tr-picker__words");
                    VisualElement top = Ds.Row("tr-picker__top");
                    top.Add(Ds.Text(name, "tr-picker__name"));
                    if (Kit.Bool(row, "noTradeClause")) top.Add(Ds.Tag("No-trade clause"));
                    words.Add(top);
                    words.Add(Ds.Text(blocked ?? (inDeal ? "In this offer" : TradeText.WorkerFacts(row)), blocked != null ? "tr-picker__blocked" : "tr-picker__facts"));
                    item.Add(words);
                    item.SetEnabled(blocked == null && !inDeal);
                    scroll.Add(item);
                }
                if (shown == 0) scroll.Add(Ds.Text("Nobody matches.", "ct-quiet"));
            }
            content.Add(ScreenDs.SearchBox("Find a worker", Fill, "trade-picker-search"));
            content.Add(scroll);
            Fill(null);
            popover = DsOverlay.Popover(button, content, alignRight: false);
        }

        private void DrawHistory()
        {
            List<JToken> rounds = Kit.Arr(trade, "history").ToList();
            if (rounds.Count == 0) return;
            VisualElement section = Ds.Column("ct-history").Named("trade-history");
            section.Add(Ds.SectionHeader("Offers so far"));
            foreach (JToken round in rounds)
            {
                bool you = Kit.Bool(round, "byYou");
                VisualElement row = Ds.Row("ct-history__row", you ? "ct-history__row--you" : "ct-history__row--worker");
                row.Add(new Icon(you ? "handshake" : "building", "ds-icon--sm", "ct-history__icon"));
                VisualElement words = Ds.Column("ct-history__words");
                words.Add(Ds.Text(RoundLine(round), "ct-history__line", "ds-wrap"));
                words.Add(Ds.Text(ContractText.Date(Kit.Str(round, "on")), "ct-quiet"));
                row.Add(words);
                section.Add(row);
            }
            body.Add(section);
        }

        private static string RoundLine(JToken round)
        {
            JToken offer = Kit.Obj(round, "offer");
            JToken mineSide = Kit.Arr(offer, "sides").FirstOrDefault(side => Kit.Bool(side, "isYou"));
            JToken theirSide = Kit.Arr(offer, "sides").FirstOrDefault(side => !Kit.Bool(side, "isYou"));
            string give = TradeText.SideWords(Kit.Arr(mineSide, "workers").Select(worker => Kit.Str(worker, "name")), Kit.Num(mineSide, "cash") ?? 0);
            string get = TradeText.SideWords(Kit.Arr(theirSide, "workers").Select(worker => Kit.Str(worker, "name")), Kit.Num(theirSide, "cash") ?? 0);
            return Kit.Bool(round, "byYou") ? $"You offered {give} for {get}" : $"{Kit.Str(theirSide, "name") ?? "They"} offered {get} for {give}";
        }

        /// <summary>A trade: where it stands, their answer with its Why?, the deal, and what moved.</summary>
        private void DrawTrade()
        {
            string status = Kit.Str(trade, "status");
            SetTitle($"Trade with {RivalName}");
            DsState state = TradeText.StatusState(trade);
            VisualElement banner = Ds.Row("ct-notice", "tr-banner", Ds.StateClass(state)).Named("trade-status");
            banner.Add(new Icon(TradeText.StatusIcon(trade), "ds-icon--md", "ct-notice__icon"));
            VisualElement bannerWords = Ds.Column("tr-banner__words");
            bannerWords.Add(Ds.Text(TradeText.Banner(trade, promotionId) ?? TradeText.StatusLabel(trade), "tr-banner__title", "ds-wrap"));
            if (TradeText.NextLine(trade) is string next) bannerWords.Add(Ds.Text(next, "tr-banner__next").Named("trade-next"));
            banner.Add(bannerWords);
            body.Add(banner);
            DrawNotices();

            JToken answer = Kit.Obj(trade, "answer");
            if (answer != null && Kit.Str(answer, "by") != promotionId)
            {
                VisualElement read = Ds.Column("ct-meter-host", "tr-read").Named("trade-answer");
                VisualElement head = Ds.Row("ct-meter__head");
                head.Add(Ds.Text("THEIR ANSWER", "ct-field__label"));
                head.Add(Ds.Spacer());
                head.Add(Ds.Text(ContractText.Date(Kit.Str(answer, "on")), "ct-quiet"));
                read.Add(head);
                string kind = Kit.Str(answer, "kind");
                DsState answerState = kind == "accept" ? DsState.Good : kind == "counter" ? DsState.Warn : DsState.Bad;
                VisualElement verdict = Ds.Row("ct-meter__reaction", Ds.StateClass(answerState));
                verdict.Add(new Icon(Ds.StateIcon(answerState), "ds-icon--lg", "ct-meter__icon"));
                verdict.Add(Ds.Text(TextFormat.Upper(TradeText.AnswerWord(kind)), "ct-meter__label"));
                WhyButton why = Kit.Obj(answer, "traceRef") is JObject traceRef ? ContractWhy.RefWords($"{RivalName}'s answer", TradeText.AnswerWord(kind), traceRef) : null;
                if (why != null) verdict.Add(why);
                read.Add(verdict);
                foreach (JToken line in Kit.Arr(answer, "lines")) read.Add(Ds.Text("• " + (string)line, "ct-meter__note", "ds-wrap"));
                body.Add(read);
            }

            if (status == "open")
            {
                List<JToken> problems = Kit.Arr(trade, "problems").ToList();
                foreach (JToken problem in problems) body.Add(ContractUi.Notice(DsState.Bad, TextFormat.Sentence(Kit.Str(problem, "message")) + (TradeText.Fix(Kit.Str(problem, "code")) is string fix ? " " + fix : string.Empty)).Named("trade-problem"));
            }

            VisualElement columns = Ds.Row("ds-row--top", "tr-columns");
            JToken offer = Kit.Obj(trade, "offer");
            columns.Add(ReadOnlySide(Kit.Arr(offer, "sides").FirstOrDefault(side => Kit.Bool(side, "isYou")), true, status));
            columns.Add(ReadOnlySide(Kit.Arr(offer, "sides").FirstOrDefault(side => !Kit.Bool(side, "isYou")), false, status));
            body.Add(columns);

            List<JToken> moves = Kit.Arr(trade, "moves").ToList();
            if (moves.Count > 0) body.Add(Moves(moves, offer));
            DrawHistory();
            DrawFooter();
        }

        private VisualElement ReadOnlySide(JToken side, bool yours, string status)
        {
            bool done = status == "completed";
            VisualElement column = Ds.Column("tr-side", yours ? "tr-side--give" : "tr-side--get").Named(yours ? "trade-give" : "trade-get");
            column.Add(Ds.SectionHeader(done ? (yours ? "You gave" : "You got") : (yours ? "You give" : "You get")));
            List<JToken> workers = Kit.Arr(side, "workers").ToList();
            if (workers.Count == 0) column.Add(Ds.Text("No workers.", "ct-quiet", "tr-side__empty"));
            foreach (JToken worker in workers)
            {
                string name = Kit.Str(worker, "name") ?? "Worker";
                faces.TryGetValue(Kit.Str(worker, "personId") ?? string.Empty, out (string imageRef, string alignment) face);
                VisualElement card = Ds.Column("tr-worker").Named("trade-worker-" + Kit.Str(worker, "employmentId"));
                VisualElement top = Ds.Row("tr-worker__top");
                top.Add(ContractUi.Portrait(face.imageRef, "ds-portrait--sm", Kit.Arr(worker, "titleIds").Any(), name));
                VisualElement words = Ds.Column("tr-worker__words");
                words.Add(Ds.Text(name, "tr-worker__name"));
                words.Add(Ds.Text(TradeText.WorkerFacts(worker, after: true), "tr-worker__facts"));
                if (Kit.Obj(worker, "adjustment") != null)
                {
                    string ends = Kit.Str(worker, "contract.endsOnAfter") is string end ? $" until {ContractText.Date(end)}" : " open-ended";
                    words.Add(Ds.Text($"Contract change: {TradeText.PayText(worker, after: true)}{ends}", "tr-worker__change"));
                }
                top.Add(words);
                card.Add(top);
                JToken say = Kit.Obj(worker, "say");
                if (say != null)
                {
                    DsState sayState = TradeText.SayState(say);
                    string line = Kit.Str(say, "line") ?? string.Empty;
                    VisualElement sayRow = Ds.Row("tr-say", Ds.StateClass(sayState));
                    sayRow.Add(Ds.Dot(sayState, line));
                    if (TradeText.MoraleWords(Kit.Num(say, "moraleChange")) is string morale) sayRow.Add(Ds.Text(morale, "tr-say__morale"));
                    WhyButton why = ContractWhy.Words($"How {name} feels about the move", line, Kit.Obj(say, "trace"));
                    if (why != null) sayRow.Add(why);
                    card.Add(sayRow);
                }
                column.Add(card);
            }
            double cash = Kit.Num(side, "cash") ?? 0;
            if (cash > 0) column.Add(Ds.Text($"{(yours ? (done ? "Cash you sent" : "Cash you send") : (done ? "Cash they sent" : "Cash they send"))}: {ContractText.Money(cash)}", "tr-cash-line").Named(yours ? "trade-give-cash-line" : "trade-get-cash-line"));
            return column;
        }

        private VisualElement Moves(List<JToken> moves, JToken offer)
        {
            var names = Kit.Arr(offer, "sides").ToDictionary(side => Kit.Str(side, "promotionId") ?? string.Empty, side => Kit.Str(side, "name"));
            VisualElement section = Ds.Column("tr-moves").Named("trade-moves");
            section.Add(Ds.SectionHeader("Who moved"));
            foreach (JToken move in moves)
            {
                string personId = Kit.Str(move, "personId");
                names.TryGetValue(Kit.Str(move, "toPromotionId") ?? string.Empty, out string to);
                VisualElement row = Ds.Row("tr-move");
                row.Add(new Icon("chevron-right", "ds-icon--sm", "tr-move__icon"));
                row.Add(Ds.Text($"{Kit.Str(move, "name")} joins {to ?? "their new promotion"}", "tr-move__text"));
                if (TradeText.MoraleWords(Kit.Num(move, "moraleChange")) is string morale) row.Add(Ds.Text(morale, "tr-say__morale"));
                row.Add(Ds.Spacer());
                if (ScreenRegistry.IsLive(ScreenIds.Worker) && personId != null)
                {
                    Button profile = Ds.Button("Profile", () =>
                    {
                        Close();
                        ShellController.Current?.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId));
                    }, DsButtonKind.Ghost, "user");
                    profile.AddToClassList("ds-btn--link");
                    row.Add(profile);
                }
                section.Add(row);
            }
            return section;
        }

        private void DrawFooter()
        {
            footer.Clear();
            footerReaction = null;
            sendButton = null;
            if (draft != null)
            {
                footerReaction = Ds.Text(string.Empty, "ct-neg__footer-reaction").Named("trade-footer-reaction");
                footer.Add(footerReaction);
                footer.Add(Ds.Spacer());
                if (draft.TradeId != null)
                {
                    Button back = Ds.Button("Keep their offer", () => _ = SwitchTo(draft.TradeId), DsButtonKind.Ghost);
                    back.name = "trade-cancel-changes";
                    back.SetEnabled(!busy);
                    footer.Add(back);
                }
                sendButton = Ds.Button(draft.TradeId != null ? "Send it back" : "Send offer", () => _ = Send(), DsButtonKind.Primary, "handshake");
                sendButton.name = draft.TradeId != null ? "trade-send-back" : "trade-send";
                footer.Add(sendButton);
                UpdateSendButton();
                return;
            }
            if (trade == null) return;
            footer.Add(Ds.Spacer());
            if (Kit.Bool(trade, "awaitingYou") && Kit.Str(trade, "status") == "open")
            {
                Button refuse = Ds.Button("Refuse", () => _ = Respond("refuse"), DsButtonKind.Danger);
                refuse.name = "trade-refuse";
                refuse.SetEnabled(!busy && Kit.Bool(trade, "canRefuse"));
                footer.Add(refuse);
                Button change = Ds.Button(TradeText.IsTheirOffer(trade) ? "Counter" : "Change and send back", StartCounter, DsButtonKind.Secondary, "edit");
                change.name = "trade-change";
                change.SetEnabled(!busy && Kit.Bool(trade, "canCounter"));
                footer.Add(change);
                Button accept = Ds.Button("Accept", () => _ = Respond("accept"), DsButtonKind.Primary, "check");
                accept.name = "trade-accept";
                accept.SetEnabled(!busy && Kit.Bool(trade, "canAccept"));
                footer.Add(accept);
                return;
            }
            if (Kit.Bool(trade, "canWithdraw"))
            {
                Button withdraw = Ds.Button("Withdraw offer", () => _ = Withdraw(), DsButtonKind.Danger);
                withdraw.name = "trade-withdraw";
                withdraw.SetEnabled(!busy);
                footer.Add(withdraw);
                return;
            }
            if (Kit.Str(trade, "status") != "open" && RivalRow(Kit.Str(trade, "otherId")) != null)
            {
                string other = Kit.Str(trade, "otherId");
                Button again = Ds.Button($"New offer to {RivalName}", () =>
                {
                    target = TradeTarget.New(other);
                    trade = null;
                    notice = null;
                    errors.Clear();
                    _ = Load();
                }, DsButtonKind.Secondary, "handshake");
                again.name = "trade-new";
                footer.Add(again);
            }
        }

        private void UpdateSendButton()
        {
            if (draft == null) return;
            List<JToken> problems = PreviewCurrent ? Kit.Arr(preview, "problems").ToList() : new List<JToken>();
            bool ready = !busy && draft.PartnerId != null && draft.HasWorkers && PreviewCurrent && problems.Count == 0;
            sendButton?.SetEnabled(ready);
            if (footerReaction == null) return;
            string lean = PreviewCurrent ? Kit.Str(preview, "rival.lean") : null;
            footerReaction.ClearClassList();
            footerReaction.AddToClassList("ct-neg__footer-reaction");
            if (!draft.HasWorkers || draft.PartnerId == null) footerReaction.text = string.Empty;
            else if (problems.Count > 0)
            {
                footerReaction.text = problems.Count == 1 ? "Fix the rule above to send it" : $"Fix the {problems.Count} rules above to send it";
                footerReaction.AddToClassList(Ds.StateClass(DsState.Bad));
            }
            else if (lean != null)
            {
                footerReaction.text = TradeText.LeanLabel(lean);
                footerReaction.AddToClassList(Ds.StateClass(TradeText.LeanState(lean)));
            }
            else footerReaction.text = string.Empty;
        }

        // ---- Commands --------------------------------------------------------------------------------

        private async Task SwitchTo(string tradeId)
        {
            target = TradeTarget.Trade(tradeId);
            errors.Clear();
            await Load();
        }

        /// <summary>"Change and send back" / "Counter": the offer on the table becomes a draft to change.</summary>
        public void StartCounter()
        {
            if (trade == null || Kit.Str(trade, "status") != "open") return;
            draft = TradeDraft.FromOffer(Kit.Obj(trade, "offer"), promotionId, Kit.Str(trade, "tradeId"));
            notice = null;
            errors.Clear();
            preview = null;
            _ = StartCounterAsync();
        }

        private async Task StartCounterAsync()
        {
            await LoadCandidates(draft.PartnerId);
            if (!IsOpen) return;
            Draw();
            SchedulePreview(0);
        }

        /// <summary>Send offer (a new trade) or Send it back (a counter). Null when it went, else the refusal.</summary>
        public async Task<string> Send()
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null || busy) return "Not ready.";
            busy = true;
            errors.Clear();
            notice = null;
            DrawFooter();
            bool counter = draft.TradeId != null;
            CommandResult<JToken> result = counter
                ? await game.Client.Command("trades.respond", draft.ToCounter())
                : await game.Client.Command("trades.propose", draft.ToArgs());
            busy = false;
            if (!IsOpen) return null;
            if (result.Ok)
            {
                string tradeId = Kit.Str(result.Data, "tradeId") ?? draft.TradeId;
                notice = counter ? $"Sent back to {RivalName}. Their answer comes after the next day." : $"Offer sent to {RivalName}. Their answer comes after the next day.";
                await SwitchTo(tradeId);
                return null;
            }
            EngineReason open = result.Reasons.FirstOrDefault(reason => reason.Code == "trades.talkOpen" && reason.Subject?.Kind == "trade");
            if (open != null)
            {
                notice = $"You already have a trade open with {RivalName}: here it is.";
                await SwitchTo(open.Subject.Id);
                return open.Message;
            }
            errors.AddRange(result.Reasons.Select(reason => TextFormat.Sentence(reason.Message)));
            Draw();
            SchedulePreview(0);
            return string.Join(" ", errors);
        }

        /// <summary>Accept or Refuse the offer waiting for you. Null when it went, else the refusal.</summary>
        public async Task<string> Respond(string answer)
        {
            EngineGame game = Kit.Game;
            if (game == null || trade == null || busy) return "Not ready.";
            busy = true;
            errors.Clear();
            DrawFooter();
            string tradeId = Kit.Str(trade, "tradeId");
            CommandResult<JToken> result = await game.Client.Command("trades.respond", new JObject { ["tradeId"] = tradeId, ["answer"] = answer });
            busy = false;
            if (!IsOpen) return null;
            if (!result.Ok)
            {
                errors.AddRange(result.Reasons.Select(reason => TextFormat.Sentence(reason.Message)));
                Draw();
                return string.Join(" ", errors);
            }
            notice = answer == "accept" ? "Trade done. The rosters are updated and the news has it." : "You turned the offer down.";
            if (answer == "accept") DsOverlay.Toast(anchor, $"Trade with {RivalName} done", DsState.Good);
            Loading = true;
            try
            {
                await LoadTrade(tradeId);
            }
            finally
            {
                Loading = false;
            }
            return null;
        }

        private async Task Withdraw()
        {
            EngineGame game = Kit.Game;
            if (game == null || trade == null) return;
            busy = true;
            DrawFooter();
            CommandResult<JToken> result = await game.Client.Command("trades.withdraw", new JObject { ["tradeId"] = Kit.Str(trade, "tradeId") });
            busy = false;
            if (!IsOpen) return;
            errors.Clear();
            if (result.Ok) notice = "You withdrew the offer.";
            else errors.AddRange(result.Reasons.Select(reason => reason.Message));
            await LoadTrade(Kit.Str(trade, "tradeId"));
        }

        // ---- Tour hooks ------------------------------------------------------------------------------

        /// <summary>Adds a worker as the picker would (tours).</summary>
        public void AddWorker(string employmentId, bool yours)
        {
            if (draft == null || !draft.Add(employmentId, yours)) return;
            Draw();
            SchedulePreview(0);
        }

        /// <summary>Clears both sides (tours).</summary>
        public void ClearOffer()
        {
            if (draft == null) return;
            foreach (string id in draft.Give.Concat(draft.Get).ToList()) draft.Remove(id);
            draft.SetCash(true, 0);
            draft.SetCash(false, 0);
            Draw();
            SchedulePreview(0);
        }

        /// <summary>Sets one side's cash as typing it would (tours).</summary>
        public void SetCash(bool yours, long cents)
        {
            if (draft == null) return;
            draft.SetCash(yours, cents);
            Draw();
            SchedulePreview(0);
        }

        /// <summary>Opens a worker's More terms (tours).</summary>
        public void ShowTerms(string employmentId)
        {
            if (expanded.Add(employmentId)) Draw();
        }
    }
}
