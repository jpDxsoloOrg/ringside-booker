using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Draft
{
    /// <summary>
    /// The draft room (DRF-02): a new game that starts with a draft opens here, before day 1, and
    /// the day button's "Finish the draft" stop (<c>draft.unfinished</c>, hint <c>draft</c>) comes
    /// back here. Route: <c>draft</c>. The screen registers itself and, when a game opens with a
    /// draft still running (a new game, or a save made mid-draft), goes straight to it.
    /// </summary>
    public static class DraftScreen
    {
        public const string ScreenId = ScreenIds.Draft;

        /// <summary>The screen built last (the tour reads it).</summary>
        public static DraftView Current { get; private set; }

        /// <summary>
        /// True while the open game's draft is running or waiting to be finished, as last read
        /// (DRF-10). A worker profile opened from the draft board hides contract and trade actions
        /// then: picks are made in the draft room.
        /// </summary>
        public static bool InProgress { get; private set; }

        /// <summary>Records the draft's status as a screen last read it.</summary>
        internal static void Saw(string status) => InProgress = status == "running" || status == "complete";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
            ShellController.Opened -= OpenIfDrafting;
            ShellController.Opened += OpenIfDrafting;
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new DraftView(context);
            Current = view;
            return view.Root;
        }

        /// <summary>When the shell opens on a game whose draft is not finished, the draft room comes first.</summary>
        private static async void OpenIfDrafting(ShellController shell)
        {
            EngineGame game = EngineGame.Current;
            if (game == null || shell == null) return;
            try
            {
                QueryResult<JToken> state = await game.Client.Query("draft.state", new JObject { ["recent"] = 1 });
                string status = state.Ok ? Kit.Str(state.Data, "draft.status") : null;
                Saw(status);
                if ((status == "running" || status == "complete") && ShellController.Current == shell && shell.Navigator.Current?.ScreenId != ScreenId)
                {
                    shell.Navigator.Go(ScreenId);
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Draft] checking for a draft failed ({exception.GetType().Name})");
            }
        }

        private static StyleSheet sheet;

        /// <summary>Adds the screen's stylesheet (Resources/Draft/Draft.uss); sheets in the overlay layer need their own.</summary>
        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Draft/Draft");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }
    }

    /// <summary>
    /// The pool's portraits: picture refs by person, read once per game with <c>workers.list</c>,
    /// and only when the world has pictures (a workshop world). The built-in worlds paint monograms.
    /// </summary>
    internal static class DraftPictures
    {
        private static EngineGame loadedFor;
        private static Task loading;
        private static readonly Dictionary<string, string> ImageRefs = new Dictionary<string, string>();

        public static Task EnsureAsync(EngineGame game)
        {
            if (game == null) return Task.CompletedTask;
            if (loadedFor == game && loading != null) return loading;
            loadedFor = game;
            ImageRefs.Clear();
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            loading = pictures == null ? Task.CompletedTask : Load(game);
            return loading;
        }

        private static async Task Load(EngineGame game)
        {
            QueryResult<JToken> list = await game.Client.Query("workers.list");
            if (!list.Ok) return;
            foreach (JToken row in Kit.Arr(list.Data, "rows"))
            {
                string id = Kit.Str(row, "personId");
                string imageRef = Kit.Str(row, "imageRef");
                if (id != null && !string.IsNullOrEmpty(imageRef)) ImageRefs[id] = imageRef;
            }
        }

        public static string ImageRef(string personId) =>
            personId != null && ImageRefs.TryGetValue(personId, out string imageRef) ? imageRef : null;
    }
}
