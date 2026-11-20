using RingsideBooker.Release;
using RingsideBooker.Saves;
using UnityEngine;

namespace RingsideBooker.UI.SaveUi
{
    /// <summary>
    /// Hands this build's version and channel (<see cref="ReleaseInfo"/>) to the Saves assembly,
    /// which cannot see it, so every slot header records the build that wrote it (POL9-10).
    /// </summary>
    internal static class SaveBuildHook
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Stamp()
        {
            SaveBuild.Set(ReleaseInfo.Version, ReleaseInfo.Channel);
        }
    }
}
