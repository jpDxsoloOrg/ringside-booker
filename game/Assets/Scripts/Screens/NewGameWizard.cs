using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
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
    /// "Workshop mods"), the promotion you take over (<c>previewWorld</c>), the options (save and
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

        /// <summary>The live wizard for the screenshot tour: picks the defaults and starts a game.</summary>
        public static NewGameWizard Last { get; private set; }

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
            switch (step)
            {
                case 0: DrawWorlds(); break;
                case 1: DrawPromotions(); break;
                default: DrawOptions(); break;
            }
        }

        private void DrawWorlds()
        {
            foreach (IGrouping<string, (string group, WorldChoice world)> group in worlds.GroupBy(entry => entry.group))
            {
                body.Add(Ui.Text(TextFormat.Upper(group.Key), "field-label", "rb-gap-top"));
                foreach ((string _, WorldChoice choice) in group) body.Add(WorldOption(choice));
            }
            if (!WorldSources.All.Any())
            {
                body.Add(Ui.Text(TextFormat.Upper("Workshop mods"), "field-label", "rb-gap-top"));
                body.Add(Kit.Note("Installed workshop world mods will be listed here."));
            }
            Button next = Ui.Btn("NEXT", async () =>
            {
                if (world == null) return;
                await LoadPreview();
            }, "btn--primary");
            next.name = "wizard-next";
            next.SetEnabled(world != null);
            nav.Add(next);
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
            try
            {
                WorldPreviewResult answer = await world.RunPreview(client);
                if (!answer.Ok || answer.Value == null)
                {
                    feedback.text = "That world could not be read: " + string.Join("; ", answer.Issues.Select(issue => Kit.Str(issue, "message") ?? issue.ToString()).Concat(answer.Reasons.Select(reason => reason.Message)));
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
            }
        }

        private void DrawPromotions()
        {
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
                await GameSession.BeginNewAsync(client, (string)options["saveName"], created.Revision, created.Seat);
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

        /// <summary>Goes straight to the last step with the defaults (the screenshot tour).</summary>
        public async Task UseDefaults()
        {
            while (client == null || world == null) await Task.Yield();
            await LoadPreview();
            step = 2;
            Draw();
        }

        private static string NewSeed() =>
            "rb-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
    }
}
