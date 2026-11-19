using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Business
{
    /// <summary>
    /// One deal in a side sheet (the web's DealSheet): terms, health with every reason and the targets
    /// in viewers, the airing history, and for a running deal <b>Renegotiate</b> (the sheet turns into
    /// the renewal preview) and <b>Cancel deal</b> (a confirm that shows the exit fee first).
    /// </summary>
    public sealed class DealSheet
    {
        private readonly VisualElement anchor;
        private readonly string dealId;
        private readonly VisualElement content;
        private readonly VisualElement footer;
        private OverlayHandle handle;
        private JToken deal;
        private string today;
        private int months;
        private string mode = "detail";
        private int asked;

        public static DealSheet Current { get; private set; }

        private DealSheet(VisualElement anchor, string dealId, int defaultMonths)
        {
            this.anchor = anchor;
            this.dealId = dealId;
            months = defaultMonths;
            content = Ds.Column("biz-sheet").Named("deal-sheet");
            footer = Ds.Row("biz-sheet-footer").Named("deal-footer");
            content.Add(Ds.Loading("Loading the deal…"));
            handle = BusinessUi.Sheet(anchor, "Deal", content, "TV deal", footer, 680f);
            if (handle != null) handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };
        }

        public string Mode => mode;
        public JToken Deal => deal;
        public JToken Valuation { get; private set; }

        public static DealSheet Open(VisualElement anchor, string dealId, int defaultMonths)
        {
            if (dealId == null) return null;
            var sheet = new DealSheet(anchor, dealId, defaultMonths);
            if (sheet.handle == null) return null;
            Current = sheet;
            _ = sheet.Load();
            return sheet;
        }

        private void SetTitle(string text, string eyebrow)
        {
            Label title = handle?.Content.Q<Label>(className: "ds-overlay-header__title");
            if (title != null) title.text = TextFormat.Upper(text);
            Label kicker = handle?.Content.Q<Label>(className: "ds-overlay-header__eyebrow");
            if (kicker != null && eyebrow != null) kicker.text = TextFormat.Upper(eyebrow);
        }

        private async Task Load()
        {
            (QueryResult<JToken> answer, QueryResult<JToken> clock) = await Kit.Game.Client.Read("networks.deal", reader => (
                reader.Query("broadcast.deal", new JObject { ["dealId"] = dealId }),
                reader.Query("clock.get")));
            if (handle == null || !handle.IsOpen) return;
            today = clock.Ok ? Kit.Str(clock.Data, "date") : null;
            content.Clear();
            footer.Clear();
            if (!answer.Ok)
            {
                content.Add(Ds.Empty("warning", "This deal can't be shown", Kit.Reasons(answer.Reasons)));
                return;
            }
            if (Kit.Str(answer.Data, "visibility") != "own")
            {
                JToken publicDeal = Kit.Obj(answer.Data, "deal");
                SetTitle($"{Kit.Str(publicDeal, "networkName")} · {Kit.Str(publicDeal, "showName")}", BusinessText.KindLabel(Kit.Str(publicDeal, "kind")));
                content.Add(BusinessUi.Quiet($"{BusinessText.Slot(publicDeal)}. Only the promotion that signed it sees its money."));
                return;
            }
            deal = Kit.Obj(answer.Data, "deal");
            if (mode == "renew") await DrawRenew();
            else DrawDetail();
        }

        // ---- Detail ---------------------------------------------------------------------------------

        private void DrawDetail()
        {
            mode = "detail";
            content.Clear();
            footer.Clear();
            string kind = Kit.Str(deal, "kind");
            string networkName = Kit.Str(deal, "networkName");
            SetTitle($"{networkName} · {Kit.Str(deal, "showName")}", $"{BusinessText.KindLabel(kind)} · {BusinessText.Slot(deal)}");

            VisualElement head = Ds.Row("biz-sheet__head");
            head.Add(BusinessUi.Logo(Kit.Str(deal, "logoRef"), networkName, "rb-logo--lg"));
            VisualElement headWords = Ds.Column("biz-sheet__head-words");
            headWords.Add(NetworksView.HealthCell(deal));
            headWords.Add(BusinessUi.Quiet(BusinessText.EndsText(Kit.Str(deal, "endsOn"), Kit.Str(deal, "status"), today)));
            head.Add(headWords);
            content.Add(head);

            JToken loss = Kit.Arr(deal, "airings").FirstOrDefault(airing => Kit.Str(airing, "status") == "aired");
            if (loss != null && Kit.Num(loss, "net") is double lossNet && lossNet < 0)
            {
                content.Add(BusinessUi.Notice(DsState.Bad, $"This deal lost {BusinessText.Money(-lossNet)} on its last airing: the airtime cost more than the network paid."));
            }

            List<string> reasons = Kit.Arr(deal, "riskReasons").Select(reason => (string)reason).Where(reason => !reason.StartsWith(BusinessText.ComingMissedPrefix, StringComparison.Ordinal)).ToList();
            List<string> missed = Kit.Arr(deal, "upcomingMissed").Select(date => BusinessText.UpcomingMissedText((string)date)).ToList();
            if (Kit.Str(deal, "risk") != null)
            {
                content.Add(BusinessUi.SubHeading("Health"));
                if (reasons.Count + missed.Count == 0) content.Add(BusinessUi.Quiet("Nothing worries the network about this deal."));
                foreach (string reason in reasons) content.Add(BusinessUi.Notice(BusinessText.RiskState(Kit.Str(deal, "risk")), TextFormat.Sentence(reason), BusinessText.RiskIcon(Kit.Str(deal, "risk")) ?? "info"));
                foreach (string line in missed) content.Add(BusinessUi.Notice(DsState.Bad, line, "warning"));
                IReadOnlyList<BusinessText.TargetLine> targets = BusinessText.TargetLines(Kit.Obj(deal, "targets"), kind);
                if (targets.Count > 0)
                {
                    content.Add(BusinessUi.SubHeading($"What {networkName} expects"));
                    content.Add(Targets(targets, kind));
                }
            }
            else
            {
                content.Add(BusinessUi.Notice(DsState.Neutral, BusinessText.EndReasonText(Kit.Str(deal, "endedReason")), "info"));
            }

            content.Add(BusinessUi.SubHeading("Terms"));
            content.Add(BusinessUi.Facts(
                ("Fee per show", BusinessUi.FactText(kind == "ppv" ? BusinessText.NoValue : BusinessText.Money(Kit.Num(deal, "terms.feePerShow") ?? 0))),
                (BusinessText.PerThousandLabel(kind), BusinessUi.FactText(BusinessText.PerThousandText(kind, Kit.Num(deal, "terms.perThousandViewers") ?? 0))),
                ("Airtime cost per show", BusinessUi.FactText(BusinessText.Money(Kit.Num(deal, "terms.costPerShow") ?? 0))),
                ("Aired", BusinessUi.FactText(Kit.Bool(deal, "live") ? "Live" : "Taped")),
                ("Day", BusinessUi.FactText(BusinessText.WeekdayText(Kit.Num(deal, "weekday") is double day ? (int)day : (int?)null) ?? "Whenever the show runs")),
                ("Timeslot", BusinessUi.FactText(kind == "ppv" ? "Not tied to a timeslot" : BusinessText.TimeslotLabel(Kit.Str(deal, "timeslot")))),
                ("Started", BusinessUi.FactText(Kit.Date(Kit.Str(deal, "startsOn"))))));

            content.Add(BusinessUi.SubHeading("Airing history"));
            List<JToken> airings = Kit.Arr(deal, "airings").ToList();
            if (airings.Count == 0)
            {
                content.Add(BusinessUi.Quiet("Nothing has aired yet."));
            }
            else
            {
                DsTable<JToken> table = new DsTable<JToken>(AiringColumns(kind), airings.Take(20)).Named("deal-airings");
                table.AddToClassList("biz-table");
                table.AddToClassList("biz-table--compact");
                content.Add(table);
                if (airings.Count > 20) content.Add(BusinessUi.Quiet($"The latest 20 of {airings.Count} airings."));
            }

            if (Kit.Str(deal, "status") == "active")
            {
                footer.Add(Ds.Spacer());
                Button cancel = Ds.Button("Cancel deal", () => CancelDealDialog.Open(anchor, deal, () => handle?.Close()), DsButtonKind.Danger);
                cancel.name = "deal-cancel";
                footer.Add(cancel);
                Button renew = Ds.Button("Renegotiate", () => _ = DrawRenew(), DsButtonKind.Primary, "handshake");
                renew.name = "deal-renegotiate";
                footer.Add(renew);
            }
        }

        internal static VisualElement Targets(IReadOnlyList<BusinessText.TargetLine> targets, string kind)
        {
            VisualElement list = Ds.Column("biz-targets");
            foreach (BusinessText.TargetLine line in targets)
            {
                VisualElement row = Ds.Row("biz-targets__row").Named($"target-{line.Id}");
                DsState state = line.Id == "bonus" ? DsState.Gold : line.Id == "cancel" ? DsState.Bad : DsState.Good;
                row.Add(Ds.Dot(state, null));
                row.Add(Ds.Text(line.Text, "biz-targets__text"));
                WhyButton why = Kit.WhyTrace(line.Label, line.Viewers, line.Trace, "count", line.Label);
                if (why != null) row.Add(BusinessUi.Quiet(why, row));
                list.Add(row);
            }
            list.Add(BusinessUi.Quiet(BusinessText.RatingsBonusText(kind)));
            return list;
        }

        private static IEnumerable<DsColumn<JToken>> AiringColumns(string kind)
        {
            yield return new DsColumn<JToken>("date", "Date", row => BusinessUi.Cell(Kit.Date(Kit.Str(row, "airDate")))) { Width = 110 };
            yield return new DsColumn<JToken>("status", "Status", row =>
            {
                string text = BusinessText.AiringStatusText(Kit.Str(row, "status"), Kit.Str(row, "missReason"), Kit.Str(row, "qualitySource"));
                Label cell = BusinessUi.Cell(text, Kit.Str(row, "status") == "missed" ? "biz-bad" : null);
                if (Kit.Str(row, "note") is string note) DsTooltip.Attach(cell, note, text);
                return cell;
            })
            {
                Grow = 1,
                MinWidth = 120,
            };
            yield return new DsColumn<JToken>("viewers", kind == "ppv" ? "Buys" : "Viewers", row =>
            {
                if (Kit.Str(row, "status") == "missed") return BusinessUi.Muted(BusinessText.NoValue);
                double viewers = Kit.Num(row, "viewers") ?? 0;
                return BusinessUi.NumWhy(BusinessText.ShortViewers(viewers), BusinessUi.WhyRef($"Viewers on {Kit.Date(Kit.Str(row, "airDate"))}", viewers, Kit.Obj(row, "traceRef"), "count"));
            })
            {
                Width = 100,
                Align = DsAlign.Right,
            };
            yield return new DsColumn<JToken>("expected", "Expected", row => BusinessUi.NumCell(BusinessText.ShortViewers(Kit.Num(row, "expectedViewers") ?? 0))) { Width = 90, Align = DsAlign.Right };
            yield return new DsColumn<JToken>("net", "Net", row =>
            {
                if (!(Kit.Num(row, "net") is double net)) return BusinessUi.Muted(BusinessText.NoValue);
                return BusinessUi.NumWhy(BusinessText.Signed(net, true), BusinessUi.WhyRef($"Net on {Kit.Date(Kit.Str(row, "airDate"))}", net, Kit.Obj(row, "traceRef"), "money"), net < 0 ? "biz-bad" : null);
            })
            {
                Width = 120,
                Align = DsAlign.Right,
            };
        }

        // ---- Renegotiate ----------------------------------------------------------------------------

        /// <summary>Shows the renewal preview for <paramref name="length"/> months (tours pick a length).</summary>
        public Task Renew(int length)
        {
            months = length;
            return DrawRenew();
        }

        private async Task DrawRenew()
        {
            mode = "renew";
            int request = ++asked;
            string kind = Kit.Str(deal, "kind");
            string networkName = Kit.Str(deal, "networkName");
            SetTitle($"Renew: {networkName} · {Kit.Str(deal, "showName")}", $"{BusinessText.KindLabel(kind)} · {BusinessText.Slot(deal)}");
            var args = new JObject
            {
                ["promotionId"] = Kit.Game.PromotionId,
                ["networkId"] = Kit.Str(deal, "networkId"),
                ["eventDefinitionId"] = Kit.Obj(deal, "eventDefinitionId") ?? JValue.CreateNull(),
                ["timeslot"] = Kit.Str(deal, "timeslot"),
                ["live"] = Kit.Bool(deal, "live"),
                ["months"] = months,
                ["dealId"] = dealId,
            };
            QueryResult<JToken> answer = await Kit.Game.Client.Query("broadcast.valuation", args);
            if (request != asked || handle == null || !handle.IsOpen || mode != "renew") return;
            content.Clear();
            footer.Clear();
            Label feedback = Kit.Feedback();

            content.Add(BusinessUi.Choices("Length", BusinessText.DealLengths.Select(value => (value, BusinessText.MonthsText(value))), months, value =>
            {
                months = value;
                _ = DrawRenew();
            }, "renew-length"));

            JToken valuation = answer.Ok ? answer.Data : null;
            Valuation = valuation;
            if (valuation == null)
            {
                content.Add(BusinessUi.Notice(DsState.Bad, answer.Ok ? "The network could not be asked." : Kit.Reasons(answer.Reasons)));
            }
            else
            {
                double income = Kit.Num(valuation, "incomePerAiring.value") ?? 0;
                content.Add(VerdictLine(valuation, networkName));
                if (income < 0) content.Add(BusinessUi.Notice(DsState.Bad, BusinessText.LosesMoneyText, "warning"));

                content.Add(BusinessUi.SubHeading("Now against renewed"));
                VisualElement compare = Ds.Column("biz-compare").Named("renew-compare");
                JToken uplift = Kit.Obj(valuation, "renewalUplift");
                string upliftTerm = Kit.Str(uplift, "term");
                if (kind != "ppv") compare.Add(CompareRow("Fee per show", Kit.Num(deal, "terms.feePerShow") ?? 0, Kit.Obj(valuation, "terms.feePerShow"), false, false, upliftTerm == "feePerShow" ? uplift : null));
                compare.Add(CompareRow(BusinessText.PerThousandLabel(kind), Kit.Num(deal, "terms.perThousandViewers") ?? 0, Kit.Obj(valuation, "terms.perThousandViewers"), kind == "ppv", false, upliftTerm == "perThousandViewers" ? uplift : null, true));
                compare.Add(CompareRow("Airtime cost per show", Kit.Num(deal, "terms.costPerShow") ?? 0, Kit.Obj(valuation, "terms.costPerShow"), false, true, null));
                content.Add(compare);
                if (Kit.Str(uplift, "reason") is string upliftReason) content.Add(BusinessUi.Notice(DsState.Gold, TextFormat.Sentence(upliftReason), "star"));

                GameDate end = RenewedEndsOn(Kit.Str(deal, "endsOn"), today, months, Kit.Str(valuation, "endsOn"));
                content.Add(BusinessUi.Facts(
                    ("New end date", BusinessUi.FactText(end == default ? Kit.Date(Kit.Str(valuation, "endsOn")) : end.Short)),
                    ("Income per airing", BusinessUi.Value(BusinessText.Money(income), BusinessUi.WhyTraced("Income per airing after renewing", Kit.Obj(valuation, "incomePerAiring"), "money"), income < 0 ? "biz-bad" : "biz-num"))));
                if (kind == "ppv" && (Kit.Num(valuation, "terms.costPerShow.value") ?? 0) > (Kit.Num(deal, "terms.costPerShow") ?? 0))
                {
                    content.Add(BusinessUi.Notice(DsState.Warn, $"{BusinessText.PpvAirtimeText} Renewed, it is {BusinessText.Money(Kit.Num(valuation, "terms.costPerShow.value") ?? 0)} a show, up from {BusinessText.Money(Kit.Num(deal, "terms.costPerShow") ?? 0)}.", "warning"));
                }
                IReadOnlyList<BusinessText.TargetLine> targets = BusinessText.TargetLines(Kit.Obj(valuation, "targets"), kind);
                if (targets.Count > 0)
                {
                    content.Add(BusinessUi.SubHeading($"What {networkName} will expect"));
                    content.Add(Targets(targets, kind));
                }
                List<string> refusals = Kit.Arr(valuation, "refusals").Select(refusal => Kit.Str(refusal, "message")).ToList();
                if (refusals.Count > 0) content.Add(BusinessUi.Refusals(refusals, "renew-refusals"));
            }
            content.Add(feedback);

            Button back = Ds.Button("Back", DrawDetail, DsButtonKind.Secondary, "back");
            back.name = "renew-back";
            footer.Add(back);
            footer.Add(Ds.Spacer());
            Button confirm = Ds.Button("Renew", null, DsButtonKind.Primary, "handshake");
            confirm.name = "renew-confirm";
            confirm.SetEnabled(valuation != null && Kit.Str(valuation, "verdict") == "accept");
            confirm.clicked += () => _ = ConfirmRenew(confirm, feedback);
            footer.Add(confirm);
        }

        internal static VisualElement VerdictLine(JToken valuation, string networkName)
        {
            string verdict = Kit.Str(valuation, "verdict");
            VisualElement line = Ds.Row("biz-verdict-line").Named("valuation-verdict");
            line.Add(Ds.Pill(verdict == "accept" ? DsState.Good : DsState.Bad, BusinessText.VerdictLabel(verdict), verdict == "accept" ? "check" : "close", true));
            string first = Kit.Arr(valuation, "refusals").Select(refusal => Kit.Str(refusal, "message")).FirstOrDefault();
            line.Add(Ds.Text(first ?? $"{networkName} would sign these terms.", "biz-verdict-line__text"));
            WhyButton why = BusinessUi.WhyWords($"{networkName}'s answer", BusinessText.VerdictLabel(verdict), Kit.Obj(valuation, "verdictTrace"));
            if (why != null) line.Add(BusinessUi.Quiet(why, line));
            return line;
        }

        private static VisualElement CompareRow(string label, double now, JToken next, bool perBuy, bool lowerIsBetter, JToken uplift, bool exact = false)
        {
            double value = Kit.Num(next, "value") ?? 0;
            VisualElement row = Ds.Row("biz-compare__row");
            row.Add(Ds.Text(label, "biz-compare__label"));
            string Format(double amount) => perBuy ? BusinessText.PerBuyText(amount) : exact ? BusinessText.Exact(amount) : BusinessText.Money(amount);
            row.Add(Ds.Text(Format(now), "biz-compare__now"));
            row.Add(new Icon("chevron-right", "ds-icon--xs", "biz-preview__arrow"));
            row.Add(BusinessUi.Value(Format(value), BusinessUi.WhyTraced($"Renewed {label.ToLowerInvariant()}", next, "money"), "biz-compare__next"));
            VisualElement chips = Ds.Row("biz-compare__chips");
            double change = value - now;
            if (Math.Abs(change) >= 0.5)
            {
                bool good = lowerIsBetter ? change < 0 : change > 0;
                chips.Add(Ds.Pill(good ? DsState.Good : DsState.Bad, perBuy || exact ? (change > 0 ? "+" : TextFormat.Minus) + BusinessText.Exact(Math.Abs(change)) : BusinessText.Signed(change, true)));
            }
            else
            {
                chips.Add(BusinessUi.Quiet("No change"));
            }
            if (uplift != null) chips.Add(Ds.Pill(DsState.Gold, BusinessText.UpliftChipText(Kit.Num(uplift, "share") ?? 0), "star"));
            row.Add(chips);
            return row;
        }

        /// <summary>When a renewal would end: the months counted from the current end date, or today if later.</summary>
        internal static GameDate RenewedEndsOn(string endsOn, string today, int months, string fallback)
        {
            if (!GameDate.TryParse(endsOn, out GameDate end) || !GameDate.TryParse(today, out GameDate now))
            {
                return GameDate.TryParse(fallback, out GameDate given) ? given : default;
            }
            return (end > now ? end : now).AddMonths(months);
        }

        private async Task ConfirmRenew(Button confirm, Label feedback)
        {
            confirm.SetEnabled(false);
            CommandResult<JToken> result = await Kit.Run("broadcast.renegotiate", new JObject { ["dealId"] = dealId, ["months"] = months }, feedback);
            if (!result.Ok)
            {
                confirm.SetEnabled(true);
                return;
            }
            DsOverlay.Toast(anchor, $"Deal with {Kit.Str(deal, "networkName")} renewed until {Kit.Date(Kit.Str(result.Data, "endsOn"))}", DsState.Good);
            mode = "detail";
            await Load();
        }
    }

    /// <summary>
    /// Walking away from a deal (the web's CancelDealDialog): the exit fee from <c>broadcast.cancelPreview</c>
    /// is in the question and the body (with its Why? and what it leaves in the bank) before the
    /// danger button is enabled. A refusal keeps it open with the engine's reason.
    /// </summary>
    public sealed class CancelDealDialog
    {
        private readonly string dealId;
        private readonly string networkName;
        private readonly Action onCancelled;
        private readonly VisualElement anchor;
        private readonly VisualElement content;
        private readonly Button confirm;
        private readonly Label feedback;
        private readonly OverlayHandle handle;

        public static CancelDealDialog Current { get; private set; }

        private CancelDealDialog(VisualElement anchor, JToken deal, Action onCancelled)
        {
            this.anchor = anchor;
            this.onCancelled = onCancelled;
            dealId = Kit.Str(deal, "dealId");
            networkName = Kit.Str(deal, "networkName");
            VisualElement body = Ds.Column("biz-cancel");
            content = Ds.Column("biz-cancel__content").Named("cancel-content");
            content.Add(Ds.Loading("Working out the exit fee…"));
            body.Add(content);
            feedback = Kit.Feedback();
            body.Add(feedback);
            VisualElement footer = Ds.Row("biz-modal-footer");
            footer.Add(Ds.Spacer());
            Button keep = Ds.Button("Keep the deal", () => handle?.Close(), DsButtonKind.Secondary);
            keep.name = "cancel-keep";
            footer.Add(keep);
            confirm = Ds.Button("Cancel deal", () => _ = Confirm(), DsButtonKind.Danger);
            confirm.name = "cancel-confirm";
            confirm.SetEnabled(false);
            footer.Add(confirm);
            handle = BusinessUi.Modal(anchor, "Cancel this deal?", body, footer, "cancel-deal", 600f);
            if (handle != null) handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };
        }

        public bool Ready { get; private set; }

        public static CancelDealDialog Open(VisualElement anchor, JToken deal, Action onCancelled)
        {
            var dialog = new CancelDealDialog(anchor, deal, onCancelled);
            if (dialog.handle == null) return null;
            Current = dialog;
            _ = dialog.Load();
            return dialog;
        }

        private async Task Load()
        {
            QueryResult<JToken> preview = await Kit.Game.Client.Query("broadcast.cancelPreview", new JObject { ["dealId"] = dealId });
            if (!handle.IsOpen) return;
            content.Clear();
            if (!preview.Ok)
            {
                content.Add(BusinessUi.Notice(DsState.Bad, Kit.Reasons(preview.Reasons)));
                return;
            }
            double fee = Kit.Num(preview.Data, "exitFee") ?? 0;
            content.Add(Ds.Text(BusinessText.CancelTitle(networkName, BusinessText.Money(fee)), "biz-cancel__question"));
            VisualElement feeRow = Ds.Row("biz-fee", "biz-fee--danger").Named("cancel-fee");
            feeRow.Add(Ds.Text("Exit fee", "biz-fee__label"));
            feeRow.Add(Ds.Spacer());
            feeRow.Add(BusinessUi.Value(BusinessText.Money(fee), Kit.WhyTrace("Exit fee", fee, Kit.Obj(preview.Data, "trace"), "money"), "biz-fee__amount", "biz-bad"));
            content.Add(feeRow);
            long cash = EngineGame.Current?.ShellData.Snapshot.CashCents ?? 0;
            if (EngineGame.Current != null)
            {
                content.Add(BusinessUi.Quiet($"Your cash goes from {BusinessText.Money(cash)} to {BusinessText.Money(cash - fee)}."));
            }
            content.Add(BusinessUi.Notice(DsState.Warn, $"The deal ends today and no more shows air on {networkName}. Its TV money stops with it.", "warning"));
            Ready = true;
            confirm.SetEnabled(true);
        }

        private async Task Confirm()
        {
            confirm.SetEnabled(false);
            CommandResult<JToken> result = await Kit.Run("broadcast.cancelDeal", new JObject { ["dealId"] = dealId }, feedback);
            if (!result.Ok)
            {
                confirm.SetEnabled(true);
                return;
            }
            DsOverlay.Toast(anchor, "Deal cancelled", DsState.Warn, $"Exit fee paid: {BusinessText.Money(Kit.Num(result.Data, "exitFee") ?? 0)}");
            handle.Close();
            onCancelled?.Invoke();
        }
    }

    /// <summary>
    /// Propose a deal (the web's ProposeDealSheet): pick the show, the length, the timeslot (not on
    /// pay-per-view) and live or taped, and see what the network would do, asked again on every change,
    /// before <b>Propose deal</b>. Each number has its Why?; a deal that loses money every airing, and
    /// pay-per-view's airtime, are said in words. The button stays disabled while the network would refuse.
    /// </summary>
    public sealed class ProposeSheet
    {
        private readonly VisualElement anchor;
        private readonly string networkId;
        private readonly Action<string> onSigned;
        private readonly VisualElement content;
        private readonly VisualElement footer;
        private readonly OverlayHandle handle;
        private JToken network;
        private List<(string value, string label)> shows = new List<(string value, string label)>();
        private string show;
        private string timeslot;
        private bool live;
        private int months;
        private int asked;
        private Button confirm;
        private Label feedback;

        public static ProposeSheet Current { get; private set; }

        private ProposeSheet(VisualElement anchor, string networkId, int defaultMonths, Action<string> onSigned)
        {
            this.anchor = anchor;
            this.networkId = networkId;
            this.onSigned = onSigned;
            months = defaultMonths;
            content = Ds.Column("biz-sheet").Named("propose-sheet");
            content.Add(Ds.Loading("Loading…"));
            footer = Ds.Row("biz-sheet-footer").Named("propose-footer");
            handle = BusinessUi.Sheet(anchor, "Propose a deal", content, "Networks", footer, 680f);
            if (handle != null) handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };
        }

        public JToken Valuation { get; private set; }
        public bool CanPropose => Valuation != null && Kit.Str(Valuation, "verdict") == "accept";

        public static ProposeSheet Open(VisualElement anchor, string networkId, int defaultMonths, Action<string> onSigned)
        {
            if (networkId == null) return null;
            var sheet = new ProposeSheet(anchor, networkId, defaultMonths, onSigned);
            if (sheet.handle == null) return null;
            Current = sheet;
            _ = sheet.Load();
            return sheet;
        }

        private async Task Load()
        {
            string promotionId = Kit.Game.PromotionId;
            (QueryResult<JToken> networks, QueryResult<JToken> profile) = await Kit.Game.Client.Read("networks.propose", reader => (
                reader.Query("broadcast.networks", new JObject { ["promotionId"] = promotionId }),
                reader.Query("promotions.profile", new JObject { ["promotionId"] = promotionId })));
            if (!handle.IsOpen) return;
            network = networks.Ok ? Kit.Arr(networks.Data).FirstOrDefault(row => Kit.Str(row, "networkId") == networkId) : null;
            if (network == null || !profile.Ok)
            {
                content.Clear();
                content.Add(Ds.Empty("warning", "This network can't be asked right now", networks.Ok ? Kit.Reasons(profile.Reasons) : Kit.Reasons(networks.Reasons)));
                return;
            }
            Label title = handle.Content.Q<Label>(className: "ds-overlay-header__title");
            if (title != null) title.text = TextFormat.Upper($"Propose a deal to {Kit.Str(network, "name")}");
            string kind = Kit.Str(network, "kind");
            shows = BusinessText.ShowOptions(kind, Kit.Arr(profile.Data, "shows")).ToList();
            JToken best = Kit.Obj(network, "bestOffer");
            string bestShow = best != null && best.Type == JTokenType.Object ? Kit.Str(best, "eventDefinitionId") ?? BusinessText.AllShowsValue : null;
            show = shows.Any(option => option.value == bestShow) ? bestShow : shows.FirstOrDefault().value;
            timeslot = kind == "ppv" ? "primeTime" : Kit.Str(best, "timeslot") ?? "evening";
            await Ask();
        }

        /// <summary>Changes the proposal (tours use it) and asks the network again.</summary>
        public Task Change(string newShow = null, string newTimeslot = null, bool? newLive = null, int? newMonths = null)
        {
            if (newShow != null) show = newShow;
            if (newTimeslot != null) timeslot = newTimeslot;
            if (newLive.HasValue) live = newLive.Value;
            if (newMonths.HasValue) months = newMonths.Value;
            return Ask();
        }

        private async Task Ask()
        {
            int request = ++asked;
            string kind = Kit.Str(network, "kind");
            string name = Kit.Str(network, "name");
            QueryResult<JToken> answer = null;
            if (show != null)
            {
                answer = await Kit.Game.Client.Query("broadcast.valuation", Args());
                if (request != asked || !handle.IsOpen) return;
            }
            Valuation = answer != null && answer.Ok ? answer.Data : null;
            content.Clear();
            footer.Clear();
            VisualElement head = Ds.Row("biz-sheet__head");
            head.Add(BusinessUi.Logo(Kit.Str(network, "logoRef"), name, "rb-logo--lg"));
            VisualElement headWords = Ds.Column("biz-sheet__head-words");
            headWords.Add(Ds.Text($"{BusinessText.KindLabel(kind)} · {BusinessText.TierText((int)(Kit.Num(network, "reachTier") ?? 0))}", "biz-sheet__head-title"));
            headWords.Add(BusinessUi.Quiet($"Reaches {Kit.Str(network, "coverageLabel")} · {BusinessText.ShortViewers(Kit.Num(network, "coveredPopulation") ?? 0)} people"));
            head.Add(headWords);
            content.Add(head);

            if (shows.Count == 0)
            {
                content.Add(BusinessUi.Notice(DsState.Info, $"You have no show {name} would carry. {(kind == "ppv" ? "Pay-per-view only carries major and flagship shows." : "House shows are never televised.")}"));
                AddFooter(false);
                return;
            }

            VisualElement form = Ds.Column("biz-form");
            form.Add(BusinessUi.Choices("Show", shows, show, value => _ = Change(newShow: value), "propose-show"));
            form.Add(BusinessUi.Choices("Length", BusinessText.DealLengths.Select(value => (value, BusinessText.MonthsText(value))), months, value => _ = Change(newMonths: value), "propose-length"));
            if (kind == "ppv") form.Add(BusinessUi.Quiet("Pay-per-view isn't tied to a timeslot."));
            else form.Add(BusinessUi.Choices("Timeslot", BusinessText.Timeslots.Select(value => (value, BusinessText.TimeslotLabel(value))), timeslot, value => _ = Change(newTimeslot: value), "propose-timeslot"));
            form.Add(BusinessUi.Switch("Live", live, value => _ = Change(newLive: value), "Live shows draw more viewers and earn a little more; taped is the default.", "propose-live"));
            content.Add(form);

            if (Valuation == null)
            {
                content.Add(BusinessUi.Notice(DsState.Bad, answer == null || answer.Ok ? "The network could not be asked." : Kit.Reasons(answer.Reasons)));
                AddFooter(false);
                return;
            }

            JToken valuation = Valuation;
            double income = Kit.Num(valuation, "incomePerAiring.value") ?? 0;
            content.Add(DealSheet.VerdictLine(valuation, name));
            if (income < 0) content.Add(BusinessUi.Notice(DsState.Bad, BusinessText.LosesMoneyText, "warning"));
            if (kind == "ppv") content.Add(BusinessUi.Notice(DsState.Warn, $"{BusinessText.PpvAirtimeText} This deal costs {BusinessText.Money(Kit.Num(valuation, "terms.costPerShow.value") ?? 0)} of airtime a show.", "warning"));

            VisualElement tiles = Ds.Row("biz-tiles", "biz-tiles--sheet").Named("propose-numbers");
            tiles.Add(BusinessUi.Tile("Income per airing", BusinessText.Money(income), "What each airing leaves you with", income < 0 ? DsState.Bad : DsState.Good,
                BusinessUi.WhyTraced("Income per airing", Kit.Obj(valuation, "incomePerAiring"), "money"), null, "propose-income"));
            double projected = Kit.Num(valuation, "projectedViewers.value") ?? 0;
            double expects = Kit.Num(valuation, "benchmark.value") ?? 0;
            tiles.Add(BusinessUi.Tile(kind == "ppv" ? "Projected buys" : "Projected viewers", BusinessText.ShortViewers(projected), $"{name} expects {BusinessText.ShortViewers(expects)}",
                projected >= expects ? DsState.Good : DsState.Warn, BusinessUi.WhyTraced("Projected viewers", Kit.Obj(valuation, "projectedViewers"), "count"), null, "propose-viewers"));
            content.Add(BusinessUi.MarkLast(tiles));

            content.Add(BusinessUi.SubHeading("Terms"));
            content.Add(BusinessUi.Facts(
                ("Fee per show", kind == "ppv" ? BusinessUi.FactText("Pay-per-view pays per buy") : BusinessUi.Value(BusinessText.Money(Kit.Num(valuation, "terms.feePerShow.value") ?? 0), BusinessUi.WhyTraced("Fee per show", Kit.Obj(valuation, "terms.feePerShow"), "money"), "biz-num")),
                (BusinessText.PerThousandLabel(kind), BusinessUi.Value(BusinessText.PerThousandText(kind, Kit.Num(valuation, "terms.perThousandViewers.value") ?? 0), BusinessUi.WhyTraced(BusinessText.PerThousandLabel(kind), Kit.Obj(valuation, "terms.perThousandViewers"), "money"), "biz-num")),
                ("Airtime cost per show", BusinessUi.Value(BusinessText.Money(Kit.Num(valuation, "terms.costPerShow.value") ?? 0), BusinessUi.WhyTraced("Airtime cost", Kit.Obj(valuation, "terms.costPerShow"), "money"), "biz-num")),
                ("Network expects", BusinessUi.Value(BusinessText.ViewersText(expects, kind), BusinessUi.WhyTraced($"What {name} expects", Kit.Obj(valuation, "benchmark"), "count"), "biz-num")),
                ("Runs", BusinessUi.FactText($"{Kit.Date(Kit.Str(valuation, "startsOn"))} to {Kit.Date(Kit.Str(valuation, "endsOn"))}"))));
            if (Kit.Bool(valuation, "becomesTelevised")) content.Add(BusinessUi.Quiet("Signing makes this show a TV show."));

            IReadOnlyList<BusinessText.TargetLine> targets = BusinessText.TargetLines(Kit.Obj(valuation, "targets"), kind);
            if (targets.Count > 0)
            {
                content.Add(BusinessUi.SubHeading($"What {name} will expect"));
                content.Add(DealSheet.Targets(targets, kind));
            }
            List<(string code, string message)> refusals = Kit.Arr(valuation, "refusals").Select(refusal => (Kit.Str(refusal, "code"), Kit.Str(refusal, "message"))).ToList();
            if (refusals.Count > 0)
            {
                content.Add(BusinessUi.SubHeading($"Why {name} would refuse"));
                content.Add(BusinessUi.Refusals(refusals.Select(refusal => refusal.message), "propose-refusals"));
                if (refusals.Any(refusal => refusal.code == "cameraTooLow"))
                {
                    Button production = Ds.Button("Open Production", () =>
                    {
                        handle.Close();
                        ShellController.Current?.Navigator.Go(UI.Navigation.ShellRoute.To(ProductionScreen.ScreenId));
                    }, DsButtonKind.Ghost, "video");
                    production.AddToClassList("ds-btn--link");
                    content.Add(production);
                }
            }
            AddFooter(CanPropose);
        }

        private JObject Args() => new JObject
        {
            ["promotionId"] = Kit.Game.PromotionId,
            ["networkId"] = networkId,
            ["eventDefinitionId"] = show == BusinessText.AllShowsValue || show == null ? JValue.CreateNull() : (JToken)show,
            ["timeslot"] = timeslot,
            ["live"] = live,
            ["months"] = months,
        };

        private void AddFooter(bool enabled)
        {
            feedback = Kit.Feedback();
            content.Add(feedback);
            Button notNow = Ds.Button("Not now", () => handle.Close(), DsButtonKind.Secondary);
            notNow.name = "propose-cancel";
            footer.Add(notNow);
            footer.Add(Ds.Spacer());
            confirm = Ds.Button("Propose deal", () => _ = Submit(), DsButtonKind.Primary, "handshake");
            confirm.name = "propose-submit";
            confirm.SetEnabled(enabled);
            footer.Add(confirm);
        }

        private async Task Submit()
        {
            if (!CanPropose) return;
            confirm.SetEnabled(false);
            CommandResult<JToken> result = await Kit.Run("broadcast.proposeDeal", Args(), feedback);
            if (!result.Ok)
            {
                confirm.SetEnabled(CanPropose);
                return;
            }
            string name = Kit.Str(network, "name");
            handle.Close();
            onSigned?.Invoke(name);
        }
    }
}
