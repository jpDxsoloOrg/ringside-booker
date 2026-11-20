using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens.Schedule;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;

namespace RingsideBooker.Tests.Schedule
{
    /// <summary>
    /// EVT8: the schedule editor's pure pieces. The recurrence the builder sends to the engine, the
    /// date field and number stepper rules, and the drafts the sheets save (never minutes, D-10).
    /// </summary>
    public sealed class ScheduleEditorTests
    {
        private static readonly GameDate Monday = new GameDate(2027, 1, 4);

        [Test]
        public void WeeklyRecurrenceListsWeekdaysMondayFirst()
        {
            var value = new RecurrenceValue { Kind = RecurrenceValue.Weekly, Weekdays = new List<int> { 4 } };
            value.ToggleWeekday(0);
            JObject json = value.ToJson();
            Assert.That((string)json["kind"], Is.EqualTo("weekly"));
            Assert.That(json["weekdays"].Select(day => (int)day), Is.EqualTo(new[] { 0, 4 }));
        }

        [Test]
        public void TheLastWeekdayOfAWeeklyShowStaysOn()
        {
            var value = new RecurrenceValue { Kind = RecurrenceValue.Weekly, Weekdays = new List<int> { 4 } };
            value.ToggleWeekday(4);
            Assert.That(value.Weekdays, Is.EqualTo(new[] { 4 }));
        }

        [Test]
        public void EveryFewWeeksGetsAStartDateOnItsWeekday()
        {
            var value = new RecurrenceValue { Kind = RecurrenceValue.Weekly, Weekdays = new List<int> { 2 } };
            value.SwitchTo(RecurrenceValue.EveryNWeeks, Monday);
            JObject json = value.ToJson();
            Assert.That((string)json["kind"], Is.EqualTo("everyNWeeks"));
            Assert.That((int)json["weekday"], Is.EqualTo(2));
            Assert.That((string)json["anchor"], Is.EqualTo("2027-01-06"));
            value.SetWeekday(5, Monday);
            Assert.That(value.Anchor, Is.EqualTo("2027-01-09"));
        }

        [Test]
        public void MonthlyAndYearlySendTheWeekAsTheEngineWantsIt()
        {
            var monthly = new RecurrenceValue { Kind = RecurrenceValue.Monthly, Week = "last", Weekday = 6 };
            Assert.That(JToken.DeepEquals(monthly.ToJson(), JObject.Parse("{\"kind\":\"monthly\",\"week\":\"last\",\"weekday\":6}")), Is.True);
            var annual = new RecurrenceValue { Kind = RecurrenceValue.Annual, Week = "2", Weekday = 5, Month = 6 };
            Assert.That(JToken.DeepEquals(annual.ToJson(), JObject.Parse("{\"kind\":\"annual\",\"month\":6,\"week\":2,\"weekday\":5}")), Is.True);
        }

        [Test]
        public void RecurrenceRoundTripsThroughJson()
        {
            JObject stored = JObject.Parse("{\"kind\":\"everyNWeeks\",\"intervalWeeks\":3,\"weekday\":2,\"anchor\":\"2027-01-06\"}");
            Assert.That(JToken.DeepEquals(RecurrenceValue.FromJson(stored).ToJson(), stored), Is.True);
            JObject dates = JObject.Parse("{\"kind\":\"dates\",\"dates\":[\"2027-02-01\"]}");
            Assert.That(JToken.DeepEquals(RecurrenceValue.FromJson(dates).ToJson(), dates), Is.True);
        }

        [Test]
        public void DateFieldRefusesDatesOutsideItsRange()
        {
            GameDate max = Monday.AddDays(30);
            Assert.That(DateField.Check("2027-01-10", Monday, max, out GameDate ok), Is.Null);
            Assert.That(ok, Is.EqualTo(new GameDate(2027, 1, 10)));
            Assert.That(DateField.Check("2027-01-03", Monday, max, out _), Is.EqualTo("Pick a date from Mon 4 Jan 2027"));
            Assert.That(DateField.Check("2027-03-01", Monday, max, out _), Does.StartWith("Pick a date up to"));
            Assert.That(DateField.Check("next friday", Monday, max, out _), Is.EqualTo("Type the date as YYYY-MM-DD"));
        }

        [Test]
        public void StepperAcceptsTypedValuesOutsideTheRangeButStepsBackIn()
        {
            Assert.That(NumberStepper.TryParse(" 2 ", out int typed), Is.True);
            Assert.That(typed, Is.EqualTo(2));
            Assert.That(NumberStepper.TryParse("two", out _), Is.False);
            Assert.That(NumberStepper.Step(2, 1, 3, 12), Is.EqualTo(3));
            Assert.That(NumberStepper.Step(12, 1, 3, 12), Is.EqualTo(12));
            Assert.That(NumberStepper.Step(6, -1, 3, 12), Is.EqualTo(5));
        }

        private static readonly List<ImportanceChoice> Sizes = new List<ImportanceChoice>
        {
            new ImportanceChoice { Importance = "regular", Label = "Weekly TV", Slots = 6, PreShowSlots = 0 },
            new ImportanceChoice { Importance = "major", Label = "Major event", Slots = 8, PreShowSlots = 1 },
        };

        [Test]
        public void TheSizeSetsTheCardUntilSlotsAreChangedByHand()
        {
            var draft = new RecurringDraft { Name = "Test Friday" };
            draft.SetImportance("major", Sizes);
            Assert.That((draft.Slots, draft.PreShowSlots), Is.EqualTo((8, 1)));
            draft.Slots = 9;
            draft.FormatTouched = true;
            draft.SetImportance("regular", Sizes);
            Assert.That(draft.Slots, Is.EqualTo(9));
            Assert.That((string)draft.ToJson()["importance"], Is.EqualTo("regular"));
        }

        [Test]
        public void ARecurringDraftIsTheEnginesDraftWithNoLength()
        {
            var draft = new RecurringDraft { Name = "Test Friday", Slots = 5 };
            draft.Recurrence = new RecurrenceValue { Kind = RecurrenceValue.Weekly, Weekdays = new List<int> { 4 } };
            JObject json = draft.ToJson();
            Assert.That(json.Properties().Select(property => property.Name), Is.EquivalentTo(new[]
            {
                "name", "brandId", "importance", "recurrence", "format", "televised", "preferredRegionId", "preferredVenueId",
            }));
            Assert.That((int)json["format"]["slots"], Is.EqualTo(5));
            Assert.That(json.ToString().ToLowerInvariant(), Does.Not.Contain("minute").And.Not.Contain("length"));
        }

        [Test]
        public void AnEditDiffersOnlyWhenSomethingChanged()
        {
            JObject row = JObject.Parse("{\"name\":\"Test Weekly\",\"brandId\":null,\"importance\":\"regular\",\"recurrence\":{\"kind\":\"weekly\",\"weekdays\":[0]},\"format\":{\"slots\":6,\"preShowSlots\":0},\"televised\":true,\"preferredRegionId\":null,\"preferredVenueId\":null}");
            RecurringDraft stored = RecurringDraft.FromRow(row);
            RecurringDraft edit = RecurringDraft.FromRow(row);
            Assert.That(edit.DiffersFrom(stored), Is.False);
            edit.Name = " Test Weekly ";
            Assert.That(edit.DiffersFrom(stored), Is.False);
            edit.Recurrence.SwitchTo(RecurrenceValue.EveryNWeeks, Monday);
            Assert.That(edit.DiffersFrom(stored), Is.True);
        }

        [Test]
        public void ASpecialDefaultsToASaturdayAtLeastTwoWeeksOut()
        {
            GameDate date = SpecialDraft.DefaultDate(Monday);
            Assert.That(date, Is.EqualTo(new GameDate(2027, 1, 23)));
            var special = new SpecialDraft { Name = "Test Bash", Date = date.Iso };
            JObject json = special.ToJson("pro_1");
            Assert.That((string)json["date"], Is.EqualTo("2027-01-23"));
            Assert.That((int)json["format"]["preShowSlots"], Is.EqualTo(1));
        }

        [Test]
        public void ReasonsLandUnderTheirFields()
        {
            FieldReasons reasons = FieldReasons.FromJson(JArray.Parse(
                "[{\"field\":\"format.slots\",\"message\":\"A show needs at least 3 slots\"},{\"field\":\"preferredRegionId\",\"message\":\"That region is not on the map\"},{\"message\":\"You can only change your own shows\"}]"));
            Assert.That(reasons.Count, Is.EqualTo(3));
            Assert.That(reasons.For("format.slots"), Is.EqualTo("A show needs at least 3 slots"));
            Assert.That(reasons.Others(new[] { "format.slots" }), Is.EquivalentTo(new[] { "You can only change your own shows", "That region is not on the map" }));
        }
    }
}
