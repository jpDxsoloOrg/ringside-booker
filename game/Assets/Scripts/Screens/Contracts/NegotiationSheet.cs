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
using RingsideBooker.UI.Why;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>What the Negotiation sheet is open on.</summary>
    public sealed class NegotiationTarget
    {
        public enum Kinds
        {
            /// <summary>Your talks (<c>negotiationId</c>).</summary>
            Talks,
            /// <summary>A new offer to a worker (<c>personId</c>).</summary>
            Signing,
            /// <summary>A renewal of your contract (<c>employmentId</c>).</summary>
            Renewal,
        }

        private NegotiationTarget(Kinds kind, string id)
        {
            Kind = kind;
            Id = id;
        }

        public Kinds Kind { get; }
        public string Id { get; }

        public static NegotiationTarget Talks(string negotiationId) => new NegotiationTarget(Kinds.Talks, negotiationId);
        public static NegotiationTarget Signing(string personId) => new NegotiationTarget(Kinds.Signing, personId);
        public static NegotiationTarget Renewal(string employmentId) => new NegotiationTarget(Kinds.Renewal, employmentId);

        public override string ToString() => $"{Kind}:{Id}";
    }

    /// <summary>
    /// The Negotiation sheet (ECO5-06 on the web) in the Windows game (UNITY-17): a new offer to a
    /// worker, a renewal of your contract, or your talks. Their ask sits beside your offer, each
    /// number with its Why?, and the engine's reaction meter answers as you change the terms. The
    /// footer has the phase's buttons: Submit offer / Offer renewal; Accept counter, Send revised
    /// offer, End talks; Withdraw offer. Opening talks whose answer you have not read marks it seen
    /// (<c>contracts.markOffersSeen</c>), which clears the day's "Offer answered" stop. An accepted
    /// counter signs at once (ECO5-10). The engine decides everything; the sheet only shows it.
    /// </summary>
    public static class NegotiationSheet
    {
        /// <summary>The sheet open now, if any (tours and the skip check press its buttons).</summary>
        public static NegotiationView Current { get; private set; }

        public static NegotiationView Open(VisualElement anchor, NegotiationTarget target)
        {
            if (anchor == null || target?.Id == null) return null;
            Current?.Close();
            var view = new NegotiationView(anchor, target);
            if (!view.IsOpen) return null;
            Current = view;
            view.Closed += () =>
            {
                if (Current == view) Current = null;
            };
            return view;
        }

        /// <summary>Your live contract with <paramref name="personId"/> (from <c>contracts.list</c>), or null.</summary>
        internal static async Task<JToken> OwnContractOf(EngineClient client, string personId)
        {
            QueryResult<JToken> active = await client.Query("contracts.list", new JObject { ["tab"] = "active" });
            return Kit.Arr(active.Data).FirstOrDefault(row =>
                Kit.Str(row, "personId") == personId && (Kit.Str(row, "status") == "active" || Kit.Str(row, "status") == "signed"));
        }

        /// <summary>The profile's entry point (<see cref="ContractsScreen.OpenNegotiation"/>).</summary>
        internal static async Task<string> OpenForPerson(VisualElement anchor, string personId, string kind)
        {
            EngineGame game = Kit.Game;
            if (game == null) return "No game is running.";
            if (game.PromotionId == null) return "Run a promotion to talk contracts.";
            if (anchor == null) return "There is no screen to open the talks on.";
            if (string.IsNullOrEmpty(personId)) return "No worker given.";
            EngineClient client = game.Client;
            kind = (kind ?? "auto").ToLowerInvariant();
            if (kind == "auto" || kind == "talks")
            {
                QueryResult<JToken> open = await client.Query("contracts.offers", new JObject { ["promotionId"] = game.PromotionId, ["status"] = "open" });
                string negotiationId = Kit.Arr(open.Data).Where(row => Kit.Str(row, "personId") == personId).Select(row => Kit.Str(row, "negotiationId")).FirstOrDefault();
                if (negotiationId != null)
                {
                    Open(anchor, NegotiationTarget.Talks(negotiationId));
                    return null;
                }
            }
            if (kind == "auto" || kind == "renew" || kind == "renewal" || kind == "talks")
            {
                JToken own = await OwnContractOf(client, personId);
                if (own != null)
                {
                    Open(anchor, NegotiationTarget.Renewal(Kit.Str(own, "employmentId")));
                    return null;
                }
                if (kind != "auto") return "They are not under contract with you.";
            }
            Open(anchor, NegotiationTarget.Signing(personId));
            return null;
        }
    }

    /// <summary>One open Negotiation sheet: loads its target, draws, and runs the offer commands.</summary>
    public sealed class NegotiationView
    {
        private const long PreviewDelayMs = 250;

        private readonly VisualElement anchor;
        private readonly OverlayHandle handle;
        private readonly VisualElement body;
        private readonly VisualElement footer;
        private readonly Label title;
        private readonly HashSet<string> markedSeen = new HashSet<string>();
        private NegotiationTarget target;
        private string promotionId;
        private ContractRules rules = ContractRules.Defaults;
        private JToken header;
        private string currentDeal;
        private string situation;
        private JToken view;
        private JToken ask;
        private OfferDraft draft;
        private string phase;
        private readonly List<string> errors = new List<string>();
        private string notice;
        private bool pending;
        private bool moreTerms;
        private JToken preview;
        private bool previewPending;
        private IVisualElementScheduledItem previewTimer;
        private int previewVersion;
        private VisualElement meterHost;
        private VisualElement askHost;
        private Label footerReaction;
        private List<string> bidders = new List<string>();

        internal NegotiationView(VisualElement anchor, NegotiationTarget target)
        {
            this.anchor = anchor;
            this.target = target;
            body = Ds.Column("ct-neg").Named("negotiation-sheet");
            ContractUi.Style(body);
            footer = Ds.Row("ct-neg__footer").Named("negotiation-footer");
            handle = DsOverlay.SideSheet(anchor, "Contract talks", body, "CONTRACT TALKS", footer, 940f);
            if (handle == null) return;
            ContractUi.Style(handle.Entry);
            title = handle.Entry.Q<Label>(className: "ds-overlay-header__title");
            handle.Closed += () =>
            {
                previewTimer?.Pause();
                Closed?.Invoke();
            };
            body.Add(Ds.Loading("Loading the talks…"));
            _ = Load();
        }

        public bool IsOpen => handle != null && handle.IsOpen;
        public NegotiationTarget Target => target;
        /// <summary>new, submitted, awaitingReview, countered or closed (null while loading).</summary>
        public string Phase => phase;
        public OfferDraft Draft => draft;
        public JToken Preview => preview;
        public VisualElement Root => body;
        public event Action Closed;

        public void Close() => handle?.Close();

        // ---- Loading --------------------------------------------------------------------------------

        private async Task Load()
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            EngineClient client = game.Client;
            promotionId = game.PromotionId;
            if (promotionId == null)
            {
                ShowLine("Run a promotion to talk contracts.");
                return;
            }
            rules = await ContractRules.LoadAsync(client);
            view = null;
            ask = null;
            draft = null;
            preview = null;
            header = null;
            currentDeal = null;
            bidders = new List<string>();
            switch (target.Kind)
            {
                case NegotiationTarget.Kinds.Talks:
                    await LoadTalks(client);
                    break;
                case NegotiationTarget.Kinds.Renewal:
                    await LoadRenewal(client);
                    break;
                default:
                    await LoadSigning(client, target.Id, null);
                    break;
            }
        }

        private async Task LoadSigning(EngineClient client, string personId, string renewalOf)
        {
            var args = new JObject { ["promotionId"] = promotionId, ["personId"] = personId };
            if (renewalOf != null) args["renewalOf"] = renewalOf;
            QueryResult<JToken> askResult = await client.Query("contracts.askingTerms", args);
            header = (await client.Query("workers.profile", new JObject { ["personId"] = personId })).Data?["header"];
            if (!askResult.Ok)
            {
                ShowLine(renewalOf == null ? $"You can't make them an offer. {askResult.ReasonText}" : "They cannot be offered a renewal now.");
                return;
            }
            ask = askResult.Data;
            string situationCode = Kit.Str(ask, "eligibility.situation");
            situation = renewalOf != null
                ? "Under contract with you"
                : ContractText.Situation(situationCode, Kit.Str(header, "employer.name"), situationCode == "endingSoonElsewhere" ? Kit.Str(ask, "eligibility.earliestStart") : null);
            if (renewalOf == null && header != null)
            {
                QueryResult<JToken> rows = await client.Query("contracts.freeAgents", new JObject { ["promotionId"] = promotionId, ["search"] = Kit.Str(header, "ringName") ?? string.Empty });
                JToken me = Kit.Arr(rows.Data).FirstOrDefault(row => Kit.Str(row, "personId") == personId);
                bidders = Kit.Arr(me, "competingBidders").Select(name => (string)name).ToList();
            }
            draft = OfferDraft.FromAsk(ask, rules.MaxLengthMonths);
            phase = "new";
            if (Kit.Obj(ask, "refusal") is JToken refusal) errors.Add(Kit.Str(refusal, "message"));
            Draw();
            SchedulePreview(0);
        }

        private async Task LoadRenewal(EngineClient client)
        {
            QueryResult<JToken> detail = await client.Query("contracts.detail", new JObject { ["employmentId"] = target.Id });
            JToken own = detail.Ok && detail.Data != null && detail.Data.Type != JTokenType.Null && !Kit.Bool(detail.Data, "termsPrivate") ? detail.Data : null;
            if (own == null)
            {
                ShowLine("That contract could not be found.");
                return;
            }
            currentDeal = ContractText.WageText(own) + (Kit.Str(own, "endsOn") is string ends ? $" until {ContractText.Date(ends)}" : string.Empty);
            await LoadSigning(client, Kit.Str(own, "personId"), target.Id);
        }

        private async Task LoadTalks(EngineClient client)
        {
            QueryResult<JToken> result = await client.Query("contracts.negotiation", new JObject { ["negotiationId"] = target.Id });
            if (!result.Ok || result.Data == null || result.Data.Type == JTokenType.Null)
            {
                ShowLine("Those talks could not be found.");
                return;
            }
            view = result.Data;
            // Opening the talks is reading the worker's answer: it clears the "Offer answered" stop.
            if (Kit.Bool(view, "answerUnseen") && markedSeen.Add(target.Id))
            {
                await client.Command("contracts.markOffersSeen", new JObject { ["negotiationIds"] = new JArray(target.Id) });
            }
            string personId = Kit.Str(view, "personId");
            header = (await client.Query("workers.profile", new JObject { ["personId"] = personId })).Data?["header"];
            situation = Kit.Str(view, "kind") == "renewal" ? "Renewing with you" : "New contract";
            bidders = Kit.Arr(view, "competingBidders").Select(name => (string)name).ToList();
            string status = Kit.Str(view, "status");
            phase = status == "submitted" || status == "awaitingReview" || status == "countered" ? status : "closed";
            ask = Kit.Obj(view, "ask");
            if (phase == "countered")
            {
                string renewalOf = Kit.Str(ask, "renewalOf");
                var args = new JObject
                {
                    ["promotionId"] = promotionId,
                    ["personId"] = personId,
                    ["kind"] = Kit.Str(view, "offer.terms.kind"),
                    ["exclusive"] = Kit.Bool(view, "offer.terms.exclusive"),
                };
                if (renewalOf != null) args["renewalOf"] = renewalOf;
                QueryResult<JToken> askResult = await client.Query("contracts.askingTerms", args);
                if (askResult.Ok) ask = askResult.Data;
                draft = OfferDraft.FromOffer(Kit.Obj(view, "lastCounter") ?? Kit.Obj(view, "offer"));
            }
            if (notice == null)
            {
                if (status == "signed") notice = ContractText.Signed(RingName, Kit.Str(view, "kind") == "renewal");
                else if (status == "awaitingReview" && Kit.Str(view, "reviewOn") is string reviewOn) notice = ContractText.OfferSent(reviewOn);
            }
            Draw();
            if (draft != null) SchedulePreview(0);
        }

        private string RingName => Kit.Str(header, "ringName") ?? Kit.Str(view, "ringName") ?? "Worker";
        private bool Renewal => target.Kind == NegotiationTarget.Kinds.Renewal || Kit.Str(view, "kind") == "renewal";

        private void ShowLine(string text)
        {
            body.Clear();
            footer.Clear();
            body.Add(Ds.Empty("contracts", text, null));
        }

        // ---- Preview --------------------------------------------------------------------------------

        private void SchedulePreview(long delay)
        {
            if (draft == null || promotionId == null) return;
            previewPending = true;
            DrawMeter();
            previewTimer?.Pause();
            int version = ++previewVersion;
            previewTimer = body.schedule.Execute(() => _ = RunPreview(version));
            previewTimer.ExecuteLater(delay);
        }

        private async Task RunPreview(int version)
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null) return;
            string personId = Kit.Str(ask, "personId") ?? Kit.Str(view, "personId") ?? Kit.Str(header, "personId");
            var args = new JObject { ["promotionId"] = promotionId, ["personId"] = personId, ["offer"] = draft.Offer.DeepClone() };
            if (view != null) args["negotiationId"] = Kit.Str(view, "negotiationId");
            if (Kit.Str(ask, "renewalOf") is string renewalOf) args["renewalOf"] = renewalOf;
            QueryResult<JToken> result = await game.Client.Query("contracts.offerPreview", args);
            if (version != previewVersion || !IsOpen) return;
            previewPending = false;
            if (result.Ok) preview = result.Data;
            DrawMeter();
        }

        /// <summary>Their ask for the draft's kind and exclusivity (asked again when either changes).</summary>
        private async Task ReloadAsk()
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null) return;
            var args = new JObject
            {
                ["promotionId"] = promotionId,
                ["personId"] = Kit.Str(ask, "personId") ?? Kit.Str(view, "personId"),
                ["kind"] = draft.Kind,
                ["exclusive"] = draft.Exclusive,
            };
            if (Kit.Str(ask, "renewalOf") is string renewalOf) args["renewalOf"] = renewalOf;
            QueryResult<JToken> result = await game.Client.Query("contracts.askingTerms", args);
            if (!IsOpen) return;
            if (result.Ok) ask = result.Data;
            Draw();
        }

        // ---- Drawing --------------------------------------------------------------------------------

        private void Draw()
        {
            if (!IsOpen) return;
            body.Clear();
            footer.Clear();
            if (title != null) title.text = TextFormat.Upper(Renewal ? $"Renew {RingName}" : RingName);

            // Who they are.
            VisualElement hero = Ds.Row("ds-row--top", "ct-hero");
            hero.Add(ContractUi.Portrait(Kit.Str(header, "imageRef") ?? Kit.Str(view, "imageRef"), "ds-portrait--md"));
            VisualElement words = Ds.Column("ct-hero__words");
            words.Add(Ds.Text(TextFormat.Upper(RingName), "ds-type-title", "ct-hero__name"));
            words.Add(Ds.Dot(Kit.Str(ask, "eligibility.situation") == "freeAgent" ? DsState.Good : DsState.Info, situation ?? ContractText.NoValue));
            var about = new List<string>();
            List<string> roles = Kit.Arr(header, "roles").Select(role => ContractText.PersonRoleLabel((string)role)).ToList();
            if (roles.Count > 0) about.Add(string.Join(", ", roles));
            if (Kit.Num(header, "age") is double age) about.Add($"{TextFormat.Number((long)age)} years old");
            if (about.Count > 0) words.Add(Ds.Text(string.Join(" · ", about), "ds-type-caption"));
            if (currentDeal != null) words.Add(Ds.Text($"Now: {currentDeal}", "ds-type-caption"));
            hero.Add(words);
            body.Add(hero);

            // What just happened, and where the talks stand.
            if (notice != null) body.Add(ContractUi.Notice(DsState.Good, notice, "check-circle").Named("negotiation-notice"));
            foreach (string error in errors.Where(error => !string.IsNullOrEmpty(error)).Distinct()) body.Add(ContractUi.Notice(DsState.Bad, error).Named("negotiation-error"));
            if (view != null && phase != "closed" && phase != null)
            {
                body.Add(ContractUi.Notice(ContractText.OfferState(Kit.Str(view, "status")), ContractText.OfferStatus(view), "handshake").Named("negotiation-status"));
            }
            if (view != null && phase == "closed")
            {
                string outcome = ContractText.OfferStatus(view);
                VisualElement line = Ds.Row("ct-notice", Ds.StateClass(ContractText.OfferState(Kit.Str(view, "status")))).Named("negotiation-outcome");
                line.Add(new Icon(Kit.Str(view, "status") == "signed" ? "check-circle" : "info", "ds-icon--sm", "ct-notice__icon"));
                line.Add(Ds.Text(outcome, "ct-notice__text"));
                WhyButton why = ContractWhy.Words("How they decided", outcome, Kit.Obj(view, "reviewTrace"));
                if (why != null) line.Add(why);
                body.Add(line);
                if (Kit.Str(view, "status") == "signed")
                {
                    body.Add(Ds.Text($"Contract: {ContractText.OfferSummary(Kit.Obj(view, "offer"))}", "ct-quiet"));
                    if (ScreenRegistry.IsLive(ScreenIds.Worker))
                    {
                        string personId = Kit.Str(view, "personId");
                        Button profile = Ds.Button($"Open {RingName}'s profile", () =>
                        {
                            Close();
                            ShellController.Current?.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId));
                        }, DsButtonKind.Ghost, "user");
                        profile.AddToClassList("ds-btn--link");
                        body.Add(profile);
                    }
                }
            }

            VisualElement columns = Ds.Row("ds-row--top", "ct-neg__columns");
            VisualElement left = Ds.Column("ct-neg__ask");
            meterHost = Ds.Column("ct-meter-host").Named("negotiation-meter");
            left.Add(meterHost);
            if (Patience() is string patience) left.Add(Ds.Text(patience, "ct-neg__patience"));
            if (ContractText.AlsoTalking(bidders) is string also) left.Add(ContractUi.Notice(DsState.Info, also, "users"));
            askHost = Ds.Column("ct-ask");
            left.Add(askHost);
            DrawAsk();
            columns.Add(left);

            VisualElement right = Ds.Column("ct-neg__offer");
            if (draft != null) right.Add(OfferForm());
            else if (view != null && phase != "closed") right.Add(Ds.Column("ct-on-table").With(
                Ds.Text("YOUR OFFER", "ct-field__label"),
                Ds.Text(ContractText.OfferSummary(Kit.Obj(view, "offer")), "ct-on-table__text", "ds-wrap")));
            columns.Add(right);
            body.Add(columns);

            List<JToken> history = Kit.Arr(view, "history").ToList();
            if (history.Count > 0) body.Add(History(history));

            DrawFooter();
            DrawMeter();
        }

        private string Patience()
        {
            if (phase == "closed") return null;
            if (view != null) return ContractText.Patience(Kit.Num(view, "patienceLeft") ?? 0, Kit.Num(view, "startPatience") ?? 0);
            double start = Kit.Num(ask, "startPatience.value") ?? 0;
            return start > 0 ? ContractText.Patience(start, start) : null;
        }

        private void DrawMeter()
        {
            if (meterHost == null) return;
            meterHost.Clear();
            if (footerReaction != null) footerReaction.text = string.Empty;
            if (draft == null) return;
            if (preview == null)
            {
                meterHost.Add(Ds.Text("Working out how they would take it…", "ct-quiet"));
                return;
            }
            string band = Kit.Str(preview, "band");
            DsState state = ContractText.BandState(band);
            string label = Kit.Str(preview, "label") ?? string.Empty;
            VisualElement head = Ds.Row("ct-meter__head");
            head.Add(Ds.Text("HOW THEY'D TAKE IT", "ct-field__label"));
            head.Add(Ds.Spacer());
            if (previewPending) head.Add(Ds.Text("updating…", "ct-quiet"));
            meterHost.Add(head);
            VisualElement reaction = Ds.Row("ct-meter__reaction", Ds.StateClass(state)).Named("negotiation-reaction");
            reaction.Add(new Icon(Ds.StateIcon(state), "ds-icon--lg", "ct-meter__icon"));
            reaction.Add(Ds.Text(TextFormat.Upper(label), "ct-meter__label"));
            WhyButton why = ContractWhy.Words("Their reaction", label, Kit.Obj(preview, "reactionTrace"));
            if (why != null) reaction.Add(why);
            meterHost.Add(reaction);
            double ratio = Kit.Num(preview, "ratio") ?? 0;
            double accept = Kit.Num(preview, "thresholds.accept") ?? 1;
            meterHost.Add(Ds.Meter(ContractText.MeterFraction(ratio, accept), state, $"{Math.Round(ratio * 100):0}% of their ask"));
            foreach (JToken note in Kit.Arr(preview, "notes")) meterHost.Add(Ds.Text("• " + (string)note, "ct-meter__note", "ds-wrap"));
            if (footerReaction != null)
            {
                footerReaction.text = label;
                footerReaction.ClearClassList();
                footerReaction.AddToClassList("ct-neg__footer-reaction");
                footerReaction.AddToClassList(Ds.StateClass(state));
            }
        }

        /// <summary>What they ask, every number with its Why?.</summary>
        private void DrawAsk()
        {
            askHost.Clear();
            if (ask == null) return;
            askHost.Add(Ds.SectionHeader("Their ask"));
            bool perAppearance = Kit.Str(ask, "kind") == "perAppearance";
            JToken pay = Kit.Obj(ask, perAppearance ? "perAppearanceFee" : "monthlyWage");
            JToken length = Kit.Obj(ask, "preferredLengthMonths");
            JToken push = Kit.Obj(ask, "expectedPush");
            JToken patience = Kit.Obj(ask, "startPatience");
            JToken cap = Kit.Obj(ask, "appearanceCap");
            askHost.Add(ContractUi.Facts(
                (perAppearance ? "Fee per appearance" : "Monthly wage", ContractUi.Value(ContractText.Money(Kit.Num(pay, "value")),
                    ContractWhy.Number(perAppearance ? "Their fee per appearance" : "Their monthly wage", pay, "money"), "ds-kv__value")),
                ("Signing bonus", ContractUi.Value(ContractText.Money(Kit.Num(ask, "signingBonus.value")), ContractWhy.Number("Their signing bonus", Kit.Obj(ask, "signingBonus"), "money"), "ds-kv__value")),
                ("Market value", ContractUi.Value(ContractText.Money(Kit.Num(ask, "marketValue.value")), ContractWhy.Number("Their market value", Kit.Obj(ask, "marketValue"), "money"), "ds-kv__value")),
                ("Preferred length", ContractUi.Value(ContractText.Months(Kit.Num(length, "value") ?? 0),
                    ContractWhy.Words("Their preferred length", ContractText.Months(Kit.Num(length, "value") ?? 0), Kit.Obj(length, "trace")), "ds-kv__value")),
                ("Expects", ContractUi.Value(ContractText.PushName(Kit.Str(push, "value")),
                    ContractWhy.Words("The card position they expect", ContractText.PushName(Kit.Str(push, "value")), Kit.Obj(push, "trace")), "ds-kv__value")),
                ("Patience", ContractUi.Value($"{TextFormat.Number((long)(Kit.Num(patience, "value") ?? 0))} rounds",
                    ContractWhy.Words("Their patience", $"{Kit.Num(patience, "value") ?? 0} rounds", Kit.Obj(patience, "trace")), "ds-kv__value")),
                ("Most appearances", cap == null ? null : ContractUi.Value($"{TextFormat.Number((long)(Kit.Num(cap, "value") ?? 0))} a year",
                    ContractWhy.Words("The most appearances they agree to", $"{Kit.Num(cap, "value") ?? 0} a year", Kit.Obj(cap, "trace")), "ds-kv__value"))));
            List<JToken> perks = Kit.Arr(ask, "perks").ToList();
            if (perks.Count > 0)
            {
                askHost.Add(Ds.Text("THEY INSIST ON", "ct-field__label", "ct-gap-top"));
                foreach (JToken perk in perks) askHost.Add(Ds.Text($"{Kit.Str(perk, "label")}: {Kit.Str(perk, "reason")}", "ct-quiet", "ds-wrap"));
            }
        }

        /// <summary>
        /// Your offer: the terms that decide most first (kind, money, length, card position), the
        /// rest one step away under More terms. Each money field says what they ask beside it; a
        /// refusal's reasons appear under the field they are about.
        /// </summary>
        private VisualElement OfferForm()
        {
            VisualElement form = Ds.Column("ct-offer").Named("negotiation-offer");
            bool disabled = pending;
            VisualElement head = Ds.Row("ct-offer__head");
            head.Add(Ds.SectionHeader("Your offer"));
            Button useAsk = Ds.Button("Use their ask", () =>
            {
                draft.Replace(OfferDraft.OfferFromAsk(ask, rules.MaxLengthMonths));
                Draw();
                SchedulePreview(0);
            }, DsButtonKind.Ghost, "reset");
            useAsk.name = "negotiation-use-ask";
            useAsk.SetEnabled(!disabled);
            head.Add(useAsk);
            form.Add(head);

            // Kind: options you may not offer say why.
            var kinds = Kit.Arr(ask, "allowedKinds").Select(entry => (
                Kit.Str(entry, "kind"),
                Kit.Str(entry, "label") ?? ContractText.KindLabel(Kit.Str(entry, "kind")),
                Kit.Bool(entry, "allowed"),
                string.Join(" ", Kit.Arr(entry, "reasons").Select(reason => Kit.Str(reason, "message"))))).ToList();
            if (kinds.Count == 0) kinds.Add((draft.Kind, ContractText.KindLabel(draft.Kind), true, null));
            form.Add(new ContractUi.ChoiceGroup<string>("Kind", kinds, draft.Kind, kind =>
            {
                draft.SetKind(kind, ask);
                _ = ReloadAsk();
                SchedulePreview(PreviewDelayMs);
            }, "offer-kind"));
            AddError(form, "offer.terms.kind");

            VisualElement money = Ds.Row("ds-row--top", "ct-offer__money");
            string payField = draft.PerAppearance ? "perAppearanceFee" : "monthlyWage";
            string payAsk = ContractText.Money(Kit.Num(ask, payField + ".value"));
            var pay = new ContractUi.Field(draft.PerAppearance ? "Fee per appearance" : "Monthly wage", ContractText.DollarsText(draft.Money(payField)),
                text => MoneyChanged(payField, text), $"They ask {payAsk}", null, "offer-pay", "$");
            pay.SetError(draft.ErrorOf("offer.terms." + payField));
            pay.SetEnabled(!disabled);
            money.Add(pay);
            var bonus = new ContractUi.Field("Signing bonus", ContractText.DollarsText(draft.Money("signingBonus")),
                text => MoneyChanged("signingBonus", text), $"They ask {ContractText.Money(Kit.Num(ask, "signingBonus.value"))}", null, "offer-bonus", "$");
            bonus.SetError(draft.ErrorOf("offer.terms.signingBonus"));
            bonus.SetEnabled(!disabled);
            money.Add(bonus);
            form.Add(money);

            var lengths = ContractText.LengthOptions(rules.MaxLengthMonths, draft.LengthMonths)
                .Select(months => (months, $"{months} mo", true, (string)null));
            form.Add(new ContractUi.ChoiceGroup<int>("Length", lengths, draft.LengthMonths, months =>
            {
                draft.SetLength(months);
                SchedulePreview(PreviewDelayMs);
            }, "offer-length"));
            form.Add(Ds.Text($"They prefer {ContractText.Months(Kit.Num(ask, "preferredLengthMonths.value") ?? 0)}", "ct-field__hint"));
            AddError(form, "offer.lengthMonths");

            form.Add(new ContractUi.ChoiceGroup<string>("Card position",
                ContractText.PushLevels.Select(push => (push, ContractText.PushName(push), true, (string)null)), draft.Push, push =>
                {
                    draft.SetPush(push);
                    SchedulePreview(PreviewDelayMs);
                }, "offer-push"));
            form.Add(Ds.Text($"Expects {ContractText.PushName(Kit.Str(ask, "expectedPush.value"))}", "ct-field__hint"));
            AddError(form, "offer.push");

            Button more = Ds.Button(moreTerms ? "Fewer terms" : "More terms", () =>
            {
                moreTerms = !moreTerms;
                Draw();
            }, DsButtonKind.Ghost, moreTerms ? "chevron-up" : "chevron-down");
            more.name = "offer-more-terms";
            form.Add(more);
            if (moreTerms) form.Add(MoreTerms(disabled));
            return form;
        }

        private VisualElement MoreTerms(bool disabled)
        {
            VisualElement more = Ds.Column("ct-offer__more").Named("offer-more");
            bool exclusiveAllowed = Kit.Bool(ask, "exclusiveAllowed");
            string exclusiveHint = !exclusiveAllowed
                ? string.Join(" ", Kit.Arr(ask, "exclusiveReasons").Select(reason => Kit.Str(reason, "message")))
                : draft.PerAppearance ? "Per-appearance deals are never exclusive" : "They work for nobody else while it runs";
            more.Add(ContractUi.Switch("Exclusive", draft.Exclusive, on =>
            {
                draft.SetExclusive(on);
                _ = ReloadAsk();
                SchedulePreview(PreviewDelayMs);
            }, exclusiveHint, !disabled && !draft.PerAppearance && exclusiveAllowed, "offer-exclusive"));
            AddError(more, "offer.terms.exclusive");

            var roleOptions = new List<string> { Kit.Str(ask, "role") };
            roleOptions.AddRange(Kit.Arr(header, "roles").Select(role => (string)role == "occasionalWrestler" ? "wrestler" : (string)role));
            roleOptions.Add(draft.Role);
            more.Add(new ContractUi.ChoiceGroup<string>("Role",
                roleOptions.Where(role => role != null).Distinct().Select(role => (role, ContractText.RoleLabel(role), true, (string)null)), draft.Role, role =>
                {
                    draft.SetRole(role);
                    SchedulePreview(PreviewDelayMs);
                }, "offer-role"));
            AddError(more, "offer.role");

            var brands = new List<(string, string, bool, string)> { (null, "Shared across every brand", true, null) };
            brands.AddRange(Kit.Arr(ask, "brandOptions").Select(brand => (Kit.Str(brand, "brandId"), Kit.Str(brand, "name"), true, (string)null)));
            if (brands.Count > 1)
            {
                more.Add(new ContractUi.ChoiceGroup<string>("Brand", brands, draft.BrandId, brandId =>
                {
                    draft.SetBrand(brandId);
                    SchedulePreview(PreviewDelayMs);
                }, "offer-brand"));
                AddError(more, "offer.brand.brandId");
            }

            string earliest = Kit.Str(ask, "eligibility.earliestStart");
            bool onDate = draft.StartsOn != null;
            more.Add(new ContractUi.ChoiceGroup<bool>("Start",
                new[] { (false, "As soon as possible", true, (string)null), (true, "On a date", true, (string)null) }, onDate, pickDate =>
                {
                    draft.SetStartsOn(pickDate ? earliest : null);
                    Draw();
                    SchedulePreview(PreviewDelayMs);
                }, "offer-start"));
            if (onDate)
            {
                var date = new ContractUi.Field("Start date", draft.StartsOn, text =>
                {
                    if (GameDate.TryParse(text, out GameDate parsed)) draft.SetStartsOn(parsed.Iso);
                    SchedulePreview(PreviewDelayMs);
                }, earliest == null ? null : $"They can start on {ContractText.Date(earliest)} at the earliest", "YYYY-MM-DD", "offer-start-date");
                date.SetError(draft.ErrorOf("offer.startsOn"));
                more.Add(date);
            }

            more.Add(Ds.Text("PERKS", "ct-field__label", "ct-gap-top"));
            var asked = new HashSet<string>(Kit.Arr(ask, "perks").Select(perk => Kit.Str(perk, "term")));
            foreach ((string key, string label, bool enforced) in new[]
            {
                ("ironClad", "Iron-clad", true),
                ("travelCovered", "Travel covered", true),
                ("creativeControl", "Creative control", false),
                ("noHouseShows", "No house shows", false),
            })
            {
                string hint = !enforced ? ContractText.NotEnforced : asked.Contains("perk." + key) ? "They insist on it" : "Adds to what the offer is worth to them";
                string perk = key;
                more.Add(ContractUi.Switch(label, enforced && draft.Perk(key), on =>
                {
                    draft.SetPerk(perk, on);
                    SchedulePreview(PreviewDelayMs);
                }, hint, enforced && !disabled, "offer-perk-" + key));
            }

            JToken cap = Kit.Obj(ask, "appearanceCap");
            var capField = new ContractUi.Field("Most appearances a year", draft.AppearanceCap?.ToString(), text =>
            {
                string digits = new string((text ?? string.Empty).Where(char.IsDigit).ToArray());
                draft.SetAppearanceCap(digits.Length == 0 || digits.Length > 4 ? (int?)null : int.Parse(digits));
                SchedulePreview(PreviewDelayMs);
            }, cap == null ? "Leave it empty for no cap" : $"They agree to {TextFormat.Number((long)(Kit.Num(cap, "value") ?? 0))} at most", "No cap", "offer-cap");
            capField.SetError(draft.ErrorOf("offer.terms.appearanceCap"));
            more.Add(capField);
            return more;
        }

        private void MoneyChanged(string field, string text)
        {
            long? cents = ContractText.ParseDollars(text);
            draft.SetMoney(field, cents ?? 0);
            SchedulePreview(PreviewDelayMs);
        }

        private void AddError(VisualElement parent, string field)
        {
            string error = draft?.ErrorOf(field);
            if (error != null) parent.Add(Ds.Text(error, "ct-field__error"));
        }

        /// <summary>The talks so far, one line per offer, with the reaction or the counter's Why?.</summary>
        private VisualElement History(List<JToken> history)
        {
            VisualElement section = Ds.Column("ct-history").Named("negotiation-history");
            section.Add(Ds.SectionHeader("Talks so far"));
            string negotiationId = Kit.Str(view, "negotiationId");
            foreach (JToken entry in history)
            {
                bool worker = Kit.Str(entry, "by") == "worker";
                int round = (int)(Kit.Num(entry, "round") ?? 0);
                VisualElement row = Ds.Row("ct-history__row", worker ? "ct-history__row--worker" : "ct-history__row--you");
                row.Add(new Icon(worker ? "user" : "handshake", "ds-icon--sm", "ct-history__icon"));
                VisualElement words = Ds.Column("ct-history__words");
                words.Add(Ds.Text(worker ? ContractText.CounterLine(Kit.Obj(entry, "offer")) : ContractText.OfferedLine(Kit.Obj(entry, "offer")), "ct-history__line", "ds-wrap"));
                VisualElement meta = Ds.Row("ct-history__meta");
                meta.Add(Ds.Text($"Round {round} · {ContractText.Date(Kit.Str(entry, "date"))}", "ct-quiet"));
                string reaction = Kit.Str(entry, "reactionLabel") ?? string.Empty;
                meta.Add(Ds.Text(reaction, "ct-history__reaction"));
                var traceRef = new JObject
                {
                    ["kind"] = worker ? "contracts.counter" : "contracts.reaction",
                    ["id"] = $"{negotiationId}:{round}",
                };
                if (worker || Kit.Str(entry, "reaction") != null)
                {
                    WhyButton why = ContractWhy.RefWords(worker ? "Their counter-offer" : "Their reaction", reaction, traceRef);
                    if (why != null) meta.Add(why);
                }
                words.Add(meta);
                row.Add(words);
                section.Add(row);
            }
            return section;
        }

        private void DrawFooter()
        {
            footer.Clear();
            footerReaction = null;
            if (phase == null || phase == "closed") return;
            if (draft != null)
            {
                footerReaction = Ds.Text(string.Empty, "ct-neg__footer-reaction");
                footer.Add(footerReaction);
            }
            footer.Add(Ds.Spacer());
            if (phase == "new")
            {
                Button submit = Ds.Button(Renewal ? "Offer renewal" : "Submit offer", () => _ = Submit(), DsButtonKind.Primary, "handshake");
                submit.name = "negotiation-submit";
                submit.SetEnabled(!pending && draft != null && Kit.Obj(ask, "refusal") == null);
                footer.Add(submit);
            }
            else if (phase == "countered")
            {
                Button end = Ds.Button("End talks", () => _ = Answer("end"), DsButtonKind.Danger);
                end.name = "negotiation-end";
                end.SetEnabled(!pending);
                footer.Add(end);
                Button revise = Ds.Button("Send revised offer", () => _ = Answer("revise"), DsButtonKind.Secondary);
                revise.name = "negotiation-revise";
                revise.SetEnabled(!pending && draft != null);
                footer.Add(revise);
                Button accept = Ds.Button("Accept counter", () => _ = Answer("accept"), DsButtonKind.Primary, "check");
                accept.name = "negotiation-accept";
                accept.SetEnabled(!pending);
                footer.Add(accept);
            }
            else
            {
                Button withdraw = Ds.Button("Withdraw offer", () => _ = Withdraw(), DsButtonKind.Danger);
                withdraw.name = "negotiation-withdraw";
                withdraw.SetEnabled(!pending);
                footer.Add(withdraw);
            }
        }

        // ---- Commands -------------------------------------------------------------------------------

        private IEnumerable<(string field, string message)> Reasons(EngineResult result) =>
            result.Reasons.Select(reason => (reason.Field, TextFormat.Sentence(reason.Message)));

        private async Task Submit()
        {
            EngineGame game = Kit.Game;
            if (game == null || draft == null) return;
            pending = true;
            errors.Clear();
            notice = null;
            DrawFooter();
            CommandResult<JToken> result = target.Kind == NegotiationTarget.Kinds.Renewal
                ? await game.Client.Command("contracts.offerRenewal", new JObject { ["employmentId"] = target.Id, ["offer"] = draft.Offer.DeepClone() })
                : await game.Client.Command("contracts.makeOffer", new JObject
                {
                    ["promotionId"] = promotionId,
                    ["personId"] = Kit.Str(ask, "personId") ?? target.Id,
                    ["offer"] = draft.Offer.DeepClone(),
                });
            pending = false;
            if (!IsOpen) return;
            if (result.Ok && Kit.Str(result.Data, "negotiationId") is string negotiationId)
            {
                notice = ContractText.OfferSent(null);
                target = NegotiationTarget.Talks(negotiationId);
                await Load();
                return;
            }
            EngineReason talking = result.Reasons.FirstOrDefault(reason => reason.Code == "contracts.alreadyNegotiating" && reason.Subject?.Kind == "negotiation");
            if (talking != null)
            {
                target = NegotiationTarget.Talks(talking.Subject.Id);
                await Load();
                return;
            }
            errors.AddRange(draft.ShowRefusal(Reasons(result)));
            Draw();
        }

        private async Task Answer(string response)
        {
            EngineGame game = Kit.Game;
            if (game == null || view == null) return;
            pending = true;
            errors.Clear();
            notice = null;
            DrawFooter();
            var args = new JObject { ["negotiationId"] = Kit.Str(view, "negotiationId"), ["response"] = response };
            if (response == "revise" && draft != null) args["offer"] = draft.Offer.DeepClone();
            CommandResult<JToken> result = await game.Client.Command("contracts.respondToCounter", args);
            pending = false;
            if (!IsOpen) return;
            if (!result.Ok)
            {
                if (draft != null) errors.AddRange(draft.ShowRefusal(Reasons(result)));
                else errors.AddRange(result.Reasons.Select(reason => reason.Message));
                Draw();
                return;
            }
            // An accepted counter (or a revision that pays it) signs at once (ECO5-10).
            notice = Kit.Str(result.Data, "status") == "signed"
                ? ContractText.Signed(RingName, Renewal)
                : response == "end" ? "You ended the talks." : ContractText.OfferSent(null);
            await Load();
        }

        private async Task Withdraw()
        {
            EngineGame game = Kit.Game;
            if (game == null || view == null) return;
            pending = true;
            DrawFooter();
            CommandResult<JToken> result = await game.Client.Command("contracts.withdrawOffer", new JObject { ["negotiationId"] = Kit.Str(view, "negotiationId") });
            pending = false;
            if (!IsOpen) return;
            errors.Clear();
            if (result.Ok) notice = "You withdrew the offer.";
            else errors.AddRange(result.Reasons.Select(reason => reason.Message));
            await Load();
        }
    }
}
