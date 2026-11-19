using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>The screen shown for a route with no registered builder: its name and the route it was asked for.</summary>
    public static class PlaceholderScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            string label = NavigationModel.ScreenLabel(context.Route.ScreenId);
            VisualElement card = Ui.El("card", "placeholder__card").With(
                Ui.Text(TextFormat.Upper("Not built yet"), "section-label"),
                Ui.Text($"The {label} screen hasn't been built in the Unity game yet. It arrives with the screen tickets; the shell already routes here.", "placeholder__body"),
                Ui.Text($"Route: {context.Route}", "placeholder__route"));
            return Ui.El("placeholder").Named($"screen-{context.Route.ScreenId}").With(
                Ui.Text(TextFormat.Upper(label), "screen-heading"),
                card);
        }
    }
}
