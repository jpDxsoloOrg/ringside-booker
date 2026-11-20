using System;
using System.Threading.Tasks;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// The one <see cref="EngineClient"/> the game uses, started on first use (on the main thread)
    /// and kept for the whole session: the title screen's wizard, saves and the shell all share it.
    /// Leaving a game unloads the world (<see cref="EngineGame"/>), it does not dispose the client.
    /// </summary>
    public static class EngineRuntime
    {
        private static Task<EngineClient> starting;

        /// <summary>The client once started, or null before the first <see cref="GetClientAsync"/> finished.</summary>
        public static EngineClient Client { get; private set; }

        /// <summary>
        /// Raised on the main thread when the engine stops (a fault in the shared client) or does
        /// not start (UNITY-24). The engine-stopped screen listens. After it, the next
        /// <see cref="GetClientAsync"/> starts a fresh client.
        /// </summary>
        public static event Action<EngineFault> Stopped;

        /// <summary>The last time the engine stopped this session, or null.</summary>
        public static EngineFault LastFault { get; private set; }

        /// <summary>The shared client, starting it (about 0.2 s) the first time. Call on Unity's main thread.</summary>
        public static Task<EngineClient> GetClientAsync()
        {
            if (Client != null && Client.IsStopped) Reset();
            if (Client != null) return Task.FromResult(Client);
            if (starting == null || starting.IsFaulted || starting.IsCanceled) starting = Start();
            return starting;
        }

        private static async Task<EngineClient> Start()
        {
            try
            {
                EngineClient client = await EngineClient.StartAsync();
                Client = client;
                client.OnFault += fault => Report(fault);
                Application.quitting += () =>
                {
                    Client?.Dispose();
                    Client = null;
                };
                return client;
            }
            catch (Exception exception)
            {
                Debug.LogError($"[EngineRuntime] The engine did not start: {exception.Message}");
                Report(new EngineFault("start", exception, DateTimeOffset.UtcNow, atStart: true));
                throw;
            }
        }

        /// <summary>Drops a stopped client (its engine thread has already ended), so the next use starts a new one.</summary>
        public static void Reset()
        {
            EngineClient old = Client;
            Client = null;
            starting = null;
            if (old != null && !old.IsStopped) old.Dispose();
        }

        private static void Report(EngineFault fault)
        {
            LastFault = fault;
            Stopped?.Invoke(fault);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Client = null;
            starting = null;
            LastFault = null;
            Stopped = null;
        }
    }
}
