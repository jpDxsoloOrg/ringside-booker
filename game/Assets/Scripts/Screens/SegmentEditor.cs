using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The segment editor (the web's SegmentEditorSheet with its sections), a side sheet on the design
    /// system. It edits the segment's draft as the engine stores it and saves it with
    /// <c>booking.addSegment</c> / <c>booking.updateSegment</c>:
    /// <list type="bullet">
    /// <item>the type (<c>match.catalog</c>);</item>
    /// <item>a match's sides, built from people or whole teams (tag teams, <c>booking.availableWorkers</c>),
    /// its titles on the line, the planned result, the way of winning and, one step away, the finish
    /// (<c>match.finishes</c>);</item>
    /// <item>a talking segment's speakers and the part each plays, where it happens, and its beats: a list
    /// of beats, each with one or two groups of speakers (<see cref="AngleBeats"/>; the speakers' sides
    /// follow from the groups), up to the slot's beat limit;</item>
    /// <item>the length, Short / Standard / Long (never minutes, D-10);</item>
    /// <item>the storyline links (<see cref="StorylineLinks"/>, written at once).</item>
    /// </list>
    /// </summary>
    public static class SegmentEditor
    {
        private static readonly Dictionary<string, string> BeatNames = new Dictionary<string, string>();

        /// <summary>A beat's name from the catalog (once an editor has read it), else its key.</summary>
        public static string BeatName(string key)
        {
            if (key == null) return string.Empty;
            if (BeatNames.TryGetValue(key, out string name)) return name;
            string tail = key.Substring(key.LastIndexOf('.') + 1);
            return Kit.Capital(tail);
        }

        /// <summary>The open editor (screenshot tours).</summary>
        public static Session Current { get; private set; }

        public static async void Open(BookingPage page, JToken slot, JToken segment, string kind)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> catalog = await client.Query("match.catalog");
            if (!catalog.Ok)
            {
                page.Feedback.text = Kit.Reasons(catalog.Reasons);
                page.Feedback.SetShown(true);
                return;
            }
            foreach (JToken beat in Kit.Arr(catalog.Data, "beats")) BeatNames[Kit.Str(beat, "key")] = Kit.Str(beat, "name");
            QueryResult<JToken> roster = await client.Query("booking.availableWorkers",
                new JObject { ["eventInstanceId"] = page.EventId, ["kind"] = kind == "match" ? "match" : "angle" });
            var session = new Session(page, slot, segment, kind, catalog.Data, roster.Ok ? roster.Data : null);
            Current = session;
            session.Show();
        }

        /// <summary>One open editor: the draft and the sheet that draws it.</summary>
        public sealed class Session
        {
            private readonly BookingPage page;
            private readonly JToken slot;
            private readonly JToken segment;
            private readonly JToken catalog;
            private readonly JToken roster;
            private readonly JObject draft;
            private readonly Dictionary<string, string> names = new Dictionary<string, string>();
            private readonly VisualElement form = Ds.Column("fc-editor").Named("segment-editor-form");
            private readonly Label feedback = Ds.Text(string.Empty, "fc-refusal");
            private OverlayHandle handle;
            private List<BeatRow> beatRows;
            private string conflict;
            private int beatLimit = AngleBeats.MaxBeats;
            private string beatLimitText;
            private bool showMore;
            private JToken finishes;

            internal Session(BookingPage page, JToken slot, JToken segment, string kind, JToken catalog, JToken roster)
            {
                this.page = page;
                this.slot = slot;
                this.segment = segment;
                this.catalog = catalog;
                this.roster = roster;
                foreach (JToken person in Kit.Arr(roster, "people")) names[Kit.Str(person, "personId")] = Kit.Str(person, "ringName");
                foreach (JToken person in Kit.Arr(segment, "sides").SelectMany(side => Kit.Arr(side, "people")))
                {
                    names[Kit.Str(person, "personId")] = Kit.Str(person, "ringName");
                }
                draft = segment != null ? (JObject)Kit.Obj(segment, "draft").DeepClone() : NewDraft(kind);
                feedback.SetShown(false);
            }

            public bool IsMatch => Kit.Str(draft, "kind") == "match";
            private JArray Participants => (JArray)(draft["participants"] ??= new JArray());
            private string SegmentId => Kit.Str(segment, "segmentId");

            private JObject NewDraft(string kind)
            {
                if (kind == "match")
                {
                    string type = Kit.Arr(catalog, "matchTypes").Where(entry => !Kit.Bool(entry, "hidden")).Select(entry => Kit.Str(entry, "key"))
                        .FirstOrDefault(key => key == "match.singles") ?? Kit.Str(Kit.Arr(catalog, "matchTypes").FirstOrDefault(), "key");
                    return new JObject
                    {
                        ["kind"] = "match",
                        ["label"] = null,
                        ["storylineIds"] = new JArray(),
                        ["participants"] = new JArray(),
                        ["match"] = new JObject { ["matchTypeKey"] = type, ["stipulationKeys"] = new JArray(), ["titleIds"] = new JArray(), ["finishKey"] = null, ["resultPlan"] = "auto" },
                        ["outcome"] = null,
                    };
                }
                JToken angleType = Kit.Arr(catalog, "angleTypes").FirstOrDefault(entry => !Kit.Bool(entry, "hidden"));
                var angle = new JObject { ["angleTypeKey"] = Kit.Str(angleType, "key") };
                if (Kit.Arr(angleType, "settings").FirstOrDefault() is JToken setting) angle["setting"] = setting.DeepClone();
                return new JObject
                {
                    ["kind"] = "angle",
                    ["label"] = null,
                    ["storylineIds"] = new JArray(),
                    ["participants"] = new JArray(),
                    ["angle"] = angle,
                };
            }

            // ---- The sheet ------------------------------------------------------------------------

            internal void Show()
            {
                VisualElement body = FightCardStyles.Apply(Ds.Column("fc-editor-wrap"));
                body.Add(form);
                body.Add(feedback);
                VisualElement footer = Ds.Row("fc-editor__footer");
                footer.Add(Ds.Spacer());
                footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
                Button save = Ds.Button("Save", async () => await Save(), DsButtonKind.Primary, "check");
                save.name = "segment-save";
                footer.Add(save);
                string title = segment == null ? (IsMatch ? "New match" : "New talking segment") : $"Edit {Kit.Str(segment, "typeName")}";
                handle = DsOverlay.SideSheet(page.Feedback, title, body, Kit.Str(slot, "roleLabel"), footer, 640f);
                if (handle != null)
                {
                    handle.Entry.name = "segment-editor";
                    handle.Closed += () =>
                    {
                        if (Current == this) Current = null;
                    };
                }
                if (!IsMatch) _ = LoadBeatLimit();
                if (IsMatch) _ = LoadFinishes();
                Redraw();
            }

            private void Redraw()
            {
                form.Clear();
                TypeSection();
                if (IsMatch)
                {
                    SidesSection();
                    TitlesSection();
                    ResultSection();
                }
                else
                {
                    SpeakersSection();
                    BeatsSection();
                    SettingSection();
                }
                TimeSection();
                form.Add(Ds.SectionHeader("Storylines"));
                form.Add(StorylineLinks.Build(SegmentId, feedback, ids => draft["storylineIds"] = new JArray(ids)));
            }

            private static VisualElement Field(string label) => Ds.Text(TextFormat.Upper(label), "fc-label", "fc-label--block");

            // ---- Type -------------------------------------------------------------------------------

            private JToken TypeInfo => IsMatch
                ? Kit.Arr(catalog, "matchTypes").FirstOrDefault(type => Kit.Str(type, "key") == Kit.Str(draft, "match.matchTypeKey"))
                : Kit.Arr(catalog, "angleTypes").FirstOrDefault(type => Kit.Str(type, "key") == Kit.Str(draft, "angle.angleTypeKey"));

            private void TypeSection()
            {
                form.Add(Ds.SectionHeader(IsMatch ? "Match type" : "Segment type"));
                VisualElement chips = Ds.Row("fc-chip-row").Named("editor-type");
                string current = IsMatch ? Kit.Str(draft, "match.matchTypeKey") : Kit.Str(draft, "angle.angleTypeKey");
                foreach (JToken type in Kit.Arr(catalog, IsMatch ? "matchTypes" : "angleTypes").Where(type => !Kit.Bool(type, "hidden") || Kit.Str(type, "key") == current))
                {
                    string key = Kit.Str(type, "key");
                    Button chip = Ds.Chip(Kit.Str(type, "name"), key == current, () => PickType(key));
                    chip.name = $"type-{key}";
                    chips.Add(chip);
                }
                form.Add(chips);
            }

            private void PickType(string key)
            {
                if (IsMatch) draft["match"]["matchTypeKey"] = key;
                else
                {
                    var angle = (JObject)draft["angle"];
                    angle["angleTypeKey"] = key;
                    angle.Remove("beats");
                    JToken type = Kit.Arr(catalog, "angleTypes").FirstOrDefault(entry => Kit.Str(entry, "key") == key);
                    List<string> settings = Kit.Arr(type, "settings").Select(setting => (string)setting).ToList();
                    if (settings.Count > 0 && !settings.Contains(Kit.Str(angle, "setting"))) angle["setting"] = settings[0];
                    beatRows = null;
                    _ = LoadBeatLimit();
                }
                if (IsMatch) _ = LoadFinishes();
                Redraw();
            }

            // ---- Match sides (people and tag teams) ----------------------------------------------

            private int SideCount
            {
                get
                {
                    int built = Participants.Any() ? Participants.Max(person => (int)(Kit.Num(person, "side") ?? 0)) + 1 : 0;
                    int min = (int)(Kit.Num(TypeInfo, "sides.min") ?? 2);
                    return Math.Max(Math.Max(built, min), sideSlots);
                }
            }

            private int sideSlots;

            private void SidesSection()
            {
                JToken type = TypeInfo;
                int sizeMax = (int)(Kit.Num(type, "sideSize.max") ?? 1);
                int sizeMin = (int)(Kit.Num(type, "sideSize.min") ?? 1);
                int sidesMax = (int)(Kit.Num(type, "sides.max") ?? 2);
                int sidesMin = (int)(Kit.Num(type, "sides.min") ?? 2);
                form.Add(Ds.SectionHeader("Sides"));
                int count = SideCount;
                VisualElement grid = Ds.Row("ds-row--top", "ds-row--wrap", "fc-sides");
                var titleHolders = new HashSet<string>(Kit.Arr(page.Card, "titleOptions").SelectMany(title => Kit.Arr(title, "holderIds")).Select(id => (string)id));
                for (int side = 0; side < count; side++)
                {
                    int sideIndex = side;
                    List<JToken> people = Participants.Where(person => (int)(Kit.Num(person, "side") ?? 0) == side).ToList();
                    VisualElement box = Ds.Column("fc-side").Named($"editor-side-{side}");
                    string teamId = people.Select(person => Kit.Str(person, "teamId")).FirstOrDefault(id => id != null);
                    string teamName = teamId == null ? null : Kit.Str(Kit.Arr(roster, "teams").FirstOrDefault(team => Kit.Str(team, "teamId") == teamId), "name");
                    VisualElement head = Ds.Row("fc-side__head");
                    head.Add(Ds.Text($"SIDE {side + 1}", "fc-label"));
                    if (teamName != null) head.Add(Ds.Pill(DsState.Info, teamName, "users"));
                    box.Add(head);
                    foreach (JToken person in people)
                    {
                        string id = Kit.Str(person, "personId");
                        box.Add(PersonLine(id, titleHolders.Contains(id), () =>
                        {
                            person.Remove();
                            Redraw();
                        }));
                    }
                    if (people.Count < sizeMin) box.Add(Ds.Text($"Needs {sizeMin - people.Count} more on this side", "fc-hint", "fc-hint--warn"));
                    else if (people.Count > sizeMax) box.Add(Ds.Text($"{people.Count - sizeMax} too many on this side", "fc-hint", "fc-hint--warn"));
                    VisualElement buttons = Ds.Row("fc-side__buttons");
                    Button add = Ds.Button("Add wrestler", () => RosterPicker.Open(form, roster, "match", TakenIds(), (id, name, talkRole) =>
                    {
                        names[id] = name;
                        Participants.Add(new JObject { ["personId"] = id, ["side"] = sideIndex, ["role"] = "competitor", ["teamId"] = null });
                        Redraw();
                    }), DsButtonKind.Ghost, "user-plus");
                    add.name = $"editor-add-{side}";
                    add.SetEnabled(people.Count < sizeMax);
                    buttons.Add(add);
                    if (sizeMax > 1)
                    {
                        Button team = Ds.Button("Add team", () => RosterPicker.OpenTeams(form, roster, TakenIds(), (picked, memberIds) =>
                        {
                            foreach (string memberId in memberIds)
                            {
                                if (TakenIds().Contains(memberId)) continue;
                                Participants.Add(new JObject { ["personId"] = memberId, ["side"] = sideIndex, ["role"] = "competitor", ["teamId"] = picked });
                            }
                            Redraw();
                        }), DsButtonKind.Ghost, "users");
                        team.name = $"editor-add-team-{side}";
                        team.SetEnabled(people.Count == 0);
                        buttons.Add(team);
                    }
                    box.Add(buttons);
                    grid.Add(box);
                }
                form.Add(grid);
                VisualElement sideButtons = Ds.Row("fc-chip-row");
                if (count < sidesMax)
                {
                    sideButtons.Add(Ds.Button("Add a side", () =>
                    {
                        sideSlots = count + 1;
                        Redraw();
                    }, DsButtonKind.Ghost, "add"));
                }
                if (count > sidesMin && !Participants.Any(person => (int)(Kit.Num(person, "side") ?? 0) == count - 1))
                {
                    sideButtons.Add(Ds.Button("Remove the last side", () =>
                    {
                        sideSlots = count - 1;
                        Redraw();
                    }, DsButtonKind.Ghost, "decrease"));
                }
                if (sideButtons.childCount > 0) form.Add(sideButtons);
            }

            private VisualElement PersonLine(string personId, bool champion, Action remove, VisualElement extra = null)
            {
                VisualElement line = Ds.Row("fc-person").Named($"editor-person-{personId}");
                PersonFacts facts = page.State.People?.Get(personId);
                line.Add(DsCards.PortraitBox(CardPeople.Picture(facts?.ImageRef ?? ImageRefOf(personId)), facts?.Alignment ?? Alignment.Tweener, "ds-portrait--xs", champion, NameOf(personId)));
                line.Add(Ds.Text(NameOf(personId), "fc-person__name"));
                if (champion) line.Add(new Icon("crown", "ds-icon--xs", "fc-person__crown"));
                line.Add(Ds.Spacer());
                if (extra != null) line.Add(extra);
                Button x = Ds.IconButton("close", "Take off this segment", remove);
                x.name = $"editor-remove-{personId}";
                line.Add(x);
                return line;
            }

            private string ImageRefOf(string personId) =>
                Kit.Str(Kit.Arr(roster, "people").FirstOrDefault(person => Kit.Str(person, "personId") == personId), "imageRef");

            private string NameOf(string personId) => personId != null && names.TryGetValue(personId, out string name) && name != null ? name : "Someone off the roster";

            private List<string> TakenIds() => Participants.Select(person => Kit.Str(person, "personId")).ToList();

            // ---- Titles and result ------------------------------------------------------------------

            private void TitlesSection()
            {
                List<JToken> titles = Kit.Arr(page.Card, "titleOptions").ToList();
                if (titles.Count == 0 || !Kit.Bool(TypeInfo, "allowsTitles")) return;
                form.Add(Ds.SectionHeader("Titles on the line"));
                var chosen = (JArray)(draft["match"]["titleIds"] ??= new JArray());
                VisualElement chips = Ds.Row("fc-chip-row").Named("editor-titles");
                foreach (JToken title in titles)
                {
                    string id = Kit.Str(title, "titleId");
                    bool on = chosen.Any(entry => (string)entry == id);
                    string holders = Kit.Bool(title, "vacant") ? "vacant" : string.Join(" & ", Kit.Arr(title, "holderNames").Select(name => (string)name));
                    Button chip = Ds.Chip($"{Kit.Str(title, "name")} ({holders})", on, () =>
                    {
                        JToken existing = chosen.FirstOrDefault(entry => (string)entry == id);
                        if (existing != null) existing.Remove();
                        else chosen.Add(id);
                        Redraw();
                    }, null, "trophy");
                    chip.name = $"title-{id}";
                    chips.Add(chip);
                }
                form.Add(chips);
            }

            private void ResultSection()
            {
                form.Add(Ds.SectionHeader("Result"));
                if (Kit.Bool(page.Card, "randomWinners"))
                {
                    form.Add(Ds.Text("Random winners are on for this game: the winner is decided on the night.", "fc-hint"));
                    return;
                }
                JToken outcome = Kit.Obj(draft, "outcome");
                string plan = Kit.Str(draft, "match.resultPlan");
                string current = outcome == null ? plan ?? "none" : Kit.Str(outcome, "kind") == "win" ? $"win-{Kit.Num(outcome, "winningSide") ?? 0}" : Kit.Str(outcome, "kind");
                VisualElement chips = Ds.Row("fc-chip-row").Named("editor-result");
                void Chip(string key, string text, Action apply)
                {
                    Button chip = Ds.Chip(text, current == key, () =>
                    {
                        apply();
                        Redraw();
                    });
                    chip.name = $"editor-result-{key}";
                    chips.Add(chip);
                }
                Chip("auto", "Auto", () => SetPlan("auto"));
                Chip("random", "Random", () => SetPlan("random"));
                for (int side = 0; side < SideCount; side++)
                {
                    int number = side;
                    List<string> people = Participants.Where(person => (int)(Kit.Num(person, "side") ?? 0) == side).Select(person => NameOf(Kit.Str(person, "personId"))).ToList();
                    Chip($"win-{side}", $"{(people.Count == 0 ? $"Side {side + 1}" : string.Join(" & ", people))} wins", () => SetOutcome(new JObject
                    {
                        ["kind"] = "win",
                        ["winningSide"] = number,
                        ["methodKey"] = Kit.Str(draft, "outcome.methodKey") ?? DefaultMethod(),
                    }));
                }
                Chip("draw", "Draw", () => SetOutcome(new JObject { ["kind"] = "draw" }));
                Chip("noContest", "No contest", () => SetOutcome(new JObject { ["kind"] = "noContest" }));
                Chip("none", "Decide later", () => SetOutcome(null));
                form.Add(chips);

                if (Kit.Str(outcome, "kind") == "win")
                {
                    form.Add(Field("How they win"));
                    VisualElement methods = Ds.Row("fc-chip-row").Named("editor-method");
                    foreach (JToken method in Kit.Arr(catalog, "methods").Where(method => !Kit.Bool(method, "hidden")))
                    {
                        string key = Kit.Str(method, "key");
                        Button chip = Ds.Chip(Kit.Str(method, "name"), Kit.Str(outcome, "methodKey") == key, () =>
                        {
                            draft["outcome"]["methodKey"] = key;
                            Redraw();
                        });
                        methods.Add(chip);
                    }
                    form.Add(methods);
                }
                form.Add(Ds.Text("Auto lets the night pick the most sensible winner; Random rolls for it.", "fc-hint"));

                Button more = Ds.Button(showMore ? "Fewer options" : "More options: the finish", () =>
                {
                    showMore = !showMore;
                    Redraw();
                }, DsButtonKind.Ghost, showMore ? "chevron-down" : "chevron-right");
                more.AddToClassList("fc-more");
                more.name = "editor-more";
                form.Add(more);
                if (showMore) FinishField();
            }

            private string DefaultMethod() =>
                Kit.Str(Kit.Arr(catalog, "methods").FirstOrDefault(method => !Kit.Bool(method, "hidden")), "key") ?? "method.pinfall";

            private void SetPlan(string plan)
            {
                draft["outcome"] = null;
                draft["match"]["resultPlan"] = plan;
                _ = LoadFinishes();
            }

            private void SetOutcome(JObject outcome)
            {
                draft["outcome"] = outcome;
                ((JObject)draft["match"]).Remove("resultPlan");
                _ = LoadFinishes();
            }

            private async Task LoadFinishes()
            {
                if (!IsMatch) return;
                int sides = Participants.Select(person => (int)(Kit.Num(person, "side") ?? 0)).Distinct().Count();
                var args = new JObject { ["matchTypeKey"] = Kit.Str(draft, "match.matchTypeKey") };
                if (sides >= 2) args["sideCount"] = sides;
                string kind = Kit.Str(draft, "outcome.kind") ?? (Kit.Str(draft, "match.resultPlan") != null ? "win" : null);
                if (kind != null) args["outcomeKind"] = kind;
                QueryResult<JToken> answer = await Kit.Game.Client.Query("match.finishes", args);
                finishes = answer.Ok ? answer.Data : null;
                string booked = Kit.Str(draft, "match.finishKey");
                if (booked != null && finishes != null && Kit.Arr(finishes).All(option => Kit.Str(option, "key") != booked)) draft["match"]["finishKey"] = null;
                if (showMore && form.panel != null) Redraw();
            }

            private void FinishField()
            {
                form.Add(Field("Finish"));
                VisualElement chips = Ds.Row("fc-chip-row").Named("editor-finish");
                string current = Kit.Str(draft, "match.finishKey");
                Button auto = Ds.Chip("Auto", current == null, () =>
                {
                    draft["match"]["finishKey"] = null;
                    Redraw();
                });
                chips.Add(auto);
                foreach (JToken option in Kit.Arr(finishes))
                {
                    string key = Kit.Str(option, "key");
                    Button chip = Ds.Chip(Kit.Str(option, "name"), current == key, () =>
                    {
                        draft["match"]["finishKey"] = key;
                        JToken outcome = Kit.Obj(draft, "outcome");
                        if (Kit.Str(outcome, "kind") == "win" && Kit.Arr(option, "methods").All(method => Kit.Str(method, "key") != Kit.Str(outcome, "methodKey")))
                        {
                            JToken method = Kit.Arr(option, "methods").FirstOrDefault();
                            if (method != null) draft["outcome"]["methodKey"] = Kit.Str(method, "key");
                        }
                        Redraw();
                    });
                    DsTooltip.Attach(chip, Kit.Str(option, "summary"));
                    chips.Add(chip);
                }
                form.Add(chips);
                if (finishes == null) form.Add(Ds.Text("Finishes load once the sides are set.", "fc-hint"));
            }

            // ---- Talking segment: speakers and parts -----------------------------------------------

            private static readonly (string key, string label)[] TalkRoles =
            {
                ("wrestler", "Wrestler"), ("manager", "Manager"), ("interviewer", "Interviewer"), ("authority", "Authority figure"),
            };

            private void SpeakersSection()
            {
                JToken type = TypeInfo;
                form.Add(Ds.SectionHeader("Speakers and their parts"));
                List<JToken> speakers = Participants.ToList();
                foreach (JToken person in speakers)
                {
                    string id = Kit.Str(person, "personId");
                    VisualElement parts = Ds.Row("fc-parts");
                    string role = Kit.Str(person, "talkRole") ?? "wrestler";
                    foreach ((string key, string label) in TalkRoles)
                    {
                        Button chip = Ds.Chip(label, role == key, () =>
                        {
                            var participant = (JObject)person;
                            if (key == "wrestler") participant.Remove("talkRole");
                            else participant["talkRole"] = key;
                            participant.Remove("forPersonId");
                            if (key == "manager")
                            {
                                string client = speakers.Select(other => Kit.Str(other, "personId")).FirstOrDefault(other => other != id);
                                if (client != null) participant["forPersonId"] = client;
                            }
                            Redraw();
                        });
                        chip.AddToClassList("fc-part-chip");
                        parts.Add(chip);
                    }
                    VisualElement line = PersonLine(id, false, () =>
                    {
                        person.Remove();
                        RemoveFromBeats(id);
                        Redraw();
                    });
                    form.Add(line);
                    VisualElement under = Ds.Row("fc-person__parts").With(parts);
                    if (role == "manager" && Kit.Str(person, "forPersonId") is string forId) under.Add(Ds.Text($"for {NameOf(forId)}", "fc-hint"));
                    form.Add(under);
                }
                int min = (int)(Kit.Num(type, "speakers.min") ?? 1);
                int max = (int)(Kit.Num(type, "speakers.max") ?? 4);
                if (speakers.Count < min) form.Add(Ds.Text($"Needs {min - speakers.Count} more {(min - speakers.Count == 1 ? "speaker" : "speakers")}", "fc-hint", "fc-hint--warn"));
                else if (speakers.Count > max) form.Add(Ds.Text($"{speakers.Count - max} too many speakers", "fc-hint", "fc-hint--warn"));
                Button add = Ds.Button("Add speaker", () => RosterPicker.Open(form, roster, "angle", TakenIds(), (id, name, talkRole) =>
                {
                    names[id] = name;
                    int side = Participants.Any() ? Participants.Max(other => (int)(Kit.Num(other, "side") ?? 0)) + 1 : 0;
                    var participant = new JObject { ["personId"] = id, ["side"] = Math.Min(side, 7), ["role"] = "speaker", ["teamId"] = null };
                    if (talkRole != null && talkRole != "wrestler") participant["talkRole"] = talkRole;
                    Participants.Add(participant);
                    if (beatRows != null && beatRows.Count > 0 && beatRows.Count == 1 && !TwoGroups(beatRows[0].BeatKey)) beatRows[0].GroupOne.Add(id);
                    else if (beatRows != null && beatRows.Count == 1 && TwoGroups(beatRows[0].BeatKey))
                    {
                        (beatRows[0].GroupOne.Count == 0 ? beatRows[0].GroupOne : beatRows[0].GroupTwo).Add(id);
                    }
                    ApplyBeats();
                    Redraw();
                }), DsButtonKind.Ghost, "user-plus");
                add.name = "editor-add-0";
                add.SetEnabled(speakers.Count < max);
                form.Add(Ds.Row("fc-side__buttons").With(add));
            }

            // ---- Talking segment: beats ----------------------------------------------------------

            private JToken BeatInfo(string key) => Kit.Arr(catalog, "beats").FirstOrDefault(beat => Kit.Str(beat, "key") == key);

            private bool TwoGroups(string key) => Kit.Arr(BeatInfo(key), "groups").Count() > 1;

            private List<string> AllowedBeats()
            {
                JToken type = TypeInfo;
                string first = Kit.Str(type, "defaultBeatKey");
                List<string> allowed = Kit.Arr(type, "beatKeys").Select(key => (string)key).ToList();
                if (first != null && allowed.Remove(first)) allowed.Insert(0, first);
                return allowed;
            }

            private void EnsureRows()
            {
                if (beatRows != null) return;
                var sides = Participants.ToDictionary(person => Kit.Str(person, "personId"), person => (int)(Kit.Num(person, "side") ?? 0));
                List<(string, IReadOnlyList<string>)> stored = draft["angle"]?["beats"] is JArray beats
                    ? beats.Select(beat => (Kit.Str(beat, "beatKey"), (IReadOnlyList<string>)Kit.Arr(beat, "personIds").Select(id => (string)id).ToList())).ToList()
                    : null;
                beatRows = AngleBeats.RowsOf(stored, sides, Kit.Str(TypeInfo, "defaultBeatKey"),
                    Participants.Select(person => Kit.Str(person, "personId")).ToList(), TwoGroups);
            }

            private void RemoveFromBeats(string personId)
            {
                EnsureRows();
                foreach (BeatRow row in beatRows)
                {
                    row.GroupOne.Remove(personId);
                    row.GroupTwo.Remove(personId);
                }
                ApplyBeats();
            }

            /// <summary>Writes the rows into the draft: stored beats plus each speaker's side, or the conflict.</summary>
            private void ApplyBeats()
            {
                if (beatRows == null) return;
                if (!AngleBeats.AssignSides(beatRows, TwoGroups, out Dictionary<string, int> sides, out SideConflict found))
                {
                    conflict = AngleBeats.ConflictMessage(beatRows, found, NameOf, TwoGroups);
                    return;
                }
                conflict = null;
                if (beatRows.Count == 0) return;
                var stored = new JArray(AngleBeats.ToStored(beatRows).Select(beat => new JObject
                {
                    ["beatKey"] = beat.beatKey,
                    ["personIds"] = new JArray(beat.personIds),
                }));
                draft["angle"]["beats"] = stored;
                int next = sides.Count == 0 ? 0 : sides.Values.Max() + 1;
                foreach (JToken person in Participants)
                {
                    string id = Kit.Str(person, "personId");
                    person["side"] = sides.TryGetValue(id, out int side) ? side : Math.Min(next++, 7);
                }
            }

            private async Task LoadBeatLimit()
            {
                string setting = Kit.Str(draft, "angle.setting") ?? "ring";
                var args = new JObject { ["slotRole"] = Kit.Str(slot, "role"), ["kind"] = "angle", ["setting"] = setting };
                if (Kit.Str(draft, "bookedTime") is string booked) args["bookedTime"] = booked;
                QueryResult<JToken> info = await Kit.Game.Client.Query("match.slotInfo", args);
                QueryResult<JToken> tunables = await Kit.Game.Client.Query("tunables.list", new JObject { ["category"] = "Angles" });
                string durationClass = info.Ok ? Kit.Str(info.Data, "durationClass") : null;
                double? value = tunables.Ok && durationClass != null
                    ? Kit.Num(Kit.Arr(tunables.Data).FirstOrDefault(row => Kit.Str(row, "key") == $"match.angle.maxBeats.{durationClass}"), "value")
                    : null;
                beatLimit = value == null ? AngleBeats.MaxBeats : Math.Min((int)value.Value, AngleBeats.MaxBeats);
                beatLimitText = value == null ? $"Up to {AngleBeats.MaxBeats} beats" : AngleBeats.LimitMessage(durationClass, beatLimit);
                if (form.panel != null && !IsMatch) Redraw();
            }

            private void BeatsSection()
            {
                EnsureRows();
                form.Add(Ds.SectionHeader("Beats"));
                VisualElement list = Ds.Column("fc-beats").Named("editor-beats");
                if (beatLimitText != null) list.Add(Ds.Text(beatLimitText, "fc-hint"));
                List<string> speakers = Participants.Select(person => Kit.Str(person, "personId")).ToList();
                if (speakers.Count == 0) list.Add(Ds.Text("Add speakers first: each beat is built from the segment's speakers.", "fc-hint"));
                for (int index = 0; index < beatRows.Count; index++) list.Add(BeatCard(index, speakers));
                if (beatRows.Count > beatLimit) list.Add(Ds.Text($"Only the first {beatLimit} beats count in this slot.", "fc-hint", "fc-hint--warn"));
                Button add = Ds.Button("Add a beat", () =>
                {
                    string key = AllowedBeats().FirstOrDefault();
                    if (key == null) return;
                    beatRows.Add(new BeatRow(key));
                    ApplyBeats();
                    Redraw();
                }, DsButtonKind.Ghost, "add");
                add.name = "editor-add-beat";
                add.SetEnabled(beatRows.Count < beatLimit && AllowedBeats().Count > 0);
                list.Add(Ds.Row("fc-side__buttons").With(add));
                if (conflict != null) list.Add(Ds.Text($"{conflict}. These beats aren't saved: move someone so each beat's groups agree.", "fc-refusal").Named("editor-beats-conflict"));
                form.Add(list);
            }

            private VisualElement BeatCard(int index, List<string> speakers)
            {
                BeatRow row = beatRows[index];
                JToken info = BeatInfo(row.BeatKey);
                List<JToken> groups = Kit.Arr(info, "groups").ToList();
                VisualElement card = Ds.Column("fc-beat").Named($"editor-beat-{index}");
                VisualElement head = Ds.Row("fc-beat__head");
                head.Add(Ds.Text($"{index + 1}", "fc-beat__number"));
                Button kind = Ds.Button(BeatName(row.BeatKey), null, DsButtonKind.Secondary, "chevron-down");
                kind.clicked += () => PickBeat(kind, row);
                kind.name = $"editor-beat-kind-{index}";
                head.Add(kind);
                head.Add(Ds.Spacer());
                Button up = Ds.IconButton("chevron-up", "Move this beat earlier", () =>
                {
                    beatRows.RemoveAt(index);
                    beatRows.Insert(index - 1, row);
                    ApplyBeats();
                    Redraw();
                });
                up.SetEnabled(index > 0);
                head.Add(up);
                Button down = Ds.IconButton("chevron-down", "Move this beat later", () =>
                {
                    beatRows.RemoveAt(index);
                    beatRows.Insert(index + 1, row);
                    ApplyBeats();
                    Redraw();
                });
                down.SetEnabled(index < beatRows.Count - 1);
                head.Add(down);
                Button remove = Ds.IconButton("trash", "Remove this beat", () =>
                {
                    beatRows.RemoveAt(index);
                    ApplyBeats();
                    Redraw();
                });
                remove.name = $"editor-beat-remove-{index}";
                remove.SetEnabled(beatRows.Count > 1);
                head.Add(remove);
                card.Add(head);
                if (Kit.Str(info, "description") is string description) card.Add(Ds.Text(description, "fc-hint"));

                for (int group = 0; group < Math.Max(1, Math.Min(2, groups.Count)); group++)
                {
                    List<string> people = group == 0 ? row.GroupOne : row.GroupTwo;
                    JToken groupInfo = groups.ElementAtOrDefault(group);
                    string label = Kit.Str(groupInfo, "label") ?? (group == 0 ? "Everyone" : "Group two");
                    VisualElement line = Ds.Row("fc-beat__group");
                    line.Add(Ds.Text(TextFormat.Upper(label), "fc-beat__group-label"));
                    VisualElement chips = Ds.Row("fc-chip-row", "fc-beat__people");
                    foreach (string person in people.ToList())
                    {
                        Button chip = Ds.Chip(NameOf(person), true, () =>
                        {
                            people.Remove(person);
                            ApplyBeats();
                            Redraw();
                        }, null, "close");
                        chips.Add(chip);
                    }
                    List<string> left = speakers.Where(person => !row.Everyone.Contains(person)).ToList();
                    Button add = Ds.Chip("Add", false, () => PickSpeaker(form, left, label, picked =>
                    {
                        people.Add(picked);
                        ApplyBeats();
                        Redraw();
                    }), null, "add");
                    add.name = $"editor-beat-{index}-add-{group}";
                    add.SetEnabled(left.Count > 0);
                    chips.Add(add);
                    line.Add(chips);
                    card.Add(line);
                    int minPeople = (int)(Kit.Num(groupInfo, "minPeople") ?? 0);
                    bool optional = Kit.Bool(groupInfo, "optional");
                    if (!optional && people.Count < minPeople && speakers.Count > 0)
                    {
                        card.Add(Ds.Text($"{BeatName(row.BeatKey)} needs {(minPeople <= 1 ? "someone" : $"at least {minPeople} people")} as {label.ToLowerInvariant()}", "fc-hint", "fc-hint--warn"));
                    }
                }
                return card;
            }

            private void PickBeat(VisualElement anchor, BeatRow row)
            {
                VisualElement list = FightCardStyles.Apply(Ds.Column("fc-pop-list"));
                OverlayHandle pop = null;
                foreach (string key in AllowedBeats())
                {
                    JToken info = BeatInfo(key);
                    Button option = Ds.Button(Kit.Str(info, "name") ?? key, () =>
                    {
                        pop?.Close();
                        bool wasTwo = TwoGroups(row.BeatKey);
                        row.BeatKey = key;
                        if (wasTwo && !TwoGroups(key))
                        {
                            row.GroupOne.AddRange(row.GroupTwo);
                            row.GroupTwo.Clear();
                        }
                        ApplyBeats();
                        Redraw();
                    }, key == row.BeatKey ? DsButtonKind.Primary : DsButtonKind.Ghost);
                    option.AddToClassList("fc-pop-list__item");
                    if (Kit.Str(info, "description") is string description) DsTooltip.Attach(option, description);
                    list.Add(option);
                }
                pop = DsOverlay.Popover(anchor, list, alignRight: false);
            }

            private void PickSpeaker(VisualElement anyElement, List<string> people, string groupLabel, Action<string> onPick)
            {
                VisualElement list = Ds.Column("fc-pop-list");
                OverlayHandle modal = null;
                foreach (string person in people)
                {
                    list.Add(Ds.Button(NameOf(person), () =>
                    {
                        modal?.Close();
                        onPick(person);
                    }, DsButtonKind.Ghost, "user"));
                }
                if (people.Count == 0) list.Add(Ds.Text("Everyone in this segment is already in this beat. Add a speaker above to bring someone new.", "fc-hint"));
                modal = DsOverlay.Modal(anyElement, $"Add to {groupLabel.ToLowerInvariant()}", FightCardStyles.Apply(list));
            }

            private void SettingSection()
            {
                List<string> settings = Kit.Arr(TypeInfo, "settings").Select(key => (string)key).ToList();
                string current = Kit.Str(draft, "angle.setting") ?? settings.FirstOrDefault() ?? "ring";
                form.Add(Ds.SectionHeader("Where"));
                if (settings.Count <= 1)
                {
                    form.Add(Ds.Text($"{BookingDetails.SettingWord(current)}: the only place this kind of segment happens.", "fc-hint"));
                    return;
                }
                var tabs = new DsTabs(segmented: true) { name = "editor-setting" };
                foreach (string setting in settings) tabs.Add(setting, BookingDetails.SettingWord(setting) ?? Kit.Capital(setting));
                tabs.Select(current, notify: false);
                tabs.Selected += picked =>
                {
                    draft["angle"]["setting"] = picked;
                    _ = LoadBeatLimit();
                    Redraw();
                };
                form.Add(tabs);
                form.Add(Ds.Text(current == "ring" ? "In front of the crowd: the crowd reacts." : current == "backstage" ? "Away from the crowd, shown on the screen." : "Recorded beforehand and played on the night.", "fc-hint"));
            }

            // ---- Time -------------------------------------------------------------------------------

            private void TimeSection()
            {
                form.Add(Ds.SectionHeader("Length"));
                if (Kit.Bool(slot, "timeLocked"))
                {
                    form.Add(Ds.Text("Long. The main event always runs long.", "fc-hint"));
                    return;
                }
                string usual = Kit.Str(slot, "usualTime");
                var tabs = new DsTabs(segmented: true) { name = "editor-time" };
                foreach (string length in CardWords.Lengths) tabs.Add(length, CardWords.Length(length) + (length == usual ? " (usual)" : string.Empty));
                tabs.Select(Kit.Str(draft, "bookedTime") ?? usual, notify: false);
                tabs.Selected += picked =>
                {
                    if (picked == usual) draft.Remove("bookedTime");
                    else draft["bookedTime"] = picked;
                    if (!IsMatch) _ = LoadBeatLimit();
                };
                form.Add(tabs);
                form.Add(Ds.Text($"Usual for the {Kit.Str(slot, "roleLabel")}: {CardWords.Length(usual)}. A longer one takes more of the show's time, raises the star limit and what the crowd expects. It must fit the show's time.", "fc-hint"));
            }

            // ---- Save -------------------------------------------------------------------------------

            private async Task Save()
            {
                if (!IsMatch && conflict != null)
                {
                    feedback.text = conflict;
                    feedback.SetShown(true);
                    return;
                }
                CommandResult<JToken> result = segment == null
                    ? await Kit.Game.Client.Command("booking.addSegment", new JObject
                    {
                        ["eventInstanceId"] = page.EventId,
                        ["preShow"] = Kit.Bool(slot, "preShow"),
                        ["slot"] = (int)(Kit.Num(slot, "slot") ?? 0),
                        ["draft"] = draft,
                    })
                    : await Kit.Game.Client.Command("booking.updateSegment", new JObject { ["segmentId"] = SegmentId, ["draft"] = draft });
                if (!result.Ok)
                {
                    feedback.text = Kit.Reasons(result.Reasons);
                    feedback.SetShown(true);
                    Debug.Log($"[Booking] save refused: {result.ReasonText}");
                    return;
                }
                handle?.Close();
                DsOverlay.Toast(page.Feedback, segment == null ? "Added to the card" : "Saved", DsState.Good, null, 3f);
            }

            /// <summary>For tours: opens the More options part (the finish).</summary>
            public void ShowMore()
            {
                showMore = true;
                Redraw();
            }
        }
    }

    /// <summary>
    /// The roster picker (the web's EditorRosterPicker): who can be booked on this show
    /// (<c>booking.availableWorkers</c>) with their picture, push, popularity, the titles they hold
    /// (EVT2-13's champion marker) and their storylines, a search and filters for champions and for
    /// each storyline. <see cref="OpenTeams"/> lists whole teams for a tag team side.
    /// </summary>
    public static class RosterPicker
    {
        public static void Open(VisualElement anyElement, JToken roster, string kind, IReadOnlyCollection<string> taken, Action<string, string, string> onPick)
        {
            VisualElement body = FightCardStyles.Apply(Ds.Column("fc-picker")).Named("roster-picker");
            OverlayHandle handle = null;
            if (roster == null)
            {
                body.Add(Ds.Text("The roster could not be read.", "fc-hint"));
                DsOverlay.Modal(anyElement, kind == "match" ? "Add a wrestler" : "Add a speaker", body);
                return;
            }
            var search = new TextField { name = "picker-search" };
            search.AddToClassList("fc-search");
            search.textEdition.placeholder = "Search by name";
            body.Add(search);
            VisualElement filters = Ds.Row("fc-chip-row", "fc-picker__filters").Named("picker-filters");
            body.Add(filters);
            var list = new ScrollView(ScrollViewMode.Vertical);
            list.AddToClassList("fc-picker__list");
            body.Add(list);
            List<JToken> people = Kit.Arr(roster, "people").Where(person => !taken.Contains(Kit.Str(person, "personId"))).ToList();
            string filter = null;

            void Filters()
            {
                filters.Clear();
                filters.Add(Ds.Chip("Everyone", filter == null, () => { filter = null; Filters(); Fill(search.value); }));
                filters.Add(Ds.Chip("Champions", filter == "champions", () => { filter = "champions"; Filters(); Fill(search.value); }, null, "crown"));
                foreach (JToken story in Kit.Arr(roster, "storylines").Take(8))
                {
                    string id = Kit.Str(story, "storylineId");
                    Button chip = Ds.Chip(Kit.Str(story, "name"), filter == id, () => { filter = id; Filters(); Fill(search.value); }, null, "storylines");
                    chip.name = $"picker-story-{id}";
                    filters.Add(chip);
                }
            }

            void Fill(string text)
            {
                list.Clear();
                IEnumerable<JToken> rows = people.Where(person => string.IsNullOrEmpty(text) ||
                    (Kit.Str(person, "ringName") ?? string.Empty).IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0);
                if (filter == "champions") rows = rows.Where(person => Kit.Arr(person, "titles").Any());
                else if (filter != null) rows = rows.Where(person => Kit.Arr(person, "storylines").Any(story => Kit.Str(story, "storylineId") == filter));
                int shown = 0;
                foreach (JToken person in rows.Take(80))
                {
                    shown++;
                    string id = Kit.Str(person, "personId");
                    string name = Kit.Str(person, "ringName");
                    bool bookable = Kit.Bool(person, "bookable");
                    var row = new Button(() =>
                    {
                        if (!bookable) return;
                        handle?.Close();
                        onPick(id, name, Kit.Str(person, "talkRole"));
                    }) { text = string.Empty, name = $"pick-{id}" };
                    row.AddToClassList("fc-pick");
                    row.EnableInClassList("fc-pick--disabled", !bookable);
                    bool champion = Kit.Arr(person, "titles").Any();
                    row.Add(DsCards.PortraitBox(CardPeople.Picture(Kit.Str(person, "imageRef")), CardWords.AlignmentOf(Kit.Str(person, "alignment")), "ds-portrait--xs", champion, name));
                    VisualElement words = Ds.Column("fc-pick__words");
                    VisualElement top = Ds.Row("fc-pick__top");
                    top.Add(Ds.Text(name, "fc-pick__name"));
                    top.Add(Ds.Tag(Kit.Capital(Kit.Str(person, "alignment")) ?? "Tweener", Kit.Str(person, "alignment")));
                    foreach (JToken title in Kit.Arr(person, "titles")) top.Add(Ds.Pill(DsState.Gold, CardWords.Title(Kit.Str(title, "name")), "crown"));
                    words.Add(top);
                    var facts = new List<string> { Kit.PushLabel(Kit.Str(person, "push")), $"Popularity {Kit.Whole(Kit.Num(person, "popularity"))}", $"Stamina {Kit.Whole(Kit.Num(person, "stamina"))}" };
                    if (Kit.Arr(person, "onCard").Any()) facts.Add($"On the card: {Kit.Str(Kit.Arr(person, "onCard").First(), "slotLabel")}");
                    if (Kit.Arr(person, "storylines").Any()) facts.Add("Storyline: " + string.Join(", ", Kit.Arr(person, "storylines").Select(story => Kit.Str(story, "name"))));
                    words.Add(Ds.Text(string.Join(" · ", facts.Where(fact => !string.IsNullOrEmpty(fact))), "fc-pick__facts"));
                    if (!bookable) words.Add(Ds.Text(Kit.Str(person, "availability.label") ?? "Unavailable", "fc-pick__reason"));
                    row.Add(words);
                    list.Add(row);
                }
                if (shown == 0) list.Add(Ds.Text("Nobody matches.", "fc-hint"));
            }

            search.RegisterValueChangedCallback(evt => Fill(evt.newValue));
            Filters();
            Fill(string.Empty);
            handle = DsOverlay.Modal(anyElement, kind == "match" ? "Add a wrestler" : "Add a speaker", body);
            handle?.Entry.AddToClassList("fc-picker-modal");
        }

        public static void OpenTeams(VisualElement anyElement, JToken roster, IReadOnlyCollection<string> taken, Action<string, List<string>> onPick)
        {
            VisualElement body = FightCardStyles.Apply(Ds.Column("fc-picker")).Named("team-picker");
            OverlayHandle handle = null;
            var names = Kit.Arr(roster, "people").ToDictionary(person => Kit.Str(person, "personId"), person => Kit.Str(person, "ringName"));
            var list = new ScrollView(ScrollViewMode.Vertical);
            list.AddToClassList("fc-picker__list");
            int shown = 0;
            foreach (JToken team in Kit.Arr(roster, "teams"))
            {
                List<string> members = Kit.Arr(team, "memberIds").Select(id => (string)id).ToList();
                bool placed = members.Any(taken.Contains);
                bool bookable = Kit.Bool(team, "bookable") && !placed;
                string id = Kit.Str(team, "teamId");
                var row = new Button(() =>
                {
                    if (!bookable) return;
                    handle?.Close();
                    onPick(id, members);
                }) { text = string.Empty, name = $"pick-team-{id}" };
                row.AddToClassList("fc-pick");
                row.EnableInClassList("fc-pick--disabled", !bookable);
                row.Add(new Icon("users", "ds-icon--lg", "fc-pick__team-icon"));
                VisualElement words = Ds.Column("fc-pick__words");
                VisualElement top = Ds.Row("fc-pick__top");
                top.Add(Ds.Text(Kit.Str(team, "name"), "fc-pick__name"));
                foreach (JToken title in Kit.Arr(team, "titles")) top.Add(Ds.Pill(DsState.Gold, CardWords.Title(Kit.Str(title, "name")), "crown"));
                words.Add(top);
                words.Add(Ds.Text(string.Join(" & ", members.Select(member => names.TryGetValue(member, out string name) ? name : "Someone")), "fc-pick__facts"));
                if (!bookable) words.Add(Ds.Text(placed ? "Someone from this team is already in the segment" : "Not everyone in this team can work", "fc-pick__reason"));
                row.Add(words);
                list.Add(row);
                shown++;
            }
            if (shown == 0) list.Add(Ds.Text("Your promotion has no teams to book.", "fc-hint"));
            body.Add(list);
            handle = DsOverlay.Modal(anyElement, "Add a team", body);
            handle?.Entry.AddToClassList("fc-picker-modal");
        }
    }
}
