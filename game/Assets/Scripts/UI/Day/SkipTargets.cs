using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Bridge;

namespace RingsideBooker.UI.Day
{
    /// <summary>What one skip target asks for today: the advance, and a line under its label.</summary>
    public sealed class SkipTargetChoice
    {
        public SkipTargetChoice(AdvanceRequest request, string detail)
        {
            Request = request;
            Detail = detail;
        }

        public AdvanceRequest Request { get; }
        /// <summary>Shown under the label, for example "Mon 1 Feb 2027 · 28 days".</summary>
        public string Detail { get; }
    }

    /// <summary>
    /// One quick choice in the Skip days sheet's "How long": "7 days", "Until the 1st of next month",
    /// or a feature's own ("Until next show", order 5; "Until season end", order 50).
    /// </summary>
    public sealed class SkipTarget
    {
        public SkipTarget(string id, string label, int order, Func<GameDate, SkipTargetChoice> resolve)
        {
            Id = id;
            Label = label;
            Order = order;
            Resolve = resolve;
        }

        /// <summary>Unique, such as <c>days.7</c> or <c>month.next</c>. Remembered as the last choice.</summary>
        public string Id { get; }
        public string Label { get; }
        /// <summary>Its place among the chips, lowest first.</summary>
        public int Order { get; }
        /// <summary>What the target means today, or null to hide its chip.</summary>
        public Func<GameDate, SkipTargetChoice> Resolve { get; }
    }

    /// <summary>
    /// The Skip days sheet's registry of quick choices (the web's <c>skipTargets.ts</c>). Features add
    /// theirs with <see cref="Register"/>; the built-in 7/30/90 days and next month are always there.
    /// </summary>
    public static class SkipTargets
    {
        public const int MinSkipDays = 1;
        public const int MaxSkipDays = 3650;
        public const int DefaultSkipDays = 7;
        public const string DefaultTargetId = "days.7";

        private static readonly List<SkipTarget> Registered = new List<SkipTarget>();

        static SkipTargets()
        {
            foreach (SkipTarget target in BuiltIn()) Registered.Add(target);
        }

        /// <summary>Raised when a target is added or removed.</summary>
        public static event Action Changed;

        /// <summary>Adds a quick choice; returns an action that removes it. Throws when the id is taken.</summary>
        public static Action Register(SkipTarget target)
        {
            if (Registered.Any(existing => existing.Id == target.Id))
            {
                throw new InvalidOperationException($"A skip target with id \"{target.Id}\" is already registered.");
            }
            Registered.Add(target);
            Changed?.Invoke();
            return () =>
            {
                if (Registered.Remove(target)) Changed?.Invoke();
            };
        }

        /// <summary>Every registered target, lowest order first, then by id (ordinal).</summary>
        public static IReadOnlyList<SkipTarget> All() =>
            Registered.OrderBy(target => target.Order).ThenBy(target => target.Id, StringComparer.Ordinal).ToList();

        /// <summary>The targets that show a chip today, with what each asks for.</summary>
        public static IReadOnlyList<(SkipTarget target, SkipTargetChoice choice)> Resolve(GameDate today)
        {
            var resolved = new List<(SkipTarget, SkipTargetChoice)>();
            foreach (SkipTarget target in All())
            {
                SkipTargetChoice choice = target.Resolve(today);
                if (choice != null) resolved.Add((target, choice));
            }
            return resolved;
        }

        /// <summary>The first day of the month after <paramref name="today"/>.</summary>
        public static GameDate NextMonthStart(GameDate today) => today.AddMonths(1).StartOfMonth;

        /// <summary><c>{ maxDays: days }</c>, "to Mon 1 Feb 2027".</summary>
        public static SkipTargetChoice DaysChoice(GameDate today, int days) =>
            new SkipTargetChoice(new AdvanceRequest(days), $"to {today.AddDays(days).DayMonthYear}");

        /// <summary>Skips to the 1st of next month and stops there: "Mon 1 Feb 2027 · 1 day".</summary>
        public static SkipTargetChoice NextMonthChoice(GameDate today)
        {
            GameDate stopAt = NextMonthStart(today);
            int days = today.DaysUntil(stopAt);
            return new SkipTargetChoice(new AdvanceRequest(days, stopAt), $"{stopAt.DayMonthYear} · {TextFormat.DayCount(days)}");
        }

        private static IEnumerable<SkipTarget> BuiltIn()
        {
            yield return DaysTarget(7, 10);
            yield return DaysTarget(30, 20);
            yield return DaysTarget(90, 30);
            yield return new SkipTarget("month.next", "Until the 1st of next month", 40, NextMonthChoice);
        }

        private static SkipTarget DaysTarget(int days, int order) =>
            new SkipTarget($"days.{days}", TextFormat.DayCount(days), order, today => DaysChoice(today, days));

        /// <summary>The skip length typed, or null when it is not a whole number in range.</summary>
        public static int? ParseSkipLength(string text)
        {
            string trimmed = (text ?? string.Empty).Trim();
            if (trimmed.Length == 0 || !trimmed.All(char.IsDigit) || trimmed.Length > 6) return null;
            int days = int.Parse(trimmed);
            return days >= MinSkipDays && days <= MaxSkipDays ? days : (int?)null;
        }

        public static string SkipLengthMessage =>
            $"Enter a whole number of days from {MinSkipDays} to {TextFormat.Number(MaxSkipDays)}.";

        /// <summary>The stop date typed (YYYY-MM-DD), or a message saying what is wrong with it.</summary>
        public static bool CheckStopDate(string value, GameDate today, out GameDate date, out string message)
        {
            message = null;
            if (!GameDate.TryParse(value, out date))
            {
                message = "Pick the date to stop on (YYYY-MM-DD).";
                return false;
            }
            if (date <= today)
            {
                message = $"Pick a date after {today.Long}.";
                return false;
            }
            return true;
        }

        /// <summary>The chosen request with the extra stop date added when it comes first.</summary>
        public static AdvanceRequest SkipRequest(AdvanceRequest baseRequest, GameDate? extraStopAt)
        {
            if (baseRequest == null) return null;
            GameDate? stop = baseRequest.StopAtDate;
            if (extraStopAt.HasValue && (!stop.HasValue || extraStopAt.Value < stop.Value)) stop = extraStopAt;
            return new AdvanceRequest(baseRequest.MaxDays, stop);
        }

        /// <summary>The last day the advance can reach: maxDays on, or its stop date when that comes first.</summary>
        public static GameDate SkipUntil(GameDate today, AdvanceRequest request)
        {
            GameDate lastDay = today.AddDays(request.MaxDays);
            return request.StopAtDate.HasValue && request.StopAtDate.Value < lastDay ? request.StopAtDate.Value : lastDay;
        }
    }
}
