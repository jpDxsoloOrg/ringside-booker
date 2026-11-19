using System;
using System.IO;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;
using UnityEngine;

namespace RingsideBooker.Engine
{
    /// <summary>
    /// Runs the embedded engine bundle (<c>StreamingAssets/engine/engine.js</c>) in a V8 runtime
    /// (ClearScript) and calls its JSON API, <c>globalThis.RingsideEngine</c>
    /// (see game/docs/engine-host.md and game/docs/runtime.md).
    ///
    /// Every argument and result is a JSON string, exactly as the bundle defines them; this class
    /// does not parse them. Calls are serialised with a lock, so a host can be used from any one
    /// thread at a time (a dedicated engine thread is the intended use; a year's advance takes
    /// seconds). The async host functions (<c>load</c>, <c>save</c>, <c>inspectSave</c>,
    /// <c>advanceDays</c>) are settled before <see cref="CallAsync"/> returns: they wait only on
    /// promise jobs, and V8 drains its job queue when the outermost call from C# returns.
    /// </summary>
    public sealed class JsEngineHost : IDisposable
    {
        /// <summary>The bundle's path under <see cref="Application.streamingAssetsPath"/>.</summary>
        public const string BundleRelativePath = "engine/engine.js";

        /// <summary>The runtime's name, for logs and diagnostics.</summary>
        public const string RuntimeName = "ClearScript V8";

        // Wraps an async host call: returns a box that the promise's settlement fills in. The box is
        // read after the call returns, by which time V8 has run the promise jobs.
        private const string HelperScript = @"(function (api) {
  return {
    callAsync: function (name, argument, onProgress) {
      var box = { done: false, value: undefined, error: undefined };
      var settle = function (promise) {
        promise.then(
          function (value) { box.done = true; box.value = value; },
          function (error) { box.done = true; box.error = String((error && error.stack) || error); });
      };
      try {
        var fn = api[name];
        if (typeof fn !== 'function') { throw new Error('RingsideEngine.' + name + ' is not a function'); }
        settle(Promise.resolve(onProgress === undefined ? fn(argument) : fn(argument, onProgress)));
      } catch (error) {
        box.done = true;
        box.error = String((error && error.stack) || error);
      }
      return box;
    }
  };
})(globalThis.RingsideEngine)";

        private static string nativeSearchPath;

        private readonly object gate = new object();
        private V8ScriptEngine engine;
        private ScriptObject api;
        private ScriptObject helper;

        /// <summary>
        /// Starts a runtime and evaluates the bundle text. Call <see cref="ConfigureNativeSearchPath"/>
        /// first when constructing off Unity's main thread before any host has been created.
        /// </summary>
        /// <param name="bundleSource">The text of engine.js.</param>
        /// <param name="documentName">The name V8 uses for the script in stack traces.</param>
        public JsEngineHost(string bundleSource, string documentName = "engine.js")
        {
            if (bundleSource == null)
            {
                throw new ArgumentNullException(nameof(bundleSource));
            }

            if (nativeSearchPath == null)
            {
                // Application.dataPath only works on the main thread; off it, configure first.
                ConfigureNativeSearchPath(Application.dataPath);
            }

            engine = new V8ScriptEngine(V8ScriptEngineFlags.None);
            try
            {
                engine.Execute(documentName, bundleSource);
                api = engine.Evaluate("globalThis.RingsideEngine") as ScriptObject;
                if (api == null)
                {
                    throw new InvalidOperationException(
                        $"{documentName} did not define globalThis.RingsideEngine; is it the engine bundle?");
                }

                helper = (ScriptObject)engine.Evaluate("ringside-host-helper.js", HelperScript);
            }
            catch
            {
                engine.Dispose();
                engine = null;
                throw;
            }
        }

        /// <summary>The default bundle location: StreamingAssets/engine/engine.js (main thread only).</summary>
        public static string DefaultBundlePath => Path.Combine(Application.streamingAssetsPath, BundleRelativePath);

        /// <summary>Loads the bundle from StreamingAssets (call on Unity's main thread).</summary>
        public static JsEngineHost LoadFromStreamingAssets()
        {
            return LoadFromFile(DefaultBundlePath);
        }

        /// <summary>Loads a bundle file.</summary>
        public static JsEngineHost LoadFromFile(string bundlePath)
        {
            if (!File.Exists(bundlePath))
            {
                throw new FileNotFoundException(
                    "Engine bundle not found; run `npm run build:engine-bundle` at the repo root", bundlePath);
            }

            return new JsEngineHost(File.ReadAllText(bundlePath), Path.GetFileName(bundlePath));
        }

        /// <summary>
        /// Tells ClearScript where the native V8 library (ClearScriptV8.win-x64.dll) is: the
        /// player's <c>&lt;Game&gt;_Data/Plugins/x86_64</c>, or the project's
        /// <c>Assets/Plugins/ClearScript/x86_64</c> in the editor. Done automatically at startup and by
        /// the first host created on the main thread.
        /// </summary>
        /// <param name="dataPath">Unity's <see cref="Application.dataPath"/>.</param>
        public static void ConfigureNativeSearchPath(string dataPath)
        {
            string path = string.Join(
                ";",
                Path.Combine(dataPath, "Plugins", "x86_64"),
                Path.Combine(dataPath, "Plugins"),
                Path.Combine(dataPath, "Plugins", "ClearScript", "x86_64"));
            HostSettings.AuxiliarySearchPath = path;
            nativeSearchPath = path;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ConfigureAtStartup()
        {
            ConfigureNativeSearchPath(Application.dataPath);
        }

        /// <summary>
        /// Calls a synchronous host function (<c>info</c>, <c>configure</c>, <c>listWorlds</c>,
        /// <c>previewWorld</c>, <c>newGame</c>, <c>query</c>, <c>command</c>, <c>cancelAdvance</c>,
        /// <c>exportState</c>, <c>worldHash</c>, <c>unload</c>) and returns its JSON result.
        /// </summary>
        /// <param name="function">The function's name on <c>RingsideEngine</c>.</param>
        /// <param name="arguments">JSON strings (or plain strings, such as a query name); trailing
        /// arguments may be left out.</param>
        public string Call(string function, params string[] arguments)
        {
            lock (gate)
            {
                ThrowIfDisposed();
                object[] scriptArguments = Array.ConvertAll(arguments ?? Array.Empty<string>(), ToScript);
                return AsResult(function, api.InvokeMethod(function, scriptArguments));
            }
        }

        /// <summary>
        /// Calls an async host function (<c>load</c>, <c>save</c>, <c>inspectSave</c>,
        /// <c>advanceDays</c>), drains the promise job queue and returns the settled JSON result.
        /// </summary>
        /// <param name="function">The function's name on <c>RingsideEngine</c>.</param>
        /// <param name="argument">Its first argument (JSON options, or base64 save text); null leaves it out.</param>
        /// <param name="onProgress">For <c>advanceDays</c>: called synchronously after every simulated
        /// day with the progress JSON, on the calling thread. It may call
        /// <c>Call("cancelAdvance")</c> or run queries.</param>
        public string CallAsync(string function, string argument = null, Action<string> onProgress = null)
        {
            lock (gate)
            {
                ThrowIfDisposed();
                object progress = onProgress == null ? (object)Undefined.Value : onProgress;
                var box = (ScriptObject)helper.InvokeMethod("callAsync", function, ToScript(argument), progress);
                if (!(box.GetProperty("done") is bool done) || !done)
                {
                    throw new InvalidOperationException(
                        $"RingsideEngine.{function} did not settle: the promise job queue was not drained");
                }

                object error = box.GetProperty("error");
                if (error is string message)
                {
                    throw new JsEngineException($"RingsideEngine.{function} rejected: {message}");
                }

                return AsResult(function, box.GetProperty("value"));
            }
        }

        /// <summary>
        /// Evaluates a JavaScript expression in the engine's runtime and returns it as text
        /// (diagnostics and tests only; game code goes through <see cref="Call"/>).
        /// </summary>
        public string EvaluateDiagnostic(string expression)
        {
            lock (gate)
            {
                ThrowIfDisposed();
                return Convert.ToString(engine.Evaluate("diagnostic.js", expression), System.Globalization.CultureInfo.InvariantCulture);
            }
        }

        /// <summary>Asks V8 for a full garbage collection (e.g. after unloading a game).</summary>
        public void CollectGarbage()
        {
            lock (gate)
            {
                ThrowIfDisposed();
                engine.CollectGarbage(true);
            }
        }

        /// <summary>Stops the runtime and frees the V8 isolate.</summary>
        public void Dispose()
        {
            lock (gate)
            {
                api = null;
                helper = null;
                engine?.Dispose();
                engine = null;
            }
        }

        private static object ToScript(string value)
        {
            return value == null ? (object)Undefined.Value : value;
        }

        private static string AsResult(string function, object result)
        {
            if (result is string json)
            {
                return json;
            }

            throw new JsEngineException(
                $"RingsideEngine.{function} returned {result?.GetType().Name ?? "null"}, not a JSON string");
        }

        private void ThrowIfDisposed()
        {
            if (engine == null)
            {
                throw new ObjectDisposedException(nameof(JsEngineHost));
            }
        }
    }

    /// <summary>A fault at the C#/JavaScript boundary (the bundle's own errors come back as JSON).</summary>
    public sealed class JsEngineException : Exception
    {
        public JsEngineException(string message) : base(message)
        {
        }
    }
}
