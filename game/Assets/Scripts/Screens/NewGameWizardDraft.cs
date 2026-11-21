using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Draft;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The wizard's draft start (DRF-06/07): the active promotions (every game) with their picker
    /// sub-screen, the "Start with a draft" group with its options shown only while it is on
    /// (<c>requires</c>), and the short draft plan from <c>previewSetup</c>.
    /// </summary>
    public sealed partial class NewGameWizard
    {
        private const string DraftGroup = "draft";
        private const int PickerPageSize = 40;

        // Active promotions: null = every promotion (the engine's default).
        private HashSet<string> activeKeys;
        private List<string> biggestFirst;
        private bool picking;
        private string pickerSearch = string.Empty;
        private string pickerCountry;
        private string pickerSize;
        private int pickerPage;
        private int biggestCount = 6;
        private JToken pickerPage0;
        private int pickerTicket;
        private bool showDraftMore;

        // previewSetup: the last answer and the arguments it was for.
        private JToken setup;
        private string setupFor;
        private string setupWanted;
        private Label activeSummary;
        private Label pickerSummary;
        private VisualElement planHost;

        /// <summary>True while the active-promotion picker is open.</summary>
        public bool InPicker => picking;

        /// <summary>The active promotions chosen (pack keys), or null for every promotion.</summary>
        public IReadOnlyCollection<string> ActivePromotionKeys => activeKeys;

        /// <summary>The last setup preview (<c>previewSetup</c>'s value), or null before it answers.</summary>
        public JToken SetupPreview => setup;

        private void ResetDraftChoices()
        {
            activeKeys = null;
            biggestFirst = null;
            setup = null;
            setupFor = null;
            setupWanted = null;
            picking = false;
            pickerSearch = string.Empty;
            pickerCountry = null;
            pickerSize = null;
            pickerPage = 0;
            pickerPage0 = null;
        }

        private string YourKey => foundMode ? null : promotionKey;

        // ---- Options step: active promotions -------------------------------------------------------

        private void DrawActivePromotions()
        {
            DraftScreen.Style(root);
            body.Add(Section("Promotions"));
            VisualElement row = Ui.El("rb-setting").Named("setting-activePromotions");
            VisualElement text = Ui.El("rb-setting__text").With(
                Ui.Text("Active promotions", "rb-setting__name"),
                Ui.Text("Promotions you leave out close before day 1: their people become free agents, or join the draft pool. Fewer promotions also play faster in a big world.",
                    "rb-setting__description"));
            row.Add(text);
            VisualElement right = Ui.El("rb-row", "rb-row--tight", "rb-active-summary");
            activeSummary = Ui.Text(SummaryText(), "rb-active-summary__text").Named("wizard-active-summary");
            right.Add(activeSummary);
            Button choose = Ui.Btn("Choose…", OpenPicker, "btn--ghost");
            choose.name = "wizard-active-promotions";
            right.Add(choose);
            row.Add(right);
            body.Add(row);
        }

        private string SummaryText()
        {
            if (setup == null) return activeKeys == null ? "Every promotion" : $"{activeKeys.Count} chosen";
            return DraftText.ActiveSummary((int)(Kit.Num(setup, "promotions.active") ?? 0), (int)(Kit.Num(setup, "promotions.total") ?? 0),
                (int)(Kit.Num(setup, "wrestlers.onActiveRosters") ?? 0));
        }

        // ---- Options step: the draft --------------------------------------------------------------

        private void DrawDraftGroup(IEnumerable<JToken> group)
        {
            List<JToken> list = group.ToList();
            body.Add(Section("Draft"));
            JToken start = list.FirstOrDefault(setting => Kit.Str(setting, "key") == DraftText.StartKey);
            if (start != null) body.Add(SettingRow(start));
            if (!DraftOn) return;

            foreach (JToken setting in list.Where(setting => setting != start && Shown(setting) && !DraftText.MoreOptionKeys.Contains(Kit.Str(setting, "key"))))
            {
                body.Add(SettingRow(setting));
            }
            Button more = Ui.Btn(showDraftMore ? "Fewer draft options" : "More draft options…", () =>
            {
                showDraftMore = !showDraftMore;
                Draw();
            }, "btn--ghost");
            more.name = "wizard-draft-more";
            more.AddToClassList("rb-wizard__advanced-toggle");
            body.Add(more);
            if (showDraftMore)
            {
                VisualElement advanced = Ui.El("rb-wizard__advanced").Named("wizard-draft-advanced");
                foreach (JToken setting in list.Where(setting => setting != start && Shown(setting) && DraftText.MoreOptionKeys.Contains(Kit.Str(setting, "key"))))
                {
                    advanced.Add(SettingRow(setting));
                }
                body.Add(advanced);
            }
            planHost = Ui.El("rb-draft-plan").Named("wizard-draft-plan");
            DraftScreen.Style(planHost);
            FillPlan();
            body.Add(planHost);
        }

        private bool DraftOn => settings.TryGetValue(DraftText.StartKey, out JToken value) && value != null && value.Type == JTokenType.Boolean && (bool)value;

        /// <summary>A setting with <c>requires</c> shows only while that boolean setting is on.</summary>
        private bool Shown(JToken setting)
        {
            string requires = Kit.Str(setting, "requires");
            if (string.IsNullOrEmpty(requires)) return true;
            return settings.TryGetValue(requires, out JToken value) && value != null && value.Type == JTokenType.Boolean && (bool)value;
        }

        /// <summary>The short draft plan: the level every promotion starts at, the pool and its mix.</summary>
        private void FillPlan()
        {
            if (planHost == null) return;
            planHost.Clear();
            planHost.Add(Ui.Text(TextFormat.Upper("The draft plan"), "rb-draft-plan__title"));
            JToken draft = setup?["draft"];
            if (draft == null || draft.Type != JTokenType.Object)
            {
                planHost.Add(Ui.Text(setup == null ? "Working out the draft…" : "No promotion can draft with these choices.", "rb-setting__description"));
                return;
            }
            int promotions = (int)(Kit.Num(draft, "promotions") ?? 0);
            int roster = (int)(Kit.Num(draft, "settings.rosterTarget") ?? 0);
            planHost.Add(Ui.Text($"{promotions} promotions draft {roster} wrestlers each{(Kit.Bool(draft, "settings.draftStaff") ? $" and {Kit.Num(draft, "settings.staffTarget")} staff" : string.Empty)}.",
                "rb-draft-plan__line", "t-wrap").Named("wizard-draft-plan-roster"));
            planHost.Add(Ui.Text(DraftText.LevelLine(Kit.Num(draft, "level.cash") ?? 0, Kit.Num(draft, "level.homePopularity") ?? 0, Kit.Num(draft, "level.prestige") ?? 0, Kit.Str(draft, "startingCash")),
                "rb-draft-plan__line", "t-wrap").Named("wizard-draft-plan-level"));
            planHost.Add(Ui.Text(DraftText.PoolLine((int)(Kit.Num(draft, "poolWrestlers") ?? 0), (int)(Kit.Num(draft, "sittingOut") ?? 0), (int)(Kit.Num(draft, "poolStaff") ?? 0)),
                "rb-draft-plan__line", "t-wrap").Named("wizard-draft-plan-pool"));
            VisualElement mix = Ui.El("rb-draft-mix").Named("wizard-draft-mix");
            foreach (JToken level in Kit.Arr(draft, "mix"))
            {
                VisualElement tile = Ui.El("rb-draft-mix__tile");
                tile.Add(Ui.Text(TextFormat.Number((long)(Kit.Num(level, "inPool") ?? 0)), "rb-draft-mix__number"));
                tile.Add(Ui.Text(Kit.Str(level, "label") ?? DraftText.LevelWord(Kit.Str(level, "level")), "rb-draft-mix__label"));
                tile.tooltip = $"{Kit.Num(level, "inPool")} in the pool of {Kit.Num(level, "available")} at this level ({Kit.Num(level, "female")} women, {Kit.Num(level, "male")} men).";
                mix.Add(tile);
            }
            planHost.Add(mix);
        }

        // ---- previewSetup -----------------------------------------------------------------------

        private JObject SetupArgs()
        {
            var args = new JObject();
            if (activeKeys != null) args["activePromotionKeys"] = new JArray(activeKeys.OrderBy(key => key, StringComparer.Ordinal));
            if (foundMode) args["founding"] = true;
            else if (promotionKey != null) args["playerPromotionKey"] = promotionKey;
            var chosen = new JObject();
            foreach (KeyValuePair<string, JToken> pair in settings.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                if (pair.Value is JValue value && (value.Type == JTokenType.Boolean || value.Type == JTokenType.String)) chosen[pair.Key] = value.DeepClone();
            }
            args["settings"] = chosen;
            return args;
        }

        /// <summary>Asks <c>previewSetup</c> again when the choices changed (one call at a time, the newest wins).</summary>
        private void RequestSetup()
        {
            if (client == null || world == null || preview == null) return;
            string wanted = SetupArgs().ToString(Formatting.None);
            if (wanted == setupFor || wanted == setupWanted) return;
            setupWanted = wanted;
            _ = RunSetup(wanted);
        }

        private async Task RunSetup(string wanted)
        {
            try
            {
                WorldPreviewResult answer = await client.PreviewSetup(world.Id, JObject.Parse(wanted));
                if (wanted != setupWanted) return;
                setupFor = wanted;
                setupWanted = null;
                setup = answer.Ok ? answer.Value : null;
                if (!answer.Ok) Debug.LogWarning($"[NewGame] previewSetup refused: {string.Join("; ", answer.Reasons.Select(reason => reason.Message))}");
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[NewGame] previewSetup failed ({exception.GetType().Name})");
                setupWanted = null;
                return;
            }
            if (activeSummary != null) activeSummary.text = SummaryText();
            if (pickerSummary != null) pickerSummary.text = SummaryText();
            FillPlan();
        }

        /// <summary>Waits until the setup preview matches the current choices (tours).</summary>
        public async Task WaitForSetup()
        {
            RequestSetup();
            string wanted = SetupArgs().ToString(Formatting.None);
            for (int wait = 0; wait < 600 && setupFor != wanted; wait++) await Task.Delay(50);
        }

        /// <summary>A setting was picked on the Options step: redraw when it shows or hides others, and re-preview.</summary>
        private void AfterSettingPicked(string key)
        {
            bool gates = Kit.Arr(preview, "settings").Any(setting => Kit.Str(setting, "requires") == key);
            if (gates) Draw();
            else RequestSetup();
        }

        // ---- The picker sub-screen ----------------------------------------------------------------

        /// <summary>Opens the active-promotion picker (the Options step's Choose…; tours call it too).</summary>
        public void OpenPicker()
        {
            if (preview == null || busy) return;
            picking = true;
            pickerPage = 0;
            Draw();
            _ = LoadPickerPage();
        }

        /// <summary>Back to the Options step (the picker's DONE).</summary>
        public void ClosePicker()
        {
            picking = false;
            Draw();
        }

        private async Task LoadPickerPage()
        {
            int ticket = ++pickerTicket;
            var args = new JObject { ["offset"] = pickerPage * PickerPageSize, ["limit"] = PickerPageSize };
            if (!string.IsNullOrWhiteSpace(pickerSearch)) args["search"] = pickerSearch.Trim();
            if (pickerCountry != null) args["countryKey"] = pickerCountry;
            if (pickerSize != null) args["size"] = pickerSize;
            WorldPreviewResult answer;
            try
            {
                answer = await client.PreviewPromotions(world.Id, args);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[NewGame] previewPromotions failed ({exception.GetType().Name})");
                return;
            }
            if (ticket != pickerTicket || !picking) return;
            if (!answer.Ok || answer.Value == null)
            {
                feedback.text = "The promotions could not be listed: " + string.Join("; ", answer.Reasons.Select(reason => reason.Message));
                feedback.SetShown(true);
                return;
            }
            pickerPage0 = answer.Value;
            biggestFirst ??= Kit.Arr(answer.Value, "biggestFirst").Select(key => (string)key).ToList();
            Draw();
        }

        /// <summary>The keys every promotion has (from <c>biggestFirst</c>), or null before the picker loaded.</summary>
        public IReadOnlyList<string> AllPromotionKeys => biggestFirst;

        private bool IsActive(string key) => activeKeys == null || activeKeys.Contains(key) || key == YourKey;

        /// <summary>Turns one promotion on or off (your own promotion stays on).</summary>
        public void TogglePromotion(string key)
        {
            if (key == null || key == YourKey || biggestFirst == null) return;
            activeKeys ??= new HashSet<string>(biggestFirst);
            if (!activeKeys.Remove(key)) activeKeys.Add(key);
            if (activeKeys.Count >= biggestFirst.Count) activeKeys = null;
            Draw();
        }

        /// <summary>Select all: every promotion active again.</summary>
        public void SelectAllPromotions()
        {
            activeKeys = null;
            Draw();
        }

        /// <summary>Only the biggest N (by wrestlers), plus your own promotion. Needs the picker loaded.</summary>
        public void OnlyBiggest(int count)
        {
            if (biggestFirst == null) return;
            biggestCount = Math.Max(1, count);
            List<string> keys = DraftText.Biggest(biggestFirst, biggestCount, YourKey);
            activeKeys = keys.Count >= biggestFirst.Count ? null : new HashSet<string>(keys);
            Draw();
        }

        /// <summary>Loads the picker's keys without opening it (tours: "Only the biggest N" straight from Options).</summary>
        public async Task<bool> LoadPromotionKeys()
        {
            if (biggestFirst != null) return true;
            if (client == null || world == null) return false;
            WorldPreviewResult answer = await client.PreviewPromotions(world.Id, new JObject { ["limit"] = 1 });
            if (!answer.Ok || answer.Value == null) return false;
            biggestFirst = Kit.Arr(answer.Value, "biggestFirst").Select(key => (string)key).ToList();
            return true;
        }

        private void DrawPicker()
        {
            steps.Clear();
            steps.Add(Ui.Text("New game", "rb-wizard__step"));
            steps.Add(Ui.Text("› Active promotions", "rb-wizard__step", "rb-wizard__step--current"));
            DraftScreen.Style(root);

            VisualElement head = Ui.El("rb-row", "rb-row--wrap", "rb-picker-head");
            pickerSummary = Ui.Text(SummaryText(), "rb-picker-head__count").Named("picker-count");
            head.Add(pickerSummary);
            body.Add(head);
            body.Add(Kit.Note("Your own promotion is always active. Promotions you leave out close before day 1."));

            VisualElement quick = Ui.El("rb-row", "rb-row--wrap", "rb-picker-quick");
            Button all = Ui.Btn("Select all", SelectAllPromotions, "btn--ghost");
            all.name = "picker-select-all";
            quick.Add(all);
            quick.Add(Ui.Text("Only the biggest", "rb-picker-quick__label"));
            var count = new TextField { value = biggestCount.ToString(), name = "picker-biggest-count", maxLength = 4 };
            count.AddToClassList("text-input");
            count.AddToClassList("rb-picker-quick__field");
            count.RegisterValueChangedCallback(change =>
            {
                if (int.TryParse(change.newValue, out int parsed) && parsed > 0) biggestCount = parsed;
            });
            quick.Add(count);
            Button apply = Ui.Btn("Apply", () => OnlyBiggest(biggestCount), "btn--ghost");
            apply.name = "picker-biggest-apply";
            apply.SetEnabled(biggestFirst != null);
            quick.Add(apply);
            body.Add(quick);

            VisualElement filters = Ui.El("rb-row", "rb-row--wrap", "rb-picker-filters");
            filters.Add(W.Search("Search promotions…", pickerSearch, text =>
            {
                pickerSearch = text;
                pickerPage = 0;
                int ticket = pickerTicket + 1;
                body.schedule.Execute(() =>
                {
                    if (picking && ticket == pickerTicket + 1) _ = LoadPickerPage();
                }).StartingIn(250);
            }, "picker-search"));
            List<(string value, string label, string detail)> countries = new List<(string, string, string)> { ("", "Every country", null) };
            countries.AddRange(Kit.Arr(pickerPage0, "countries").Select(country => (Kit.Str(country, "key"), Kit.Str(country, "name"), $"{Kit.Num(country, "count")}")));
            string countryName = pickerCountry == null ? "Every country" : Kit.Arr(pickerPage0, "countries").Where(country => Kit.Str(country, "key") == pickerCountry).Select(country => Kit.Str(country, "name")).FirstOrDefault() ?? pickerCountry;
            filters.Add(ScreenDs.Picker(countryName, countries, picked =>
            {
                pickerCountry = string.IsNullOrEmpty(picked) ? null : picked;
                pickerPage = 0;
                _ = LoadPickerPage();
            }, searchable: countries.Count > 12, name: "picker-country"));
            List<JToken> sizes = Kit.Arr(pickerPage0, "sizes").ToList();
            if (sizes.Count > 0)
            {
                VisualElement sizeChips = Ui.El("rb-row", "rb-row--tight").Named("picker-size");
                sizeChips.Add(PickerChip("Any size", pickerSize == null, () => { pickerSize = null; pickerPage = 0; _ = LoadPickerPage(); }, "picker-size-any"));
                foreach (JToken size in sizes)
                {
                    string label = Kit.Str(size, "label");
                    sizeChips.Add(PickerChip(label, pickerSize == label, () => { pickerSize = label; pickerPage = 0; _ = LoadPickerPage(); }, "picker-size-" + label));
                }
                filters.Add(sizeChips);
            }
            body.Add(filters);

            VisualElement list = Ui.El("rb-picker-list").Named("picker-list");
            if (pickerPage0 == null)
            {
                list.Add(Kit.Note("Listing the promotions…"));
            }
            else
            {
                Import.Pictures.PictureProvider pictures = WorkshopWorlds.PicturesForPack(world?.Id);
                List<JToken> rows = Kit.Arr(pickerPage0, "rows").ToList();
                if (rows.Count == 0) list.Add(Kit.Note("No promotion matches."));
                foreach (JToken promotion in rows) list.Add(PickerRow(promotion, pictures));
            }
            body.Add(list);

            int total = (int)(Kit.Num(pickerPage0, "total") ?? 0);
            int pages = Math.Max(1, (int)Math.Ceiling(total / (double)PickerPageSize));
            if (pages > 1)
            {
                VisualElement pager = Ui.El("rb-row", "rb-row--tight", "rb-picker-pager");
                Button prev = Ui.Btn("Previous", () => { pickerPage--; _ = LoadPickerPage(); }, "btn--ghost");
                prev.name = "picker-prev";
                prev.SetEnabled(pickerPage > 0);
                pager.Add(prev);
                pager.Add(Ui.Text($"Page {pickerPage + 1} of {pages} · {total} promotions", "t-sm", "t-muted"));
                Button next = Ui.Btn("Next", () => { pickerPage++; _ = LoadPickerPage(); }, "btn--ghost");
                next.name = "picker-next";
                next.SetEnabled(pickerPage < pages - 1);
                pager.Add(next);
                body.Add(pager);
            }

            Button done = Ui.Btn("DONE", ClosePicker, "btn--primary");
            done.name = "picker-done";
            nav.Add(done);
            RequestSetup();
        }

        private static Button PickerChip(string label, bool selected, Action onClick, string name)
        {
            Button chip = Ui.Button(string.Empty, onClick, "choice-chip", "rb-chip");
            chip.Add(Ui.Text(label, "choice-chip__label"));
            chip.EnableInClassList("choice-chip--selected", selected);
            chip.name = name;
            return chip;
        }

        private VisualElement PickerRow(JToken promotion, Import.Pictures.PictureProvider pictures)
        {
            string key = Kit.Str(promotion, "key");
            bool yours = key == YourKey;
            bool on = IsActive(key);
            Button row = Ui.Button(string.Empty, () => TogglePromotion(key), "rb-picker-row");
            row.name = "picker-row-" + key;
            row.EnableInClassList("rb-picker-row--on", on);
            row.SetEnabled(!yours);
            VisualElement check = Ui.El("rb-picker-row__check");
            check.Add(new Icon(yours ? "lock" : on ? "check" : "close", "ds-icon--sm"));
            row.Add(check);
            row.Add(PromotionLogos.Badge(pictures, Kit.Str(promotion, "logoRef"), Kit.Str(promotion, "shortName") ?? Kit.Str(promotion, "name"), "rb-logo--sm"));
            VisualElement words = Ui.El("rb-picker-row__words");
            words.Add(Ui.Text($"{Kit.Str(promotion, "name")} ({Kit.Str(promotion, "shortName")})", "rb-picker-row__name"));
            string size = Kit.Str(promotion, "size");
            words.Add(Ui.Text($"{Kit.Str(promotion, "country.name")}{(size != null ? " · " + size : string.Empty)} · {Kit.Num(promotion, "wrestlers")} wrestlers{(yours ? " · yours" : string.Empty)}",
                "rb-picker-row__detail"));
            row.Add(words);
            return row;
        }
    }
}
