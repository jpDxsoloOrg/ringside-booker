using System;
using System.IO;
using System.Linq;
using RingsideBooker;
using RingsideBooker.Release;
using UnityEditor.Build;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Batch-mode entry points, called from game/tools/*.sh with -executeMethod.
/// </summary>
public static class BuildScripts
{
    public const string BootScenePath = "Assets/Scenes/Boot.unity";
    private const string WindowsOutput = "Builds/Windows/RingsideBooker.exe";

    public const string VersionArgument = "-rbVersion";
    private const string LicensesFolder = "Assets/StreamingAssets/licenses";
    private const string VersionFile = "Assets/StreamingAssets/" + ReleaseInfo.FileName;
    private const string ChangelogCopy = "Assets/StreamingAssets/" + ReleaseNotes.FileName;
    private const string IconFolder = "Assets/UI/AppIcon";

    /// <summary>Product name in the player settings (window, exe details, persistentDataPath).</summary>
    public const string ProductName = "Ringside Booker";

    /// <summary>
    /// Company name. It is also the persistentDataPath folder (LocalLow/&lt;company&gt;/&lt;product&gt;)
    /// where saves and PlayerPrefs live, so changing it would hide every tester's saves.
    /// </summary>
    public const string CompanyName = "jpDxsolo";

    /// <summary>
    /// Builds the Windows 64-bit player to game/Builds/Windows/RingsideBooker.exe. The version
    /// (<c>Application.version</c>) comes from StreamingAssets/version.json when the package script
    /// wrote one, else from <c>-rbVersion &lt;v&gt;</c>, else the project's bundleVersion; it is set
    /// for the build only. The identity (product, company, icon) is applied, the third-party
    /// notices are staged into StreamingAssets/licenses and the repo's CHANGELOG.md into
    /// StreamingAssets (What's new reads it), and no source map ships in the player.
    /// </summary>
    public static void BuildWindows()
    {
        EnsureBootScene();

        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string outputPath = Path.Combine(projectRoot, WindowsOutput);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
        string version = VersionFromFile(projectRoot) ?? CommandLineValue(VersionArgument) ?? PlayerSettings.bundleVersion;

        if (!File.Exists(Path.Combine(Application.streamingAssetsPath, "engine", "engine.js")))
        {
            Debug.LogError("[BuildScripts] StreamingAssets/engine/engine.js is missing: build the engine bundle first " +
                           "(npm run build:engine-bundle, or game/tools/package-windows.sh)");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        StageLicenses(projectRoot);
        StageChangelog(projectRoot);
        ApplyIdentity();

        var options = new BuildPlayerOptions
        {
            scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray(),
            locationPathName = outputPath,
            target = BuildTarget.StandaloneWindows64,
            targetGroup = BuildTargetGroup.Standalone,
            options = BuildOptions.None,
        };

        string savedVersion = PlayerSettings.bundleVersion;
        BuildReport report;
        try
        {
            PlayerSettings.bundleVersion = version;
            report = BuildPipeline.BuildPlayer(options);
        }
        finally
        {
            PlayerSettings.bundleVersion = savedVersion;
            AssetDatabase.SaveAssets();
        }
        BuildSummary summary = report.summary;
        if (summary.result == BuildResult.Succeeded) RemoveSourceMaps(outputPath);
        Debug.Log($"[BuildScripts] Windows build {summary.result}: {summary.outputPath} version {version} " +
                  $"({summary.totalSize} bytes, {summary.totalErrors} errors, {summary.totalTime})");

        if (Application.isBatchMode)
        {
            EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
        }
    }

    /// <summary>The version in StreamingAssets/version.json (written by package-windows.sh), or null.</summary>
    private static string VersionFromFile(string projectRoot)
    {
        string path = Path.Combine(projectRoot, VersionFile);
        if (!File.Exists(path)) return null;
        ReleaseInfo.Stamp stamp = ReleaseInfo.Stamp.Parse(File.ReadAllText(path), null);
        if (string.IsNullOrEmpty(stamp.Version) || stamp.Channel == ReleaseInfo.ChannelLocal)
        {
            Debug.LogWarning($"[BuildScripts] {VersionFile} has no version or channel; ignoring it");
            return null;
        }
        Debug.Log($"[BuildScripts] Version {stamp.Version} ({stamp.Channel}) from {VersionFile}");
        return stamp.Version;
    }

    /// <summary>
    /// The game's identity in the player settings (POL9-10): product and company name and the app
    /// icon (Assets/UI/AppIcon, rendered by game/tools/icon/build-app-icon.mjs) for every size the
    /// Windows player asks for, plus the default icon. Saves the project settings.
    /// </summary>
    [MenuItem("Ringside Booker/Apply Game Identity")]
    public static void ApplyIdentity()
    {
        PlayerSettings.productName = ProductName;
        PlayerSettings.companyName = CompanyName;

        Texture2D largest = LoadIcon(256);
        if (largest == null)
        {
            Debug.LogWarning($"[BuildScripts] No app icon in {IconFolder}; the player keeps Unity's icon");
            return;
        }
        PlayerSettings.SetIcons(NamedBuildTarget.Unknown, new[] { largest }, IconKind.Any);
        int[] sizes = PlayerSettings.GetIconSizes(NamedBuildTarget.Standalone, IconKind.Application);
        Texture2D[] icons = sizes.Select(size => LoadIcon(size) ?? largest).ToArray();
        PlayerSettings.SetIcons(NamedBuildTarget.Standalone, icons, IconKind.Application);
        AssetDatabase.SaveAssets();
        Debug.Log($"[BuildScripts] Identity: {ProductName} by {CompanyName}, icon sizes {string.Join(",", sizes)}");
    }

    /// <summary>AppIcon-&lt;size&gt;.png, or the nearest larger size, or null.</summary>
    private static Texture2D LoadIcon(int size)
    {
        int[] available = { 16, 32, 48, 64, 128, 256, 512, 1024 };
        foreach (int candidate in available.Where(each => each >= size))
        {
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>($"{IconFolder}/AppIcon-{candidate}.png");
            if (texture != null) return texture;
        }
        return null;
    }

    /// <summary>Copies the repo's CHANGELOG.md into StreamingAssets (generated, gitignored) for What's new.</summary>
    [MenuItem("Ringside Booker/Stage Changelog")]
    public static void StageChangelog() => StageChangelog(Directory.GetParent(Application.dataPath).FullName);

    private static void StageChangelog(string projectRoot)
    {
        string source = Path.GetFullPath(Path.Combine(projectRoot, "..", ReleaseNotes.FileName));
        string target = Path.Combine(projectRoot, ChangelogCopy);
        if (!File.Exists(source))
        {
            Debug.LogWarning($"[BuildScripts] {source} is missing; What's new will be empty");
            return;
        }
        File.Copy(source, target, true);
        AssetDatabase.Refresh();
        Debug.Log($"[BuildScripts] Staged {ReleaseNotes.FileName} in StreamingAssets");
    }

    /// <summary>The value after <paramref name="name"/> on the command line, or null.</summary>
    private static string CommandLineValue(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int index = 0; index < args.Length - 1; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        }
        return null;
    }

    /// <summary>
    /// Copies the third-party notices (game/docs/licenses, the ClearScript and SQLite plugin notes,
    /// the fonts' OFL texts) into StreamingAssets/licenses, which is generated and gitignored.
    /// </summary>
    [MenuItem("Ringside Booker/Stage Licence Notices")]
    public static void StageLicenses() => StageLicenses(Directory.GetParent(Application.dataPath).FullName);

    private static void StageLicenses(string projectRoot)
    {
        string target = Path.Combine(projectRoot, LicensesFolder);
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.CreateDirectory(target);
        string[] sources =
        {
            "docs/licenses/THIRD-PARTY-NOTICES.txt",
            "Assets/Plugins/ClearScript/LICENSE-ClearScript.txt",
            "Assets/Plugins/Sqlite/README-sqlite.txt",
            "Assets/UI/Fonts/OFL-BarlowCondensed.txt",
            "Assets/UI/Fonts/OFL-Inter.txt",
        };
        foreach (string source in sources)
        {
            string path = Path.Combine(projectRoot, source);
            if (!File.Exists(path)) throw new FileNotFoundException($"Licence notice missing: {source}", path);
            File.Copy(path, Path.Combine(target, Path.GetFileName(path)), true);
        }
        AssetDatabase.Refresh();
        Debug.Log($"[BuildScripts] Staged {sources.Length} licence notices in {LicensesFolder}");
    }

    /// <summary>Deletes every *.map the player's StreamingAssets got (the engine bundle's source map).</summary>
    private static void RemoveSourceMaps(string exePath)
    {
        string dataFolder = Path.Combine(Path.GetDirectoryName(exePath), Path.GetFileNameWithoutExtension(exePath) + "_Data", "StreamingAssets");
        if (!Directory.Exists(dataFolder)) return;
        foreach (string map in Directory.GetFiles(dataFolder, "*.map", SearchOption.AllDirectories))
        {
            File.Delete(map);
            Debug.Log($"[BuildScripts] Removed {map} from the player");
        }
    }

    /// <summary>
    /// Creates Assets/Scenes/Boot.unity (a single GameObject with the Boot behaviour) if it
    /// is missing, and makes it the first enabled scene in the build settings.
    /// </summary>
    [MenuItem("Ringside Booker/Ensure Boot Scene")]
    public static void EnsureBootScene()
    {
        if (!File.Exists(BootScenePath))
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var bootObject = new GameObject("Boot");
            bootObject.AddComponent<Boot>();
            Directory.CreateDirectory(Path.GetDirectoryName(BootScenePath));
            if (!EditorSceneManager.SaveScene(scene, BootScenePath))
            {
                throw new InvalidOperationException($"Could not save {BootScenePath}");
            }
            Debug.Log($"[BuildScripts] Created {BootScenePath}");
        }

        EditorBuildSettingsScene[] current = EditorBuildSettings.scenes;
        if (current.Length == 0 || current[0].path != BootScenePath || !current[0].enabled)
        {
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(BootScenePath, true) }
                .Concat(current.Where(scene => scene.path != BootScenePath))
                .ToArray();
            Debug.Log($"[BuildScripts] {BootScenePath} set as the first build scene");
        }

        AssetDatabase.SaveAssets();
    }
}
