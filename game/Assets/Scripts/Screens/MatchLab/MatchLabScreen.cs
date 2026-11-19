using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.MatchLab
{
    /// <summary>
    /// The Match lab (the web's <c>screens/match-lab</c>, UNITY-21): try a segment that isn't on any card
    /// with the people of the running game. Match mode builds the sides, plays out Runs nights
    /// (<c>match.simulate</c> + <c>match.simulateBatch</c>) and shows the rating, the winner odds, the
    /// physical toll and the aftermath; Angle mode builds beats and rates them
    /// (<c>match.previewAngle</c>) with per-beat scores and the aftermath. Nothing here touches the
    /// world. Route: <c>match-lab</c>, <c>mode=angle</c> opens Angle mode.
    /// </summary>
    public static class MatchLabScreen
    {
        public const string ScreenId = "match-lab";

        /// <summary>The lab's state for the session; a new game starts it again.</summary>
        public static LabState State { get; private set; } = new LabState();

        /// <summary>The lab on screen (tours drive it).</summary>
        public static LabView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register() => ScreenRegistry.Register(ScreenId, Build);

        public static VisualElement Build(ScreenContext context)
        {
            if (State.Owner != Kit.Game) State = new LabState { Owner = Kit.Game };
            if (context.Route.Param("mode") == "angle") State.Kind = "angle";
            else if (context.Route.Param("mode") == "match") State.Kind = "match";

            VisualElement screen = Kit.Screen(ScreenId, "Match lab", "Try a segment that isn't on any card. Nothing here changes your world.");
            ScreenDs.Style(screen, "Screens/MatchLab");
            VisualElement host = Ds.Column("lab").Named("lab");
            screen.Add(host);
            if (Kit.Game == null)
            {
                host.Add(Ds.Empty("lab", "Load or start a game to use the Match lab", "The Match lab rates segments with the people of a running game."));
                return screen;
            }
            var view = new LabView(host, context, State);
            Current = view;
            host.RegisterCallback<AttachToPanelEvent>(evt => { _ = view.LoadAsync(); });
            host.RegisterCallback<DetachFromPanelEvent>(_ =>
            {
                if (Current == view) Current = null;
            });
            return screen;
        }
    }

    /// <summary>The lab on screen: loads its options once, then redraws from <see cref="LabState"/> on every change.</summary>
    public sealed class LabView
    {
        private static readonly System.Random Random = new System.Random();
        private static bool moreOpen;

        private readonly VisualElement host;
        private readonly ScreenContext context;
        private readonly LabState state;
        private JToken options;
        private JToken catalog;
        private string today;
        private readonly Dictionary<string, List<JToken>> finishes = new Dictionary<string, List<JToken>>();
        private readonly Dictionary<string, JToken> rosterRows = new Dictionary<string, JToken>();

        public LabView(VisualElement host, ScreenContext context, LabState state)
        {
            this.host = host;
            this.context = context;
            this.state = state;
        }

        public LabState State => state;
        public bool Loaded => catalog != null;

        public async Task LoadAsync()
        {
            host.Clear();
            host.Add(Ds.Loading("Loading the Match lab…"));
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> optionsAnswer = await client.Query("match.labOptions");
            QueryResult<JToken> catalogAnswer = await client.Query("match.catalog");
            QueryResult<JToken> clock = await client.Query("clock.get");
            host.Clear();
            if (!optionsAnswer.Ok || !catalogAnswer.Ok)
            {
                host.Add(Ds.Empty("lab", "The Match lab can't open", Kit.Reasons((optionsAnswer.Ok ? catalogAnswer : optionsAnswer).Reasons)));
                return;
            }
            options = optionsAnswer.Data;
            catalog = catalogAnswer.Data;
            today = clock.Ok ? Kit.Str(clock.Data, "date") : null;
            string promotionId = Kit.Str(optionsAnswer.Data, "promotion.id");
            if (promotionId != null)
            {
                QueryResult<JToken> roster = await client.Query("roster.rows", new JObject { ["promotionId"] = promotionId });
                foreach (JToken row in roster.Ok ? Kit.Arr(roster.Data, "rows") : Enumerable.Empty<JToken>())
                {
                    if (Kit.Str(row, "personId") is string id) rosterRows[id] = row;
                }
            }
            if (!Kit.Bool(options, "available") || !Kit.Bool(catalog, "available"))
            {
                host.Add(Ds.Empty("lab", "No match types in this save", "This save was started before match types existed. Start a new game to use the Match lab."));
                return;
            }
            if (Kit.Obj(options, "promotion") == null || Kit.Obj(options, "promotion").Type == JTokenType.Null)
            {
                host.Add(Ds.Empty("lab", "You run no promotion", "The Match lab rates segments for the promotion you run. Take a job to use it."));
                return;
            }
            if (Kit.Str(options, "defaults.regionId") == null)
            {
                host.Add(Ds.Empty("lab", "No regions in this world", "A show needs a region to be rated in."));
                return;
            }
            JToken firstType = MatchType(Kit.Str(options, "defaults.typeKey"));
            state.Seed(options, (int)(Kit.Num(firstType, "sides.min") ?? 2));
            if (state.IsAngle && state.AngleTypeKey == null) StartAngle(VisibleAngleTypes().FirstOrDefault());
            await EnsureFinishesAsync();
            Render();
        }

        // ---- Catalog --------------------------------------------------------------------------

        private IEnumerable<JToken> VisibleMatchTypes() =>
            Kit.Arr(catalog, "matchTypes").Where(type => !Kit.Bool(type, "hidden")).OrderBy(type => Kit.Num(type, "order") ?? 0);

        private IEnumerable<JToken> VisibleAngleTypes() =>
            Kit.Arr(catalog, "angleTypes").Where(type => !Kit.Bool(type, "hidden")).OrderBy(type => Kit.Num(type, "order") ?? 0);

        private JToken MatchType(string key) => Kit.Arr(catalog, "matchTypes").FirstOrDefault(type => Kit.Str(type, "key") == key);
        private JToken AngleType(string key) => Kit.Arr(catalog, "angleTypes").FirstOrDefault(type => Kit.Str(type, "key") == key);
        private JToken Beat(string key) => Kit.Arr(catalog, "beats").FirstOrDefault(beat => Kit.Str(beat, "key") == key);

        private string FinishCacheKey => $"{state.TypeKey}|{state.Sides.Count}";

        private async Task EnsureFinishesAsync()
        {
            if (state.TypeKey == null || finishes.ContainsKey(FinishCacheKey)) return;
            string key = FinishCacheKey;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("match.finishes", new JObject { ["matchTypeKey"] = state.TypeKey, ["sideCount"] = state.Sides.Count });
            finishes[key] = answer.Ok ? Kit.Arr(answer.Data).ToList() : new List<JToken>();
        }

        // ---- Drawing ----------------------------------------------------------------------------

        public void Render()
        {
            host.Clear();
            VisualElement bar = Ds.Row("lab-modebar");
            var tabs = new DsTabs(segmented: true) { name = "lab-mode" };
            tabs.Add("match", "Match", null, "versus").Add("angle", "Angle", null, "megaphone");
            tabs.Select(state.Kind, false);
            tabs.Selected += SwitchMode;
            bar.Add(tabs);
            bar.Add(Ds.Text(state.IsAngle
                ? "Build a talking segment beat by beat and see how each beat lands."
                : "Put people on each side, choose a result or leave it to the night, and press Run.", "lab-modebar__hint"));
            host.Add(bar);

            VisualElement columns = Ds.Row("ds-row--top", "lab-columns");
            host.Add(columns);
            VisualElement setup = Ds.Column("lab-setup");
            VisualElement build = Ds.Column("lab-build");
            VisualElement results = Ds.Column("lab-results").Named("lab-results");
            columns.Add(setup);
            columns.Add(build);
            columns.Add(results);

            setup.Add(SetupPanel());
            if (state.IsAngle)
            {
                build.Add(BeatsPanel());
                results.Add(RunBar());
                LabResults.Angle(results, build, state, this, today);
            }
            else
            {
                build.Add(SidesPanel());
                build.Add(PlanPanel());
                results.Add(RunBar());
                LabResults.Match(results, build, state, this, today, MatchType(state.TypeKey));
            }
        }

        private void SwitchMode(string mode)
        {
            if (mode == state.Kind) return;
            state.Kind = mode;
            if (state.IsAngle && state.AngleTypeKey == null) StartAngle(VisibleAngleTypes().FirstOrDefault());
            Render();
        }

        private void StartAngle(JToken angleType)
        {
            if (angleType == null) return;
            string firstSetting = Kit.Arr(angleType, "settings").Select(setting => (string)setting).FirstOrDefault();
            state.SetAngleType(Kit.Str(angleType, "key"), Kit.Str(angleType, "defaultBeatKey"), firstSetting);
            // The people already placed carry over as the first beat's speakers; the rest stay in the people list.
            foreach (string id in state.Sides.SelectMany(side => side).Where(id => state.Beats[0].GroupOne.Count < 4 && !state.Beats[0].GroupOne.Contains(id)))
            {
                state.Beats[0].GroupOne.Add(id);
            }
        }

        private VisualElement SetupPanel()
        {
            VisualElement panel = Ds.Panel(state.IsAngle ? "The angle" : "The match", null, null, "lab-panel").Named("lab-setup-panel");
            if (state.IsAngle)
            {
                List<JToken> types = VisibleAngleTypes().ToList();
                panel.Add(ScreenDs.Field("Angle type",
                    ScreenDs.Choices(types.Select(type => (Kit.Str(type, "key"), Kit.Str(type, "name"))), state.AngleTypeKey, key =>
                    {
                        StartAngle(AngleType(key));
                        Render();
                    }, "lab-angle-type"),
                    SpeakersText(AngleType(state.AngleTypeKey))));
                List<string> settings = Kit.Arr(AngleType(state.AngleTypeKey), "settings").Select(setting => (string)setting).ToList();
                if (settings.Count > 1)
                {
                    panel.Add(ScreenDs.Field("Where", ScreenDs.Choices(settings.Select(setting => (setting, SettingWord(setting))), state.Setting, setting =>
                    {
                        state.Setting = setting;
                        Render();
                    }, "lab-setting")));
                }
            }
            else
            {
                List<JToken> types = VisibleMatchTypes().ToList();
                JToken current = MatchType(state.TypeKey);
                panel.Add(ScreenDs.Field("Match type",
                    ScreenDs.Choices(types.Select(type => (Kit.Str(type, "key"), Kit.Str(type, "shortName") ?? Kit.Str(type, "name"))), state.TypeKey, key =>
                    {
                        state.SetType(key, (int)(Kit.Num(MatchType(key), "sides.min") ?? 2));
                        _ = RenderAfter(EnsureFinishesAsync());
                    }, "lab-type"),
                    current == null ? null : LimitsText(current)));
            }

            panel.Add(ScreenDs.Field("Card spot", ScreenDs.Choices(LabState.SlotRoles.Select(role => (role, LabText.SlotWord(role))), state.SlotRole, role =>
            {
                state.SlotRole = role;
                Render();
            }, "lab-slot")));
            panel.Add(ScreenDs.Field("Time",
                ScreenDs.Choices(new[] { ("usual", "Usual") }.Concat(LabState.Durations.Select(time => (time, LabText.TimeWord(time)))), state.BookedTime ?? "usual", time =>
                {
                    state.BookedTime = time == "usual" ? null : time;
                    Render();
                }, "lab-time"),
                "Usual is the slot's own time: the main event runs long."));

            Button more = Ds.Button(moreOpen ? "Fewer options" : "More options", () =>
            {
                moreOpen = !moreOpen;
                Render();
            }, DsButtonKind.Ghost, moreOpen ? "chevron-up" : "chevron-down");
            more.name = "lab-more";
            more.AddToClassList("lab-more");
            panel.Add(more);
            if (moreOpen)
            {
                VisualElement extra = Ds.Column("lab-more__body").Named("lab-more-body");
                extra.Add(ScreenDs.Field("Show size", ScreenDs.Choices(Kit.Arr(options, "importances").Select(item => (Kit.Str(item, "key"), Kit.Str(item, "label"))), state.Importance, key =>
                {
                    state.Importance = key;
                    Render();
                }, "lab-importance")));
                extra.Add(ScreenDs.Field("Television", ScreenDs.Choices(new[] { (true, "On TV"), (false, "Not televised") }, state.Televised, on =>
                {
                    state.Televised = on;
                    Render();
                }, "lab-tv")));
                List<(string, string, string)> regions = Kit.Arr(options, "regions")
                    .Select(region => (Kit.Str(region, "id"), Kit.Str(region, "name"), $"{Kit.Str(region, "countryName")} · {Kit.Str(region, "continentName")}")).ToList();
                string regionName = regions.FirstOrDefault(region => region.Item1 == state.RegionId).Item2 ?? "Pick a region";
                extra.Add(ScreenDs.Field("Region", ScreenDs.Picker(regionName, regions, id =>
                {
                    state.RegionId = id;
                    Render();
                }, searchable: true, name: "lab-region"), "Popularity and the crowd are read here."));
                List<(string, string, string)> rateAs = Kit.Arr(options, "rateAs")
                    .Select(promotion => (Kit.Str(promotion, "id"), Kit.Str(promotion, "name"), Kit.Bool(promotion, "yours") ? "Yours" : null)).ToList();
                if (rateAs.Count > 1)
                {
                    string rateName = rateAs.FirstOrDefault(promotion => promotion.Item1 == state.PromotionId).Item2 ?? "Your promotion";
                    extra.Add(ScreenDs.Field("Rate as", ScreenDs.Picker(rateName, rateAs, id =>
                    {
                        state.PromotionId = id;
                        Render();
                    }, searchable: true, name: "lab-rate-as"), "A rival plays by its own rules."));
                }
                panel.Add(extra);
            }
            return panel;
        }

        private static string LimitsText(JToken type)
        {
            string Range(string path) =>
                Kit.Num(type, path + ".min") == Kit.Num(type, path + ".max") ? $"{Kit.Num(type, path + ".min")}" : $"{Kit.Num(type, path + ".min")} to {Kit.Num(type, path + ".max")}";
            return $"{Range("sides")} sides, {Range("sideSize")} each";
        }

        private static string SpeakersText(JToken angleType) =>
            angleType == null ? null : Kit.Num(angleType, "speakers.min") == Kit.Num(angleType, "speakers.max")
                ? $"{Kit.Num(angleType, "speakers.min")} speaker{(Kit.Num(angleType, "speakers.min") == 1 ? string.Empty : "s")}"
                : $"{Kit.Num(angleType, "speakers.min")} to {Kit.Num(angleType, "speakers.max")} speakers";

        private static string SettingWord(string setting) => setting switch
        {
            "ring" => "In the ring",
            "backstage" => "Backstage",
            "video" => "Pre-taped",
            _ => Kit.Capital(setting),
        };

        // ---- Match mode: sides and the plan -----------------------------------------------------

        private VisualElement SidesPanel()
        {
            JToken type = MatchType(state.TypeKey);
            int maxSides = (int)(Kit.Num(type, "sides.max") ?? 2);
            int minSides = (int)(Kit.Num(type, "sides.min") ?? 2);
            int maxSize = Math.Min(LabState.MaxSideSize, (int)(Kit.Num(type, "sideSize.max") ?? 1));
            VisualElement panel = Ds.Panel("Who's in it", "Clear all", () =>
            {
                foreach (List<string> side in state.Sides) side.Clear();
                state.FatigueOverrides.Clear();
                Render();
            }, "lab-panel").Named("lab-sides");
            VisualElement grid = Ds.Row("ds-row--wrap", "ds-row--top", "lab-sides");
            for (int index = 0; index < state.Sides.Count; index++)
            {
                int side = index;
                VisualElement card = Ds.Column("lab-side").Named($"lab-side-{side}");
                VisualElement head = Ds.Row("lab-side__head");
                head.Add(Ds.Text(TextFormat.Upper(LabText.SideLabel(side)), "lab-side__label"));
                head.Add(Ds.Spacer());
                if (state.Sides.Count > minSides)
                {
                    Button remove = Ds.IconButton("close", "Remove this side", () =>
                    {
                        state.RemoveSide(side);
                        _ = RenderAfter(EnsureFinishesAsync());
                    });
                    head.Add(remove);
                }
                card.Add(head);
                foreach (string personId in state.Sides[side])
                {
                    string id = personId;
                    VisualElement row = Ds.Row("lab-person");
                    (Alignment alignment, Texture2D picture) face = Face(id);
                    row.Add(DsCards.PortraitBox(face.picture, face.alignment, "ds-portrait--xs", false, state.NameOf(id)));
                    VisualElement words = Ds.Column("lab-person__words");
                    words.Add(Ds.Text(state.NameOf(id), "lab-person__name"));
                    if (state.People.TryGetValue(id, out LabPerson person) && person.PromotionShortName != null)
                    {
                        words.Add(Ds.Text(person.PromotionShortName, "lab-person__detail"));
                    }
                    row.Add(words);
                    row.Add(Ds.Spacer());
                    row.Add(Ds.IconButton("close", $"Take {state.NameOf(id)} off", () =>
                    {
                        state.RemovePerson(side, id);
                        Render();
                    }));
                    card.Add(row);
                }
                if (state.Sides[side].Count < maxSize)
                {
                    Button add = Ds.Button(state.Sides[side].Count == 0 ? "Add someone" : "Add a partner", () => OpenPicker(side), DsButtonKind.Ghost, "add");
                    add.name = $"lab-add-{side}";
                    add.AddToClassList("lab-side__add");
                    card.Add(add);
                }
                grid.Add(card);
            }
            panel.Add(grid);
            if (state.Sides.Count < Math.Min(maxSides, LabState.MaxSides))
            {
                Button addSide = Ds.Button("Add a side", () =>
                {
                    state.AddSide();
                    _ = RenderAfter(EnsureFinishesAsync());
                }, DsButtonKind.Ghost, "add");
                addSide.name = "lab-add-side";
                panel.Add(addSide);
            }
            return panel;
        }

        private void OpenPicker(int side)
        {
            LabPicker.Open(host, state, $"Add to {LabText.SideLabel(side)}", null, person =>
            {
                bool added = state.AddPerson(side, person);
                if (added) Render();
                return added;
            });
        }

        private VisualElement PlanPanel()
        {
            VisualElement panel = Ds.Panel("The result", null, null, "lab-panel").Named("lab-plan");
            var winners = new List<(string, string)> { ("auto", "Let the night decide") };
            for (int side = 0; side < state.Sides.Count; side++)
            {
                string names = ScreenDs.JoinNames(state.Sides[side].Select(state.NameOf));
                winners.Add((side.ToString(), string.IsNullOrEmpty(names) ? $"{LabText.SideLabel(side)} wins" : $"{names} wins"));
            }
            winners.Add(("draw", "Draw"));
            panel.Add(ScreenDs.Field("Who wins", ScreenDs.Choices(winners, state.Winner, winner =>
            {
                state.Winner = winner;
                Render();
            }, "lab-winner")));

            finishes.TryGetValue(FinishCacheKey, out List<JToken> allowed);
            var finishOptions = new List<(string, string, string)> { ("auto", "Any finish", "The booker's usual call") };
            foreach (JToken finish in allowed ?? new List<JToken>())
            {
                finishOptions.Add((Kit.Str(finish, "key"), Kit.Str(finish, "name"), Kit.Str(finish, "summary")));
            }
            string currentFinish = finishOptions.FirstOrDefault(option => option.Item1 == (state.FinishKey ?? "auto")).Item2 ?? "Any finish";
            panel.Add(ScreenDs.Field("Finish", ScreenDs.Picker(currentFinish, finishOptions, key =>
            {
                state.FinishKey = key == "auto" ? null : key;
                Render();
            }, name: "lab-finish")));
            return panel;
        }

        // ---- Angle mode: beats ------------------------------------------------------------------

        private VisualElement BeatsPanel()
        {
            JToken angleType = AngleType(state.AngleTypeKey);
            VisualElement panel = Ds.Panel("Beats", null, null, "lab-panel").Named("lab-beats");
            panel.Add(Ds.Text("Each beat is one moment of the angle. The people in a group speak or act together.", "lab-quiet"));
            List<string> beatKeys = Kit.Arr(angleType, "beatKeys").Select(key => (string)key).ToList();
            for (int index = 0; index < state.Beats.Count; index++)
            {
                int beatIndex = index;
                LabBeat beat = state.Beats[index];
                JToken beatDef = Beat(beat.BeatKey);
                VisualElement card = Ds.Column("lab-beat").Named($"lab-beat-{beatIndex}");
                VisualElement head = Ds.Row("lab-beat__head");
                head.Add(Ds.Text($"{beatIndex + 1}", "lab-beat__number"));
                var beatOptions = beatKeys.Select(key => (key, Kit.Str(Beat(key), "name") ?? key, Kit.Str(Beat(key), "description"))).ToList();
                head.Add(ScreenDs.Picker(Kit.Str(beatDef, "name") ?? "Pick a beat", beatOptions, key =>
                {
                    beat.BeatKey = key;
                    int groups = Kit.Arr(Beat(key), "groups").Count();
                    if (groups < 2) beat.GroupTwo.Clear();
                    Render();
                }, name: $"lab-beat-{beatIndex}-type"));
                head.Add(Ds.Spacer());
                if (state.Beats.Count > 1)
                {
                    head.Add(Ds.IconButton("trash", "Remove this beat", () =>
                    {
                        state.Beats.RemoveAt(beatIndex);
                        Render();
                    }));
                }
                card.Add(head);
                string description = Kit.Str(beatDef, "description");
                if (description != null) card.Add(Ds.Text(description, "lab-beat__description"));

                List<JToken> groups = Kit.Arr(beatDef, "groups").ToList();
                for (int group = 0; group < Math.Max(1, Math.Min(2, groups.Count)); group++)
                {
                    List<string> members = group == 0 ? beat.GroupOne : beat.GroupTwo;
                    JToken groupDef = group < groups.Count ? groups[group] : null;
                    int max = (int)(Kit.Num(groupDef, "maxPeople") ?? 4);
                    VisualElement row = Ds.Row("ds-row--wrap", "lab-beat__group");
                    string stats = string.Join(", ", Kit.Arr(groupDef, "stats").Select(stat => Kit.Capital((string)stat)));
                    row.Add(Ds.Text(TextFormat.Upper(Kit.Str(groupDef, "label") ?? (group == 0 ? "Group one" : "Group two")), "lab-beat__group-label"));
                    foreach (string personId in members.ToList())
                    {
                        string id = personId;
                        Button chip = Ds.Chip(state.NameOf(id), false, () =>
                        {
                            members.Remove(id);
                            Render();
                        }, null, "close");
                        DsTooltip.Attach(chip, "Take them out of this beat");
                        row.Add(chip);
                    }
                    if (members.Count < max)
                    {
                        int groupIndex = group;
                        Button add = Ds.Button("Add", () => OpenBeatPicker(beat, groupIndex, Kit.Str(groupDef, "label")), DsButtonKind.Ghost, "add");
                        add.name = $"lab-beat-{beatIndex}-add-{group}";
                        row.Add(add);
                    }
                    if (!string.IsNullOrEmpty(stats)) row.Add(Ds.Text($"reads {stats.ToLowerInvariant()}", "lab-beat__stats"));
                    card.Add(row);
                }
                panel.Add(card);
            }
            if (state.Beats.Count < LabState.MaxBeats)
            {
                Button addBeat = Ds.Button("Add a beat", () =>
                {
                    state.Beats.Add(new LabBeat { BeatKey = Kit.Str(angleType, "defaultBeatKey") ?? beatKeys.FirstOrDefault() });
                    Render();
                }, DsButtonKind.Ghost, "add");
                addBeat.name = "lab-add-beat";
                panel.Add(addBeat);
            }
            return panel;
        }

        private void OpenBeatPicker(LabBeat beat, int group, string groupLabel)
        {
            LabPicker.Open(host, state, $"Add {(groupLabel ?? "someone").ToLowerInvariant()}", null, person =>
            {
                List<string> members = group == 0 ? beat.GroupOne : beat.GroupTwo;
                if (beat.Everyone.Contains(person.Id)) return false;
                members.Add(person.Id);
                state.People[person.Id] = person;
                Render();
                return true;
            });
        }

        // ---- Running ----------------------------------------------------------------------------

        private VisualElement RunBar()
        {
            VisualElement panel = Ds.Panel(null, null, null, "lab-panel", "lab-runbar").Named("lab-runbar");
            VisualElement row = Ds.Row("lab-runbar__row");
            if (!state.IsAngle)
            {
                row.Add(Ds.Text("RUNS", "lab-runbar__label"));
                row.Add(ScreenDs.Choices(new[] { 1, 10, 50, 100 }.Select(runs => (runs, runs == 1 ? "×1" : $"×{runs}")), state.Runs, runs =>
                {
                    state.Runs = LabState.ClampRuns(runs);
                    Render();
                }, "lab-runs"));
            }
            row.Add(Ds.Spacer());
            bool ready = state.IsAngle ? state.AngleArgs(0) != null : state.PreviewArgs(0) != null;
            SkewButton run = Ds.Cta(state.Pending ? "Running…" : "Run", () => _ = RunAsync(), "play");
            run.name = "lab-run";
            run.SetEnabled(ready && !state.Pending);
            row.Add(run);
            panel.Add(row);
            string hint = state.Refusal != null ? null
                : !ready ? (state.IsAngle ? "Put someone in every beat's first group to run it." : "Put someone on every side to run it.")
                : state.IsAngle ? "Rates the angle on a fresh night."
                : state.Runs == 1 ? "Plays out one night in full." : $"Plays out {LabText.RunsText(state.Runs)}: the last in full, the odds over all of them.";
            if (hint != null) panel.Add(Ds.Text(hint, "lab-quiet"));
            if (state.Refusal != null) panel.Add(Kit.Error(state.Refusal));
            return panel;
        }

        /// <summary>Plays out the segment (a fresh seed, or the shown one again for a what-if).</summary>
        public async Task RunAsync(bool sameSeed = false)
        {
            if (state.Pending) return;
            EngineClient client = Kit.Game.Client;
            state.Pending = true;
            state.Refusal = null;
            Render();
            try
            {
                if (state.IsAngle)
                {
                    int seed = LabState.FreshSeed(1, Random);
                    JObject args = state.AngleArgs(seed);
                    if (args == null) return;
                    QueryResult<JToken> answer = await client.Query("match.previewAngle", args);
                    if (!answer.Ok)
                    {
                        state.Refusal = Kit.Reasons(answer.Reasons);
                        return;
                    }
                    state.LastAngle = new LabAngleRun { Args = args, Result = answer.Data, Date = today };
                }
                else
                {
                    int runs = state.Runs;
                    int first = sameSeed && state.LastRun != null
                        ? Math.Min(Math.Max(0, state.LastRun.Seed), LabState.SeedMax - (runs - 1))
                        : LabState.FreshSeed(runs, Random);
                    JObject single = state.SimulateArgs(first + runs - 1);
                    if (single == null) return;
                    QueryResult<JToken> night = await client.Query("match.simulate", single);
                    QueryResult<JToken> batch = runs > 1 ? await client.Query("match.simulateBatch", state.BatchArgs(first, runs)) : null;
                    if (!night.Ok || (batch != null && !batch.Ok))
                    {
                        state.Refusal = Kit.Reasons((!night.Ok ? night : batch).Reasons);
                        return;
                    }
                    JObject shownArgs = state.PreviewArgs(first + runs - 1);
                    state.LastRun = new LabRun
                    {
                        Args = shownArgs,
                        PlanKey = state.PlanKey(),
                        Simulation = night.Data,
                        Preview = Kit.Obj(night.Data, "preview"),
                        Batch = batch?.Data,
                        Runs = runs,
                        Seed = first,
                        Date = today,
                    };
                }
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                state.Refusal = "The game engine did not answer. Try again.";
            }
            finally
            {
                state.Pending = false;
                if (host.panel != null) Render();
            }
        }

        private async Task RenderAfter(Task task)
        {
            await task;
            if (host.panel != null) Render();
        }

        /// <summary>A person's side colour and workshop picture, for people on your roster (others are neutral).</summary>
        public (Alignment alignment, Texture2D picture) Face(string personId)
        {
            if (personId == null || !rosterRows.TryGetValue(personId, out JToken row)) return (Alignment.Tweener, null);
            return (ScreenDs.AlignmentOf(Kit.Str(row, "alignment")), ScreenDs.Picture(Kit.Str(row, "imageRef")));
        }

        /// <summary>Opens a worker's screen from a result line, when the game has one.</summary>
        public void OpenPerson(string personId)
        {
            if (personId != null && ScreenRegistry.IsLive(ScreenIds.Worker)) context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId));
        }
    }
}
