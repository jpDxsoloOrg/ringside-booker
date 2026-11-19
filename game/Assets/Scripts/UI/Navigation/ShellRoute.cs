using System;
using System.Collections.Generic;
using System.Text;

namespace RingsideBooker.UI.Navigation
{
    /// <summary>
    /// Where the shell shows a screen: a screen id (a nav item id such as <c>contracts</c>, or one of
    /// <see cref="ScreenIds"/> for screens outside the sidebar) and optional parameters, the
    /// equivalent of the web's path plus query (<c>/game/contracts?tab=offers</c>).
    /// </summary>
    public sealed class ShellRoute : IEquatable<ShellRoute>
    {
        private static readonly IReadOnlyDictionary<string, string> NoParams = new Dictionary<string, string>();

        public ShellRoute(string screenId, IReadOnlyDictionary<string, string> parameters = null)
        {
            ScreenId = screenId ?? throw new ArgumentNullException(nameof(screenId));
            Parameters = parameters ?? NoParams;
        }

        public string ScreenId { get; }
        public IReadOnlyDictionary<string, string> Parameters { get; }

        public string Param(string key) => Parameters.TryGetValue(key, out string value) ? value : null;

        /// <summary>A route with parameters given as key, value pairs: <c>With("contracts", "tab", "offers")</c>.</summary>
        public static ShellRoute With(string screenId, params string[] keyValues)
        {
            var parameters = new Dictionary<string, string>();
            for (int index = 0; index + 1 < keyValues.Length; index += 2)
            {
                if (keyValues[index + 1] != null) parameters[keyValues[index]] = keyValues[index + 1];
            }
            return new ShellRoute(screenId, parameters);
        }

        public static ShellRoute To(string screenId) => new ShellRoute(screenId);

        /// <summary><c>contracts?tab=offers</c>, for logs and the placeholder screens.</summary>
        public override string ToString()
        {
            if (Parameters.Count == 0) return ScreenId;
            var builder = new StringBuilder(ScreenId).Append('?');
            bool first = true;
            foreach (KeyValuePair<string, string> pair in Parameters)
            {
                if (!first) builder.Append('&');
                builder.Append(pair.Key).Append('=').Append(pair.Value);
                first = false;
            }
            return builder.ToString();
        }

        public bool Equals(ShellRoute other)
        {
            if (other is null || other.ScreenId != ScreenId || other.Parameters.Count != Parameters.Count) return false;
            foreach (KeyValuePair<string, string> pair in Parameters)
            {
                if (other.Param(pair.Key) != pair.Value) return false;
            }
            return true;
        }

        public override bool Equals(object obj) => obj is ShellRoute other && Equals(other);
        public override int GetHashCode() => ScreenId.GetHashCode();
    }

    /// <summary>Screen ids that are not sidebar items (the web's other routes).</summary>
    public static class ScreenIds
    {
        public const string Settings = "settings";
        public const string ShowNight = "show-night";
        public const string ShowResults = "show-results";
        public const string Worker = "worker";
        public const string Promotion = "promotion";
    }
}
