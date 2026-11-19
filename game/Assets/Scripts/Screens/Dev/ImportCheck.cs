using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Engine;
using RingsideBooker.Import;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using UnityEngine;
using UnityEngine.UIElements;
using Debug = UnityEngine.Debug;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// Workshop world import check (UNITY-12): run the player with
    /// <c>-rbImportCheck [all | itemId,itemId…]</c> and it imports every installed workshop world mod
    /// (or the listed ones) the way New game's import sub-screen does, logging one
    /// <c>[ImportCheck]</c> line per mod with item id, counts, warning codes and timings, or the
    /// failure's reason codes (never a mod's names). Add-on mods with no people or promotions are
    /// listed as "not a world" and skipped. With <c>-rbImportCheckShots &lt;folder&gt;</c> the first
    /// mod goes through the real sub-screen (list, import, report, back to New game with it
    /// selected) with a PNG at each step. Quits with exit 0 when every world mod imported, else 1.
    /// </summary>
    public sealed class ImportCheck : MonoBehaviour
    {
        public const string Argument = "-rbImportCheck";
        public const string ShotsArgument = "-rbImportCheckShots";

        private HashSet<string> items;
        private string shots;
        private int shotIndex;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.FindIndex(args, arg => string.Equals(arg, Argument, StringComparison.OrdinalIgnoreCase));
            if (at < 0 || Application.isBatchMode) return;
            var host = new GameObject("ImportCheck");
            DontDestroyOnLoad(host);
            ImportCheck check = host.AddComponent<ImportCheck>();
            string list = at + 1 < args.Length && !args[at + 1].StartsWith("-", StringComparison.Ordinal) ? args[at + 1] : "all";
            if (!string.Equals(list, "all", StringComparison.OrdinalIgnoreCase))
            {
                check.items = new HashSet<string>(list.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(item => item.Trim()));
            }
            int shotsAt = Array.FindIndex(args, arg => string.Equals(arg, ShotsArgument, StringComparison.OrdinalIgnoreCase));
            if (shotsAt >= 0 && shotsAt + 1 < args.Length) check.shots = args[shotsAt + 1];
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 900f);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Active == null) yield return null;
            yield return new WaitForSecondsRealtime(1f);
            NewGameWizard wizard = NewGameWizard.Active;

            Task<IReadOnlyList<WorkshopMod>> scan = wizard.OpenImportAndScan();
            yield return Await(scan);
            List<WorkshopMod> mods = (scan.Result ?? new List<WorkshopMod>())
                .Where(mod => items == null || items.Contains(mod.ItemId)).ToList();
            Debug.Log($"[ImportCheck] {mods.Count} mods to check ({mods.Count(mod => mod.IsWorld)} worlds)");

            int passed = 0;
            int failed = 0;
            bool first = true;
            Task<EngineClient> clientTask = EngineRuntime.GetClientAsync();
            yield return Await(clientTask);
            EngineClient client = clientTask.Result;
            foreach (WorkshopMod mod in mods.OrderBy(mod => mod.SizeBytes))
            {
                if (!mod.IsWorld)
                {
                    Debug.Log($"[ImportCheck] item {mod.ItemId}: not a world ({mod.PeopleCount} people, {mod.PromotionCount} promotions), skipped");
                    continue;
                }
                var clock = Stopwatch.StartNew();
                WorldModImportResult result;
                if (first && shots != null)
                {
                    // Through the sub-screen, with pictures of each step.
                    first = false;
                    wizard.PickMod(mod.ItemId);
                    yield return Capture("import-list");
                    Task<WorldModImportResult> run = wizard.RunImport();
                    yield return new WaitForSecondsRealtime(0.3f);
                    yield return Capture("import-running");
                    yield return Await(run);
                    result = run.Result;
                    yield return new WaitForSecondsRealtime(0.5f);
                    yield return Capture(result != null && result.Ok ? "import-report" : "import-failed");
                    if (result != null && result.Ok)
                    {
                        Click("import-use");
                        float until = Time.realtimeSinceStartup + 20f;
                        while (wizard.SelectedWorldId != mod.PackId && Time.realtimeSinceStartup < until) yield return null;
                        yield return new WaitForSecondsRealtime(0.5f);
                        Debug.Log($"[ImportCheck] back on New game, selected world is {(wizard.SelectedWorldId == mod.PackId ? "the imported one" : "NOT the imported one")}");
                        yield return Capture("new-game-imported-selected");
                        if (wizard.SelectedWorldId != mod.PackId) result = null;
                    }
                }
                else
                {
                    Task<WorldModImportResult> run = WorkshopWorlds.ImportAsync(client, mod, false);
                    yield return Await(run);
                    result = run.Result;
                    // Free the converted world again: the check holds one at a time.
                    yield return Await(client.RemoveImportedWorld(mod.PackId));
                }
                if (result != null && result.Ok)
                {
                    passed++;
                    Debug.Log($"[ImportCheck] item {mod.ItemId}: OK, {result.Counts?["person"]} people, {result.Counts?["promotion"]} promotions, " +
                              $"{WorkshopWorlds.WarningCodes(result)}; {clock.Elapsed.TotalSeconds:0.0} s");
                }
                else
                {
                    failed++;
                    Debug.LogError($"[ImportCheck] item {mod.ItemId}: FAILED {(result == null ? "no result" : result.ReasonCodes)}");
                }
            }
            // The failure screen: an add-on mod (no people or promotions) forced through the import.
            WorkshopMod addOn = mods.FirstOrDefault(mod => !mod.IsWorld);
            if (shots != null && addOn != null)
            {
                Task<IReadOnlyList<WorkshopMod>> reopen = wizard.OpenImportAndScan();
                yield return Await(reopen);
                wizard.PickMod(addOn.ItemId);
                Task<WorldModImportResult> run = wizard.RunImport(evenIfNotAWorld: true);
                yield return Await(run);
                yield return new WaitForSecondsRealtime(0.5f);
                yield return Capture("import-failed-add-on");
                Debug.Log($"[ImportCheck] add-on item {addOn.ItemId} forced (expected to fail): {(run.Result == null ? "no result" : run.Result.Ok ? "imported" : run.Result.ReasonCodes)}");
            }
            Debug.Log($"[ImportCheck] {(failed == 0 ? "PASSED" : "FAILED")}: {passed} imported, {failed} failed");
            Application.Quit(failed == 0 ? 0 : 1);
        }

        private void GiveUp()
        {
            Debug.LogError("[ImportCheck] timed out");
            Application.Quit(1);
        }

        private static void Click(string name)
        {
            var document = FindAnyObjectByType<UIDocument>();
            Button button = document?.rootVisualElement.Q<Button>(name);
            if (button == null)
            {
                Debug.LogWarning($"[ImportCheck] no button {name}");
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static IEnumerator Await(Task task)
        {
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted) Debug.LogException(task.Exception);
        }

        private IEnumerator Capture(string name)
        {
            if (shots == null) yield break;
            Directory.CreateDirectory(shots);
            yield return new WaitForEndOfFrame();
            shotIndex++;
            string path = Path.Combine(shots, $"{shotIndex:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[ImportCheck] {path}");
        }
    }
}
