using System;
using System.Collections.Generic;
using RingsideBooker.UI.Shell;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Navigation
{
    /// <summary>What a screen gets when the shell builds it.</summary>
    public sealed class ScreenContext
    {
        public ScreenContext(ShellRoute route, ShellNavigator navigator, OverlayLayer overlay)
        {
            Route = route;
            Navigator = navigator;
            Overlay = overlay;
        }

        /// <summary>The route that opened the screen (screen id and parameters such as <c>tab</c>).</summary>
        public ShellRoute Route { get; }
        /// <summary>Navigate elsewhere in the shell.</summary>
        public ShellNavigator Navigator { get; }
        /// <summary>The root overlay layer, for the screen's own sheets and dialogs.</summary>
        public OverlayLayer Overlay { get; }
    }

    /// <summary>
    /// Screen id → builder. A screen is a function that returns the <see cref="VisualElement"/> drawn
    /// in the shell's content area. Register real screens here (UNITY-09 and later); every nav item
    /// or other screen id without a builder shows <see cref="PlaceholderScreen"/>.
    /// </summary>
    public static class ScreenRegistry
    {
        private static readonly Dictionary<string, Func<ScreenContext, VisualElement>> Builders =
            new Dictionary<string, Func<ScreenContext, VisualElement>>();

        static ScreenRegistry()
        {
            Register(ScreenIds.Settings, context => SettingsScreen.Build(context));
        }

        /// <summary>Registers (or replaces) the builder for <paramref name="screenId"/>.</summary>
        public static void Register(string screenId, Func<ScreenContext, VisualElement> build)
        {
            Builders[screenId] = build ?? throw new ArgumentNullException(nameof(build));
        }

        public static bool IsLive(string screenId) => Builders.ContainsKey(screenId);

        /// <summary>Builds the screen for a route: its registered builder, or the placeholder.</summary>
        public static VisualElement Build(ScreenContext context)
        {
            return Builders.TryGetValue(context.Route.ScreenId, out Func<ScreenContext, VisualElement> build)
                ? build(context)
                : PlaceholderScreen.Build(context);
        }
    }
}
