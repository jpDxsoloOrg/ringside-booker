using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Business
{
    /// <summary>
    /// Business › Production in the Windows game (UNITY-18), the web's ProductionScreen on the UNITY-11
    /// design system: what the production levels cost and do. A money warning leads when cash is going
    /// out faster than it comes in; then the headline cards (show quality ceiling, popularity ceiling,
    /// monthly overhead, show production ahead, cash runway) and the areas in two groups, "On every
    /// show" and "Every month", each with its level, its cost and Why?, and what the level does. − and
    /// + open the change dialog, which prices the change (<c>production.changePreview</c>) before
    /// <c>production.setLevel</c> runs. Reads: <c>production.overview</c>, <c>production.ceiling</c>,
    /// <c>production.cashRunway</c>. No stops of its own.
    /// </summary>
    public static class ProductionScreen
    {
        public const string ScreenId = "production";

        public static ProductionView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new ProductionView(context);
            Current = view;
            return view.Root;
        }
    }

    /// <summary>The Production screen's drawing (one per visit).</summary>
    public sealed class ProductionView
    {
        private static readonly (string kind, string heading, string lead)[] Groups =
        {
            ("perShow", "On every show", "Paid on each show night. Stage, camera, editing and pyro set how good a show can look."),
            ("monthly", "Every month", "Paid on the 1st of each month. Marketing and back office hold up your popularity."),
        };

        private readonly ScreenContext context;
        private readonly VisualElement body;

        public ProductionView(ScreenContext context)
        {
            this.context = context;
            Root = BusinessUi.Page("screen-production", "Production", "How good your shows can look, and what that costs.", out _);
            body = Ds.Column("biz-body").Named("production-body");
            Root.Add(body);
            Kit.Live(body, Render);
        }

        public VisualElement Root { get; }

        /// <summary>The overview last drawn (tours read the rows).</summary>
        public JToken Overview { get; private set; }

        private async Task Render()
        {
            string promotionId = Kit.Game?.PromotionId;
            if (promotionId == null)
            {
                body.Clear();
                body.Add(Ds.Empty("video", "You don't run a promotion", "Only a promotion sets its production."));
                return;
            }
            var args = new JObject { ["promotionId"] = promotionId };
            (QueryResult<JToken> overview, QueryResult<JToken> ceiling, QueryResult<JToken> runway) =
                await Kit.Game.Client.Read("production", reader => (
                    reader.Query("production.overview", args),
                    reader.Query("production.ceiling", args),
                    reader.Query("production.cashRunway", args)));
            body.Clear();
            if (!overview.Ok)
            {
                body.Add(Ds.Empty("warning", "Production can't be shown", Kit.Reasons(overview.Reasons)));
                return;
            }
            JToken data = overview.Data;
            Overview = data;
            if (runway.Ok && BusinessText.RunwayWarns(Kit.Str(runway.Data, "status"))) body.Add(BusinessUi.Verdict(runway.Data, "production-warning"));

            VisualElement tiles = Ds.Row("biz-tiles").Named("production-kpis");
            if (ceiling.Ok) tiles.Add(ShowCeilingTile(ceiling.Data));
            tiles.Add(PopularityCeilingTile(data));
            if (Kit.Obj(data, "monthlyOverhead") is JToken overhead && overhead.Type == JTokenType.Object) tiles.Add(OverheadTile(overhead));
            if (Kit.Obj(data, "upcomingShows") is JToken upcoming && upcoming.Type == JTokenType.Object) tiles.Add(UpcomingTile(upcoming));
            if (runway.Ok) tiles.Add(BusinessUi.RunwayTile(runway.Data));
            body.Add(BusinessUi.MarkLast(tiles));

            string networkName = Kit.Str(data, "tvDeal.networkName");
            bool mine = Kit.Bool(data, "mine");
            List<JToken> rows = Kit.Arr(data, "rows").ToList();
            foreach ((string kind, string heading, string lead) in Groups)
            {
                List<JToken> groupRows = rows.Where(row => Kit.Str(row, "costKind") == kind).ToList();
                if (groupRows.Count == 0) continue;
                VisualElement panel = Ds.Panel(heading, null, null, "biz-areas").Named($"production-{kind}");
                panel.Add(BusinessUi.Quiet(lead));
                foreach (JToken row in groupRows) panel.Add(AreaRow(row, mine, networkName));
                body.Add(panel);
            }
        }

        private static VisualElement ShowCeilingTile(JToken view)
        {
            double ceiling = Kit.Num(view, "ceiling") ?? 0;
            bool qualifies = Kit.Bool(view, "bonusSlot.qualifies");
            string line = BusinessText.BonusSlotLine(qualifies, Kit.Num(view, "bonusSlot.threshold") ?? 0, ceiling, Kit.Str(view, "bonusSlot.minImportance"));
            WhyButton why = Kit.WhyTrace("Show quality ceiling", ceiling, Kit.Obj(view, "ceilingTrace"), "points", "Show quality ceiling");
            return BusinessUi.Tile("Show quality ceiling", Kit.Whole(ceiling), line, qualifies ? DsState.Gold : DsState.Neutral, why, "/100", "tile-show-ceiling", "trophy");
        }

        private static VisualElement PopularityCeilingTile(JToken overview)
        {
            double value = Kit.Num(overview, "popularityCeiling.value") ?? 0;
            int above = (int)(Kit.Num(overview, "regionsAboveCeiling") ?? 0);
            string words = above > 0 ? $"{BusinessText.RegionsAboveText(above)}: popularity there slowly falls back" : "Set by marketing and back office";
            WhyButton why = Kit.WhyTrace("Popularity ceiling", value, Kit.Obj(overview, "popularityCeiling.trace"), "points", "Popularity ceiling");
            return BusinessUi.Tile("Popularity ceiling", Kit.Whole(value), words, above > 0 ? DsState.Warn : DsState.Neutral, why, null, "tile-popularity-ceiling", "star");
        }

        private static VisualElement OverheadTile(JToken overhead)
        {
            double total = Kit.Num(overhead, "total") ?? 0;
            string words = $"Production {BusinessText.Compact(Kit.Num(overhead, "byCategory.production") ?? 0)} · marketing {BusinessText.Compact(Kit.Num(overhead, "byCategory.marketing") ?? 0)} · back office {BusinessText.Compact(Kit.Num(overhead, "byCategory.backOffice") ?? 0)}";
            WhyButton why = Kit.WhyTrace("Monthly overhead", total, Kit.Obj(overhead, "trace"), "money", "Monthly overhead");
            return BusinessUi.Tile("Monthly overhead", BusinessText.Compact(total), words, DsState.Neutral, why, "/month", "tile-overhead", "money");
        }

        private static VisualElement UpcomingTile(JToken upcoming)
        {
            double total = Kit.Num(upcoming, "total") ?? 0;
            int count = (int)(Kit.Num(upcoming, "count") ?? 0);
            string window = BusinessText.ForecastWindowText((int)(Kit.Num(upcoming, "days") ?? 0));
            string words = count == 0 ? $"No shows in the next {window}" : $"{BusinessText.ShowCountText(count)}, paid on each show night";
            WhyButton why = Kit.WhyTrace($"Show production, next {window}", total, Kit.Obj(upcoming, "trace"), "money");
            return BusinessUi.Tile($"Shows, next {window}", BusinessText.Compact(total), words, DsState.Neutral, why, null, "tile-upcoming-shows", "video");
        }

        private VisualElement AreaRow(JToken row, bool mine, string networkName)
        {
            string area = Kit.Str(row, "area");
            string label = Kit.Str(row, "label");
            int level = (int)(Kit.Num(row, "level") ?? 0);
            int minLevel = (int)(Kit.Num(row, "minLevel") ?? 0);
            VisualElement element = Ds.Row("biz-area").Named($"area-{area}");

            VisualElement name = Ds.Column("biz-area__name");
            name.Add(Ds.Text(label, "biz-area__label"));
            if (minLevel > 0) name.Add(Ds.Text(BusinessText.TvFloorText(minLevel, networkName), "biz-area__floor"));
            element.Add(name);

            VisualElement stepper = Ds.Row("biz-stepper");
            if (mine)
            {
                Button down = Ds.IconButton("decrease", level <= minLevel ? (minLevel > 0 ? BusinessText.TvFloorText(minLevel, networkName) : "Already at level 0") : $"Lower {label}",
                    () => ProductionChangeDialog.Open(Root, row, networkName, level - 1), false);
                down.name = $"level-{area}-down";
                down.SetEnabled(level > minLevel);
                stepper.Add(down);
            }
            VisualElement meter = Ds.Row("biz-segments");
            for (int i = 1; i <= BusinessText.ProductionLevelMax; i++)
            {
                VisualElement segment = Ds.El("biz-segment");
                segment.EnableInClassList("biz-segment--on", i <= level);
                segment.EnableInClassList("biz-segment--floor", i <= minLevel);
                meter.Add(segment);
            }
            stepper.Add(meter);
            stepper.Add(Ds.Text($"{level}", "biz-stepper__level"));
            if (mine)
            {
                Button up = Ds.IconButton("add", level >= BusinessText.ProductionLevelMax ? "Already at the top level" : $"Raise {label}",
                    () => ProductionChangeDialog.Open(Root, row, networkName, level + 1), false);
                up.name = $"level-{area}-up";
                up.SetEnabled(level < BusinessText.ProductionLevelMax);
                stepper.Add(up);
            }
            element.Add(stepper);

            VisualElement cost = Ds.Column("biz-area__cost");
            if (mine && Kit.Num(row, "cost") is double amount)
            {
                string basis = Kit.Str(row, "costBasis");
                WhyButton why = Kit.WhyTrace($"{label} {basis}".Trim(), amount, Kit.Obj(row, "costTrace"), "money");
                cost.Add(BusinessUi.Value(BusinessText.Money(amount), why, "biz-area__amount"));
                if (basis != null) cost.Add(Ds.Text(basis, "biz-area__basis"));
            }
            element.Add(cost);

            VisualElement effects = Ds.Column("biz-area__effects");
            List<JToken> lines = Kit.Arr(row, "effects").ToList();
            if (lines.Count == 0)
            {
                effects.Add(Ds.Text(BusinessText.NoEffectText, "biz-area__effect", "biz-quiet-text"));
            }
            foreach (JToken line in lines)
            {
                VisualElement effect = Ds.Row("biz-area__effect-row");
                effect.Add(Ds.Text(Kit.Str(line, "text"), "biz-area__effect"));
                if (Kit.Num(line, "value") is double value)
                {
                    WhyButton why = Kit.WhyTrace(Kit.Str(line, "label"), value, Kit.Obj(line, "trace"), BusinessText.KnownUnit(Kit.Str(line, "unit")));
                    if (why != null) effect.Add(BusinessUi.Quiet(why, effect));
                }
                effects.Add(effect);
            }
            element.Add(effects);
            return element;
        }
    }

    /// <summary>
    /// The production change dialog (the web's ProductionChangeDialog): the level asked for (adjustable
    /// with − and +), the one-time fee with its Why? or "Lowering is free", every number the change
    /// moves before → after with a good/bad chip, and the engine's refusals, all before you confirm.
    /// The confirm waits for the preview and for <c>canApply</c>.
    /// </summary>
    public sealed class ProductionChangeDialog
    {
        private readonly VisualElement anchor;
        private readonly string area;
        private readonly string label;
        private readonly int from;
        private readonly int minLevel;
        private readonly string floorText;
        private readonly VisualElement content;
        private readonly Button confirm;
        private readonly Label title;
        private readonly Label feedback;
        private OverlayHandle handle;
        private int to;
        private int asked;
        private JToken preview;

        public static ProductionChangeDialog Current { get; private set; }

        private ProductionChangeDialog(VisualElement anchor, JToken row, string networkName, int level)
        {
            this.anchor = anchor;
            area = Kit.Str(row, "area");
            label = Kit.Str(row, "label");
            from = (int)(Kit.Num(row, "level") ?? 0);
            minLevel = (int)(Kit.Num(row, "minLevel") ?? 0);
            floorText = minLevel > 0 ? BusinessText.TvFloorText(minLevel, networkName) : null;
            to = Math.Max(minLevel, Math.Min(BusinessText.ProductionLevelMax, level));

            VisualElement bodyRoot = Ds.Column("biz-change");
            content = Ds.Column("biz-change__content").Named("change-content");
            bodyRoot.Add(content);
            feedback = Kit.Feedback();
            bodyRoot.Add(feedback);

            VisualElement footer = Ds.Row("biz-modal-footer");
            footer.Add(Ds.Spacer());
            Button cancel = Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Secondary);
            cancel.name = "change-cancel";
            footer.Add(cancel);
            confirm = Ds.Button("Working it out…", () => _ = Confirm(), DsButtonKind.Primary);
            confirm.name = "change-confirm";
            confirm.SetEnabled(false);
            footer.Add(confirm);

            handle = BusinessUi.Modal(anchor, BusinessText.ChangeTitle(label, from, to), bodyRoot, footer, "production-change", 760f);
            title = handle?.Content.Q<Label>(className: "biz-modal__title");
            if (handle != null) handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };
        }

        public int To => to;
        public JToken Preview => preview;
        public bool CanApply => preview != null && Kit.Bool(preview, "canApply") && (int)(Kit.Num(preview, "to") ?? -1) == to;

        public static ProductionChangeDialog Open(VisualElement anchor, JToken row, string networkName, int level)
        {
            var dialog = new ProductionChangeDialog(anchor, row, networkName, level);
            if (dialog.handle == null) return null;
            Current = dialog;
            _ = dialog.Load();
            return dialog;
        }

        /// <summary>Asks about another level (the dialog's own − and +).</summary>
        public void SetLevel(int level)
        {
            int next = Math.Max(minLevel, Math.Min(BusinessText.ProductionLevelMax, level));
            if (next == to) return;
            to = next;
            _ = Load();
        }

        private async Task Load()
        {
            int level = to;
            asked = level;
            if (title != null) title.text = TextFormat.Upper(BusinessText.ChangeTitle(label, from, level));
            confirm.SetEnabled(false);
            BusinessUi.SetButtonText(confirm, "Working it out…");
            Draw(null, null);
            string promotionId = Kit.Game?.PromotionId;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("production.changePreview", new JObject { ["promotionId"] = promotionId, ["area"] = area, ["level"] = level });
            if (asked != level || handle == null || !handle.IsOpen) return;
            preview = answer.Ok ? answer.Data : null;
            Draw(preview, answer.Ok ? null : Kit.Reasons(answer.Reasons));
            double? fee = Kit.Num(preview, "fee");
            BusinessUi.SetButtonText(confirm, BusinessText.ConfirmLabel(from, level, fee));
            confirm.SetEnabled(CanApply);
        }

        private void Draw(JToken answer, string failure)
        {
            content.Clear();
            VisualElement stepper = Ds.Row("biz-stepper", "biz-stepper--big");
            Button down = Ds.IconButton("decrease", to <= minLevel ? floorText ?? "Already at level 0" : "One level lower", () => SetLevel(to - 1), false);
            down.name = "change-down";
            down.SetEnabled(to > minLevel);
            stepper.Add(down);
            VisualElement meter = Ds.Row("biz-segments", "biz-segments--big");
            for (int i = 1; i <= BusinessText.ProductionLevelMax; i++)
            {
                VisualElement segment = Ds.El("biz-segment");
                segment.EnableInClassList("biz-segment--on", i <= to);
                segment.EnableInClassList("biz-segment--was", i <= from && i > to);
                segment.EnableInClassList("biz-segment--new", i > from && i <= to);
                meter.Add(segment);
            }
            stepper.Add(meter);
            stepper.Add(Ds.Text($"Level {to}", "biz-stepper__level"));
            Button up = Ds.IconButton("add", to >= BusinessText.ProductionLevelMax ? "Already at the top level" : "One level higher", () => SetLevel(to + 1), false);
            up.name = "change-up";
            up.SetEnabled(to < BusinessText.ProductionLevelMax);
            stepper.Add(up);
            content.Add(stepper);
            if (floorText != null && to <= minLevel) content.Add(BusinessUi.Quiet(floorText));

            VisualElement fee = Ds.Row("biz-fee").Named("change-fee");
            if (to <= from)
            {
                fee.Add(Ds.Text(BusinessText.LoweringIsFree, "biz-fee__label"));
            }
            else
            {
                fee.Add(Ds.Text("One-time fee", "biz-fee__label"));
                fee.Add(Ds.Spacer());
                if (answer == null)
                {
                    fee.Add(BusinessUi.Quiet("Working it out…"));
                }
                else
                {
                    double amount = Kit.Num(answer, "fee") ?? 0;
                    fee.Add(BusinessUi.Value(BusinessText.Money(amount), Kit.WhyTrace($"{label} upgrade fee", amount, Kit.Obj(answer, "feeTrace"), "money"), "biz-fee__amount"));
                }
            }
            content.Add(fee);

            if (failure != null) content.Add(BusinessUi.Notice(DsState.Bad, failure));
            if (answer == null)
            {
                if (failure == null) content.Add(Ds.Loading("Working out what changes…"));
                return;
            }

            content.Add(BusinessUi.SubHeading("What changes"));
            VisualElement rows = Ds.Column("biz-preview").Named("change-rows");
            foreach (JToken row in Kit.Arr(answer, "rows"))
            {
                string unit = Kit.Str(row, "unit");
                double before = Kit.Num(row, "before") ?? 0;
                double after = Kit.Num(row, "after") ?? 0;
                VisualElement line = Ds.Row("biz-preview__row").Named($"change-row-{Kit.Str(row, "id")}");
                line.Add(Ds.Text(Kit.Str(row, "label"), "biz-preview__label"));
                line.Add(Ds.Text(BusinessText.UnitValue(before, unit), "biz-preview__before"));
                line.Add(new Icon("chevron-right", "ds-icon--xs", "biz-preview__arrow"));
                WhyButton why = Kit.WhyTrace(Kit.Str(row, "label"), after, Kit.Obj(row, "trace"), BusinessText.KnownUnit(unit == "money/month" ? "money" : unit));
                line.Add(BusinessUi.Value(BusinessText.UnitValue(after, unit), why, "biz-preview__after"));
                VisualElement chipBox = Ds.Row("biz-preview__chip");
                chipBox.Add(after == before
                    ? BusinessUi.Quiet("No change")
                    : Ds.Pill(BusinessText.ChangeState(before, after, unit), BusinessText.ChangeText(before, after, unit)));
                line.Add(chipBox);
                rows.Add(line);
            }
            content.Add(rows);
            List<string> reasons = Kit.Arr(answer, "reasons").Select(reason => Kit.Str(reason, "message")).ToList();
            if (reasons.Count > 0) content.Add(BusinessUi.Refusals(reasons, "change-refusals"));
        }

        private async Task Confirm()
        {
            if (!CanApply) return;
            confirm.SetEnabled(false);
            int level = to;
            CommandResult<JToken> result = await Kit.Run("production.setLevel", new JObject { ["promotionId"] = Kit.Game.PromotionId, ["area"] = area, ["level"] = level }, feedback);
            if (!result.Ok)
            {
                confirm.SetEnabled(CanApply);
                return;
            }
            double fee = Kit.Num(result.Data, "fee") ?? 0;
            DsOverlay.Toast(anchor, fee > 0 ? $"{label} raised to level {level} for {BusinessText.Money(fee)}" : $"{label} set to level {level}", DsState.Good);
            handle?.Close();
        }
    }
}
