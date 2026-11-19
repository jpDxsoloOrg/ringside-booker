using System;
using System.Collections.Generic;

namespace RingsideBooker.UI.Navigation
{
    /// <summary>
    /// Implemented by a game (bridge or demo) that wants to know where the player went, for
    /// example to mark something as seen when its screen opens. The shell subscribes an installed
    /// <see cref="Bridge.IShellData"/> or <see cref="Bridge.IDayControl"/> that implements it.
    /// </summary>
    public interface INavigationObserver
    {
        void OnNavigated(ShellRoute route);
    }

    /// <summary>The shell's current screen and its history (the web's router, in one class).</summary>
    public sealed class ShellNavigator
    {
        private const int MaxHistory = 50;
        private readonly List<ShellRoute> history = new List<ShellRoute>();

        /// <summary>The screen on show, or null before the first navigation.</summary>
        public ShellRoute Current { get; private set; }

        /// <summary>Raised after every navigation, with the new route.</summary>
        public event Action<ShellRoute> Navigated;

        public bool CanGoBack => history.Count > 0;

        public void Go(string screenId) => Go(ShellRoute.To(screenId));

        /// <summary>Shows <paramref name="route"/>. Going to the current route again re-opens it.</summary>
        public void Go(ShellRoute route)
        {
            if (route == null) return;
            if (Current != null)
            {
                history.Add(Current);
                if (history.Count > MaxHistory) history.RemoveAt(0);
            }
            Current = route;
            Navigated?.Invoke(route);
        }

        /// <summary>Back to the previous screen (Settings' back button). Returns false when there is none.</summary>
        public bool Back()
        {
            if (history.Count == 0) return false;
            ShellRoute previous = history[history.Count - 1];
            history.RemoveAt(history.Count - 1);
            Current = previous;
            Navigated?.Invoke(previous);
            return true;
        }
    }
}
