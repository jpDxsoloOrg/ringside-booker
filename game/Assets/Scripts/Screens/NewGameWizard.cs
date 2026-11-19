using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import;
using RingsideBooker.Saves;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The New game wizard on the title screen (the web's NewGameScreen, a working subset): pick a
    /// world (the bundled ones from <c>listWorlds</c>, then each <see cref="IWorldSource"/>, such as
    /// the workshop worlds imported this session; "Import a workshop world…" opens a sub-screen that
    /// lists the installed mods, imports one and comes back with it selected), the promotion you take over (<c>previewWorld</c>), the options (save and
    /// booker names, seed, season length and every new-game setting including Show night Live/Auto),
    /// then Start: <c>newGame</c>, the first save (<see cref="GameSession.BeginNewAsync"/>) and the
    /// Game scene (<see cref="EngineGame.Enter"/>).
    /// </summary>
    public sealed class NewGameWizard
    {
        private const int SeedMaxLength = 64;
        private static readonly string[] StepNames = { "World", "Promotion", "Options" };

        private readonly VisualElement root;
        private readonly VisualElement steps;
        private readonly VisualElement body;
        private readonly VisualElement nav;
        private readonly Label feedback;

        private EngineClient client;
        private List<(string group, WorldChoice world)> worlds = new List<(string, WorldChoice)>();
        private WorldChoice world;
        private JToken preview;
        private string promotionKey;
        private string saveName = "My career";
        private string playerName = "Alex Booker";
        private string seed = NewSeed();
        private string seasonPreset;
        private readonly Dictionary<string, JToken> settings = new Dictionary<string, JToken>();
        private int step;
        private bool busy;

        // The "Import a workshop world" sub-screen (UNITY-12).
        private bool importing;
        private List<WorkshopMod> mods;
        private WorkshopMod pickedMod;
        private WorldModImportResult importResult;
        private WorkshopMod importedMod;
        private volatile string importStage;
        private bool importRunning;

        private NewGameWizard()
        {
            root = Ui.El("rb-wizard").Named("new-game-wizard");
            steps = Ui.El("rb-wizard__steps");
            body = Ui.El("rb-stack");
            nav = Ui.El("rb-wizard__nav");
            feedback = Kit.Feedback();
            root.With(steps, body, feedback, nav);
        }

        /// <summary>The wizard, ready to add to the title screen's panel.</summary>
        public static VisualElement Build()
        {
            var wizard = new NewGameWizard();
            wizard.Start();
            return wizard.root;
        }

        /// <summary>The import report summary of the world being set up (counts only), or null.</summary>
        public string ImportNotice => world?.Notice;

        /// <summary>The live wizard for the screenshot tour: picks the defaults and starts a game.</summary>
        public static NewGameWizard Last { get; private set; }

        /// <summary>The wizard on screen now (attached to a panel), or null.</summary>
        public static NewGameWizard Active => Last != null && Last.root.panel != null ? Last : null;

        /// <summary>True while the import sub-screen is open.</summary>
        public bool InImport => importing;

        /// <summary>
        /// Escape / Back: leaves the import sub-screen for the world list (not while an import
        /// runs). Returns true when it handled the key.
        /// </summary>
        public bool HandleBack()
        {
            if (!importing || importRunning) return false;
            CloseImport(selectImported: false);
            return true;
        }

        private async void Start()
        {
            Last = this;
            body.Add(Kit.Note("Starting the engine…"));
            try
            {
                client = await EngineRuntime.GetClientAsync();
                worlds = await ListWorlds(client);
            }
            catch (Exception exception)
            {
                body.Clear();
                body.Add(Kit.Error($"The engine did not start: {exception.Message}"));
                return;
            }
            world = worlds.Select(entry => entry.world).FirstOrDefault();
            Draw();
        }

        private static async Task<List<(string, WorldChoice)>> ListWorlds(EngineClient client)
        {
            var list = new List<(string, WorldChoice)>();
            WorldListResult bundled = await client.ListWorlds();
            foreach (JToken pack in bundled.Packs)
            {
                if (Kit.Bool(pack, "imported")) continue; // an imported workshop world: listed by its source
                list.Add(("Built in", new WorldChoice(Kit.Str(pack, "id"), Kit.Str(pack, "name"), Kit.Str(pack, "description"),
                    $"{Kit.Str(pack, "author")} · v{Kit.Str(pack, "version")}")));
            }
            foreach (IWorldSource source in WorldSources.All)
            {
                try
                {
                    foreach (WorldChoice choice in await source.ListAsync(client)) list.Add((source.Label, choice));
                }
                catch (Exception exception)
                {
                    Debug.LogWarning($"[NewGame] {source.Label}: {exception.Message}");
                }
            }
            return list;
        }

        private void Draw()
        {
            steps.Clear();
            for (int index = 0; index < StepNames.Length; index++)
            {
                Label label = Ui.Text($"{index + 1}. {StepNames[index]}", "rb-wizard__step");
                label.EnableInClassList("rb-wizard__step--current", index == step);
                steps.Add(label);
            }
            body.Clear();
            nav.Clear();
            feedback.SetShown(false);
            if (importing)
            {
                DrawImport();
                return;
            }
            switch (step)
            {
                case 0: DrawWorlds(); break;
                case 1: DrawPromotions(); break;
                default: DrawOptions(); break;
            }
        }

        private void DrawWorlds()
        {
            var list = new ScrollView(ScrollViewMode.Vertical) { name = "world-list" };
            list.AddToClassList("rb-world-list");
            foreach (IGrouping<string, (string group, WorldChoice world)> group in worlds.GroupBy(entry => entry.group))
            {
                list.Add(Ui.Text(TextFormat.Upper(group.Key), "field-label", "rb-gap-top"));
                foreach ((string _, WorldChoice choice) in group) list.Add(WorldOption(choice));
            }
            body.Add(list);
            Button import = Ui.Btn("Import a workshop world…", OpenImport, "btn--ghost");
            import.name = "wizard-import-workshop";
            import.AddToClassList("rb-gap-top");
            import.style.alignSelf = Align.FlexStart;
            body.Add(import);
            body.Add(Kit.Note("Turns an installed workshop world mod into a world you can start here."));
            Button next = Ui.Btn("NEXT", async () =>
            {
                if (world == null) return;
                await LoadPreview();
            }, "btn--primary");
            next.name = "wizard-next";
            next.SetEnabled(world != null);
            nav.Add(next);
        }

        // ---- Import a workshop world (sub-screen) ---------------------------------------------------

        private void OpenImport()
        {
            if (busy) return;
            importing = true;
            importResult = null;
            importedMod = null;
            Draw();
            if (mods == null) _ = Scan();
        }

        private async Task Scan()
        {
            mods = await WorkshopWorlds.ScanAsync();
            pickedMod ??= mods.FirstOrDefault(mod => mod.IsWorld);
            if (importing && !importRunning) Draw();
        }

        private void CloseImport(bool selectImported)
        {
            importing = false;
            if (selectImported && importedMod != null) _ = ReturnWithImported(importedMod.PackId);
            else Draw();
        }

        /// <summary>Back on the world list with the imported world listed and selected.</summary>
        private async Task ReturnWithImported(string packId)
        {
            body.Clear();
            nav.Clear();
            body.Add(Kit.Note("Loading the worlds…"));
            try
            {
                worlds = await ListWorlds(client);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[NewGame] listing worlds failed ({exception.GetType().Name})");
            }
            world = worlds.Select(entry => entry.world).FirstOrDefault(choice => choice.Id == packId) ?? world;
            step = 0;
            Draw();
        }

        private void DrawImport()
        {
            steps.Clear();
            steps.Add(Ui.Text("New game", "rb-wizard__step"));
            steps.Add(Ui.Text("› Import a workshop world", "rb-wizard__step", "rb-wizard__step--current"));

            if (importResult != null && !importRunning)
            {
                DrawImportReport();
                return;
            }
            if (mods == null)
            {
                body.Add(Kit.Note("Looking for installed workshop world mods…"));
                nav.Add(BackButton());
                return;
            }
            if (mods.Count == 0)
            {
                body.Add(Kit.Note("No workshop world mods are installed. Subscribe to world mods in the Steam workshop; they show up here."));
                nav.Add(BackButton());
                return;
            }

            body.Add(Kit.Note($"{mods.Count} installed workshop {(mods.Count == 1 ? "mod" : "mods")}. Pick a world to import; a big world takes a few seconds."));
            var list = new ScrollView(ScrollViewMode.Vertical) { name = "workshop-mod-list" };
            list.AddToClassList("rb-mod-list");
            foreach (WorkshopMod mod in mods) list.Add(ModOption(mod));
            body.Add(list);

            body.Add(Ui.Text(TextFormat.Upper("Pictures"), "field-label", "rb-gap-top"));
            body.Add(Kit.Chips(new[] { (false, "With pictures"), (true, "Roster only (no pictures)") }, WorkshopWorlds.RosterOnly,
                picked => WorkshopWorlds.RosterOnly = picked, "import-roster-only"));

            if (importRunning)
            {
                Label progress = Ui.Text(ImportProgressText(0), "rb-import-progress").Named("import-progress");
                body.Add(progress);
                var clock = System.Diagnostics.Stopwatch.StartNew();
                progress.schedule.Execute(() => progress.text = ImportProgressText(clock.Elapsed.TotalSeconds)).Every(250);
            }

            Button back = BackButton();
            back.SetEnabled(!importRunning);
            nav.Add(back);
            Button import = Ui.Btn(importRunning ? "IMPORTING…" : "IMPORT", async () => await RunImport(), "btn--primary");
            import.name = "import-start";
            import.SetEnabled(!importRunning && pickedMod != null && pickedMod.IsWorld);
            nav.Add(import);
        }

        private string ImportProgressText(double seconds)
        {
            string stage = importStage == WorldModImporter.StageConverting
                ? "Converting and checking the world"
                : "Reading the mod's database";
            return $"{stage}… {seconds:0} s";
        }

        private Button BackButton()
        {
            Button back = Ui.Btn("BACK", () => CloseImport(selectImported: false), "btn--ghost");
            back.name = "import-back";
            return back;
        }

        private VisualElement ModOption(WorkshopMod mod)
        {
            Button option = Ui.Button(string.Empty, () =>
            {
                if (importRunning) return;
                pickedMod = mod;
                Draw();
            }, "choice-chip", "rb-option");
            option.name = $"mod-{mod.ItemId}";
            option.Add(Ui.Text(mod.WorldName ?? $"Workshop item {mod.ItemId}", "choice-chip__label"));
            option.Add(Ui.Text(ModDetail(mod), "choice-chip__detail"));
            option.EnableInClassList("choice-chip--selected", mod == pickedMod);
            option.SetEnabled(mod.IsWorld);
            return option;
        }

        private static string ModDetail(WorkshopMod mod)
        {
            if (!mod.IsWorld) return "Not a world: no people or promotions to import (an add-on mod)";
            var parts = new List<string>();
            if (mod.StartDate != null) parts.Add($"starts {mod.StartDate}");
            if (mod.PeopleCount > 0) parts.Add($"{mod.PeopleCount:N0} people");
            if (mod.PromotionCount > 0) parts.Add($"{mod.PromotionCount:N0} promotions");
            if (mod.SizeBytes > 0) parts.Add($"{mod.SizeBytes / (1024.0 * 1024.0):0.#} MB");
            if (WorkshopWorlds.IsImported(mod, WorkshopWorlds.RosterOnly)) parts.Add("imported");
            parts.Add($"item {mod.ItemId}");
            return string.Join(" · ", parts);
        }

        /// <summary>Opens the import sub-screen and waits for the mod list (the import check drives it).</summary>
        public async Task<IReadOnlyList<WorkshopMod>> OpenImportAndScan()
        {
            while (client == null) await Task.Yield();
            OpenImport();
            while (mods == null) await Task.Yield();
            return mods;
        }

        /// <summary>Selects the installed mod with this workshop item id on the import sub-screen.</summary>
        public bool PickMod(string itemId)
        {
            WorkshopMod mod = mods?.FirstOrDefault(candidate => candidate.ItemId == itemId);
            if (mod == null) return false;
            pickedMod = mod;
            Draw();
            return true;
        }

        /// <summary>The world selected on the World step (its pack id), or null.</summary>
        public string SelectedWorldId => world?.Id;

        /// <summary>Imports the picked mod (the import screen's IMPORT button; the tours call it too).</summary>
        /// <param name="evenIfNotAWorld">Import an add-on mod anyway (the import check uses it to show a failure).</param>
        public async Task<WorldModImportResult> RunImport(bool evenIfNotAWorld = false)
        {
            if (importRunning || client == null || pickedMod == null || (!pickedMod.IsWorld && !evenIfNotAWorld)) return null;
            WorkshopMod mod = pickedMod;
            importRunning = true;
            importStage = WorldModImporter.StageReading;
            importResult = null;
            Draw();
            try
            {
                importResult = await WorkshopWorlds.ImportAsync(client, mod, WorkshopWorlds.RosterOnly, stage => importStage = stage);
                importedMod = importResult.Ok ? mod : null;
            }
            finally
            {
                importRunning = false;
                if (importing) Draw();
            }
            return importResult;
        }

        private void DrawImportReport()
        {
            WorkshopMod mod = pickedMod;
            body.Add(Ui.Text(mod?.WorldName ?? "Workshop world", "t-ui-semibold"));
            if (importResult.Ok)
            {
                body.Add(Kit.Note(WorkshopWorlds.Summary(importResult)).Named("import-report"));
                JArray warnings = importResult.Response?["report"]?["warnings"] as JArray;
                if (warnings != null && warnings.Count > 0)
                {
                    body.Add(Ui.Text(TextFormat.Upper("What was skipped or adjusted"), "field-label", "rb-gap-top"));
                    var list = new ScrollView(ScrollViewMode.Vertical) { name = "import-warnings" };
                    list.AddToClassList("rb-import-warnings");
                    foreach (JToken warning in warnings.OrderByDescending(entry => (int?)entry["count"] ?? 0))
                    {
                        list.Add(Ui.Text($"{Kit.Num(warning, "count"):N0} × {Kit.Str(warning, "message")}", "t-sm", "t-wrap"));
                    }
                    body.Add(list);
                }
            }
            else
            {
                body.Add(Kit.Error("Import failed. " + WorkshopWorlds.FailureText(importResult)).Named("import-failure"));
                body.Add(Kit.Note("Use Copy details to share what went wrong (it lists the problems the game found, no mod pictures or files)."));
            }

            Button back = Ui.Btn("BACK", () =>
            {
                importResult = null;
                Draw();
            }, "btn--ghost");
            back.name = "import-back";
            nav.Add(back);
            Button copy = Ui.Btn("Copy details", () =>
            {
                GUIUtility.systemCopyBuffer = WorkshopWorlds.Details(mod, importResult);
                feedback.text = "Details copied.";
                feedback.SetShown(true);
            }, "btn--ghost");
            copy.name = "import-copy-details";
            nav.Add(copy);
            if (importResult.Ok)
            {
                Button use = Ui.Btn("USE THIS WORLD", () => CloseImport(selectImported: true), "btn--primary");
                use.name = "import-use";
                nav.Add(use);
                use.schedule.Execute(() => use.Focus());
            }
        }

        private VisualElement WorldOption(WorldChoice choice)
        {
            Button option = Ui.Button(string.Empty, () =>
            {
                world = choice;
                Draw();
            }, "choice-chip", "rb-option");
            option.name = $"world-{choice.Id}";
            option.Add(Ui.Text(choice.Name, "choice-chip__label"));
            if (choice.Detail.Length > 0) option.Add(Ui.Text(choice.Detail, "choice-chip__detail"));
            if (choice.Description.Length > 0) option.Add(Ui.Text(choice.Description, "choice-chip__detail", "t-wrap"));
            option.EnableInClassList("choice-chip--selected", choice == world);
            return option;
        }

        private async Task LoadPreview()
        {
            if (busy) return;
            busy = true;
            nav.SetEnabled(false);
            feedback.text = "Reading the world…";
            feedback.SetShown(true);
            try
            {
                WorldPreviewResult answer = await world.RunPreview(client);
                if (!answer.Ok || answer.Value == null)
                {
                    feedback.text = "That world could not be read: " + string.Join("; ", answer.Issues.Select(issue => Kit.Str(issue, "message") ?? issue.ToString()).Concat(answer.Reasons.Select(reason => reason.Message)))
                        + (world.Notice == null ? string.Empty : " " + world.Notice);
                    feedback.SetShown(true);
                    return;
                }
                preview = answer.Value;
                promotionKey = Kit.Str(Kit.Arr(preview, "promotions").FirstOrDefault(), "key");
                seasonPreset = Kit.Str(preview, "seasonLength.defaultPreset") ?? "12m";
                settings.Clear();
                foreach (JToken setting in Kit.Arr(preview, "settings")) settings[Kit.Str(setting, "key")] = setting["default"]?.DeepClone();
                step = 1;
                Draw();
            }
            finally
            {
                busy = false;
                nav.SetEnabled(true);
            }
        }

        private void DrawPromotions()
        {
            if (world.Notice != null) body.Add(Kit.Note(world.Notice).Named("wizard-import-report"));
            body.Add(Kit.Note("Pick the promotion you take over. Founding your own arrives in a later sprint."));
            var list = new ScrollView(ScrollViewMode.Vertical);
            list.AddToClassList("rb-promo-list");
            foreach (JToken promotion in Kit.Arr(preview, "promotions"))
            {
                string key = Kit.Str(promotion, "key");
                Button option = Ui.Button(string.Empty, () =>
                {
                    promotionKey = key;
                    Draw();
                }, "choice-chip", "rb-option");
                option.name = $"promotion-{key}";
                option.Add(Ui.Text($"{Kit.Str(promotion, "name")} ({Kit.Str(promotion, "shortName")})", "choice-chip__label"));
                option.Add(Ui.Text(
                    $"{Kit.Str(promotion, "homeRegion.name")}, {Kit.Str(promotion, "homeCountry.name")} · {Kit.Capital(Kit.Str(promotion, "style"))} · " +
                    $"Cash {TextFormat.Money((long)(Kit.Num(promotion, "cash") ?? 0))} · Prestige {Kit.Whole(Kit.Num(promotion, "prestige"))} · " +
                    $"Roster {Kit.Num(promotion, "rosterSize")} · Titles {Kit.Num(promotion, "titleCount")} · Popularity {Kit.Decimal1(Kit.Num(promotion, "homeCountryPopularity"))}",
                    "choice-chip__detail"));
                option.EnableInClassList("choice-chip--selected", key == promotionKey);
                list.Add(option);
            }
            body.Add(list);
            nav.Add(Ui.Btn("BACK", () => { step = 0; Draw(); }, "btn--ghost"));
            Button next = Ui.Btn("NEXT", () => { step = 2; Draw(); }, "btn--primary");
            next.name = "wizard-next";
            next.SetEnabled(promotionKey != null);
            nav.Add(next);
        }

        private void DrawOptions()
        {
            body.Add(TextRow("Save name", saveName, value => saveName = value, "wizard-save-name"));
            body.Add(TextRow("Your name", playerName, value => playerName = value, "wizard-player-name"));
            VisualElement seedRow = TextRow("Seed", seed, value => seed = value, "wizard-seed");
            seedRow.Add(Ui.Btn("New seed", () => { seed = NewSeed(); Draw(); }, "btn--link"));
            body.Add(seedRow);

            body.Add(Ui.Text(TextFormat.Upper("Season length"), "field-label", "rb-gap-top"));
            body.Add(Kit.Chips(Kit.Arr(preview, "seasonLength.presets").Select(preset => (Kit.Str(preset, "key"), Kit.Str(preset, "label"))),
                seasonPreset, picked => seasonPreset = picked));

            foreach (IGrouping<string, JToken> group in Kit.Arr(preview, "settings").GroupBy(setting => Kit.Str(setting, "group") ?? "world"))
            {
                body.Add(Ui.Text(TextFormat.Upper(Kit.Capital(group.Key)), "field-label", "rb-gap-top"));
                foreach (JToken setting in group) body.Add(SettingRow(setting));
            }

            nav.Add(Ui.Btn("BACK", () => { step = 1; Draw(); }, "btn--ghost"));
            Button start = Ui.Btn("START", async () => await StartGame(), "btn--primary");
            start.name = "wizard-start";
            nav.Add(start);
        }

        private VisualElement SettingRow(JToken setting)
        {
            string key = Kit.Str(setting, "key");
            VisualElement row = Ui.El("rb-setting").Named($"setting-{key}");
            row.Add(Ui.Text(Kit.Str(setting, "label"), "t-ui-semibold", "t-sm"));
            IEnumerable<(string, string)> options = Kit.Str(setting, "kind") == "boolean"
                ? new[] { ("true", "On"), ("false", "Off") }
                : Kit.Arr(setting, "options").Select(option => ((string)option, Kit.Capital((string)option)));
            string current = settings.TryGetValue(key, out JToken value) && value != null
                ? (value.Type == JTokenType.Boolean ? ((bool)value ? "true" : "false") : value.ToString())
                : null;
            row.Add(Kit.Chips(options, current, picked =>
                settings[key] = Kit.Str(setting, "kind") == "boolean" ? new JValue(picked == "true") : new JValue(picked)));
            row.Add(Ui.Text(Kit.Str(setting, "description"), "t-xs", "t-muted", "t-wrap"));
            return row;
        }

        private static VisualElement TextRow(string label, string value, Action<string> onChange, string name)
        {
            var field = new TextField { value = value, name = name };
            field.AddToClassList("text-input");
            field.style.width = 320;
            field.RegisterValueChangedCallback(evt => onChange(evt.newValue));
            return Ui.El("rb-line").With(Ui.Text(label, "rb-line__label"), field);
        }

        /// <summary>Starts the game with what the wizard holds (the tour calls it after picking the defaults).</summary>
        public async Task StartGame()
        {
            if (busy || client == null || world == null || promotionKey == null) return;
            if (string.IsNullOrWhiteSpace(seed) || seed.Length > SeedMaxLength)
            {
                feedback.text = $"Enter a seed of 1 to {SeedMaxLength} characters.";
                feedback.SetShown(true);
                return;
            }
            busy = true;
            nav.SetEnabled(false);
            try
            {
                var settingsJson = new JObject();
                foreach (KeyValuePair<string, JToken> pair in settings)
                {
                    if (pair.Value != null) settingsJson[pair.Key] = pair.Value.DeepClone();
                }
                var options = new JObject
                {
                    ["rootPackId"] = world.Id,
                    ["seed"] = seed.Trim(),
                    ["playerName"] = string.IsNullOrWhiteSpace(playerName) ? "Booker" : playerName.Trim(),
                    ["saveName"] = string.IsNullOrWhiteSpace(saveName) ? "My career" : saveName.Trim(),
                    ["seasonLength"] = new JObject { ["preset"] = seasonPreset ?? "12m" },
                    ["player"] = new JObject { ["mode"] = "existing", ["promotionKey"] = promotionKey },
                    ["settings"] = settingsJson,
                    ["tunableOverrides"] = new JObject(),
                };
                if (Kit.Str(preview, "startDate") is string startDate) options["startDate"] = startDate;
                DesktopSaveSettings.ApplyTo(options);

                NewGameResult created = await world.RunNewGame(client, options);
                if (!created.Ok)
                {
                    feedback.text = Kit.Reasons(created.Reasons);
                    feedback.SetShown(true);
                    return;
                }
                GameSession session = await GameSession.BeginNewAsync(client, (string)options["saveName"], created.Revision, created.Seat);
                WorkshopWorlds.RememberForSlot(session?.SlotId, world.Id);
                EngineGame.Enter(client, created.Seat);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                feedback.text = $"The game could not start: {exception.Message}";
                feedback.SetShown(true);
            }
            finally
            {
                busy = false;
                nav.SetEnabled(true);
            }
        }

        /// <summary>
        /// Goes straight to the last step with the defaults (the screenshot tour and the skip
        /// check). With <paramref name="workshop"/>, it first imports an installed workshop world
        /// through the import sub-screen (<paramref name="itemId"/>, or the first world mod) and uses
        /// it. Returns false when that import failed (the default world is used then).
        /// </summary>
        public async Task<bool> UseDefaults(bool workshop = false, string itemId = null)
        {
            while (client == null || world == null) await Task.Yield();
            bool ok = true;
            if (workshop)
            {
                OpenImport();
                while (mods == null) await Task.Yield();
                WorkshopMod mod = itemId == null
                    ? mods.FirstOrDefault(candidate => candidate.IsWorld)
                    : mods.FirstOrDefault(candidate => candidate.ItemId == itemId);
                if (mod == null)
                {
                    Debug.LogWarning("[NewGame] no such workshop world mod installed; using the default world");
                    ok = false;
                    CloseImport(selectImported: false);
                }
                else
                {
                    pickedMod = mod;
                    WorldModImportResult result = await RunImport();
                    ok = result != null && result.Ok;
                    importing = false;
                    if (ok) await ReturnWithImported(mod.PackId);
                    else Draw();
                    ok = ok && world?.Id == mod.PackId;
                }
            }
            await LoadPreview();
            step = 2;
            Draw();
            return ok;
        }

        private static string NewSeed() =>
            "rb-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
    }
}
