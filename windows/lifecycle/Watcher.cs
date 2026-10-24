using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Watcher {
    private const string Family = "OpenAI.Codex_2p2nqsd0c76g0";
    private delegate bool EnumProc(IntPtr window, IntPtr lparam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lparam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll", EntryPoint="GetWindowLong")] private static extern int GetWindowLong32(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] private static extern IntPtr GetWindowLong64(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr OpenProcess(uint rights, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder name);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, int informationLength, out int requiredLength);
    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenStatistics {
        public Luid TokenId; public Luid AuthenticationId; public long ExpirationTime;
        public int TokenType; public int ImpersonationLevel; public uint DynamicCharged;
        public uint DynamicAvailable; public uint GroupCount; public uint PrivilegeCount; public Luid ModifiedId;
    }
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static HashSet<long> KnownWindows = new HashSet<long>();
    private static string LogonId = ReadLogonId();
    private static string PriorEpoch;
    private static readonly List<string> PriorProcesses = new List<string>();

    private static string ReadLogonId() {
        try {
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) {
                int length; GetTokenInformation(identity.Token, 10, IntPtr.Zero, 0, out length);
                if (length <= 0 || length > 4096) return null;
                IntPtr buffer = Marshal.AllocHGlobal(length);
                try {
                    if (!GetTokenInformation(identity.Token, 10, buffer, length, out length)) return null;
                    var statistics = (TokenStatistics)Marshal.PtrToStructure(buffer, typeof(TokenStatistics));
                    return ((uint)statistics.AuthenticationId.HighPart).ToString()+":"+statistics.AuthenticationId.LowPart.ToString();
                } finally { Marshal.FreeHGlobal(buffer); }
            }
        } catch { return null; }
    }
    private static void LoadPriorEpoch(string data) {
        try {
            var state = Json.DeserializeObject(File.ReadAllText(Path.Combine(data, "lifecycle-session.json"))) as Dictionary<string, object>;
            if (state == null || !state.ContainsKey("epoch") || !(state["epoch"] is string)) return;
            PriorEpoch = (string)state["epoch"];
            // A persisted process list does not replace the prior window
            // handles. Seed both independently so an unreadable known window
            // on the first tick after restart is unknown, never a false close.
            object[] priorWindows = state.ContainsKey("windows") ? state["windows"] as object[] : null;
            if (priorWindows != null && priorWindows.Length <= 100) {
                foreach (object entry in priorWindows) {
                    string text = entry as string; if (text == null) continue;
                    string[] parts = text.Split(':'); int pid; long ticks, window;
                    if (parts.Length == 3 && Int32.TryParse(parts[0], out pid) && pid > 0 &&
                        Int64.TryParse(parts[1], out ticks) && ticks > 0 && Int64.TryParse(parts[2], out window) && window > 0)
                        KnownWindows.Add(window);
                }
            }
            object[] entries = state.ContainsKey("epochProcesses") ? state["epochProcesses"] as object[] : null;
            bool fromWindows = entries == null || entries.Length == 0;
            if (fromWindows) entries = state.ContainsKey("windows") ? state["windows"] as object[] : null;
            if (entries == null || entries.Length > 100) return;
            foreach (object entry in entries) {
                string text = entry as string; if (text == null) continue;
                string[] parts = text.Split(':'); int pid; long ticks;
                if (parts.Length < 2 || !Int32.TryParse(parts[0], out pid) || pid <= 0 || !Int64.TryParse(parts[1], out ticks) || ticks <= 0) continue;
                string identity = parts[0]+":"+parts[1]; if (!PriorProcesses.Contains(identity)) PriorProcesses.Add(identity);
            }
        } catch { }
    }
    private static object PriorProcessesGone() {
        if (PriorEpoch == null || PriorProcesses.Count == 0) return null;
        bool unreadable = false;
        foreach (string identity in PriorProcesses) {
            string[] parts = identity.Split(':'); int pid = Int32.Parse(parts[0]); long ticks = Int64.Parse(parts[1]);
            try {
                using (Process process = Process.GetProcessById(pid)) {
                    if (process.StartTime.ToUniversalTime().Ticks == ticks) return false;
                }
            } catch (ArgumentException) { /* exact prior process is gone */ }
              catch { unreadable = true; }
        }
        return unreadable ? null : (object)true;
    }

    private static string Quote(string value) {
        if (value.IndexOf('"') >= 0 || value.EndsWith("\\")) throw new ArgumentException("invalid-path");
        return "\"" + value + "\"";
    }
    private static Dictionary<string, object> Snapshot() {
        var windows = new List<string>();
        bool available = true;
        try {
            bool ok = EnumWindows(delegate(IntPtr window, IntPtr ignored) {
                if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || GetWindowTextLength(window) == 0) return true;
                long style = IntPtr.Size == 8 ? GetWindowLong64(window, -20).ToInt64() : GetWindowLong32(window, -20);
                if ((style & 0x80) != 0 || (style & 0x08000000) != 0) return true;
                uint pid; GetWindowThreadProcessId(window, out pid);
                IntPtr handle = OpenProcess(0x1000, false, pid);
                if (handle == IntPtr.Zero) { if (KnownWindows.Contains(window.ToInt64())) available = false; return true; }
                try {
                    uint length = 0;
                    if (GetPackageFamilyName(handle, ref length, null) != 122 || length == 0 || length > 1024) { if (KnownWindows.Contains(window.ToInt64())) available = false; return true; }
                    var family = new StringBuilder((int)length);
                    if (GetPackageFamilyName(handle, ref length, family) != 0 || family.ToString() != Family) { if (KnownWindows.Contains(window.ToInt64())) available = false; return true; }
                    using (Process process = Process.GetProcessById((int)pid)) {
                        // Package identity plus the GUI executable excludes the
                        // bundled Codex CLI and a separately-installed ChatGPT.
                        if (!String.Equals(process.ProcessName, "ChatGPT", StringComparison.OrdinalIgnoreCase)) return true;
                        windows.Add(pid.ToString()+":"+process.StartTime.ToUniversalTime().Ticks.ToString()+":"+window.ToInt64().ToString());
                    }
                } catch { if (KnownWindows.Contains(window.ToInt64())) available = false; } finally { CloseHandle(handle); }
                return true;
            }, IntPtr.Zero);
            if (!ok) available = false;
        } catch { available = false; }
        windows.Sort(StringComparer.Ordinal);
        if (available) {
            var next = new HashSet<long>();
            foreach (string identity in windows) next.Add(Int64.Parse(identity.Substring(identity.LastIndexOf(':')+1)));
            KnownWindows = next;
        }
        return new Dictionary<string, object> { {"schemaVersion", 1}, {"source", Family}, {"detectorAvailable", available}, {"windows", windows},
            {"logonId", LogonId}, {"priorEpoch", PriorEpoch}, {"priorEpochProcessesGone", PriorProcessesGone()} };
    }
    private static string Arg(string[] args, string name) { int at = Array.IndexOf(args, name); return at >= 0 && at+1 < args.Length ? args[at+1] : null; }
    [STAThread]
    private static int Main(string[] args) {
        try {
            if (Array.IndexOf(args, "--probe") >= 0) {
                string probeData = Arg(args, "--data"); if (probeData != null) LoadPriorEpoch(Path.GetFullPath(probeData));
                Console.WriteLine(Json.Serialize(Snapshot())); return 0;
            }
            string root = Path.GetFullPath(Arg(args, "--root"));
            string data = Path.GetFullPath(Arg(args, "--data"));
            LoadPriorEpoch(data);
            byte[] digest; using (var sha = SHA256.Create()) digest = sha.ComputeHash(Encoding.UTF8.GetBytes((root+"|"+data).ToLowerInvariant()));
            string key = BitConverter.ToString(digest).Replace("-", "").Substring(0, 24);
            bool created;
            using (var mutex = new Mutex(true, "Local\\ShuanglingCodexObserver-"+key, out created)) {
                if (!created) return 0;
                var info = new ProcessStartInfo(Path.Combine(root, "windows", "runtime", "node", "node.exe"), Quote(Path.Combine(root, "src", "lifecycle", "observer.mjs"))+" --root "+Quote(root)+" --data "+Quote(data));
                info.UseShellExecute = false; info.CreateNoWindow = true;
                info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
                info.WorkingDirectory = root;
                using (Process child = Process.Start(info)) {
                    child.OutputDataReceived += delegate { }; child.ErrorDataReceived += delegate { };
                    child.BeginOutputReadLine(); child.BeginErrorReadLine();
                    while (!child.HasExited) {
                        child.StandardInput.WriteLine(Json.Serialize(Snapshot())); child.StandardInput.Flush();
                        Thread.Sleep(750);
                    }
                    return child.ExitCode;
                }
            }
        } catch { return 1; }
    }
}
