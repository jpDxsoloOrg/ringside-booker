using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The segment editor sheet (a working subset of the web's SegmentEditorSheet): match or talking
    /// segment; the type (<c>match.catalog</c>); sides built from a roster picker
    /// (<c>booking.availableWorkers</c>); titles on the line; the planned result (a side, Draw, No
    /// contest, Auto or Random) with its method; a storyline link; the time (Usual, Short, Standard,
    /// Long); and for talking segments one beat with everyone in it. Saves with
    /// <c>booking.addSegment</c> or <c>booking.updateSegment</c>.
    /// </summary>
    public static class SegmentEditor
    {
        private sealed class Person
        {
            public string Id;
            public string Name;
            public int Side;
        }

        private sealed class Draft
        {
            public string Kind;
            public string TypeKey;
            public readonly List<Person> People = new List<Person>();
            public int Sides = 2;
            public readonly List<string> TitleIds = new List<string>();
            public readonly List<string> StorylineIds = new List<string>();
            /// <summary>"none", "auto", "random", "draw", "noContest" or "win".</summary>
            public string Result = "auto";
            public int WinningSide;
            public string MethodKey;
            public string Time;
            public string BeatKey;
            public string Setting;
            public JToken Original;
        }

        public static async void Open(ScreenContext context, JToken card, bool preShow, int slot, JToken segment, string kind)
        {
            EngineClient client = Kit.Game.Client;
            string eventId = Kit.Str(card, "show.eventInstanceId");
            QueryResult<JToken> catalog = await client.Query("match.catalog");
            if (!catalog.Ok) return;
            Draft draft = FromSegment(segment, kind, catalog.Data);

            string title = segment == null ? (kind == "match" ? "New match" : "New talking segment") : $"Edit {Kit.Str(segment, "typeName")}";
            Sheet sheet = Sheet.Open(context.Overlay, title, SheetPlacement.Right);
            sheet.Root.name = "segment-editor";
            sheet.Root.AddToClassList("rb-editor");
            VisualElement form = Ui.El("rb-stack");
            sheet.Body.Add(form);
            Label feedback = Kit.Feedback();
            sheet.Body.Add(feedback);

            void Redraw() => Draw(form, draft, card, catalog.Data, context, eventId, Redraw);
            Redraw();

            sheet.AddFooterButton("Cancel", sheet.Close, "btn--ghost");
            Button save = sheet.AddFooterButton("Save", async () =>
            {
                JObject json = ToJson(draft);
                CommandResult<JToken> result = segment == null
                    ? await Kit.Run("booking.addSegment", new JObject { ["eventInstanceId"] = eventId, ["preShow"] = preShow, ["slot"] = slot, ["draft"] = json }, feedback)
                    : await Kit.Run("booking.updateSegment", new JObject { ["segmentId"] = Kit.Str(segment, "segmentId"), ["draft"] = json }, feedback);
                if (result.Ok) sheet.Close();
            }, "btn--primary");
            save.name = "segment-save";
        }

        private static Draft FromSegment(JToken segment, string kind, JToken catalog)
        {
            var draft = new Draft { Kind = kind };
            JToken source = Kit.Obj(segment, "draft");
            draft.Original = source;
            if (source == null)
            {
                draft.TypeKey = kind == "match" ? "match.singles" : Kit.Str(Kit.Arr(catalog, "angleTypes").FirstOrDefault(), "key");
                draft.Sides = kind == "match" ? 2 : 1;
                draft.BeatKey = DefaultBeat(catalog, draft.TypeKey);
                return draft;
            }

            draft.TypeKey = kind == "match" ? Kit.Str(source, "match.matchTypeKey") : Kit.Str(source, "angle.angleTypeKey");
            var names = Kit.Arr(segment, "sides").SelectMany(side => Kit.Arr(side, "people"))
                .ToDictionary(person => Kit.Str(person, "personId"), person => Kit.Str(person, "ringName"));
            foreach (JToken participant in Kit.Arr(source, "participants"))
            {
                string id = Kit.Str(participant, "personId");
                draft.People.Add(new Person { Id = id, Name = names.TryGetValue(id, out string name) ? name : id, Side = (int)(Kit.Num(participant, "side") ?? 0) });
            }
            draft.Sides = Math.Max(kind == "match" ? 2 : 1, draft.People.Count == 0 ? 0 : draft.People.Max(person => person.Side) + 1);
            draft.TitleIds.AddRange(Kit.Arr(source, "match.titleIds").Select(id => (string)id));
            draft.StorylineIds.AddRange(Kit.Arr(source, "storylineIds").Select(id => (string)id));
            draft.Time = Kit.Str(source, "bookedTime");
            draft.Setting = Kit.Str(source, "angle.setting");
            draft.BeatKey = Kit.Str(Kit.Arr(source, "angle.beats").FirstOrDefault(), "beatKey") ?? DefaultBeat(catalog, draft.TypeKey);

            JToken planned = BookingScreen.PlannedResult(segment);
            if (planned == null) draft.Result = "none";
            else if (planned.Type == JTokenType.String) draft.Result = (string)planned;
            else
            {
                draft.Result = Kit.Str(planned, "kind");
                draft.WinningSide = (int)(Kit.Num(planned, "winningSide") ?? 0);
                draft.MethodKey = Kit.Str(planned, "methodKey");
            }
            return draft;
        }

        private static string DefaultBeat(JToken catalog, string angleTypeKey) =>
            Kit.Str(Kit.Arr(catalog, "angleTypes").FirstOrDefault(type => Kit.Str(type, "key") == angleTypeKey), "defaultBeatKey");

        private static void Draw(VisualElement form, Draft draft, JToken card, JToken catalog, ScreenContext context, string eventId, Action redraw)
        {
            form.Clear();
            bool match = draft.Kind == "match";

            // Type.
            form.Add(Ui.Text(TextFormat.Upper(match ? "Match type" : "Segment type"), "field-label"));
            IEnumerable<JToken> types = Kit.Arr(catalog, match ? "matchTypes" : "angleTypes").Where(type => !Kit.Bool(type, "hidden"));
            form.Add(Kit.Chips(types.Select(type => (Kit.Str(type, "key"), Kit.Str(type, "name"))), draft.TypeKey, picked =>
            {
                draft.TypeKey = picked;
                if (!match) draft.BeatKey = DefaultBeat(catalog, picked);
                redraw();
            }, "editor-type"));
            JToken typeInfo = types.FirstOrDefault(type => Kit.Str(type, "key") == draft.TypeKey);

            // Sides.
            int maxSides = match ? (int)(Kit.Num(typeInfo, "sides.max") ?? 2) : 4;
            form.Add(Ui.Text(TextFormat.Upper(match ? "Sides" : "Speakers"), "field-label", "rb-gap-top"));
            for (int side = 0; side < draft.Sides; side++)
            {
                int sideIndex = side;
                VisualElement box = Ui.El("rb-side").Named($"editor-side-{side}");
                box.Add(Ui.Text(match ? $"Side {side + 1}" : $"Speaker group {side + 1}", "t-xs", "t-muted"));
                foreach (Person person in draft.People.Where(person => person.Side == sideIndex).ToList())
                {
                    box.Add(Ui.El("rb-row", "rb-row--tight").With(
                        Ui.Text(person.Name, "t-sm"),
                        Ui.Btn("×", () =>
                        {
                            draft.People.Remove(person);
                            redraw();
                        }, "btn--link")));
                }
                Button add = Ui.Btn(match ? "+ Add wrestler" : "+ Add speaker", () => RosterPicker.Open(context.Overlay, eventId, match ? "match" : "angle",
                    draft.People.Select(person => person.Id).ToList(), (id, name) =>
                    {
                        draft.People.Add(new Person { Id = id, Name = name, Side = sideIndex });
                        redraw();
                    }), "btn--link");
                add.name = $"editor-add-{side}";
                box.Add(add);
                form.Add(box);
            }
            VisualElement sideButtons = Ui.El("rb-row", "rb-row--tight", "rb-row--wrap");
            if (draft.Sides < maxSides) sideButtons.Add(Ui.Btn("+ Add side", () => { draft.Sides++; redraw(); }, "btn--link"));
            if (draft.Sides > (match ? 2 : 1) && !draft.People.Any(person => person.Side == draft.Sides - 1))
            {
                sideButtons.Add(Ui.Btn("− Remove last side", () => { draft.Sides--; redraw(); }, "btn--link"));
            }
            form.Add(sideButtons);

            if (match)
            {
                // Titles.
                List<JToken> titles = Kit.Arr(card, "titleOptions").ToList();
                if (titles.Count > 0 && Kit.Bool(typeInfo, "allowsTitles"))
                {
                    form.Add(Ui.Text(TextFormat.Upper("Titles on the line"), "field-label", "rb-gap-top"));
                    VisualElement titleRow = Ui.El("chip-row", "rb-chips");
                    foreach (JToken titleOption in titles)
                    {
                        string id = Kit.Str(titleOption, "titleId");
                        Button chip = Ui.Button(string.Empty, () =>
                        {
                            if (!draft.TitleIds.Remove(id)) draft.TitleIds.Add(id);
                            redraw();
                        }, "choice-chip", "rb-chip");
                        chip.Add(Ui.Text(Kit.Str(titleOption, "name"), "choice-chip__label"));
                        string holders = string.Join(", ", Kit.Arr(titleOption, "holderNames").Select(name => (string)name));
                        chip.Add(Ui.Text(Kit.Bool(titleOption, "vacant") ? "Vacant" : holders, "choice-chip__detail"));
                        chip.EnableInClassList("choice-chip--selected", draft.TitleIds.Contains(id));
                        titleRow.Add(chip);
                    }
                    form.Add(titleRow);
                }

                // Result.
                form.Add(Ui.Text(TextFormat.Upper("Result"), "field-label", "rb-gap-top"));
                var results = new List<(string, string)> { ("auto", "Auto"), ("random", "Random") };
                for (int side = 0; side < draft.Sides; side++)
                {
                    string names = string.Join(" & ", draft.People.Where(person => person.Side == side).Select(person => person.Name));
                    results.Add(($"win:{side}", $"{(names.Length > 0 ? names : $"Side {side + 1}")} wins"));
                }
                results.Add(("draw", "Draw"));
                results.Add(("noContest", "No contest"));
                results.Add(("none", "Decide later"));
                string current = draft.Result == "win" ? $"win:{draft.WinningSide}" : draft.Result;
                form.Add(Kit.Chips(results, current, picked =>
                {
                    if (picked.StartsWith("win:"))
                    {
                        draft.Result = "win";
                        draft.WinningSide = int.Parse(picked.Substring(4));
                        draft.MethodKey ??= Kit.Str(Kit.Arr(catalog, "methods").FirstOrDefault(), "key");
                    }
                    else draft.Result = picked;
                    redraw();
                }, "editor-result"));
                if (draft.Result == "win")
                {
                    form.Add(Ui.Text("How", "t-xs", "t-muted"));
                    form.Add(Kit.Chips(Kit.Arr(catalog, "methods").Where(method => !Kit.Bool(method, "hidden"))
                        .Select(method => (Kit.Str(method, "key"), Kit.Str(method, "name"))), draft.MethodKey, picked => draft.MethodKey = picked));
                }
                form.Add(Kit.Note("Auto lets the night pick the most sensible winner; Random rolls for it."));
            }
            else
            {
                // One beat with everyone in it (the web's beat list is a Sprint U2 item).
                List<string> beatKeys = Kit.Arr(typeInfo, "beatKeys").Select(key => (string)key).ToList();
                if (beatKeys.Count > 0)
                {
                    var beatNames = Kit.Arr(catalog, "beats").ToDictionary(beat => Kit.Str(beat, "key"), beat => Kit.Str(beat, "name"));
                    form.Add(Ui.Text(TextFormat.Upper("What happens"), "field-label", "rb-gap-top"));
                    form.Add(Kit.Chips(beatKeys.Select(key => (key, beatNames.TryGetValue(key, out string name) ? name : key)), draft.BeatKey, picked => draft.BeatKey = picked, "editor-beat"));
                }
                List<string> settings = Kit.Arr(typeInfo, "settings").Select(key => (string)key).ToList();
                if (settings.Count > 1)
                {
                    form.Add(Ui.Text(TextFormat.Upper("Where"), "field-label", "rb-gap-top"));
                    form.Add(Kit.Chips(settings.Select(key => (key, key == "ring" ? "In the ring" : key == "video" ? "Pre-taped" : Kit.Capital(key))),
                        draft.Setting ?? settings[0], picked => draft.Setting = picked));
                }
            }

            // Time.
            form.Add(Ui.Text(TextFormat.Upper("Time"), "field-label", "rb-gap-top"));
            form.Add(Kit.Chips(new[] { ((string)null, "Usual"), ("short", "Short"), ("standard", "Standard"), ("long", "Long") }, draft.Time, picked => draft.Time = picked, "editor-time"));

            // Storyline link.
            StorylineField(form, draft, eventId, redraw);
        }

        private static async void StorylineField(VisualElement form, Draft draft, string eventId, Action redraw)
        {
            VisualElement slot = Ui.El("rb-stack");
            form.Add(slot);
            QueryResult<JToken> people = await Kit.Game.Client.Query("booking.availableWorkers",
                new JObject { ["eventInstanceId"] = eventId, ["kind"] = draft.Kind == "match" ? "match" : "angle" });
            if (!people.Ok) return;
            var booked = new HashSet<string>(draft.People.Select(person => person.Id));
            var storylines = Kit.Arr(people.Data, "people").Where(person => booked.Contains(Kit.Str(person, "personId")))
                .SelectMany(person => Kit.Arr(person, "storylines"))
                .GroupBy(story => Kit.Str(story, "storylineId")).Select(group => group.First()).ToList();
            if (storylines.Count == 0 && draft.StorylineIds.Count == 0) return;
            slot.Add(Ui.Text(TextFormat.Upper("Storyline"), "field-label", "rb-gap-top"));
            VisualElement row = Ui.El("chip-row", "rb-chips");
            foreach (JToken story in storylines)
            {
                string id = Kit.Str(story, "storylineId");
                Button chip = Ui.Button(string.Empty, () =>
                {
                    if (!draft.StorylineIds.Remove(id)) draft.StorylineIds.Add(id);
                    redraw();
                }, "choice-chip", "rb-chip");
                chip.Add(Ui.Text(Kit.Str(story, "name"), "choice-chip__label"));
                chip.EnableInClassList("choice-chip--selected", draft.StorylineIds.Contains(id));
                row.Add(chip);
            }
            slot.Add(row);
            slot.Add(Kit.Note("Linking a segment to a storyline moves that story on when the segment runs."));
        }

        private static JObject ToJson(Draft draft)
        {
            bool match = draft.Kind == "match";
            var participants = new JArray(draft.People.Select(person => new JObject
            {
                ["personId"] = person.Id,
                ["side"] = person.Side,
                ["role"] = match ? "competitor" : "speaker",
                ["teamId"] = null,
            }));
            var json = new JObject
            {
                ["kind"] = draft.Kind,
                ["label"] = null,
                ["storylineIds"] = new JArray(draft.StorylineIds),
                ["participants"] = participants,
            };
            if (draft.Original?["crew"] is JObject crew) json["crew"] = crew.DeepClone();
            if (draft.Time != null) json["bookedTime"] = draft.Time;

            if (match)
            {
                var details = new JObject
                {
                    ["matchTypeKey"] = draft.TypeKey,
                    ["stipulationKeys"] = Kit.Obj(draft.Original, "match.stipulationKeys")?.DeepClone() ?? new JArray(),
                    ["titleIds"] = new JArray(draft.TitleIds),
                    ["finishKey"] = Kit.Obj(draft.Original, "match.finishKey")?.DeepClone(),
                };
                JToken outcome = null;
                switch (draft.Result)
                {
                    case "auto":
                    case "random":
                        details["resultPlan"] = draft.Result;
                        break;
                    case "draw":
                        outcome = new JObject { ["kind"] = "draw" };
                        break;
                    case "noContest":
                        outcome = new JObject { ["kind"] = "noContest" };
                        break;
                    case "win":
                        outcome = new JObject { ["kind"] = "win", ["winningSide"] = draft.WinningSide, ["methodKey"] = draft.MethodKey ?? "method.pinfall" };
                        break;
                }
                json["match"] = details;
                json["outcome"] = outcome;
            }
            else
            {
                var angle = new JObject { ["angleTypeKey"] = draft.TypeKey };
                if (draft.BeatKey != null && draft.People.Count > 0)
                {
                    angle["beats"] = new JArray(new JObject { ["beatKey"] = draft.BeatKey, ["personIds"] = new JArray(draft.People.Select(person => person.Id)) });
                }
                if (draft.Setting != null) angle["setting"] = draft.Setting;
                json["angle"] = angle;
            }
            return json;
        }
    }

    /// <summary>The roster picker (the web's SideBuilder search): who can be booked on this show.</summary>
    public static class RosterPicker
    {
        public static async void Open(OverlayLayer overlay, string eventId, string kind, IReadOnlyCollection<string> taken, Action<string, string> onPick)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("booking.availableWorkers",
                new JObject { ["eventInstanceId"] = eventId, ["kind"] = kind });
            Sheet sheet = Sheet.Open(overlay, kind == "match" ? "Add a wrestler" : "Add a speaker", SheetPlacement.Center);
            sheet.Root.name = "roster-picker";
            sheet.Root.AddToClassList("rb-picker");
            if (!answer.Ok)
            {
                sheet.Body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            var search = new TextField { name = "picker-search" };
            search.AddToClassList("text-input");
            search.textEdition.placeholder = "Search by name";
            sheet.Body.Add(search);
            VisualElement list = Ui.El("rb-stack", "rb-picker__list");
            sheet.Body.Add(list);
            List<JToken> people = Kit.Arr(answer.Data, "people").Where(person => !taken.Contains(Kit.Str(person, "personId"))).ToList();

            Import.Pictures.PictureProvider pictures = WorkshopWorlds.CurrentPictures;

            void Fill(string filter)
            {
                list.Clear();
                foreach (JToken person in people.Where(person => string.IsNullOrEmpty(filter) ||
                    (Kit.Str(person, "ringName") ?? string.Empty).IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0).Take(80))
                {
                    string id = Kit.Str(person, "personId");
                    string name = Kit.Str(person, "ringName");
                    bool bookable = Kit.Bool(person, "bookable");
                    Button row = Ui.Button(string.Empty, () =>
                    {
                        sheet.Close();
                        onPick(id, name);
                    }, "rb-pick-row");
                    row.name = $"pick-{id}";
                    VisualElement portrait = RosterScreen.Portrait(pictures, Kit.Str(person, "imageRef"));
                    if (portrait != null) row.Add(portrait);
                    row.Add(Ui.Text(name, "t-ui-semibold", "rb-pick-row__name"));
                    row.Add(Ui.Text(Kit.PushLabel(Kit.Str(person, "push")), "t-xs", "t-muted", "rb-pick-row__cell"));
                    row.Add(Ui.Text($"Pop {Kit.Decimal1(Kit.Num(person, "popularity"))}", "t-xs", "t-data", "rb-pick-row__cell"));
                    row.Add(Ui.Text($"Stamina {Kit.Whole(Kit.Num(person, "stamina"))}", "t-xs", "rb-pick-row__cell"));
                    string onCard = Kit.Arr(person, "onCard").Any() ? "On the card" : null;
                    row.Add(Ui.Text(bookable ? onCard ?? Kit.Str(person, "brandName") ?? string.Empty : Kit.Str(person, "availability.label") ?? "Unavailable",
                        "t-xs", bookable ? "t-muted" : "t-negative", "rb-pick-row__cell"));
                    row.SetEnabled(bookable);
                    list.Add(row);
                }
            }

            search.RegisterValueChangedCallback(evt => Fill(evt.newValue));
            Fill(string.Empty);
        }
    }
}
