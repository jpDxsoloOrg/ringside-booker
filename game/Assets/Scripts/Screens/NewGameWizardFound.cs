using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The founding form (the web's FoundPromotionForm): what the wizard sends as
    /// <c>player: { mode: "found", … }</c>, and the checks the engine would refuse (names taken,
    /// short name pattern, a home region, a style, a hex colour).
    /// </summary>
    public sealed class FoundPromotion
    {
        public const int NameMin = 3;
        public const int NameMax = 48;
        public static readonly string[] Styles = { "mainstream", "traditional", "technical", "hardHitting", "hardcore", "highFlying", "entertainment" };
        public static readonly string[] Sizes = { "small", "medium", "large" };
        public static readonly string[] Weekdays = { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };
        public static readonly string[] Colours = { "#d7301a", "#2b6cb0", "#16a34a", "#9333ea", "#f59e0b", "#0891b2", "#e11d48", "#334155" };
        private static readonly Regex ShortNamePattern = new Regex("^[A-Z0-9]{2,8}$");
        private static readonly Regex HexPattern = new Regex("^#[0-9a-fA-F]{6}$");

        public string Name = string.Empty;
        public string ShortName = string.Empty;
        public string ContinentKey;
        public string CountryKey;
        public string HomeRegionKey;
        public string Style;
        public string Size = "medium";
        public string Color = "#d7301a";
        public bool StarterKit = true;
        /// <summary>0 = Monday; Friday by default (the end of the working week).</summary>
        public int WeeklyShowDay = 4;

        public static string Normalise(string shortName) => (shortName ?? string.Empty).Trim().ToUpperInvariant();

        public static string NameProblem(string name, IEnumerable<string> taken)
        {
            string trimmed = (name ?? string.Empty).Trim();
            if (trimmed.Length == 0) return "Enter a name for your promotion.";
            if (trimmed.Length < NameMin || trimmed.Length > NameMax) return $"Use {NameMin} to {NameMax} characters.";
            string clash = taken?.FirstOrDefault(existing => string.Equals(existing?.Trim(), trimmed, StringComparison.OrdinalIgnoreCase));
            return clash == null ? null : $"{clash} already exists. Pick another name.";
        }

        public static string ShortNameProblem(string shortName, IEnumerable<string> taken)
        {
            string normalised = Normalise(shortName);
            if (normalised.Length == 0) return "Enter a short name.";
            if (!ShortNamePattern.IsMatch(normalised)) return "Use 2 to 8 letters or digits, no spaces.";
            string clash = taken?.FirstOrDefault(existing => existing == normalised);
            return clash == null ? null : $"{clash} is already taken by another promotion.";
        }

        public static bool ValidColour(string color) => color != null && HexPattern.IsMatch(color);

        /// <summary>The first thing that keeps the form from being sent, or null.</summary>
        public string FirstProblem(JToken preview) =>
            NameProblem(Name, Kit.Arr(preview, "takenNames").Select(name => (string)name))
            ?? ShortNameProblem(ShortName, Kit.Arr(preview, "takenShortNames").Select(name => (string)name))
            ?? (RegionName(preview, HomeRegionKey) == null ? "Choose a home region." : null)
            ?? (Style == null ? "Choose a style." : null)
            ?? (ValidColour(Color) ? null : "Use a hex colour such as #1a2b3c.");

        public static string RegionName(JToken preview, string regionKey) =>
            regionKey == null ? null : Kit.Arr(preview, "regions").SelectMany(continent => Kit.Arr(continent, "countries"))
                .SelectMany(country => Kit.Arr(country, "regions")).Where(region => Kit.Str(region, "key") == regionKey)
                .Select(region => Kit.Str(region, "name")).FirstOrDefault();

        public JObject ToPlayer() => new JObject
        {
            ["mode"] = "found",
            ["name"] = Name.Trim(),
            ["shortName"] = Normalise(ShortName),
            ["homeRegionKey"] = HomeRegionKey,
            ["style"] = Style ?? Styles[0],
            ["size"] = Size,
            ["color"] = Color,
            ["starterKit"] = StarterKit,
            ["weeklyShowDay"] = WeeklyShowDay,
        };

        public static string StyleLabel(string style) => style switch
        {
            "hardHitting" => "Hard-hitting",
            "highFlying" => "High-flying",
            _ => Kit.Capital(style),
        };
    }

    public sealed partial class NewGameWizard
    {
        private bool foundMode;
        private bool foundChecked;
        private readonly FoundPromotion found = new FoundPromotion();

        /// <summary>The tours: shows the founding form filled with an example promotion.</summary>
        public void ShowFoundExample()
        {
            if (preview == null) return;
            foundMode = true;
            found.Name = "Harbour City Wrestling";
            found.ShortName = "HCW";
            JToken continent = Kit.Arr(preview, "regions").FirstOrDefault();
            JToken country = Kit.Arr(continent, "countries").FirstOrDefault();
            found.ContinentKey = Kit.Str(continent, "key");
            found.CountryKey = Kit.Str(country, "key");
            found.HomeRegionKey = Kit.Str(Kit.Arr(country, "regions").FirstOrDefault(), "key");
            found.Style = "technical";
            found.Color = "#2b6cb0";
            ShowStep(1);
        }

        /// <summary>The tours: back to taking over a promotion.</summary>
        public void ShowTakeOver()
        {
            foundMode = false;
            ShowStep(1);
        }

        private void DrawFoundForm()
        {
            body.Add(Kit.Note("Start your own promotion from nothing: you pick the name, the home region, the style and how big you start."));
            List<string> takenNames = Kit.Arr(preview, "takenNames").Select(name => (string)name).ToList();
            List<string> takenShort = Kit.Arr(preview, "takenShortNames").Select(name => (string)name).ToList();

            body.Add(Section("Name"));
            VisualElement form = Ui.El("rb-form").Named("wizard-found");
            Label nameProblem = Hint(null);
            Label shortProblem = Hint("2 to 8 letters or digits, shown in capitals.");
            form.Add(TextRow("Promotion name", found.Name, value =>
            {
                found.Name = value;
                SetHint(nameProblem, value.Length == 0 && !foundChecked ? null : FoundPromotion.NameProblem(value, takenNames), null);
            }, "found-name"));
            form.Add(nameProblem);
            form.Add(TextRow("Short name", found.ShortName, value =>
            {
                found.ShortName = value;
                SetHint(shortProblem, value.Length == 0 && !foundChecked ? null : FoundPromotion.ShortNameProblem(value, takenShort), "2 to 8 letters or digits, shown in capitals.");
            }, "found-short-name"));
            form.Add(shortProblem);
            if (foundChecked || found.Name.Length > 0) SetHint(nameProblem, FoundPromotion.NameProblem(found.Name, takenNames), null);
            if (foundChecked || found.ShortName.Length > 0) SetHint(shortProblem, FoundPromotion.ShortNameProblem(found.ShortName, takenShort), "2 to 8 letters or digits, shown in capitals.");
            body.Add(form);

            body.Add(Section("Home region"));
            List<JToken> continents = Kit.Arr(preview, "regions").ToList();
            body.Add(Ui.Text("Continent", "rb-setting__name"));
            body.Add(Kit.Chips(continents.Select(row => (Kit.Str(row, "key"), Kit.Str(row, "name"))), found.ContinentKey, picked =>
            {
                found.ContinentKey = picked;
                found.CountryKey = null;
                found.HomeRegionKey = null;
                Draw();
            }, "found-continent"));
            JToken continent = continents.FirstOrDefault(row => Kit.Str(row, "key") == found.ContinentKey);
            if (continent != null)
            {
                body.Add(Ui.Text("Country", "rb-setting__name"));
                body.Add(Kit.Chips(Kit.Arr(continent, "countries").Select(row => (Kit.Str(row, "key"), Kit.Str(row, "name"))), found.CountryKey, picked =>
                {
                    found.CountryKey = picked;
                    found.HomeRegionKey = null;
                    Draw();
                }, "found-country"));
            }
            JToken country = Kit.Arr(continent, "countries").FirstOrDefault(row => Kit.Str(row, "key") == found.CountryKey);
            if (country != null)
            {
                body.Add(Ui.Text("Region", "rb-setting__name"));
                body.Add(Kit.Chips(Kit.Arr(country, "regions").Select(row => (Kit.Str(row, "key"),
                    $"{Kit.Str(row, "name")} ({TextFormat.Number((long)(Kit.Num(row, "population") ?? 0))})")), found.HomeRegionKey, picked => found.HomeRegionKey = picked, "found-region"));
            }
            if (foundChecked && FoundPromotion.RegionName(preview, found.HomeRegionKey) == null) body.Add(Hint("Choose a home region.", true));

            body.Add(Section("Style"));
            VisualElement styles = Kit.Chips(FoundPromotion.Styles.Select(style => (style, FoundPromotion.StyleLabel(style))), found.Style, picked => found.Style = picked, "found-style");
            body.Add(styles);
            body.Add(Ui.Text("The kind of wrestling you are known for. Fans and wrestlers who like that style warm to you faster.", "rb-setting__description"));
            if (foundChecked && found.Style == null) body.Add(Hint("Choose a style.", true));

            body.Add(Section("Size"));
            body.Add(Ui.Text("How much you start with. Bigger means more cash and a head start with the fans.", "rb-setting__description"));
            VisualElement sizes = Ui.El("rb-promo-list").Named("found-size");
            foreach (string size in FoundPromotion.Sizes)
            {
                JToken numbers = Kit.Obj(preview, $"foundingSizes.{size}");
                Button option = Ui.Button(string.Empty, () =>
                {
                    found.Size = size;
                    Draw();
                }, "choice-chip", "rb-option");
                option.name = $"found-size-{size}";
                option.Add(Ui.Text(Kit.Capital(size), "choice-chip__label"));
                option.Add(Ui.Text($"{TextFormat.Money((long)(Kit.Num(numbers, "cash") ?? 0))} cash · popularity {Kit.Whole(Kit.Num(numbers, "homePopularity"))} at home, " +
                    $"{Kit.Whole(Kit.Num(numbers, "countryPopularity"))} in the rest of the country · prestige {Kit.Whole(Kit.Num(numbers, "prestige"))}", "choice-chip__detail", "t-wrap"));
                option.EnableInClassList("choice-chip--selected", found.Size == size);
                sizes.Add(option);
            }
            body.Add(sizes);

            body.Add(Section("Colour"));
            VisualElement colourRow = Ui.El("rb-row", "rb-row--wrap", "rb-found-colours").Named("found-colours");
            foreach (string colour in FoundPromotion.Colours)
            {
                Button swatch = Ui.Button(string.Empty, () =>
                {
                    found.Color = colour;
                    Draw();
                }, "rb-swatch");
                swatch.name = $"found-colour-{colour.Substring(1)}";
                if (ColorUtility.TryParseHtmlString(colour, out Color parsed)) swatch.style.backgroundColor = parsed;
                swatch.EnableInClassList("rb-swatch--selected", string.Equals(found.Color, colour, StringComparison.OrdinalIgnoreCase));
                colourRow.Add(swatch);
            }
            body.Add(colourRow);
            VisualElement colourForm = Ui.El("rb-form");
            Label colourProblem = Hint(null);
            colourForm.Add(TextRow("Hex code", found.Color, value =>
            {
                found.Color = value.Trim();
                SetHint(colourProblem, FoundPromotion.ValidColour(found.Color) ? null : "Use a hex colour such as #1a2b3c.", null);
            }, "found-colour-hex"));
            colourForm.Add(colourProblem);
            body.Add(colourForm);
            VisualElement logoPreview = Ui.El("rb-row", "rb-found-preview").Named("found-preview");
            VisualElement plate = UI.Design.DsCards.Logo(FoundPromotion.Normalise(found.ShortName).Length > 0 ? FoundPromotion.Normalise(found.ShortName) : "?",
                FoundPromotion.ValidColour(found.Color) ? found.Color : "#334155", "ds-logo--lg");
            logoPreview.Add(plate);
            logoPreview.Add(Ui.Text(found.Name.Trim().Length > 0 ? found.Name.Trim() : "Your promotion", "rb-setting__name", "rb-found-preview__name"));
            body.Add(logoPreview);

            body.Add(Section("Starter kit"));
            VisualElement kit = Ui.El("rb-setting").Named("found-starter-kit");
            kit.Add(Ui.El("rb-setting__text").With(
                Ui.Text("Starter kit", "rb-setting__name"),
                Ui.Text("A vacant championship and a weekly show, so you have something to book from day one.", "rb-setting__description")));
            VisualElement kitChoices = Kit.Chips(new[] { (true, "On"), (false, "Off") }, found.StarterKit, picked =>
            {
                found.StarterKit = picked;
                Draw();
            });
            kitChoices.AddToClassList("rb-segmented");
            kitChoices.AddToClassList("rb-setting__choices");
            kit.Add(kitChoices);
            body.Add(kit);
            if (found.StarterKit)
            {
                VisualElement day = Ui.El("rb-setting").Named("found-show-day");
                day.Add(Ui.El("rb-setting__text").With(Ui.Text("Weekly show day", "rb-setting__name"),
                    Ui.Text("The day your weekly show runs.", "rb-setting__description")));
                VisualElement days = Kit.Chips(FoundPromotion.Weekdays.Select((label, index) => (index, label.Substring(0, 3))), found.WeeklyShowDay, picked => found.WeeklyShowDay = picked);
                days.AddToClassList("rb-segmented");
                days.AddToClassList("rb-setting__choices");
                day.Add(days);
                body.Add(day);
            }
            body.Add(Ui.Text("A new promotion starts with nobody under contract: sign wrestlers before your first show.", "rb-setting__description"));
        }

        private static Label Hint(string text, bool problem = false)
        {
            Label label = Ui.Text(text ?? string.Empty, "rb-form__hint");
            if (problem) label.AddToClassList("t-negative");
            label.SetShown(!string.IsNullOrEmpty(text));
            return label;
        }

        private static void SetHint(Label label, string problem, string fallback)
        {
            label.text = problem ?? fallback ?? string.Empty;
            label.EnableInClassList("t-negative", problem != null);
            label.SetShown(!string.IsNullOrEmpty(label.text));
        }
    }
}
