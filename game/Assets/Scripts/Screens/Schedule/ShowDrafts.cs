using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Screens.Schedule
{
    /// <summary>The card size an importance starts with, from <c>calendar.editorOptions</c>.</summary>
    public sealed class ImportanceChoice
    {
        public string Importance;
        public string Label;
        public int Slots;
        public int PreShowSlots;

        public static List<ImportanceChoice> From(JToken options) =>
            (options?["importances"] as JArray ?? new JArray()).Select(row => new ImportanceChoice
            {
                Importance = (string)row["importance"],
                Label = (string)row["label"],
                Slots = (int?)row["defaultFormat"]?["slots"] ?? 6,
                PreShowSlots = (int?)row["defaultFormat"]?["preShowSlots"] ?? 0,
            }).ToList();
    }

    /// <summary>
    /// A recurring show being edited (EVT8-03): what the editor sheet holds until Save. Pure, so it
    /// is tested without the engine. <see cref="ToJson"/> is the engine's <c>DefinitionDraft</c>.
    /// </summary>
    public sealed class RecurringDraft
    {
        public string Name = string.Empty;
        public string BrandId;
        public string Importance = "regular";
        public RecurrenceValue Recurrence = new RecurrenceValue();
        public int Slots = 6;
        public int PreShowSlots;
        public bool Televised;
        public string RegionId;
        public string VenueId;
        /// <summary>The first show date of a new show (ISO), or null for "as soon as possible".</summary>
        public string ActiveFrom;
        /// <summary>True once the player changed a slot count, so a new importance no longer resets it.</summary>
        public bool FormatTouched;

        /// <summary>Picks a size; the card size follows it until the player sets slots by hand.</summary>
        public void SetImportance(string importance, IReadOnlyList<ImportanceChoice> choices)
        {
            Importance = importance;
            if (FormatTouched) return;
            ImportanceChoice choice = choices?.FirstOrDefault(entry => entry.Importance == importance);
            if (choice == null) return;
            Slots = choice.Slots;
            PreShowSlots = choice.PreShowSlots;
        }

        public JObject ToJson()
        {
            var draft = new JObject
            {
                ["name"] = Name ?? string.Empty,
                ["brandId"] = BrandId,
                ["importance"] = Importance,
                ["recurrence"] = Recurrence.ToJson(),
                ["format"] = new JObject { ["slots"] = Slots, ["preShowSlots"] = PreShowSlots },
                ["televised"] = Televised,
                ["preferredRegionId"] = RegionId,
                ["preferredVenueId"] = VenueId,
            };
            if (!string.IsNullOrEmpty(ActiveFrom)) draft["activeFrom"] = ActiveFrom;
            return draft;
        }

        /// <summary>A draft of a stored show, from its <c>calendar.definitions</c> row.</summary>
        public static RecurringDraft FromRow(JToken row) => new RecurringDraft
        {
            Name = (string)row["name"] ?? string.Empty,
            BrandId = (string)row["brandId"],
            Importance = (string)row["importance"] ?? "regular",
            Recurrence = RecurrenceValue.FromJson(row["recurrence"]),
            Slots = (int?)row["format"]?["slots"] ?? 6,
            PreShowSlots = (int?)row["format"]?["preShowSlots"] ?? 0,
            Televised = (bool?)row["televised"] ?? false,
            RegionId = (string)row["preferredRegionId"],
            VenueId = (string)row["preferredVenueId"],
            FormatTouched = true,
        };

        /// <summary>True when Save would change anything about the stored show.</summary>
        public bool DiffersFrom(RecurringDraft stored) =>
            stored == null || !JToken.DeepEquals(WithoutStart(ToJson()), WithoutStart(stored.ToJson()));

        private static JObject WithoutStart(JObject draft)
        {
            draft["name"] = ((string)draft["name"] ?? string.Empty).Trim();
            draft.Remove("activeFrom");
            return draft;
        }
    }

    /// <summary>A one-off special being planned (EVT8-04). <see cref="ToJson"/> is <c>calendar.addOneOff</c>'s arguments.</summary>
    public sealed class SpecialDraft
    {
        public string Name = string.Empty;
        public string BrandId;
        public string Importance = "major";
        public int Slots = 8;
        public int PreShowSlots = 1;
        public string Date;
        public string RegionId;
        public string VenueId;
        public bool FormatTouched;

        public void SetImportance(string importance, IReadOnlyList<ImportanceChoice> choices)
        {
            Importance = importance;
            if (FormatTouched) return;
            ImportanceChoice choice = choices?.FirstOrDefault(entry => entry.Importance == importance);
            if (choice == null) return;
            Slots = choice.Slots;
            PreShowSlots = choice.PreShowSlots;
        }

        /// <summary>The first Saturday at least two weeks after <paramref name="from"/>: a sensible PPV date.</summary>
        public static GameDate DefaultDate(GameDate from) => RecurrenceValue.NextOn(5, from.AddDays(14));

        public JObject ToJson(string promotionId) => new JObject
        {
            ["promotionId"] = promotionId,
            ["name"] = Name ?? string.Empty,
            ["brandId"] = BrandId,
            ["importance"] = Importance,
            ["format"] = new JObject { ["slots"] = Slots, ["preShowSlots"] = PreShowSlots },
            ["date"] = Date,
            ["regionId"] = RegionId,
            ["venueId"] = VenueId,
        };
    }

    /// <summary>The engine's refusal reasons grouped by the field they belong under.</summary>
    public sealed class FieldReasons
    {
        private readonly Dictionary<string, string> byField = new Dictionary<string, string>();
        private readonly List<string> general = new List<string>();

        public int Count { get; private set; }

        public static FieldReasons From(IEnumerable<(string field, string message)> reasons)
        {
            var grouped = new FieldReasons();
            foreach ((string field, string message) in reasons)
            {
                grouped.Count++;
                string key = Normalize(field);
                if (key == null) grouped.general.Add(message);
                else if (!grouped.byField.ContainsKey(key)) grouped.byField[key] = message;
                else grouped.byField[key] += " · " + message;
            }
            return grouped;
        }

        public static FieldReasons FromJson(JToken reasons) =>
            From((reasons as JArray ?? new JArray()).Select(reason => ((string)reason["field"], (string)reason["message"])));

        /// <summary>The message for a field (e.g. <c>format.slots</c>), or null.</summary>
        public string For(string field) => byField.TryGetValue(field, out string message) ? message : null;

        /// <summary>Messages for fields the sheet has no place for, and reasons with no field.</summary>
        public IEnumerable<string> Others(IEnumerable<string> placed)
        {
            var known = new HashSet<string>(placed);
            return general.Concat(byField.Where(entry => !known.Contains(entry.Key)).Select(entry => entry.Value));
        }

        private static string Normalize(string field)
        {
            if (string.IsNullOrEmpty(field)) return null;
            return field.StartsWith("draft.", StringComparison.Ordinal) ? field.Substring(6) : field;
        }
    }
}
