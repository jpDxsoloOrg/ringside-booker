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
    /// The Storylines screen's sheets (UNITY-16): create / edit (name, summary, brand and, when
    /// creating, the people with their sides), add people, change a side, remove someone, and End
    /// with the payoff preview (what ending it now pays each member, with a Why? on every number).
    /// </summary>
    public static class StorylineSheets
    {
        /// <summary>The most people the picker lists; the filter narrows a long roster.</summary>
        public const int MaxOptions = 80;

        /// <summary>The sheet or modal open last (tours read it).</summary>
        public static OverlayHandle Current { get; private set; }

        // ---- Create and edit ------------------------------------------------------------------------

        /// <summary>The create sheet (<paramref name="story"/> null) or the edit sheet for a storyline.</summary>
        public static async void OpenEditor(VisualElement anchor, JToken story, string promotionId)
        {
            EngineGame game = Kit.Game;
            if (game == null || promotionId == null) return;
            bool create = story == null;
            var brands = new List<(string id, string name)>();
            JToken options = null;
            try
            {
                var queries = new List<(string, object)> { ("promotions.profile", new JObject { ["promotionId"] = promotionId }) };
                if (create) queries.Add(("storylines.memberOptions", new JObject { ["promotionId"] = promotionId }));
                QueryResult<JToken>[] results = await CreativeUi.Queries(game.Client, queries.ToArray());
                if (results[0].Ok) brands = Kit.Arr(results[0].Data, "header.brands").Select(brand => (Kit.Str(brand, "brandId"), Kit.Str(brand, "name"))).ToList();
                if (create && results[1].Ok) options = Kit.Obj(results[1].Data, "options");
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
            }

            string nameValue = create ? string.Empty : Kit.Str(story, "name") ?? string.Empty;
            string summaryValue = create ? string.Empty : Kit.Str(story, "summary") ?? string.Empty;
            string brandValue = create ? null : Kit.Str(story, "brandId");

            VisualElement body = Ds.Column("cr-form").Named("storyline-form");
            var name = new CreativeUi.Field("Name", nameValue, text => nameValue = text, $"Up to {StorylineText.NameMax} characters.", "storyline-name", StorylineText.NameMax);
            body.Add(name);
            CreativeUi.Field summary = null;
            summary = new CreativeUi.Field("Summary", summaryValue, text =>
            {
                summaryValue = text ?? string.Empty;
                summary?.SetHint(SummaryCount(summaryValue));
            }, SummaryCount(summaryValue), "storyline-summary", StorylineText.SummaryMax, true);
            body.Add(summary);
            CreativeUi.ChoiceGroup<string> brand = null;
            if (brands.Count > 0)
            {
                var choices = new List<(string, string)> { ("whole", "Whole promotion") };
                choices.AddRange(brands.Select(entry => (entry.id, entry.name)));
                brand = new CreativeUi.ChoiceGroup<string>("Brand", choices, brandValue ?? "whole", value => brandValue = value == "whole" ? null : value, "storyline-brand");
                body.Add(brand);
            }
            MemberPicker picker = null;
            if (create)
            {
                picker = new MemberPicker(options, Array.Empty<string>(), StorylineText.MaxMembers);
                body.Add(picker);
            }
            VisualElement general = CreativeUi.Problem("storyline-form-problem");
            body.Insert(0, general);

            VisualElement buttons = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            buttons.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            Button save = null;
            save = Ds.Button(create ? "Start storyline" : "Save", async () =>
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
            save.name = "storyline-form-save";
            buttons.Add(save);

            handle = CreativeUi.Sheet(anchor, create ? "New storyline" : "Edit storyline", body, buttons, "Storylines", create ? 640f : 520f, "storyline-form-sheet");
            Current = handle;
            Picker = picker;

            async Task Submit()
            {
                CommandResult<JToken> result;
                try
                {
                    if (create)
                    {
                        var members = new JArray(picker.Chosen.Select(member => new JObject { ["personId"] = member.personId, ["side"] = member.side }));
                        result = await game.Client.Command("storylines.create", new JObject
                        {
                            ["promotionId"] = promotionId,
                            ["name"] = nameValue,
                            ["summary"] = summaryValue,
                            ["brandId"] = brandValue == null ? JValue.CreateNull() : (JToken)brandValue,
                            ["members"] = members,
                        });
                    }
                    else
                    {
                        var changes = new JObject { ["storylineId"] = Kit.Str(story, "id") };
                        if (nameValue != Kit.Str(story, "name")) changes["name"] = nameValue;
                        if (summaryValue != (Kit.Str(story, "summary") ?? string.Empty)) changes["summary"] = summaryValue;
                        if (brandValue != Kit.Str(story, "brandId")) changes["brandId"] = brandValue == null ? JValue.CreateNull() : (JToken)brandValue;
                        if (changes.Count == 1)
                        {
                            handle?.Close();
                            return;
                        }
                        result = await game.Client.Command("storylines.edit", changes);
                    }
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                    CreativeUi.SetProblem(general, CreativeUi.EngineUnreachable);
                    return;
                }
                if (result.Ok)
                {
                    handle?.Close();
                    if (create)
                    {
                        string id = Kit.Str(result.Data, "storylineId");
                        List<string> warnings = Kit.Arr(result.Data, "warnings").Select(warning => Kit.Str(warning, "message")).Where(text => text != null).ToList();
                        StorylinesScreen.PendingWarnings = (id, warnings);
                        DsOverlay.Toast(anchor, $"Started {nameValue.Trim()}");
                        if (id != null) ShellController.Current?.Navigator.Go(StorylinesScreen.StorylineRoute(id));
                    }
                    else
                    {
                        DsOverlay.Toast(anchor, "Saved");
                    }
                    return;
                }
                StorylineText.PlacedReasons placed = StorylineText.PlaceReasons(CreativeUi.ReasonList(result.Reasons));
                name.SetError(placed.Name);
                summary.SetError(placed.Summary);
                brand?.SetError(placed.BrandId);
                picker?.SetError(placed.Members);
                if (brand == null && placed.BrandId != null) placed.General.Add(placed.BrandId);
                CreativeUi.SetProblem(general, string.Join(" ", placed.General));
            }
        }

        /// <summary>The picker of the sheet open last (tours pick people with it).</summary>
        public static MemberPicker Picker { get; private set; }

        private static string SummaryCount(string text) => $"{TextFormat.Number((text ?? string.Empty).Length)} of {TextFormat.Number(StorylineText.SummaryMax)} characters";

        // ---- People ---------------------------------------------------------------------------------

        /// <summary>Add people: the picker in a small sheet; each pick is added with its side.</summary>
        public static async void OpenAddMembers(VisualElement anchor, JToken story)
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            QueryResult<JToken> options = await game.Client.Query("storylines.memberOptions", new JObject { ["promotionId"] = Kit.Str(story, "promotionId") });
            List<string> already = new[] { "faces", "heels", "neutrals" }.SelectMany(side => Kit.Arr(story, side)).Select(member => Kit.Str(member, "personId")).ToList();
            var picker = new MemberPicker(options.Ok ? Kit.Obj(options.Data, "options") : null, already, Math.Max(0, StorylineText.MaxMembers - already.Count));
            VisualElement body = Ds.Column("cr-form").Named("storyline-add");
            body.Add(picker);
            VisualElement problem = CreativeUi.Problem("storyline-add-problem");
            body.Insert(0, problem);
            VisualElement buttons = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            buttons.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            Button add = null;
            add = Ds.Button("Add", async () =>
            {
                add.SetEnabled(false);
                foreach ((string personId, string _, string side) in picker.Chosen.ToList())
                {
                    string refused = await CreativeUi.Run("storylines.addMember", new JObject { ["storylineId"] = Kit.Str(story, "id"), ["personId"] = personId, ["side"] = side });
                    if (refused != null)
                    {
                        CreativeUi.SetProblem(problem, refused);
                        add.SetEnabled(true);
                        return;
                    }
                    picker.Remove(personId);
                }
                handle?.Close();
                DsOverlay.Toast(anchor, "Added to the storyline");
            }, DsButtonKind.Primary, "user-plus");
            add.name = "storyline-add-save";
            buttons.Add(add);
            handle = CreativeUi.Sheet(anchor, "Add people", body, buttons, Kit.Str(story, "name"), 600f, "storyline-add-sheet");
            Current = handle;
            Picker = picker;
        }

        public static async void SetSide(VisualElement anchor, JToken story, string personId, string side, VisualElement problem)
        {
            string refused = await CreativeUi.Run("storylines.setSide", new JObject { ["storylineId"] = Kit.Str(story, "id"), ["personId"] = personId, ["side"] = side });
            CreativeUi.SetProblem(problem, refused);
        }

        public static void ConfirmRemove(VisualElement anchor, JToken story, string personId, string name)
        {
            Current = CreativeUi.Confirm(anchor, $"Remove {name}?", $"{name} will no longer be part of {Kit.Str(story, "name")}. Their alignment doesn't change.", "Remove", true,
                () => CreativeUi.Run("storylines.removeMember", new JObject { ["storylineId"] = Kit.Str(story, "id"), ["personId"] = personId }), "storyline-remove");
        }

        // ---- End ------------------------------------------------------------------------------------

        /// <summary>
        /// Ending a storyline: what ending it now pays each member (with a Why? on every number), or
        /// why it pays nothing, and the shows whose linked segments stop counting. End is final.
        /// </summary>
        public static async void OpenEnd(VisualElement anchor, JToken story, string today)
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            string name = Kit.Str(story, "name");
            VisualElement body = Ds.Column("cr-end").Named("storyline-end-sheet-body");
            body.Add(CreativeUi.Notice(DsState.Warn, "Ending it is final: the storyline can't be changed again.", "lock"));
            VisualElement preview = Ds.Column("cr-end__preview");
            preview.Add(Ds.Loading(StorylineText.PayoffLoading));
            body.Add(preview);
            VisualElement problem = CreativeUi.Problem("storyline-end-problem");
            body.Add(problem);

            VisualElement footer = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            Button end = null;
            end = Ds.Button("End storyline", async () =>
            {
                end.SetEnabled(false);
                string refused = await CreativeUi.Run("storylines.end", new JObject { ["storylineId"] = Kit.Str(story, "id") });
                if (refused == null)
                {
                    handle?.Close();
                    DsOverlay.Toast(anchor, $"Ended {name}");
                    return;
                }
                CreativeUi.SetProblem(problem, refused);
                end.SetEnabled(true);
            }, DsButtonKind.Danger, "stop");
            end.name = "storyline-end-confirm";
            end.SetEnabled(false);
            footer.Add(end);
            handle = CreativeUi.Sheet(anchor, $"End {name}?", body, footer, "End storyline", 560f, "storyline-end-sheet");
            Current = handle;

            QueryResult<JToken> payoff = await game.Client.Query("storylines.payoff", new JObject { ["storylineId"] = Kit.Str(story, "id") });
            preview.Clear();
            if (!payoff.Ok)
            {
                preview.Add(Ds.Text(CreativeUi.QueryProblem(payoff), "cr-quiet"));
                return;
            }
            string kind = Kit.Str(payoff.Data, "kind");
            if (kind != "preview")
            {
                preview.Add(Ds.Text(kind == "unavailable" ? Kit.Str(payoff.Data, "reason.message") : $"{name} has already ended.", "cr-quiet"));
                return;
            }
            JToken plan = Kit.Obj(payoff.Data, "plan");
            preview.Add(PayoffPreview(story, plan, StorylineText.StillBookedShows(Kit.Arr(story, "timeline"), today)));
            end.SetEnabled(true);
        }

        /// <summary>What ending it now would pay: strength in words, then each member's change with its Why?.</summary>
        public static VisualElement PayoffPreview(JToken story, JToken plan, IReadOnlyList<string> stillBooked)
        {
            VisualElement preview = Ds.Column("cr-payoff").Named("storyline-payoff");
            if (Kit.Bool(plan, "eligible"))
            {
                double quality = Kit.Num(plan, "quality.value") ?? 0;
                DsState state = StorylineText.PayoffState(quality);
                VisualElement strength = Ds.Row("cr-payoff__strength", Ds.StateClass(state));
                strength.Add(new Icon(quality > 0 ? "trend-up" : quality < 0 ? "trend-down" : "flat", "ds-icon--lg", "cr-payoff__icon"));
                VisualElement words = Ds.Column("cr-payoff__words");
                words.Add(Ds.Text(TextFormat.Upper(StorylineText.PayoffStrengthLabel), "cr-micro"));
                words.Add(Ds.Text(Kit.Capital(StorylineText.PayoffStrengthWords(quality)), "cr-payoff__headline"));
                strength.Add(words);
                strength.Add(Ds.Spacer());
                strength.Add(CreativeUi.Value(quality.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
                    CreativeUi.WhyTrace(StorylineText.PayoffStrengthLabel, quality, Kit.Obj(plan, "quality.trace"), "ratio", StorylineText.PayoffStrengthLabel), "cr-payoff__number"));
                preview.Add(strength);
                if (Kit.Bool(plan, "finalePlayed")) preview.Add(CreativeUi.Notice(DsState.Gold, StorylineText.FinalePlayed, "crown"));
                VisualElement list = Ds.Column("cr-payoff__members");
                Dictionary<string, string> images = MemberImages(story);
                foreach (JToken member in Kit.Arr(plan, "members"))
                {
                    string personId = Kit.Str(member, "personId");
                    string memberName = Kit.Str(member, "name");
                    string skipped = Kit.Str(member, "skippedReason");
                    list.Add(MemberLine(personId, memberName, images.TryGetValue(personId ?? string.Empty, out string image) ? image : null, skipped,
                        Kit.Num(member, "popularity.value") ?? 0, Kit.Obj(member, "popularity.trace"),
                        Kit.Num(member, "momentum.value") ?? 0, Kit.Obj(member, "momentum.trace")));
                }
                preview.Add(list);
            }
            else
            {
                preview.Add(CreativeUi.Notice(DsState.Neutral,
                    $"{StorylineText.NotEligibleText((int)(Kit.Num(plan, "minSegments") ?? 0), (int)(Kit.Num(plan, "countedSegments") ?? 0))}. Ending it now still ends it, with no change for anyone in it.",
                    "info"));
            }
            foreach (string show in stillBooked) preview.Add(CreativeUi.Notice(DsState.Warn, StorylineText.StillBookedText(show), "calendar"));
            return preview;
        }

        /// <summary>An ended storyline's record: what it paid each member.</summary>
        public static VisualElement PaidList(JToken story, JToken record)
        {
            VisualElement list = Ds.Column("cr-payoff__members");
            Dictionary<string, string> images = MemberImages(story);
            var names = new[] { "faces", "heels", "neutrals" }.SelectMany(side => Kit.Arr(story, side))
                .GroupBy(member => Kit.Str(member, "personId")).ToDictionary(group => group.Key ?? string.Empty, group => Kit.Str(group.First(), "name"));
            foreach (JToken member in Kit.Arr(record, "members"))
            {
                string personId = Kit.Str(member, "personId");
                list.Add(MemberLine(personId, names.TryGetValue(personId ?? string.Empty, out string known) ? known : "Someone who was in it",
                    images.TryGetValue(personId ?? string.Empty, out string image) ? image : null,
                    Kit.Bool(member, "skipped") ? StorylineText.SkippedRecord : null,
                    Kit.Num(member, "popularityDelta") ?? 0, null, Kit.Num(member, "momentumDelta") ?? 0, null));
            }
            return list;
        }

        private static Dictionary<string, string> MemberImages(JToken story) =>
            new[] { "faces", "heels", "neutrals" }.SelectMany(side => Kit.Arr(story, side))
                .GroupBy(member => Kit.Str(member, "personId") ?? string.Empty)
                .ToDictionary(group => group.Key, group => Kit.Str(group.First(), "imageRef"));

        private static VisualElement MemberLine(string personId, string name, string imageRef, string skipped, double popularity, JToken popularityTrace, double momentum, JToken momentumTrace)
        {
            VisualElement row = Ds.Row("cr-payoff__member").Named("payoff-" + personId);
            row.Add(CreativeUi.Portrait(imageRef, "ds-portrait--xs"));
            row.Add(CreativeUi.Person(name, personId, "cr-payoff__name"));
            if (skipped != null)
            {
                row.Add(CreativeUi.Clip(skipped, "cr-payoff__skipped"));
                return row;
            }
            row.Add(Change("Popularity", popularity, 1, popularityTrace, name));
            row.Add(Change("Momentum", momentum, 0, momentumTrace, name));
            return row;
        }

        private static VisualElement Change(string label, double value, int decimals, JToken trace, string memberName)
        {
            DsState state = value > 0 ? DsState.Good : value < 0 ? DsState.Bad : DsState.Neutral;
            VisualElement cell = Ds.Row("cr-change", Ds.StateClass(state));
            cell.Add(Ds.Text(label, "cr-change__label"));
            cell.Add(Ds.Text(StorylineText.Signed(value, decimals), "cr-change__value"));
            return CreativeUi.Quiet(cell, CreativeUi.WhyTrace($"{label} for {memberName}", value, trace, "points", $"{label}: {memberName}"));
        }
    }

    /// <summary>
    /// Picks people for a storyline: a filter box over the promotion's people (portrait, name, job,
    /// push, how many storylines they are in, alignment), and the chosen list where each pick gets
    /// a Face / Heel / Neutral choice that starts from their alignment. "N of 12" counts the picks.
    /// </summary>
    public sealed class MemberPicker : VisualElement
    {
        private readonly List<JToken> options;
        private readonly HashSet<string> alreadyIn;
        private readonly int max;
        private readonly List<(string personId, string name, string side)> chosen = new List<(string, string, string)>();
        private readonly VisualElement chosenList;
        private readonly Label counter;
        private readonly Label error;
        private readonly VisualElement optionList;
        private string filter = string.Empty;

        public MemberPicker(JToken options, IEnumerable<string> alreadyIn, int max)
        {
            AddToClassList("cr-picker");
            name = "member-picker";
            this.options = Kit.Arr(options).ToList();
            this.alreadyIn = new HashSet<string>(alreadyIn);
            this.max = max;
            VisualElement head = Ds.Row("cr-picker__head");
            head.Add(Ds.Text(TextFormat.Upper("People"), "cr-field__label"));
            head.Add(Ds.Spacer());
            counter = Ds.Text(string.Empty, "cr-picker__counter");
            head.Add(counter);
            Add(head);
            chosenList = Ds.Column("cr-picker__chosen").Named("member-picker-chosen");
            Add(chosenList);
            error = Ds.Text(string.Empty, "cr-field__error");
            error.SetShown(false);
            Add(error);
            Add(CreativeUi.Search("Find a person", string.Empty, text =>
            {
                filter = text;
                DrawOptions();
            }, "member-picker-search"));
            optionList = Ds.Column("cr-picker__options").Named("member-picker-options");
            Add(optionList);
            if (options == null) optionList.Add(Ds.Text("Couldn't load the people you can pick.", "cr-quiet"));
            DrawChosen();
            DrawOptions();
        }

        public IReadOnlyList<(string personId, string name, string side)> Chosen => chosen;

        public IReadOnlyList<JToken> Options => options;

        public void SetError(string text)
        {
            error.text = text ?? string.Empty;
            error.SetShown(!string.IsNullOrEmpty(text));
        }

        public void Pick(JToken option)
        {
            string personId = Kit.Str(option, "personId");
            if (chosen.Count >= max || chosen.Any(member => member.personId == personId) || alreadyIn.Contains(personId)) return;
            chosen.Add((personId, Kit.Str(option, "name"), StorylineText.DefaultSideFor(Kit.Str(option, "alignment"))));
            DrawChosen();
            DrawOptions();
        }

        public void Remove(string personId)
        {
            chosen.RemoveAll(member => member.personId == personId);
            DrawChosen();
            DrawOptions();
        }

        public void SetSide(string personId, string side)
        {
            int index = chosen.FindIndex(member => member.personId == personId);
            if (index < 0) return;
            chosen[index] = (chosen[index].personId, chosen[index].name, side);
            DrawChosen();
        }

        private void DrawChosen()
        {
            counter.text = $"{TextFormat.Number(chosen.Count)} of {TextFormat.Number(max)}";
            chosenList.Clear();
            if (chosen.Count == 0)
            {
                chosenList.Add(Ds.Text("Pick people from the list below.", "cr-quiet"));
                return;
            }
            foreach ((string personId, string memberName, string side) in chosen)
            {
                string id = personId;
                VisualElement row = Ds.Row("cr-chosen").Named("chosen-" + id);
                row.Add(CreativeUi.Clip(memberName, "cr-chosen__name"));
                VisualElement sides = Ds.Row("cr-chosen__sides");
                foreach ((string value, string _, string label) in StorylineText.Sides)
                {
                    string target = value;
                    Button chip = Ds.Chip(label, side == value, () => SetSide(id, target));
                    chip.name = $"chosen-{id}-{value}";
                    sides.Add(chip);
                }
                row.Add(sides);
                Button remove = Ds.IconButton("close", $"Remove {memberName}", () => Remove(id));
                row.Add(remove);
                chosenList.Add(row);
            }
        }

        private void DrawOptions()
        {
            optionList.Clear();
            bool full = chosen.Count >= max;
            if (full) optionList.Add(Ds.Text("That's as many as this storyline can take. Remove someone to pick another.", "cr-quiet"));
            string needle = filter.Trim();
            List<JToken> shown = options.Where(option => needle.Length == 0 || (Kit.Str(option, "name") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0).ToList();
            if (shown.Count == 0 && options.Count > 0) optionList.Add(Ds.Text("No one matches.", "cr-quiet"));
            foreach (JToken option in shown.Take(StorylineSheets.MaxOptions))
            {
                JToken captured = option;
                string personId = Kit.Str(option, "personId");
                bool picked = chosen.Any(member => member.personId == personId);
                bool already = alreadyIn.Contains(personId);
                var row = new Button(() => Pick(captured)) { text = string.Empty };
                row.name = "option-" + personId;
                row.AddToClassList("cr-option");
                string alignment = Kit.Str(option, "alignment");
                row.Add(CreativeUi.Portrait(Kit.Str(option, "imageRef"), "ds-portrait--xs", false, alignment == "face" ? Alignment.Face : alignment == "heel" ? Alignment.Heel : Alignment.Tweener));
                VisualElement words = Ds.Column("cr-option__words");
                words.Add(CreativeUi.Clip(Kit.Str(option, "name"), "cr-option__name"));
                string facts = StorylineText.MemberOptionFacts(Kit.Str(option, "role"), Kit.Str(option, "push"), (int)(Kit.Num(option, "activeStorylineCount") ?? 0));
                if (picked) facts += " · Picked";
                if (already) facts += " · Already in it";
                words.Add(CreativeUi.Clip(facts, "cr-option__facts"));
                row.Add(words);
                row.Add(Ds.Tag(alignment == "tweener" ? "Tweener" : Kit.Capital(alignment ?? "?"), alignment == "face" || alignment == "heel" ? alignment : null));
                row.SetEnabled(!picked && !already && !full);
                optionList.Add(row);
            }
            if (shown.Count > StorylineSheets.MaxOptions) optionList.Add(Ds.Text($"Showing {StorylineSheets.MaxOptions} of {shown.Count}. Type a name to find someone else.", "cr-quiet"));
        }
    }
}
