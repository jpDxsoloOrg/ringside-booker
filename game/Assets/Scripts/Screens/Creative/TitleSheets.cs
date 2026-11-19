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
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// The Titles screen's sheets (UNITY-16): create and edit (a side sheet that leads with name,
    /// brand, holders and division, with weights and colour under More options), award (who can
    /// hold it, teams first for tag and trios titles, a confirm when it strips a champion) and the
    /// vacate, retire and reactivate confirms. Nothing changes on screen before the engine says yes;
    /// refusals stay in the sheet in the engine's words.
    /// </summary>
    public static class TitleSheets
    {
        /// <summary>The most people the award list draws; search narrows a long roster.</summary>
        public const int MaxPeople = 120;

        /// <summary>The sheet or modal open last (tours read it).</summary>
        public static OverlayHandle Current { get; private set; }

        /// <summary>The card's menu: the title's actions, then Open.</summary>
        public static void OpenMenu(VisualElement anchor, JToken row, Action<string> open)
        {
            string id = Kit.Str(row, "titleId");
            IReadOnlyList<string> actions = TitleText.RowActions(Kit.Bool(row, "editable"), Kit.Str(row, "status"), Kit.Obj(row, "champion") != null);
            var items = actions
                .Select(action => (TitleText.ActionLabel(action), TitleText.ActionIcon(action), TitleText.IsDanger(action), (Action)(() => Run(anchor, action, row, null))))
                .ToList();
            items.Add(("Open", "chevron-right", false, () => open(id)));
            Current = CreativeUi.Menu(anchor, items, "title-menu");
        }

        /// <summary>Opens the sheet or confirm an action asks for.</summary>
        public static void Run(VisualElement anchor, string action, JToken row, string promotionId)
        {
            switch (action)
            {
                case TitleText.Edit:
                    OpenForm(anchor, row, Kit.Str(row, "promotionId"));
                    break;
                case TitleText.Award:
                    OpenAward(anchor, row);
                    break;
                default:
                    OpenEndOrReturn(anchor, action, row);
                    break;
            }
        }

        // ---- Vacate, retire, reactivate ---------------------------------------------------------------

        public static void OpenEndOrReturn(VisualElement anchor, string kind, JToken row)
        {
            string name = Kit.Str(row, "name");
            (string title, string body, string confirm, bool danger) = TitleText.EndOrReturnCopy(kind, name, Kit.Str(row, "champion.label"));
            Current = CreativeUi.Confirm(anchor, title, body, confirm, danger, async () =>
            {
                string refused = await CreativeUi.Run("titles." + kind, new JObject { ["titleId"] = Kit.Str(row, "titleId") });
                if (refused == null) DsOverlay.Toast(anchor, TitleText.DoneText(kind, name));
                return refused;
            }, "title-" + kind);
        }

        // ---- Create and edit ------------------------------------------------------------------------

        /// <summary>The create sheet (<paramref name="row"/> null) or the edit sheet for a title's row.</summary>
        public static async void OpenForm(VisualElement anchor, JToken row, string promotionId)
        {
            EngineGame game = Kit.Game;
            if (game == null || promotionId == null) return;
            bool create = row == null;
            List<(string id, string name)> brands = new List<(string, string)>();
            try
            {
                QueryResult<JToken> profile = await game.Client.Query("promotions.profile", new JObject { ["promotionId"] = promotionId });
                if (profile.Ok) brands = Kit.Arr(profile.Data, "header.brands").Select(brand => (Kit.Str(brand, "brandId"), Kit.Str(brand, "name"))).ToList();
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
            }
            string ownBrand = Kit.Str(row, "brandId");
            if (ownBrand != null && brands.All(brand => brand.id != ownBrand))
            {
                brands.Add((ownBrand, $"{Kit.Str(row, "brandName") ?? "Old brand"} (not running)"));
            }

            TitleText.Form form = create ? new TitleText.Form() : TitleText.Form.FromRow(row);
            bool held = !create && Kit.Obj(row, "champion") != null;

            VisualElement body = Ds.Column("cr-form").Named("title-form");
            VisualElement general = CreativeUi.Problem("title-form-problem");
            body.Add(general);
            var name = new CreativeUi.Field("Name", form.Name, text => form.Name = text, $"Up to {TitleText.NameMax} characters.", "title-name", TitleText.NameMax);
            body.Add(name);
            var brandChoices = brands.Select(brand => (brand.id, brand.name)).ToList();
            brandChoices.Add((TitleText.PromotionWide, TitleText.PromotionWideLabel));
            var brand = new CreativeUi.ChoiceGroup<string>("Brand", brandChoices, form.Brand, value => form.Brand = value, "title-brand");
            body.Add(brand);
            var holders = new CreativeUi.ChoiceGroup<int>("Holders", new[] { (1, "Singles"), (2, "Tag team"), (3, "Trios") }, form.HolderCount,
                value => form.HolderCount = value, "title-holders", held ? TitleText.HoldersLockedHint : null);
            holders.SetLocked(held);
            body.Add(holders);
            var division = new CreativeUi.ChoiceGroup<string>("Division", TitleText.Divisions, form.Gender, value => form.Gender = value, "title-division");
            body.Add(division);
            CreativeUi.ChoiceGroup<string> tier = null;
            if (create)
            {
                tier = new CreativeUi.ChoiceGroup<string>("Tier", TitleText.Tiers.Select(entry => (entry.value, entry.label)), form.Tier, value =>
                {
                    form.Tier = value;
                    tier?.SetHint(TierHint(value));
                }, "title-tier", TierHint(form.Tier));
                body.Add(tier);
            }

            // More options: the weight limits and the placeholder belt's colour.
            VisualElement more = Ds.Column("cr-more").Named("title-more");
            var minWeight = new CreativeUi.Field("Minimum weight (kg)", form.MinWeight, text => form.MinWeight = text, "Optional.", "title-min-weight");
            var maxWeight = new CreativeUi.Field("Weight limit (kg)", form.MaxWeight, text => form.MaxWeight = text, "Optional.", "title-max-weight");
            VisualElement weights = Ds.Row("ds-row--top", "cr-pair");
            weights.Add(minWeight);
            weights.Add(maxWeight);
            more.Add(weights);
            more.Add(ColourChoice(form));
            bool moreOpen = form.MinWeight.Length > 0 || form.MaxWeight.Length > 0;
            more.SetShown(moreOpen);
            Button moreToggle = null;
            moreToggle = Ds.Button("More options", () =>
            {
                moreOpen = !moreOpen;
                more.SetShown(moreOpen);
                moreToggle.Q<Icon>()?.RemoveFromHierarchy();
                moreToggle.Insert(0, new Icon(moreOpen ? "chevron-up" : "chevron-down", "ds-icon--sm", "ds-btn__icon"));
            }, DsButtonKind.Ghost, moreOpen ? "chevron-up" : "chevron-down");
            moreToggle.name = "title-more-toggle";
            moreToggle.AddToClassList("cr-more-toggle");
            body.Add(moreToggle);
            body.Add(more);

            VisualElement footer = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            Button save = null;
            save = Ds.Button(create ? "Create title" : "Save", async () =>
            {
                save.SetEnabled(false);
                try
                {
                    await Submit();
                }
                finally
                {
                    save.SetEnabled(true);
                }
            }, DsButtonKind.Primary, create ? "add" : "check");
            save.name = "title-form-save";
            footer.Add(save);

            handle = CreativeUi.Sheet(anchor, create ? "New title" : $"Edit {Kit.Str(row, "name")}", body, footer,
                create ? "Titles" : "Edit title", 560f, "title-form-sheet");
            Current = handle;

            async Task Submit()
            {
                (JObject args, TitleText.FormErrors errors) = create ? TitleText.CreateArgs(promotionId, form) : TitleText.EditArgs(row, form);
                if (errors == null)
                {
                    CommandResult<JToken> result;
                    try
                    {
                        result = await game.Client.Command(create ? "titles.create" : "titles.edit", args);
                    }
                    catch (Exception exception)
                    {
                        Debug.LogException(exception);
                        errors = new TitleText.FormErrors();
                        errors.General.Add(CreativeUi.EngineUnreachable);
                        Show(errors);
                        return;
                    }
                    if (result.Ok)
                    {
                        handle?.Close();
                        DsOverlay.Toast(anchor, create ? $"Created the {form.Name.Trim()}" : "Saved");
                        string newId = Kit.Str(result.Data, "titleId");
                        if (create && newId != null) ShellController.Current?.Navigator.Go(TitlesScreen.TitleRoute(newId));
                        return;
                    }
                    errors = TitleText.ErrorsFromReasons(CreativeUi.ReasonList(result.Reasons));
                }
                Show(errors);
            }

            void Show(TitleText.FormErrors errors)
            {
                CreativeUi.SetProblem(general, string.Join(" ", errors.General));
                name.SetError(errors.Of("name"));
                brand.SetError(errors.Of("brand"));
                holders.SetError(errors.Of("holderCount"));
                division.SetError(errors.Of("division"));
                minWeight.SetError(errors.Of("minWeight"));
                maxWeight.SetError(errors.Of("maxWeight"));
                if (errors.Of("minWeight") != null || errors.Of("maxWeight") != null)
                {
                    moreOpen = true;
                    more.SetShown(true);
                }
            }
        }

        private static string TierHint(string tier) =>
            TitleText.Tiers.FirstOrDefault(entry => entry.value == tier).hint + " The title's Why? explains it once it exists.";

        private static VisualElement ColourChoice(TitleText.Form form)
        {
            var swatches = TitleText.Swatches.ToList();
            if (swatches.All(swatch => swatch.hex != form.Color)) swatches.Insert(0, (form.Color, "Current colour"));
            var group = new CreativeUi.ChoiceGroup<string>("Colour", swatches.Select(swatch => (swatch.hex, swatch.name)), form.Color, value => form.Color = value, "title-colour",
                "The placeholder belt's colour when the world has no picture for it.");
            int index = 0;
            foreach (Button chip in group.Chips)
            {
                VisualElement sample = Ds.El("cr-swatch");
                if (ColorUtility.TryParseHtmlString(swatches[index].hex, out Color color)) sample.style.backgroundColor = color;
                chip.Insert(0, sample);
                index++;
            }
            return group;
        }

        // ---- Award ----------------------------------------------------------------------------------

        /// <summary>The award sheet for a title's row (<c>titles.eligibleHolders</c>).</summary>
        public static void OpenAward(VisualElement anchor, JToken row)
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            string titleId = Kit.Str(row, "titleId");
            string titleName = Kit.Str(row, "name");
            int holderCount = (int)(Kit.Num(row, "holderCount") ?? 1);
            bool single = holderCount == 1;
            JToken champion = Kit.Obj(row, "champion");

            var picked = new List<string>();
            string pickedTeam = null;
            string search = string.Empty;
            bool includeIneligible = false;
            JToken holders = null;
            string loadError = null;

            Button award = null;
            VisualElement list = null;
            VisualElement body = Ds.Column("cr-award").Named("award-sheet");
            VisualElement problem = CreativeUi.Problem("award-problem");
            body.Add(problem);
            Label prompt = Ds.Text(string.Empty, "cr-award__prompt");
            body.Add(prompt);
            VisualElement tools = Ds.Row("cr-award__tools");
            tools.Add(CreativeUi.Search("Search by ring name", string.Empty, text =>
            {
                search = text;
                Draw();
            }, "award-search"));
            body.Add(tools);
            body.Add(CreativeUi.Switch("Show who can't hold it", false, on =>
            {
                includeIneligible = on;
                Load();
            }, null, "award-show-ineligible"));
            list = Ds.Column("cr-award__list").Named("award-list");
            body.Add(list);

            VisualElement footer = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            award = Ds.Button("Award", () => Award(), DsButtonKind.Primary, "trophy");
            award.name = "award-confirm";
            footer.Add(award);

            handle = CreativeUi.Sheet(anchor, $"Award the {titleName}", body, footer, "Award", 600f, "award-title-sheet");
            Current = handle;
            Load();

            async void Load()
            {
                list.Clear();
                list.Add(Ds.Loading("Loading who can hold it…"));
                try
                {
                    QueryResult<JToken> result = await game.Client.Query("titles.eligibleHolders", new JObject { ["titleId"] = titleId, ["includeIneligible"] = includeIneligible });
                    holders = result.Ok ? result.Data : null;
                    loadError = result.Ok ? null : CreativeUi.QueryProblem(result);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                    loadError = CreativeUi.EngineUnreachable;
                }
                Draw();
            }

            bool Matches(params string[] names)
            {
                string needle = search.Trim();
                return needle.Length == 0 || names.Any(name => name != null && name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }

            void Draw()
            {
                prompt.text = $"{TitleText.PickPrompt(holderCount)}. {TextFormat.Number(picked.Count)} of {TextFormat.Number(holderCount)} picked.";
                award.SetEnabled(picked.Count == holderCount);
                list.Clear();
                if (loadError != null)
                {
                    list.Add(CreativeUi.Notice(DsState.Bad, loadError));
                    return;
                }
                if (holders == null) return;
                List<JToken> people = Kit.Arr(holders, "people").ToList();
                List<JToken> teams = Kit.Arr(holders, "teams").ToList();
                bool full = picked.Count >= holderCount;

                if (!single && teams.Count > 0)
                {
                    list.Add(Ds.SectionHeader("Teams"));
                    List<JToken> shownTeams = teams.Where(team => Matches(new[] { Kit.Str(team, "name") }.Concat(Kit.Arr(team, "members").Select(m => Kit.Str(m, "ringName"))).ToArray())).ToList();
                    if (shownTeams.Count == 0) list.Add(Ds.Text("No team matches the search.", "cr-quiet"));
                    foreach (JToken team in shownTeams)
                    {
                        string teamId = Kit.Str(team, "teamId");
                        bool current = Kit.Bool(team, "isCurrentHolder");
                        string members = string.Join(" & ", Kit.Arr(team, "members").Select(m => Kit.Str(m, "ringName")));
                        list.Add(PickRow("award-team-" + teamId, pickedTeam == teamId, !current, true, null, Kit.Str(team, "name"),
                            members, Kit.Bool(team, "sameBrand") ? null : "Works on another brand",
                            current ? Ds.Pill(DsState.Gold, "Champions", "titles") : null,
                            () =>
                            {
                                pickedTeam = teamId;
                                picked.Clear();
                                picked.AddRange(Kit.Arr(team, "members").Select(m => Kit.Str(m, "personId")));
                                Draw();
                            }));
                    }
                    list.Add(Ds.SectionHeader("Or pick wrestlers"));
                }
                else
                {
                    list.Add(Ds.SectionHeader("Wrestlers"));
                }

                List<JToken> shownPeople = people.Where(person => Matches(Kit.Str(person, "ringName"))).ToList();
                if (shownPeople.Count == 0)
                {
                    list.Add(Ds.Text(people.Count == 0 ? "Nobody on the roster can hold this title." : "Nobody matches the search.", "cr-quiet"));
                }
                foreach (JToken person in shownPeople.Take(MaxPeople))
                {
                    string personId = Kit.Str(person, "personId");
                    bool on = picked.Contains(personId);
                    bool current = Kit.Bool(person, "isCurrentHolder");
                    bool enabled = !current && (single || on || !full);
                    string meta = $"{TitleText.WeightClass(Kit.Str(person, "weightClass"))} · {Kit.PushLabel(Kit.Str(person, "push"))}";
                    VisualElement end = Ds.Row("cr-pick__end");
                    if (current) end.Add(Ds.Pill(DsState.Gold, "Champion", "titles"));
                    end.Add(Availability(Kit.Obj(person, "availability")));
                    list.Add(PickRow("award-person-" + personId, on, enabled, single, Kit.Str(person, "imageRef"), Kit.Str(person, "ringName"), meta,
                        Kit.Bool(person, "sameBrand") ? null : TitleText.OtherBrandText(Kit.Str(person, "brandName")), end,
                        () =>
                        {
                            pickedTeam = null;
                            if (single)
                            {
                                picked.Clear();
                                picked.Add(personId);
                            }
                            else if (!picked.Remove(personId))
                            {
                                picked.Add(personId);
                            }
                            Draw();
                        }));
                }
                if (shownPeople.Count > MaxPeople) list.Add(Ds.Text($"Showing {MaxPeople} of {shownPeople.Count}. Search to find someone else.", "cr-quiet"));

                if (includeIneligible)
                {
                    list.Add(Ds.SectionHeader("Can't hold it"));
                    List<JToken> ineligible = Kit.Arr(holders, "ineligible").ToList();
                    List<JToken> shown = ineligible.Where(person => Matches(Kit.Str(person, "ringName"))).ToList();
                    if (shown.Count == 0) list.Add(Ds.Text(ineligible.Count == 0 ? "Everyone on the roster can hold it." : "Nobody matches the search.", "cr-quiet"));
                    foreach (JToken person in shown.Take(MaxPeople))
                    {
                        string reasons = string.Join(". ", Kit.Arr(person, "reasons").Select(reason => Kit.Str(reason, "message")));
                        list.Add(PickRow("award-ineligible-" + Kit.Str(person, "personId"), false, false, single, null, Kit.Str(person, "ringName"), reasons, null, null, null));
                    }
                }
            }

            async void Award()
            {
                if (picked.Count != holderCount) return;
                List<JToken> people = Kit.Arr(holders, "people").ToList();
                string teamName = pickedTeam == null ? null : Kit.Str(Kit.Arr(holders, "teams").FirstOrDefault(team => Kit.Str(team, "teamId") == pickedTeam), "name");
                string names = TitleText.PickNames(picked.Select(id => Kit.Str(people.FirstOrDefault(person => Kit.Str(person, "personId") == id), "ringName") ?? "Someone"), teamName);
                var args = new JObject
                {
                    ["titleId"] = titleId,
                    ["holderIds"] = new JArray(picked),
                    ["teamId"] = pickedTeam == null ? JValue.CreateNull() : (JToken)pickedTeam,
                };
                if (champion != null)
                {
                    (string title, string confirmBody) = TitleText.AwardConfirmCopy(titleName, names, Kit.Str(champion, "label"));
                    CreativeUi.Confirm(anchor, title, confirmBody, "Award", true, async () =>
                    {
                        string refused = await Send();
                        if (refused != null) CreativeUi.SetProblem(problem, refused);
                        return null;
                    }, "award-strip");
                    return;
                }
                award.SetEnabled(false);
                string result = await Send();
                award.SetEnabled(picked.Count == holderCount);
                CreativeUi.SetProblem(problem, result);

                async Task<string> Send()
                {
                    string refused = await CreativeUi.Run("titles.award", args);
                    if (refused == null)
                    {
                        handle?.Close();
                        DsOverlay.Toast(anchor, $"Awarded the {titleName} to {names}");
                    }
                    return refused;
                }
            }
        }

        /// <summary>One row of the award list: a check (or radio), a portrait, the name, facts and its state.</summary>
        private static VisualElement PickRow(string name, bool on, bool enabled, bool radio, string imageRef, string title, string meta, string hint, VisualElement end, Action onPick)
        {
            var row = new Button(() => onPick?.Invoke()) { text = string.Empty };
            row.name = name;
            row.AddToClassList("cr-pick");
            row.EnableInClassList("cr-pick--on", on);
            VisualElement box = Ds.El("ds-check__box", radio ? "cr-pick__radio" : "cr-pick__box");
            if (on) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
            row.Add(box);
            if (imageRef != null || onPick != null) row.Add(CreativeUi.Portrait(imageRef, "ds-portrait--xs"));
            VisualElement words = Ds.Column("cr-pick__words");
            words.Add(CreativeUi.Clip(title, "cr-pick__name"));
            if (!string.IsNullOrEmpty(meta)) words.Add(CreativeUi.Clip(meta, "cr-pick__meta"));
            if (!string.IsNullOrEmpty(hint)) words.Add(CreativeUi.Clip(hint, "cr-pick__hint"));
            row.Add(words);
            if (end != null) row.Add(end);
            row.SetEnabled(enabled);
            return row;
        }

        /// <summary>The availability dot: "Available", or the reason ("Injured until Mar 4, 2027").</summary>
        public static VisualElement Availability(JToken availability)
        {
            string status = Kit.Str(availability, "status");
            if (status == null || status == "available") return Ds.Dot(DsState.Good, "Available");
            string reason = Kit.Str(availability, "reason") ?? Kit.Capital(status);
            string until = Kit.Str(availability, "until");
            VisualElement dot = Ds.Dot(DsState.Warn, until == null ? reason : $"Back {Kit.Date(until)}");
            DsTooltip.Attach(dot, reason);
            return dot;
        }
    }
}
