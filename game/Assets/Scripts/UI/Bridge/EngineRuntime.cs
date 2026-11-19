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

        /// <summary>The shared client, starting it (about 0.2 s) the first time. Call on Unity's main thread.</summary>
        public static Task<EngineClient> GetClientAsync()
        {
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
                throw;
            }
        }
    }
}
