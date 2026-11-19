using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// The contract lists' filters (ECO5-09): role, gender and card position (Ended has role only).
    /// They live behind the toolbar's Filter button and stay while the screen is open.
    /// </summary>
    public sealed class ContractFilters
    {
        public string Role { get; set; }
        public string Gender { get; set; }
        public string Push { get; set; }

        public int Count(string tab) =>
            (Role != null ? 1 : 0) + (tab == ContractsScreen.TabEnded ? 0 : (Gender != null ? 1 : 0) + (Push != null ? 1 : 0));

        public void Clear()
        {
            Role = null;
            Gender = null;
            Push = null;
        }

        public bool Keeps(JToken row, string tab) =>
            (Role == null || Kit.Str(row, "role") == Role) &&
            (tab == ContractsScreen.TabEnded || Gender == null || Kit.Str(row, "gender") == Gender) &&
            (tab == ContractsScreen.TabEnded || Push == null || Kit.Str(row, "push") == Push);

        public void Build(VisualElement panel, string tab, IReadOnlyList<JToken> activeRows, Action changed)
        {
            // Roles present on the roster only, so every chip finds somebody.
            IEnumerable<string> roles = ContractText.EmploymentRoles.Where(role => activeRows.Any(row => Kit.Str(row, "role") == role) || role == Role);
            panel.Add(Group("Role", "All roles", roles.Select(role => (role, ContractText.RoleLabel(role))), Role, value => { Role = value; changed(); }, "filter-role"));
            if (tab == ContractsScreen.TabEnded) return;
            panel.Add(Group("Gender", "Any gender", ContractText.Genders.Select(gender => (gender, ContractText.GenderLabel(gender))), Gender, value => { Gender = value; changed(); }, "filter-gender"));
            panel.Add(Group("Push", "Any push", ContractText.PushLevels.Select(push => (push, ContractText.PushName(push))), Push, value => { Push = value; changed(); }, "filter-push"));
        }

        /// <summary>A chip group with "any" first; null is "any".</summary>
        internal static VisualElement Group(string label, string any, IEnumerable<(string value, string text)> options, string selected, Action<string> pick, string name)
        {
            var all = new List<(string, string, bool, string)> { (null, any, true, null) };
            all.AddRange(options.Select(option => (option.value, option.text, true, (string)null)));
            return new ContractUi.ChoiceGroup<string>(label, all, selected, pick, name);
        }
    }

    /// <summary>
    /// The Free agents tab's filters (ECO5-09), the Workers list's where both have them: who to list
    /// (free agents only, or also workers whose deals end soon), role, gender, the push they would
    /// expect with you, style, an age range, a lowest popularity among your fans, and the continent
    /// they are based on.
    /// </summary>
    public sealed class FreeAgentFilters
    {
        /// <summary>Leave out workers whose deals elsewhere end soon (asks the engine again).</summary>
        public bool FreeAgentsOnly { get; set; }
        public string Role { get; set; }
        public string Gender { get; set; }
        public string Push { get; set; }
        public string Style { get; set; }
        public int? AgeMin { get; set; }
        public int? AgeMax { get; set; }
        public int? PopMin { get; set; }
        public string ContinentId { get; set; }

        public int Count =>
            (FreeAgentsOnly ? 1 : 0) + (Role != null ? 1 : 0) + (Gender != null ? 1 : 0) + (Push != null ? 1 : 0) + (Style != null ? 1 : 0) +
            (AgeMin.HasValue ? 1 : 0) + (AgeMax.HasValue ? 1 : 0) + (PopMin.HasValue ? 1 : 0) + (ContinentId != null ? 1 : 0);

        public void Clear()
        {
            FreeAgentsOnly = false;
            Role = Gender = Push = Style = ContinentId = null;
            AgeMin = AgeMax = PopMin = null;
        }

        public bool Keeps(JToken row) =>
            (Role == null || Kit.Arr(row, "roles").Any(role => (string)role == Role)) &&
            (Gender == null || Kit.Str(row, "gender") == Gender) &&
            (Push == null || Kit.Str(row, "pushExpectation") == Push) &&
            (Style == null || Kit.Str(row, "style") == Style) &&
            (!AgeMin.HasValue || (Kit.Num(row, "age") ?? 0) >= AgeMin.Value) &&
            (!AgeMax.HasValue || (Kit.Num(row, "age") ?? 0) <= AgeMax.Value) &&
            (!PopMin.HasValue || (Kit.Num(row, "popularityHere") ?? 0) >= PopMin.Value) &&
            (ContinentId == null || Kit.Str(row, "basedIn.continentId") == ContinentId);

        /// <summary>A whole number from 0 to <paramref name="max"/> typed in a field, or null.</summary>
        public static int? WholeNumber(string text, int max)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            string digits = new string(text.Where(char.IsDigit).ToArray());
            if (digits.Length == 0 || digits.Length > 3) return null;
            int value = int.Parse(digits, System.Globalization.CultureInfo.InvariantCulture);
            return value <= max ? value : (int?)null;
        }

        public void Build(VisualElement panel, IReadOnlyList<JToken> rows, Action changed, Action situationChanged)
        {
            panel.Add(new ContractUi.ChoiceGroup<bool>("Situation",
                new[] { (false, "Include ending soon", true, (string)null), (true, "Free agents only", true, (string)null) },
                FreeAgentsOnly, value => { FreeAgentsOnly = value; situationChanged(); }, "filter-situation"));
            panel.Add(ContractFilters.Group("Role", "Any role", ContractText.PersonRoles.Select(role => (role, ContractText.PersonRoleLabel(role))), Role, value => { Role = value; changed(); }, "filter-role"));
            panel.Add(ContractFilters.Group("Gender", "Any gender", ContractText.Genders.Select(gender => (gender, ContractText.GenderLabel(gender))), Gender, value => { Gender = value; changed(); }, "filter-gender"));
            panel.Add(ContractFilters.Group("Push expectation", "Any push", ContractText.PushLevels.Select(push => (push, ContractText.PushName(push))), Push, value => { Push = value; changed(); }, "filter-push"));
            panel.Add(ContractFilters.Group("Style", "Any style", ContractText.RingStyles.Select(style => (style, ContractText.StyleLabel(style))), Style, value => { Style = value; changed(); }, "filter-style"));

            VisualElement numbers = Ds.Row("ds-row--top", "ct-filter-numbers");
            var ageFrom = new ContractUi.Field("Age from", AgeMin?.ToString(), text => { AgeMin = WholeNumber(text, 120); changed(); }, placeholder: "Any", name: "filter-age-min");
            var ageTo = new ContractUi.Field("Age to", AgeMax?.ToString(), text => { AgeMax = WholeNumber(text, 120); changed(); }, placeholder: "Any", name: "filter-age-max");
            var pop = new ContractUi.Field("Your fans, at least", PopMin?.ToString(), text => { PopMin = WholeNumber(text, 100); changed(); }, placeholder: "0–100", name: "filter-pop-min");
            numbers.Add(ageFrom);
            numbers.Add(ageTo);
            numbers.Add(pop);
            panel.Add(numbers);

            var continents = rows
                .Select(row => (id: Kit.Str(row, "basedIn.continentId"), name: Kit.Str(row, "basedIn.continentName")))
                .Where(place => place.id != null)
                .GroupBy(place => place.id)
                .Select(group => (group.Key, group.First().name ?? group.Key))
                .OrderBy(place => place.Item2, StringComparer.Ordinal)
                .ToList();
            if (continents.Count > 1 || ContinentId != null)
            {
                panel.Add(ContractFilters.Group("Based in", "Anywhere", continents, ContinentId, value => { ContinentId = value; changed(); }, "filter-continent"));
            }
        }
    }
}
