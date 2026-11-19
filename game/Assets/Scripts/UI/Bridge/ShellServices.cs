using System;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// Where the shell finds the game. The engine bridge (UNITY-04/09) calls <see cref="Install"/>
    /// with its implementations before loading the Game scene; when nothing is installed (opening
    /// Game.unity directly, or "Start demo game" on the title screen) the shell installs
    /// <see cref="Demo.DemoGame"/>.
    /// </summary>
    public static class ShellServices
    {
        public static IShellData Data { get; private set; }
        public static IDayControl Day { get; private set; }

        public static bool IsInstalled => Data != null && Day != null;

        /// <summary>Raised after <see cref="Install"/> or <see cref="Clear"/>.</summary>
        public static event Action Changed;

        /// <summary>Installs the game the shell reads. Replaces (and disposes) whatever was there.</summary>
        public static void Install(IShellData data, IDayControl day)
        {
            if (data == null) throw new ArgumentNullException(nameof(data));
            if (day == null) throw new ArgumentNullException(nameof(day));
            DisposeCurrent(data, day);
            Data = data;
            Day = day;
            Changed?.Invoke();
        }

        /// <summary>Removes the game (back to the title screen). Disposes implementations that are <see cref="IDisposable"/>.</summary>
        public static void Clear()
        {
            DisposeCurrent(null, null);
            Data = null;
            Day = null;
            Changed?.Invoke();
        }

        private static void DisposeCurrent(object keepData, object keepDay)
        {
            if (Data is IDisposable data && !ReferenceEquals(Data, keepData) && !ReferenceEquals(Data, keepDay)) data.Dispose();
            if (Day is IDisposable day && !ReferenceEquals(Day, Data) && !ReferenceEquals(Day, keepData) && !ReferenceEquals(Day, keepDay)) day.Dispose();
        }
    }
}
