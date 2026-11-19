using RingsideBooker.UI.Navigation;
using UnityEngine;

namespace RingsideBooker.Screens
{
    /// <summary>Registers the core loop screens with the shell (UNITY-09).</summary>
    public static class ScreensSetup
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        public static void Register()
        {
            ScreenRegistry.Register(NavigationModel.HomeItemId, OfficeScreen.Build);
            ScreenRegistry.Register("roster", RosterScreen.Build);
            ScreenRegistry.Register("calendar", CalendarScreen.Build);
            ScreenRegistry.Register("booking", BookingScreen.Build);
            ScreenRegistry.Register(ScreenIds.ShowNight, ShowNightScreen.Build);
            ScreenRegistry.Register(ScreenIds.ShowResults, ResultsScreen.Build);
        }
    }
}
