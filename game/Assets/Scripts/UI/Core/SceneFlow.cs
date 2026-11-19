using UnityEngine;
using UnityEngine.SceneManagement;

namespace RingsideBooker.UI
{
    /// <summary>The game's scenes and how to move between them: Boot → Title → Game.</summary>
    public static class SceneFlow
    {
        public const string TitleScene = "Title";
        public const string GameScene = "Game";

        public static void LoadTitle() => SceneManager.LoadScene(TitleScene);

        public static void LoadGame() => SceneManager.LoadScene(GameScene);

        /// <summary>Quits the player (stops play mode in the editor).</summary>
        public static void Quit()
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }
    }
}
