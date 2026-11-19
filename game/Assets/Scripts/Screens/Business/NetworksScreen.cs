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
    /// Business › Networks in the Windows game (UNITY-18), the web's NetworksScreen on the UNITY-11
    /// design system: your TV, streaming and pay-per-view deals, and the networks that would take your
    /// shows. It leads with what TV brings in and any deal in trouble, then two tabs. <b>Your deals</b>:
    /// one row per deal (slot, fee, last and expected viewers, health) with targets in the column
    /// picker; a row opens the deal sheet (terms, health and targets, airings, Renegotiate, Cancel with
    /// the exit fee first). <b>Available networks</b>: who reaches your fans, what they carry and their
    /// best offer; Propose opens the Propose sheet. Reads <c>broadcast.deals</c>, <c>broadcast.networks</c>,
    /// <c>broadcast.incomeSummary</c>, <c>broadcast.deal</c>, <c>broadcast.valuation</c>,
    /// <c>broadcast.cancelPreview</c>; commands <c>broadcast.proposeDeal</c>, <c>broadcast.renegotiate</c>,
    /// <c>broadcast.cancelDeal</c>. Routes: <c>networks?tab=deals|available&amp;deal=&lt;id&gt;&amp;propose=&lt;id&gt;</c>.
    /// Deal warnings never stop a skip (the engine has no broadcast gate): the health badge is the notice.
    /// </summary>
    public static class NetworksScreen
    {
        public const string ScreenId = "networks";
        public const string TabDeals = "deals";
        public const string TabAvailable = "available";

        public static NetworksView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new NetworksView(context);
            Current = view;
            return view.Root;
        }

        /// <summary><c>broadcast.deal.defaultMonths</c> from the rules (24 when it can't be read).</summary>
        internal static int DefaultMonths(QueryResult<JToken> rules)
        {
            if (rules == null || !rules.Ok) return BusinessText.FallbackDefaultMonths;
            JToken row = Kit.Arr(rules.Data).FirstOrDefault(entry => Kit.Str(entry, "key") == "broadcast.deal.defaultMonths");
            return Kit.Num(row, "value") is double months ? (int)months : BusinessText.FallbackDefaultMonths;
        }
    }

    /// <summary>The Networks screen's state and drawing (one per visit).</summary>
    public sealed class NetworksView
    {
        private readonly ScreenContext context;
        private readonly DsTabs tabs;
        private readonly VisualElement summary;
        private readonly VisualElement body;
        private string tab;
        private bool showEnded;
        private string openDeal;
        private string openPropose;

        public NetworksView(ScreenContext context)
        {
            this.context = context;
            ShellRoute route = context.Route;
            tab = route.Param("tab") == NetworksScreen.TabAvailable ? NetworksScreen.TabAvailable : NetworksScreen.TabDeals;
            openDeal = route.Param("deal");
            openPropose = route.Param("propose");

            Root = BusinessUi.Page("screen-networks", "Networks", "The networks that air your shows and pay you for them.", out _);
            summary = Ds.Column("biz-summary").Named("networks-summary");
            Root.Add(summary);
            tabs = new DsTabs().Named("networks-tabs");
            tabs.Add(NetworksScreen.TabDeals, "Your deals", null, "tv").Add(NetworksScreen.TabAvailable, "Available networks", null, "handshake");
            tabs.AddToClassList("biz-tabs");
            tabs.Select(tab, false);
            tabs.Selected += SelectTab;
            Root.Add(tabs);
            body = Ds.Column("biz-body").Named("networks-body");
            Root.Add(body);
            Kit.Live(body, Render);
        }

        public VisualElement Root { get; }
        public string Tab => tab;
        public DsTable<JToken> Table { get; private set; }
        public IReadOnlyList<JToken> Deals { get; private set; } = Array.Empty<JToken>();
        public IReadOnlyList<JToken> Networks { get; private set; } = Array.Empty<JToken>();
        public int DefaultMonths { get; private set; } = BusinessText.FallbackDefaultMonths;

        public void SelectTab(string id)
        {
            if (id == tab) return;
            tab = id;
            tabs.Select(id, false);
            _ = Render();
        }

        public void ShowEnded(bool ended)
        {
            showEnded = ended;
            _ = Render();
        }

        public DealSheet OpenDeal(string dealId) => DealSheet.Open(Root, dealId, DefaultMonths);

        public ProposeSheet OpenPropose(string networkId) => ProposeSheet.Open(Root, networkId, DefaultMonths, Signed);

        private void Signed(string networkName)
        {
            DsOverlay.Toast(Root, $"Deal signed with {networkName}", DsState.Good, "It airs from the show's next date.");
            SelectTab(NetworksScreen.TabDeals);
        }

        private async Task Render()
        {
            string promotionId = Kit.Game?.PromotionId;
            if (promotionId == null)
            {
                summary.Clear();
                body.Clear();
                body.Add(Ds.Empty("tv", "You don't run a promotion", "Only a promotion signs TV deals."));
                return;
            }
            string asked = tab;
            bool ended = showEnded;
            var args = new JObject { ["promotionId"] = promotionId };
            (QueryResult<JToken> deals, QueryResult<JToken> income, QueryResult<JToken> clock, QueryResult<JToken> rules, QueryResult<JToken> networks) =
                await Kit.Game.Client.Read("networks", reader => (
                    reader.Query("broadcast.deals", new JObject { ["promotionId"] = promotionId, ["include"] = ended ? "all" : "active" }),
                    reader.Query("broadcast.incomeSummary", new JObject { ["promotionId"] = promotionId, ["days"] = 30 }),
                    reader.Query("clock.get"),
                    reader.Query("tunables.list", new JObject { ["category"] = "Broadcast" }),
                    asked == NetworksScreen.TabAvailable ? reader.Query("broadcast.networks", args) : null));
            if (asked != tab || ended != showEnded) return;
            DefaultMonths = NetworksScreen.DefaultMonths(rules);
            string today = clock.Ok ? Kit.Str(clock.Data, "date") : null;
            Deals = deals.Ok ? Kit.Arr(deals.Data).ToList() : new List<JToken>();
            DrawSummary(Deals.Where(deal => Kit.Str(deal, "status") == "active").ToList(), income.Ok ? income.Data : null);
            body.Clear();
            if (asked == NetworksScreen.TabAvailable)
            {
                DrawAvailable(networks);
            }
            else
            {
                DrawDeals(deals, today);
            }

            if (openDeal != null)
            {
                string dealId = openDeal;
                openDeal = null;
                OpenDeal(dealId);
            }
            if (openPropose != null)
            {
                string networkId = openPropose;
                openPropose = null;
                OpenPropose(networkId);
            }
        }

        // ---- Lead: TV money and deals in trouble ---------------------------------------------------

        private void DrawSummary(List<JToken> active, JToken income)
        {
            summary.Clear();
            List<JToken> trouble = active.Where(deal =>
            {
                string risk = Kit.Str(deal, "risk");
                return risk == "atRisk" || risk == "cancelling" || Kit.Arr(deal, "upcomingMissed").Any() ||
                       BusinessText.RiskLabel(risk, Kit.Arr(deal, "riskReasons").Select(r => (string)r).ToList()) == BusinessText.MissedAiringLabel;
            }).ToList();
            foreach (JToken deal in trouble.Take(3))
            {
                string risk = Kit.Str(deal, "risk");
                string reason = Kit.Arr(deal, "riskReasons").Select(r => (string)r).FirstOrDefault();
                DsState state = risk == "cancelling" ? DsState.Bad : DsState.Warn;
                string text = $"{Kit.Str(deal, "showName")} on {Kit.Str(deal, "networkName")}: {BusinessText.RiskLabel(risk, Kit.Arr(deal, "riskReasons").Select(r => (string)r).ToList())}" +
                              (reason == null ? "." : $". {TextFormat.Sentence(reason)}");
                VisualElement notice = BusinessUi.Notice(state, text, "warning", $"deal-warning-{Kit.Str(deal, "dealId")}");
                notice.AddToClassList("biz-notice--action");
                string dealId = Kit.Str(deal, "dealId");
                Button open = Ds.Button("Open deal", () => OpenDeal(dealId), DsButtonKind.Ghost);
                open.AddToClassList("ds-btn--link");
                notice.Add(Ds.Spacer());
                notice.Add(open);
                summary.Add(notice);
            }

            VisualElement tiles = Ds.Row("biz-tiles", "biz-tiles--compact").Named("networks-kpis");
            if (income != null)
            {
                double total = Kit.Num(income, "total") ?? 0;
                WhyButton why = Kit.WhyTrace("TV income (30 days)", total, Kit.Obj(income, "trace"), "money", "TV income (30 days)");
                string words = total < 0 ? "Airtime cost more than the networks paid" : BusinessText.LastAiringText(Kit.Obj(income, "lastAiring"));
                tiles.Add(BusinessUi.Tile("TV income · 30 days", BusinessText.Compact(total), words, total < 0 ? DsState.Bad : DsState.Neutral, why, null, "tile-tv-income", "tv"));
            }
            int atRisk = trouble.Count;
            string dealWords = active.Count == 0 ? "No network carries your shows yet"
                : atRisk == 0 ? "All on track with their networks"
                : $"{atRisk} need{(atRisk == 1 ? "s" : string.Empty)} attention";
            tiles.Add(BusinessUi.Tile("Deals running", active.Count.ToString(), dealWords, atRisk > 0 ? DsState.Warn : active.Count > 0 ? DsState.Good : DsState.Neutral, null, null, "tile-deals", "handshake"));
            JToken next = active.OrderBy(deal => Kit.Str(deal, "endsOn")).FirstOrDefault();
            if (next != null)
            {
                int days = (int)(Kit.Num(next, "daysLeft") ?? 0);
                tiles.Add(BusinessUi.Tile("Next deal ends", Kit.Date(Kit.Str(next, "endsOn")), $"{Kit.Str(next, "showName")} on {Kit.Str(next, "networkName")}, {BusinessText.DaysAway(days)}",
                    days <= 60 ? DsState.Warn : DsState.Neutral, null, null, "tile-next-end", "calendar"));
            }
            summary.Add(BusinessUi.MarkLast(tiles));
        }

        // ---- Your deals -----------------------------------------------------------------------------

        private void DrawDeals(QueryResult<JToken> deals, string today)
        {
            VisualElement toolbar = Ds.Row("biz-toolbar").Named("deals-toolbar");
            toolbar.Add(BusinessUi.Quiet("A row opens the deal: its targets, its airings, Renegotiate and Cancel."));
            toolbar.Add(Ds.Spacer());
            toolbar.Add(BusinessUi.Switch("Show ended deals", showEnded, ShowEnded, null, "deals-show-ended"));
            body.Add(toolbar);
            if (!deals.Ok)
            {
                body.Add(Ds.Empty("tv", "Your deals can't be shown", Kit.Reasons(deals.Reasons)));
                Table = null;
                return;
            }
            if (Deals.Count == 0)
            {
                body.Add(Ds.Empty("tv", showEnded ? "No deals, running or ended" : "No TV deals yet",
                    "A TV, streaming or pay-per-view deal pays you for every show it carries. See which networks would take your shows.",
                    "See available networks", () => SelectTab(NetworksScreen.TabAvailable), "handshake"));
                Table = null;
                return;
            }
            DsTable<JToken> table = new DsTable<JToken>(DealColumns(today), Deals).Named("deals-table");
            table.AddToClassList("biz-table");
            table.RowClicked += row => OpenDeal(Kit.Str(row, "dealId"));
            Table = table;
            body.Add(table);
        }

        private static IEnumerable<DsColumn<JToken>> DealColumns(string today)
        {
            yield return new DsColumn<JToken>("deal", "Network and show", row =>
            {
                VisualElement cell = Ds.Row("biz-name-cell");
                cell.Add(BusinessUi.Logo(Kit.Str(row, "logoRef"), Kit.Str(row, "networkName")));
                cell.Add(BusinessUi.Cell($"{Kit.Str(row, "networkName")} · {Kit.Str(row, "showName")}", "ds-cell__text--strong", "biz-name-cell__name"));
                return cell;
            })
            {
                Grow = 1,
                MinWidth = 240,
                Pinned = true,
                SortKey = row => $"{Kit.Str(row, "networkName")} · {Kit.Str(row, "showName")}",
            };
            yield return new DsColumn<JToken>("slot", "Slot", row => BusinessUi.Cell(BusinessText.Slot(row))) { Width = 200 };
            yield return new DsColumn<JToken>("fee", "Fee per show", row => BusinessUi.NumCell(BusinessText.FeeText(Kit.Str(row, "kind"), Kit.Num(row, "terms.feePerShow") ?? 0, Kit.Num(row, "terms.perThousandViewers") ?? 0)))
            {
                Width = 150,
                Align = DsAlign.Right,
                SortKey = row => Kit.Num(row, "terms.feePerShow") ?? 0,
            };
            yield return new DsColumn<JToken>("last", "Last viewers", row =>
            {
                JToken last = Kit.Obj(row, "lastAiring");
                if (last == null || last.Type != JTokenType.Object) return BusinessUi.Muted("No airing yet");
                double viewers = Kit.Num(last, "viewers") ?? 0;
                return BusinessUi.NumWhy(BusinessText.ShortViewers(viewers), BusinessUi.WhyRef($"{Kit.Str(row, "showName")} viewers on {Kit.Date(Kit.Str(last, "airDate"))}", viewers, Kit.Obj(last, "traceRef"), "count"));
            })
            {
                Width = 130,
                Align = DsAlign.Right,
                SortKey = row => Kit.Num(row, "lastAiring.viewers") ?? -1,
                Help = "Viewers (buys on pay-per-view) of the latest airing.",
            };
            yield return new DsColumn<JToken>("expected", "Network expects", row =>
            {
                JToken expected = Kit.Obj(row, "expectedViewers");
                if (expected == null || expected.Type != JTokenType.Object) return BusinessUi.Muted(BusinessText.NoValue);
                return BusinessUi.NumWhy(BusinessText.ShortViewers(Kit.Num(expected, "value") ?? 0), BusinessUi.WhyTraced($"What {Kit.Str(row, "networkName")} expects", expected, "count"));
            })
            {
                Width = 150,
                Align = DsAlign.Right,
                SortKey = row => Kit.Num(row, "expectedViewers.value") ?? -1,
                Help = "What the network expects a show in this slot to draw today.",
            };
            yield return new DsColumn<JToken>("health", "Health", HealthCell)
            {
                Width = 160,
                SortKey = row => Array.IndexOf(new[] { "cancelling", "atRisk", "watch", "safe", "exceeding" }, Kit.Str(row, "risk") ?? string.Empty),
                Help = "How the network sees the deal: Exceeding, Safe, Watch, At risk or Cancelling.",
            };
            yield return new DsColumn<JToken>("targets", "Targets", row =>
            {
                IReadOnlyList<BusinessText.TargetLine> lines = BusinessText.TargetLines(Kit.Obj(row, "targets"), Kit.Str(row, "kind"));
                if (lines.Count == 0) return BusinessUi.Muted(BusinessText.NoValue);
                Label cell = BusinessUi.Cell(lines[0].Short);
                DsTooltip.Attach(cell, string.Join("\n", lines.Select(line => line.Text)), "Targets");
                return cell;
            })
            {
                Width = 190,
                Default = false,
                Help = "The viewers the deal is judged by: stay safe, may cancel, ratings bonus.",
            };
            yield return new DsColumn<JToken>("ends", "Ends", row => BusinessUi.Cell(BusinessText.EndsText(Kit.Str(row, "endsOn"), Kit.Str(row, "status"), today)))
            {
                Width = 230,
                SortKey = row => Kit.Str(row, "endsOn"),
            };
        }

        /// <summary>The health badge (reasons on hover) with its Why?, or why an ended deal ended.</summary>
        internal static VisualElement HealthCell(JToken row)
        {
            string risk = Kit.Str(row, "risk");
            if (risk == null) return BusinessUi.Muted(BusinessText.EndReasonText(Kit.Str(row, "endedReason")));
            List<string> reasons = Kit.Arr(row, "riskReasons").Select(reason => (string)reason).ToList();
            VisualElement cell = Ds.Row("biz-health");
            string label = BusinessText.RiskLabel(risk, reasons);
            VisualElement pill = Ds.Pill(label == BusinessText.MissedAiringLabel ? DsState.Bad : BusinessText.RiskState(risk), label, BusinessText.RiskIcon(risk));
            if (reasons.Count > 0) DsTooltip.Attach(pill, string.Join("\n", reasons), label);
            cell.Add(pill);
            WhyButton why = BusinessUi.WhyRefWords($"{Kit.Str(row, "networkName")}'s view of the deal", BusinessText.RiskName(risk), Kit.Obj(row, "healthTraceRef"));
            if (why != null) cell.Add(BusinessUi.Quiet(why, cell));
            return cell;
        }

        // ---- Available networks ---------------------------------------------------------------------

        private void DrawAvailable(QueryResult<JToken> networks)
        {
            VisualElement toolbar = Ds.Row("biz-toolbar").Named("available-toolbar");
            toolbar.Add(BusinessUi.Quiet("Networks that reach places where fans know you, and the best deal each would offer today."));
            toolbar.Add(Ds.Spacer());
            body.Add(toolbar);
            if (networks == null || !networks.Ok)
            {
                body.Add(Ds.Empty("tv", "The networks can't be shown", networks == null ? null : Kit.Reasons(networks.Reasons)));
                Table = null;
                return;
            }
            Networks = Kit.Arr(networks.Data).ToList();
            if (Networks.Count == 0)
            {
                body.Add(Ds.Empty("tv", "No network reaches your fans yet",
                    "Networks only deal with promotions that are known where they broadcast. Grow your popularity in a region to open its networks."));
                Table = null;
                return;
            }
            DsTable<JToken> table = new DsTable<JToken>(NetworkColumns(), Networks).Named("available-table");
            table.AddToClassList("biz-table");
            Table = table;
            body.Add(table);
        }

        private IEnumerable<DsColumn<JToken>> NetworkColumns()
        {
            yield return new DsColumn<JToken>("network", "Network", row =>
            {
                VisualElement cell = Ds.Row("biz-name-cell");
                cell.Add(BusinessUi.Logo(Kit.Str(row, "logoRef"), Kit.Str(row, "name")));
                cell.Add(BusinessUi.Cell(Kit.Str(row, "name"), "ds-cell__text--strong", "biz-name-cell__name"));
                return cell;
            })
            {
                Grow = 0.7f,
                MinWidth = 200,
                Pinned = true,
                SortKey = row => Kit.Str(row, "name"),
            };
            yield return new DsColumn<JToken>("kind", "Kind", row => BusinessUi.Cell($"{BusinessText.KindLabel(Kit.Str(row, "kind"))} · {BusinessText.TierText((int)(Kit.Num(row, "reachTier") ?? 0))}"))
            {
                Width = 220,
                SortKey = row => Kit.Num(row, "reachTier") ?? 0,
                Help = "Tier 4 networks reach the most people and expect the biggest audiences.",
            };
            yield return new DsColumn<JToken>("reaches", "Reaches", row => BusinessUi.Cell($"{Kit.Str(row, "coverageLabel")} · {BusinessText.ShortViewers(Kit.Num(row, "coveredPopulation") ?? 0)} people"))
            {
                Width = 240,
                SortKey = row => Kit.Num(row, "coveredPopulation") ?? 0,
            };
            yield return new DsColumn<JToken>("carries", "Carries", row =>
            {
                string text = BusinessText.CarriesText(row);
                Label cell = BusinessUi.Cell(text);
                DsTooltip.Attach(cell, text.Replace("; ", "\n"), "Carries");
                return cell;
            })
            {
                Width = 260,
                Default = false,
                Help = "The shows already on the network, by name only: never anyone's money.",
            };
            yield return new DsColumn<JToken>("offer", "Best offer", row =>
            {
                JToken offer = Kit.Obj(row, "bestOffer");
                VisualElement cell = Ds.Row("biz-offer-cell");
                if (offer != null && offer.Type == JTokenType.Object)
                {
                    string verdict = Kit.Str(offer, "verdict");
                    VisualElement pill = Ds.Pill(verdict == "accept" ? DsState.Good : DsState.Bad, BusinessText.VerdictLabel(verdict), verdict == "accept" ? "check" : "close");
                    string refusal = Kit.Str(offer, "firstRefusal.message");
                    if (refusal != null) DsTooltip.Attach(pill, refusal, BusinessText.VerdictLabel(verdict));
                    cell.Add(pill);
                }
                bool loses = (Kit.Num(offer, "incomePerAiring") ?? 0) < 0;
                string words = BusinessText.BestOfferText(Kit.Str(row, "kind"), offer);
                Label text = loses ? BusinessUi.Cell(words, "biz-bad") : BusinessUi.Cell(words);
                DsTooltip.Attach(text, words, "Best offer");
                cell.Add(text);
                return cell;
            })
            {
                Grow = 1.3f,
                MinWidth = 340,
                SortKey = row => Kit.Num(row, "bestOffer.incomePerAiring") ?? double.MinValue,
                Help = "What the network would pay for your best show not yet on it, and whether it would sign today.",
            };
            yield return new DsColumn<JToken>("propose", string.Empty, row =>
            {
                string networkId = Kit.Str(row, "networkId");
                Button propose = Ds.Button("Propose", () => OpenPropose(networkId), DsButtonKind.Secondary);
                propose.name = $"propose-{networkId}";
                propose.AddToClassList("biz-row-button");
                return propose;
            })
            {
                Width = 120,
                Pinned = true,
            };
        }
    }
}
