using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// The Titles screens' words and rules, ported from the web (<c>apps/web/src/screens/titles/</c>):
    /// belt metal, prestige words, reign days, record values, which actions a title offers, the
    /// confirms' copy, and the create / edit form's checks and command arguments. Engine-free, so
    /// the EditMode tests cover it.
    /// </summary>
    public static class TitleText
    {
        // ---- Belts and prestige ---------------------------------------------------------------------

        /// <summary>Gold from 70 prestige, silver from 45, bronze from 20, plain below (display only).</summary>
        public static string BeltTier(double prestige)
        {
            if (prestige >= 70) return "gold";
            if (prestige >= 45) return "silver";
            if (prestige >= 20) return "bronze";
            return "plain";
        }

        /// <summary>Prestige in plain words, said before its number: "Top prize", "Respected", "Building", "Minor".</summary>
        public static string PrestigeWords(double prestige)
        {
            if (prestige >= 70) return "Top prize";
            if (prestige >= 45) return "Respected";
            if (prestige >= 20) return "Building";
            return "Minor";
        }

        public static string Whole(double value) => TextFormat.Number((long)Math.Round(value));

        // ---- Reigns ---------------------------------------------------------------------------------

        public const string CurrentReignText = "Current";
        public const string WonTodayText = "Won today";
        public const string NoReignsText = "No champions yet";
        public const string NoRecordsText = "No records yet";
        public const string Vacant = "Vacant";

        /// <summary>"142 days", "1 day", or "Won today" for a reign that began today.</summary>
        public static string ReignDays(int days) => days == 0 ? WonTodayText : TextFormat.DayCount(days);

        /// <summary>"1 defence", "3 defences".</summary>
        public static string Defences(int count) => $"{TextFormat.Number(count)} {(count == 1 ? "defence" : "defences")}";

        /// <summary>The champion's line on a card: "142 days · 3 defences".</summary>
        public static string ReignLine(int days, int defences) => $"{ReignDays(days)} · {Defences(defences)}";

        /// <summary>"Singles", "Tag team", "Trios".</summary>
        public static string HolderCount(int count) => count == 2 ? "Tag team" : count == 3 ? "Trios" : "Singles";

        /// <summary>The records the panel lists, in order: key, label and what the number counts.</summary>
        public static readonly (string key, string label, string unit)[] RecordRows =
        {
            ("longestReign", "Longest reign", "days"),
            ("shortestReign", "Shortest reign", "days"),
            ("mostDefences", "Most defences in a reign", "defences"),
            ("mostReigns", "Most reigns", "reigns"),
            ("mostCombinedDays", "Most combined days", "days"),
            ("oldestChampion", "Oldest champion", "years"),
            ("youngestChampion", "Youngest champion", "years"),
        };

        /// <summary>"142 days", "1 defence", "3 reigns", "41 years old".</summary>
        public static string RecordValue(double value, string unit)
        {
            bool one = Math.Abs(value - 1) < 1e-9;
            string number = TextFormat.Number((long)Math.Round(value));
            switch (unit)
            {
                case "days": return $"{number} {(one ? "day" : "days")}";
                case "defences": return $"{number} {(one ? "defence" : "defences")}";
                case "reigns": return $"{number} {(one ? "reign" : "reigns")}";
                case "years": return $"{number} {(one ? "year old" : "years old")}";
                default: return number;
            }
        }

        // ---- Actions --------------------------------------------------------------------------------

        public const string Edit = "edit";
        public const string Award = "award";
        public const string Vacate = "vacate";
        public const string Retire = "retire";
        public const string Reactivate = "reactivate";

        /// <summary>
        /// Which actions a title offers: none when the viewer can't change it; Reactivate alone when it
        /// is retired; else Edit, Award, Vacate (when someone holds it) and Retire.
        /// </summary>
        public static IReadOnlyList<string> RowActions(bool editable, string status, bool held)
        {
            if (!editable) return Array.Empty<string>();
            if (status == "retired") return new[] { Reactivate };
            return held ? new[] { Edit, Award, Vacate, Retire } : new[] { Edit, Award, Retire };
        }

        public static string ActionLabel(string action) => action switch
        {
            Edit => "Edit",
            Award => "Award",
            Vacate => "Vacate",
            Retire => "Retire",
            Reactivate => "Reactivate",
            _ => action,
        };

        public static string ActionIcon(string action) => action switch
        {
            Edit => "edit",
            Award => "trophy",
            Vacate => "close",
            Retire => "lock",
            Reactivate => "unlock",
            _ => "more",
        };

        public static bool IsDanger(string action) => action == Vacate || action == Retire;

        /// <summary>The confirm's words for vacating, retiring and reactivating a title.</summary>
        public static (string title, string body, string confirm, bool danger) EndOrReturnCopy(string kind, string titleName, string championLabel)
        {
            string champion = championLabel ?? "The champion";
            switch (kind)
            {
                case Vacate:
                    return ($"Vacate the {titleName}?", $"{champion}'s reign ends today as Vacated.", "Vacate", true);
                case Retire:
                    return ($"Retire the {titleName}?",
                        championLabel == null
                            ? "It moves to Retired. Its lineage is kept, and you can bring it back later."
                            : $"It moves to Retired. {champion}'s reign ends today. Its lineage is kept, and you can bring it back later.",
                        "Retire", true);
                default:
                    return ($"Bring the {titleName} back?", "It returns vacant. Award it to someone when you are ready.", "Bring it back", false);
            }
        }

        /// <summary>What the toast says once the command worked.</summary>
        public static string DoneText(string kind, string titleName) => kind switch
        {
            Vacate => $"The {titleName} is vacant",
            Retire => $"Retired the {titleName}",
            Reactivate => $"The {titleName} is back, vacant",
            _ => "Saved",
        };

        /// <summary>The award confirm's words: who gets it and how the current reign ends.</summary>
        public static (string title, string body) AwardConfirmCopy(string titleName, string pickNames, string championLabel) =>
            ($"Award the {titleName} to {pickNames}?", $"{championLabel ?? "The champion"}'s reign ends as Stripped.");

        /// <summary>"Pick 1 person", "Pick 2 people".</summary>
        public static string PickPrompt(int holderCount) =>
            holderCount == 1 ? "Pick 1 person" : $"Pick {TextFormat.Number(holderCount)} people";

        /// <summary>The hint under someone on another brand: where they do work.</summary>
        public static string OtherBrandText(string brandName) => brandName == null ? "Works across brands" : $"Works on {brandName}";

        /// <summary>The picked people's names ("A & B"), or the team's name when a team was picked whole.</summary>
        public static string PickNames(IEnumerable<string> names, string teamName) =>
            teamName ?? string.Join(" & ", names);

        public static string WeightClass(string weightClass) => weightClass switch
        {
            "lightweight" => "Lightweight",
            "cruiserweight" => "Cruiserweight",
            "lightHeavyweight" => "Light heavyweight",
            "heavyweight" => "Heavyweight",
            "superHeavyweight" => "Super heavyweight",
            _ => CreativeUi.NoValue,
        };

        // ---- The create / edit form -------------------------------------------------------------------

        public const string PromotionWide = "promotion-wide";
        public const string PromotionWideLabel = "Promotion-wide";
        public const string HoldersLockedHint = "Vacate the title to change this";
        public const string WeightNotANumber = "Enter a weight in kg, or leave it empty for no limit.";
        public const int NameMax = 60;

        public static readonly (string hex, string name)[] Swatches =
        {
            ("#c9a227", "Gold"),
            ("#8a8d91", "Silver"),
            ("#b0703a", "Bronze"),
            ("#b91c1c", "Red"),
            ("#1d4ed8", "Blue"),
            ("#15803d", "Green"),
            ("#7e22ce", "Purple"),
            ("#1f2328", "Black"),
        };

        public static readonly (string value, string label)[] Divisions =
        {
            ("open", "Open"),
            ("male", "Men's"),
            ("female", "Women's"),
        };

        public static readonly (string value, string label, string hint)[] Tiers =
        {
            ("world", "World", "The top prize. Starts with the most prestige."),
            ("secondary", "Secondary", "The next rung down, such as a mid-card title."),
            ("specialty", "Specialty", "A belt for a style or gimmick. Starts with the least prestige."),
        };

        /// <summary>What the form holds while the player fills it in. Weights stay text until submit.</summary>
        public sealed class Form
        {
            public string Name = string.Empty;
            public string Brand = PromotionWide;
            public int HolderCount = 1;
            public string Gender = "open";
            public string MinWeight = string.Empty;
            public string MaxWeight = string.Empty;
            public string Color = "#c9a227";
            public string Tier = "secondary";

            /// <summary>The form filled in from a title's card row, for editing.</summary>
            public static Form FromRow(JToken row) => new Form
            {
                Name = Kit.Str(row, "name") ?? string.Empty,
                Brand = Kit.Str(row, "brandId") ?? PromotionWide,
                HolderCount = (int)(Kit.Num(row, "holderCount") ?? 1),
                Gender = Kit.Str(row, "division.gender") ?? "open",
                MinWeight = WeightText(Kit.Num(row, "division.minWeightKg")),
                MaxWeight = WeightText(Kit.Num(row, "division.maxWeightKg")),
                Color = (Kit.Str(row, "color") ?? "#c9a227").ToLowerInvariant(),
            };
        }

        /// <summary>A weight shown in the form: rounded to a whole kilogram, empty for no limit.</summary>
        public static string WeightText(double? kg) => kg.HasValue ? Math.Round(kg.Value).ToString(CultureInfo.InvariantCulture) : string.Empty;

        /// <summary>The text of a weight box as kilograms: (ok, null) when empty, (false, _) when it is not a weight.</summary>
        public static bool TryParseWeight(string text, out double? kg)
        {
            kg = null;
            string trimmed = (text ?? string.Empty).Trim().Replace(',', '.');
            if (trimmed.Length == 0) return true;
            if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out double value) && value > 0 && !double.IsInfinity(value))
            {
                kg = value;
                return true;
            }
            return false;
        }

        /// <summary>The problems with the form: one per field, and the rest for the top of the sheet.</summary>
        public sealed class FormErrors
        {
            public readonly Dictionary<string, string> Fields = new Dictionary<string, string>();
            public readonly List<string> General = new List<string>();
            public bool Any => Fields.Count > 0 || General.Count > 0;
            public string Of(string field) => Fields.TryGetValue(field, out string text) ? text : null;
        }

        private static readonly Dictionary<string, string> FieldByReasonField = new Dictionary<string, string>
        {
            ["name"] = "name",
            ["brandId"] = "brand",
            ["holderCount"] = "holderCount",
            ["division"] = "division",
            ["division.gender"] = "division",
            ["division.minWeightKg"] = "minWeight",
            ["division.maxWeightKg"] = "maxWeight",
        };

        /// <summary>The engine's reasons, each under the field it names; the rest go to the top.</summary>
        public static FormErrors ErrorsFromReasons(IEnumerable<(string code, string field, string message)> reasons)
        {
            var errors = new FormErrors();
            foreach ((string _, string field, string message) in reasons)
            {
                if (field == null || !FieldByReasonField.TryGetValue(field, out string formField))
                {
                    errors.General.Add(message);
                    continue;
                }
                errors.Fields[formField] = errors.Fields.TryGetValue(formField, out string before) ? $"{before} {message}" : message;
            }
            return errors;
        }

        private static JObject Division(string gender, double? min, double? max) => new JObject
        {
            ["gender"] = gender,
            ["minWeightKg"] = min.HasValue ? (JToken)min.Value : JValue.CreateNull(),
            ["maxWeightKg"] = max.HasValue ? (JToken)max.Value : JValue.CreateNull(),
        };

        private static FormErrors WeightErrors(bool minOk, bool maxOk)
        {
            var errors = new FormErrors();
            if (!minOk) errors.Fields["minWeight"] = WeightNotANumber;
            if (!maxOk) errors.Fields["maxWeight"] = WeightNotANumber;
            return errors;
        }

        private static JToken BrandArg(string brand) =>
            string.IsNullOrEmpty(brand) || brand == PromotionWide ? JValue.CreateNull() : (JToken)brand;

        /// <summary><c>titles.create</c>'s arguments, or the errors that stop the form being sent.</summary>
        public static (JObject args, FormErrors errors) CreateArgs(string promotionId, Form form)
        {
            bool minOk = TryParseWeight(form.MinWeight, out double? min);
            bool maxOk = TryParseWeight(form.MaxWeight, out double? max);
            if (!minOk || !maxOk) return (null, WeightErrors(minOk, maxOk));
            return (new JObject
            {
                ["promotionId"] = promotionId,
                ["brandId"] = BrandArg(form.Brand),
                ["name"] = form.Name,
                ["holderCount"] = form.HolderCount,
                ["division"] = Division(form.Gender, min, max),
                ["tier"] = form.Tier,
                ["color"] = form.Color,
            }, null);
        }

        /// <summary>
        /// <c>titles.edit</c>'s arguments: name, brand, division and colour as the form has them, and
        /// the holder count only when it changed (the engine refuses any change while it is held).
        /// Weights left as shown keep their exact stored value rather than the rounded one.
        /// </summary>
        public static (JObject args, FormErrors errors) EditArgs(JToken row, Form form)
        {
            bool minOk = TryParseWeight(form.MinWeight, out double? min);
            bool maxOk = TryParseWeight(form.MaxWeight, out double? max);
            if (!minOk || !maxOk) return (null, WeightErrors(minOk, maxOk));
            double? storedMin = Kit.Num(row, "division.minWeightKg");
            double? storedMax = Kit.Num(row, "division.maxWeightKg");
            if (form.MinWeight == WeightText(storedMin)) min = storedMin;
            if (form.MaxWeight == WeightText(storedMax)) max = storedMax;
            var args = new JObject
            {
                ["titleId"] = Kit.Str(row, "titleId"),
                ["name"] = form.Name,
                ["brandId"] = BrandArg(form.Brand),
                ["division"] = Division(form.Gender, min, max),
                ["color"] = form.Color,
            };
            if (form.HolderCount != (int)(Kit.Num(row, "holderCount") ?? 1)) args["holderCount"] = form.HolderCount;
            return (args, null);
        }
    }
}
