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
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// One contract in a side sheet (the web's ContractSheet + ContractDetailView): the decision first
    /// (a request to leave with both answers and what each costs), then the terms, dates, titles and
    /// morale. The footer has Got it for a new expiry notice, Renew, and Release (Call off deal for a
    /// signed one) with the severance preview. Redraws as the world changes.
    /// </summary>
    public static class ContractSheet
    {
        /// <summary>The sheet open now, if any (tours and the skip check press its buttons).</summary>
        public static OverlayHandle Current { get; private set; }

        public static OverlayHandle Open(VisualElement anchor, string employmentId, ContractRules rules, ContractsView view = null)
        {
            Current?.Close();
            VisualElement body = Ds.Column("ct-sheet").Named("contract-sheet");
            ContractUi.Style(body);
            VisualElement footer = Ds.Row("ct-sheet__footer").Named("contract-sheet-footer");
            OverlayHandle handle = null;
            // Bind before opening: the binding draws when the body joins the panel (the handle is read once the draw's queries are back).
            Kit.Live(body, () => Render(anchor, body, footer, () => handle, employmentId, rules, view));
            handle = DsOverlay.SideSheet(anchor, "Contract", body, "CONTRACT", footer, 560f);
            if (handle == null) return null;
            ContractUi.Style(handle.Entry);
            Current = handle;
            handle.Closed += () =>
            {
                if (Current == handle) Current = null;
            };
            return handle;
        }

        private static async Task Render(VisualElement anchor, VisualElement body, VisualElement footer, System.Func<OverlayHandle> handleOf, string employmentId,
            ContractRules rules, ContractsView view)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> detailResult = await client.Query("contracts.detail", new JObject { ["employmentId"] = employmentId });
            JToken detail = detailResult.Ok ? detailResult.Data : null;
            JToken answer = null;
            JToken renewAsk = null;
            bool own = detail != null && detail.Type != JTokenType.Null && !Kit.Bool(detail, "termsPrivate");
            string status = Kit.Str(detail, "status");
            bool live = own && (status == "active" || status == "signed");
            bool openRequest = own && Kit.Str(detail, "request.status") == "open";
            if (openRequest) answer = (await client.Query("contracts.answerPreview", new JObject { ["employmentId"] = employmentId })).Data;
            string promotionId = Kit.Game.PromotionId;
            bool renewable = live && Kit.Str(detail, "endsOn") != null && Kit.Str(detail, "promotionId") == promotionId;
            bool insideWindow = renewable && Kit.Num(detail, "daysLeft") is double daysLeft && daysLeft <= rules.RenewalWindowDays;
            JToken renewalTalks = null;
            if (insideWindow)
            {
                QueryResult<JToken> offers = await client.Query("contracts.offers", new JObject { ["promotionId"] = promotionId, ["status"] = "open" });
                renewalTalks = Kit.Arr(offers.Data).FirstOrDefault(row => Kit.Str(row, "personId") == Kit.Str(detail, "personId") && Kit.Str(row, "kind") == "renewal");
                if (renewalTalks == null)
                {
                    renewAsk = (await client.Query("contracts.askingTerms", new JObject
                    {
                        ["promotionId"] = promotionId, ["personId"] = Kit.Str(detail, "personId"), ["renewalOf"] = employmentId,
                    })).Data;
                }
            }

            OverlayHandle handle = handleOf();
            Label title = handle?.Entry.Q<Label>(className: "ds-overlay-header__title");
            body.Clear();
            footer.Clear();
            if (detail == null || detail.Type == JTokenType.Null)
            {
                body.Add(Ds.Empty("contracts", "That contract could not be found.", null));
                return;
            }
            string ringName = Kit.Str(detail, "ringName");
            if (title != null) title.text = TextFormat.Upper(ringName);

            // Who.
            VisualElement hero = Ds.Row("ds-row--top", "ct-hero");
            hero.Add(ContractUi.Portrait(Kit.Str(detail, "imageRef"), "ds-portrait--md", Kit.Arr(detail, "titles").Any(), ringName));
            VisualElement words = Ds.Column("ct-hero__words");
            words.Add(Ds.Text(TextFormat.Upper(ringName), "ds-type-title", "ct-hero__name"));
            words.Add(Ds.Text($"{ContractText.RoleText(Kit.Str(detail, "role"), Kit.Str(detail, "push"))} at {Kit.Str(detail, "promotionName")}", "ds-type-caption", "ds-wrap"));
            if (live) words.Add(ContractUi.Chips(ContractText.StatusChips(detail, rules.ExpiringSoonDays, rules.ExpiringWindowDays, ignoreEnd: true), 4));
            hero.Add(words);
            body.Add(hero);

            if (!own)
            {
                body.Add(ContractUi.Facts(("Kind", ContractUi.FactText(ContractText.KindLabel(Kit.Str(detail, "kind"))))));
                body.Add(Dates(detail));
                body.Add(ContractUi.Notice(DsState.Neutral, ContractText.TermsPrivate, "lock"));
                return;
            }

            // The decision first.
            if (Kit.Obj(detail, "request") != null) body.Add(RequestPanel(anchor, detail, answer, rules, view, handle));

            if (renewable && !insideWindow)
            {
                body.Add(ContractUi.Notice(DsState.Neutral, ContractText.RenewalWindow(rules.RenewalWindowDays) + ".", "clock"));
            }
            else if (renewAsk != null && Kit.Obj(renewAsk, "refusal") != null)
            {
                VisualElement refusal = Ds.Row("ct-notice", Ds.StateClass(DsState.Warn));
                refusal.Add(new Icon("morale", "ds-icon--sm", "ct-notice__icon"));
                refusal.Add(Ds.Text(Kit.Str(renewAsk, "refusal.message"), "ct-notice__text"));
                JToken decision = Kit.Obj(renewAsk, "renewalDecision");
                UI.Why.WhyButton why = decision == null ? null : ContractWhy.Words($"{ringName}'s willingness to renew", Kit.Bool(decision, "value") ? "Willing" : "Not willing", Kit.Obj(decision, "trace"));
                if (why != null) refusal.Add(why);
                body.Add(refusal);
            }

            body.Add(Ds.SectionHeader("Terms"));
            JToken severance = Kit.Obj(detail, "severance");
            body.Add(ContractUi.Facts(
                ("Kind", ContractUi.FactText(ContractText.KindLabel(Kit.Str(detail, "kind")) + (Kit.Bool(detail, "exclusive") ? ", exclusive" : string.Empty))),
                ("Wage", ContractUi.FactText($"{ContractText.Money(Kit.Num(detail, "monthlyWage") ?? 0)} a month")),
                ("Per appearance", ContractUi.FactText(ContractText.Money(Kit.Num(detail, "perAppearanceFee") ?? 0))),
                ("Signing bonus", ContractUi.FactText(ContractText.Money(Kit.Num(detail, "signingBonus") ?? 0))),
                ("Shares", ContractUi.FactText($"Gate {BasisPoints(Kit.Num(detail, "shares.gateBp"))} · Merch {BasisPoints(Kit.Num(detail, "shares.merchBp"))} · TV {BasisPoints(Kit.Num(detail, "shares.broadcastBp"))}")),
                ("Appearance cap", ContractUi.FactText(Kit.Num(detail, "appearanceCap") is double cap ? $"{TextFormat.Number((long)cap)} a year" : "None")),
                ("Perks", ContractUi.FactText(Kit.Arr(detail, "perks").Any() ? string.Join(", ", Kit.Arr(detail, "perks").Select(perk => ContractText.PerkLabel((string)perk))) : "None")),
                ("Release today", severance == null ? null : ContractUi.Value(ContractText.Money(Kit.Num(severance, "value")),
                    ContractWhy.Number($"{ringName}'s severance today", severance, "money"), "ds-kv__value"))));

            body.Add(Ds.SectionHeader("Dates"));
            body.Add(Dates(detail));

            List<string> titles = Kit.Arr(detail, "titles").Select(item => Kit.Str(item, "name")).ToList();
            if (titles.Count > 0)
            {
                body.Add(Ds.SectionHeader("Titles held"));
                VisualElement row = Ds.Row("ds-row--wrap", "ct-chips");
                foreach (string name in titles) row.Add(Ds.Pill(DsState.Gold, name, "crown"));
                body.Add(row);
            }

            body.Add(Ds.SectionHeader("Morale"));
            JToken unhappy = Kit.Obj(detail, "unhappy");
            VisualElement unhappyValue = null;
            if (unhappy != null)
            {
                double days = Kit.Num(unhappy, "days") ?? 0;
                UI.Why.WhyButton why = ContractWhy.Ref($"{ringName}'s unhappy days", days, Kit.Obj(unhappy, "traceRef"), "days");
                unhappyValue = Kit.Bool(unhappy, "paused")
                    ? ContractUi.Value($"Clock paused: in a hot storyline ({ContractText.Days(days)})", why, "ds-kv__value")
                    : ContractUi.Value($"{ContractText.Days(days)} of {TextFormat.Number((long)(Kit.Num(unhappy, "of") ?? 0))} before asking to leave", why, "ds-kv__value");
            }
            body.Add(ContractUi.Facts(
                ("Morale", ContractUi.FactText(ContractText.Signed(Kit.Num(detail, "morale") ?? 0))),
                ("Unhappy", unhappyValue)));

            if (ScreenRegistry.IsLive(ScreenIds.Worker))
            {
                string personId = Kit.Str(detail, "personId");
                Button profile = Ds.Button($"Open {ringName}'s profile", () =>
                {
                    handle.Close();
                    ShellController.Current?.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId));
                }, DsButtonKind.Ghost, "user");
                profile.name = "contract-profile";
                profile.AddToClassList("ds-btn--link");
                body.Add(profile);
            }

            // Footer: Got it, Renew, Release.
            if (!live) return;
            if (Kit.Str(detail, "notice") == "unseen")
            {
                Button gotIt = Ds.Button("Got it", async () =>
                {
                    CommandResult<JToken> result = await Kit.Run("contracts.acknowledgeExpiries", new JObject { ["employmentIds"] = new JArray(employmentId) });
                    if (!result.Ok) DsOverlay.Toast(anchor, Kit.Reasons(result.Reasons), DsState.Bad);
                }, DsButtonKind.Primary, "check");
                gotIt.name = "contract-got-it";
                footer.Add(gotIt);
            }
            if (renewable)
            {
                if (renewalTalks != null)
                {
                    string negotiationId = Kit.Str(renewalTalks, "negotiationId");
                    Button open = Ds.Button("Open talks", () => NegotiationSheet.Open(anchor, NegotiationTarget.Talks(negotiationId)), DsButtonKind.Secondary, "handshake");
                    open.name = "contract-renew";
                    footer.Add(open);
                }
                else
                {
                    Button renew = Ds.Button("Renew", () => NegotiationSheet.Open(anchor, NegotiationTarget.Renewal(employmentId)), DsButtonKind.Secondary, "handshake");
                    renew.name = "contract-renew";
                    bool refused = renewAsk != null && Kit.Obj(renewAsk, "refusal") != null;
                    renew.SetEnabled(insideWindow && !refused);
                    footer.Add(renew);
                }
            }
            footer.Add(Ds.Spacer());
            if (!openRequest)
            {
                bool signed = status == "signed";
                Button release = Ds.Button(signed ? "Call off deal" : "Release", () => ReleaseDialog.Open(anchor, employmentId, ringName, handle), DsButtonKind.Danger, "user-minus");
                release.name = "contract-release";
                footer.Add(release);
            }
        }

        private static string BasisPoints(double? bp)
        {
            double value = (bp ?? 0) / 100.0;
            return value == System.Math.Round(value) ? $"{value:0}%" : $"{value:0.#}%";
        }

        private static VisualElement Dates(JToken detail) => ContractUi.Facts(
            ("Starts", ContractUi.FactText(ContractText.Date(Kit.Str(detail, "startsOn")))),
            ("Ends", ContractUi.FactText(Kit.Str(detail, "endsOn") is string ends ? ContractText.Date(ends) : ContractText.NoEndDate)),
            ("Days left", Kit.Num(detail, "daysLeft") is double days ? ContractUi.FactText(ContractText.Days(days)) : null),
            ("Ended", Kit.Str(detail, "endedOn") is string ended ? ContractUi.FactText(ContractText.Date(ended)) : null));

        /// <summary>
        /// A worker who wants to leave: both answers side by side with what each costs and its Why?.
        /// Grant asks first (it ends the contract and pays); Refuse does not. After a refusal: the
        /// daily walk-out chance and when they settle down.
        /// </summary>
        private static VisualElement RequestPanel(VisualElement anchor, JToken detail, JToken answer, ContractRules rules, ContractsView view, OverlayHandle handle)
        {
            string ringName = Kit.Str(detail, "ringName");
            string employmentId = Kit.Str(detail, "employmentId");
            VisualElement panel = Ds.Column("ct-request", Ds.StateClass(DsState.Bad)).Named("release-request");
            if (Kit.Str(detail, "request.status") != "open")
            {
                panel.AddToClassList(Ds.StateClass(DsState.Warn));
                panel.Add(Ds.Text($"You refused {ringName}'s request to leave.", "ct-request__headline"));
                if (Kit.Arr(detail, "perks").Any(perk => (string)perk == "ironClad"))
                {
                    panel.Add(Ds.Text("Iron-clad: they can’t walk out.", "ct-request__line"));
                }
                else if (Kit.Obj(detail, "walkout") is JToken walkout)
                {
                    double chance = Kit.Num(walkout, "chance") ?? 0;
                    panel.Add(ContractUi.Value($"Daily walk-out chance {ContractText.Percent(chance)}",
                        ContractWhy.Ref($"{ringName}'s daily walk-out chance", chance, Kit.Obj(walkout, "traceRef"), "ratio"), "ct-request__line"));
                }
                panel.Add(Ds.Text($"Settles down when morale is above {ContractText.Signed(rules.SettlesAbove)}.", "ct-quiet"));
                return panel;
            }

            panel.Add(Ds.Text(ContractText.RequestHeadline(ringName, Kit.Obj(detail, "request")), "ct-request__headline", "ds-wrap"));
            if (answer == null)
            {
                panel.Add(Ds.Text("Working out both answers…", "ct-quiet"));
                return panel;
            }
            if (Kit.Str(answer, "kind") == "refused")
            {
                panel.Add(Ds.Text(string.Join(" ", Kit.Arr(answer, "reasons").Select(reason => Kit.Str(reason, "message"))), "ct-request__line", "ds-wrap"));
                return panel;
            }
            Label error = Ds.Text(string.Empty, "ct-field__error");
            error.SetShown(false);

            VisualElement outcomes = Ds.Row("ds-row--top", "ct-outcomes");
            JToken grantSeverance = Kit.Obj(answer, "grantSeverance");
            double grantCost = Kit.Num(grantSeverance, "value") ?? 0;
            VisualElement grant = Ds.Column("ct-outcome");
            grant.Add(Ds.Text("LET THEM GO", "ct-outcome__title"));
            grant.Add(Ds.Text("They leave now. You pay", "ct-outcome__line"));
            grant.Add(ContractUi.Value(ContractText.Money(grantCost), ContractWhy.Number($"Severance if you let {ringName} go", grantSeverance, "money"), "ct-outcome__value"));
            Button grantButton = Ds.Button("Grant", () =>
            {
                double cashBefore = Kit.Num(answer, "cashBefore") ?? 0;
                VisualElement confirmBody = Ds.Column();
                confirmBody.Add(Ds.Text($"Their contract ends today and you pay {ContractText.Money(grantCost)}. Cash after: {ContractText.Money(cashBefore - grantCost)}.", "ds-wrap", "ct-modal__text"));
                VisualElement confirmFooter = Ds.Row();
                OverlayHandle confirm = null;
                confirmFooter.Add(Ds.Button("Cancel", () => confirm?.Close(), DsButtonKind.Ghost));
                Button go = Ds.Button("Grant", async () =>
                {
                    CommandResult<JToken> result = await Kit.Run("contracts.answerReleaseRequest", new JObject { ["employmentId"] = employmentId, ["answer"] = "grant" });
                    confirm?.Close();
                    if (!result.Ok)
                    {
                        error.text = Kit.Reasons(result.Reasons);
                        error.SetShown(true);
                        return;
                    }
                    handle.Close();
                    double paid = Kit.Num(result.Data, "severance") ?? grantCost;
                    DsOverlay.Toast(anchor, $"Let {ringName} go. Severance {ContractText.Money(paid)}", DsState.Good);
                }, DsButtonKind.Danger);
                go.name = "release-grant-confirm";
                confirmFooter.Add(go);
                confirm = ContractUi.Modal(anchor, $"Let {ringName} go?", confirmBody, confirmFooter, "release-grant-modal");
            }, DsButtonKind.Danger);
            grantButton.name = "release-grant";
            grant.Add(grantButton);
            outcomes.Add(grant);

            VisualElement refuse = Ds.Column("ct-outcome");
            refuse.Add(Ds.Text("KEEP THEM", "ct-outcome__title"));
            refuse.Add(Ds.Text($"Morale {ContractText.Signed(Kit.Num(answer, "refuseMoraleDelta") ?? 0)}, then", "ct-outcome__line"));
            if (Kit.Bool(answer, "ironClad"))
            {
                refuse.Add(Ds.Text("Iron-clad: they can’t walk out.", "ct-outcome__value"));
            }
            else
            {
                JToken walkout = Kit.Obj(answer, "walkoutChanceAfterRefusal");
                refuse.Add(ContractUi.Value($"{ContractText.Percent(Kit.Num(walkout, "value") ?? 0)} daily walk-out chance",
                    ContractWhy.Number($"{ringName}'s daily walk-out chance if refused", walkout, "ratio"), "ct-outcome__value"));
            }
            Button refuseButton = Ds.Button("Refuse", async () =>
            {
                CommandResult<JToken> result = await Kit.Run("contracts.answerReleaseRequest", new JObject { ["employmentId"] = employmentId, ["answer"] = "refuse" });
                if (!result.Ok)
                {
                    error.text = Kit.Reasons(result.Reasons);
                    error.SetShown(true);
                    return;
                }
                DsOverlay.Toast(anchor, $"Refused {ringName}'s request to leave.", DsState.Warn);
            }, DsButtonKind.Secondary);
            refuseButton.name = "release-refuse";
            refuse.Add(refuseButton);
            outcomes.Add(refuse);
            panel.Add(outcomes);
            panel.Add(error);
            return panel;
        }
    }

    /// <summary>
    /// Release (or, for a signed deal that has not started, Call off deal): a danger confirm whose body
    /// is the engine's preview, so the player sees the severance with its Why?, the cash after and
    /// every warning before agreeing. When the amount moved meanwhile it stays open, says so and shows
    /// the new amount.
    /// </summary>
    public static class ReleaseDialog
    {
        public const string SeveranceChangedText = "The amount changed; check it again.";

        public static OverlayHandle Current { get; private set; }

        public static OverlayHandle Open(VisualElement anchor, string employmentId, string ringName, OverlayHandle contractSheet)
        {
            VisualElement body = Ds.Column("ct-release").Named("release-body");
            VisualElement footer = Ds.Row();
            OverlayHandle handle = ContractUi.Modal(anchor, $"Release {ringName}?", body, footer, "release-modal");
            if (handle == null) return null;
            Current = handle;
            handle.Closed += () =>
            {
                if (Current == handle) Current = null;
            };
            Label error = Ds.Text(string.Empty, "ct-field__error");
            error.SetShown(false);
            JToken preview = null;

            Button cancel = Ds.Button("Cancel", handle.Close, DsButtonKind.Ghost);
            footer.Add(cancel);
            Button confirm = Ds.Button("Release", null, DsButtonKind.Danger, "user-minus");
            confirm.name = "release-confirm";
            confirm.SetEnabled(false);
            footer.Add(confirm);
            confirm.clicked += async () =>
            {
                if (preview == null || Kit.Str(preview, "kind") != "ok") return;
                confirm.SetEnabled(false);
                double expected = Kit.Num(preview, "severance.value") ?? 0;
                CommandResult<JToken> result = await Kit.Game.Client.Command("contracts.release", new JObject { ["employmentId"] = employmentId, ["expectedSeverance"] = expected });
                if (result.Ok)
                {
                    handle.Close();
                    contractSheet?.Close();
                    DsOverlay.Toast(anchor, $"Released {ringName}. Severance {ContractText.Money(Kit.Num(result.Data, "severance") ?? expected)}", DsState.Good,
                        (Kit.Num(result.Data, "severance") ?? 0) > 0 ? "It's in the ledger under Finances." : null);
                    return;
                }
                bool moved = result.Reasons.Any(reason => reason.Code == "severanceChanged");
                error.text = moved ? SeveranceChangedText : Kit.Reasons(result.Reasons);
                error.SetShown(true);
                await Load();
            };

            async Task Load()
            {
                QueryResult<JToken> answer = await Kit.Game.Client.Query("contracts.releasePreview", new JObject { ["employmentId"] = employmentId });
                preview = answer.Ok ? answer.Data : null;
                body.Clear();
                if (preview == null)
                {
                    body.Add(Ds.Text(answer.ReasonText ?? "That contract could not be found.", "ds-wrap"));
                    return;
                }
                if (Kit.Str(preview, "kind") == "refused")
                {
                    body.Add(Ds.Text(string.Join(" ", Kit.Arr(preview, "reasons").Select(reason => Kit.Str(reason, "message"))), "ds-wrap", "ct-modal__text"));
                    return;
                }
                bool withdraw = Kit.Str(preview, "mode") == "withdraw";
                Label title = handle.Entry.Q<Label>(className: "ds-overlay-header__title");
                if (title != null) title.text = TextFormat.Upper(withdraw ? $"Call off the deal with {ringName}?" : $"Release {ringName}?");
                Label confirmLabel = confirm.Q<Label>(className: "ds-btn__label");
                if (confirmLabel != null) confirmLabel.text = TextFormat.Upper(withdraw ? "Call off deal" : "Release");
                body.Add(Ds.Text(withdraw
                    ? $"{ringName} has signed but not started. Calling the deal off pays them part of what they were promised."
                    : $"{ringName} leaves today and is paid severance for the rest of the contract.", "ds-wrap", "ct-modal__text"));
                JToken severance = Kit.Obj(preview, "severance");
                double cashAfter = Kit.Num(preview, "cashAfter") ?? 0;
                body.Add(ContractUi.Facts(
                    ("Severance", ContractUi.Value(ContractText.Money(Kit.Num(severance, "value")), ContractWhy.Number($"{ringName}'s severance", severance, "money"), "ds-kv__value")),
                    ("Cash now", ContractUi.FactText(ContractText.Money(Kit.Num(preview, "cashBefore")))),
                    ("Cash after", Ds.Text(ContractText.Money(cashAfter), "ds-kv__value", cashAfter < 0 ? "ct-bad" : "ct-plain"))));
                List<JToken> warnings = Kit.Arr(preview, "warnings").ToList();
                if (warnings.Count > 0)
                {
                    body.Add(Ds.Text("BEFORE YOU RELEASE", "ct-field__label", "ct-gap-top"));
                    foreach (JToken warning in warnings) body.Add(ContractUi.Notice(DsState.Warn, Kit.Str(warning, "message")));
                }
                body.Add(error);
                confirm.SetEnabled(true);
            }

            body.Add(Ds.Text("Working out the cost…", "ct-quiet"));
            _ = Load();
            return handle;
        }
    }
}
