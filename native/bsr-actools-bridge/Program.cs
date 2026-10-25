using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AcManager.Tools.ContentInstallation;
using AcManager.Tools.ContentInstallation.Entries;
using AcManager.Tools.Data;
using AcManager.Tools.Helpers;
using AcManager.Tools.Managers;
using AcManager.Tools.Managers.Plugins;
using AcManager.Tools.Miscellaneous;
using FirstFloor.ModernUI.Helpers;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SharpCompress.Archives;
using SharpCompress.Readers;

namespace Bsr.AcToolsBridge {
    internal static class Program {
        private static readonly object OutputLock = new object();
        private static readonly object InstalledFilesLock = new object();
        private static List<string> _installedFiles;
        private static string _installRequestId;
        private static string _acRoot;

        [STAThread]
        private static int Main(string[] args) {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            Assembly.Load("AcManager.Internal, Version=1.0.2.0, Culture=neutral, PublicKeyToken=null");
            var application = System.Windows.Application.Current ?? new System.Windows.Application {
                ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown
            };
            var exitCode = 1;
            Exception failure = null;
            application.Dispatcher.BeginInvoke(new Action(async () => {
                try {
                    exitCode = await Run(args);
                } catch (Exception e) {
                    failure = e;
                } finally {
                    application.Dispatcher.BeginInvokeShutdown(System.Windows.Threading.DispatcherPriority.Background);
                }
            }));

            try {
                System.Windows.Threading.Dispatcher.Run();
                if (failure == null) return exitCode;
                throw failure;
            } catch (Exception e) {
                Write(new {
                    type = "fatal",
                    ok = false,
                    error = e.Message,
                    exception = e.GetType().FullName,
                    detail = e.ToString()
                });
                return 1;
            }
        }

        private static async Task<int> Run(string[] args) {
            if (args.Length == 0 || string.Equals(args[0], "serve", StringComparison.OrdinalIgnoreCase)) {
                await Serve();
                return 0;
            }

            var command = args[0].ToLowerInvariant();
            var options = ParseOptions(args.Skip(1).ToArray());
            if (command == "self-test") {
                return await SelfTest(options);
            }

            var archive = Require(options, "archive");
            JObject result;
            if (command == "extract") {
                result = await ExtractArchive(archive, Require(options, "destination"), null);
            } else {
                var root = Require(options, "ac-root");
                EnsureRuntime(root, false);
                result = await ProcessArchive(command, archive, command == "install", null);
            }
            Write(result);
            return result.Value<bool>("ok") ? 0 : 2;
        }

        private static async Task Serve() {
            Write(new {
                type = "ready",
                protocol = 1,
                engine = "AcTools/ContentInstallationManager",
                framework = Environment.Version.ToString(),
                processArchitecture = Environment.Is64BitProcess ? "x64" : "x86",
                encoding = Console.OutputEncoding.WebName,
                apartment = Thread.CurrentThread.GetApartmentState().ToString()
            });

            string line;
            while ((line = await Console.In.ReadLineAsync()) != null) {
                if (string.IsNullOrWhiteSpace(line)) continue;
                JObject request = null;
                try {
                    request = JObject.Parse(line);
                    var id = request.Value<string>("id");
                    var command = (request.Value<string>("command") ?? "").ToLowerInvariant();
                    if (command == "shutdown") {
                        Write(new { type = "result", id, ok = true });
                        return;
                    }

                    var archive = request.Value<string>("archive");
                    JObject result;
                    if (command == "extract") {
                        result = await ExtractArchive(archive, request.Value<string>("destination"), id);
                    } else {
                        var root = request.Value<string>("acRoot");
                        EnsureRuntime(root, false);
                        result = await ProcessArchive(command, archive, command == "install", id);
                    }
                    result["type"] = "result";
                    result["id"] = id;
                    Write(result);
                } catch (Exception e) {
                    Write(new {
                        type = "result",
                        id = request?.Value<string>("id"),
                        ok = false,
                        error = e.Message,
                        exception = e.GetType().FullName
                    });
                }
            }
        }

        private static async Task<int> SelfTest(Dictionary<string, string> options) {
            var work = Require(options, "workspace");
            var root = Path.Combine(work, "fake-assetto-corsa");
            var car = Path.Combine(work, "fixtures", "bsr_test_car.zip");
            var track = Path.Combine(work, "fixtures", "bsr_test_track.zip");

            if (Directory.Exists(root)) Directory.Delete(root, true);
            EnsureRuntime(root, true);

            Write(new {
                type = "headless-check",
                ok = System.Windows.Application.Current != null && System.Windows.Application.Current.Windows.Count == 0,
                applicationCreated = System.Windows.Application.Current != null,
                visibleWindows = System.Windows.Application.Current?.Windows.Count ?? 0,
                apartment = Thread.CurrentThread.GetApartmentState().ToString()
            });

            var carInspect = await ProcessArchive("inspect", car, false, "car-inspect");
            Write(carInspect);
            var trackInspect = await ProcessArchive("inspect", track, false, "track-inspect");
            Write(trackInspect);
            var carInstall = await ProcessArchive("install", car, true, "car-install");
            Write(carInstall);
            var trackInstall = await ProcessArchive("install", track, true, "track-install");
            Write(trackInstall);

            var carInstalled = File.Exists(Path.Combine(root, "content", "cars", "bsr_test_car", "ui", "ui_car.json"));
            var trackInstalled = File.Exists(Path.Combine(root, "content", "tracks", "bsr_test_track", "ui", "ui_track.json"));
            var ok = carInspect.Value<bool>("ok") && trackInspect.Value<bool>("ok") &&
                    carInstall.Value<bool>("ok") && trackInstall.Value<bool>("ok") && carInstalled && trackInstalled;
            Write(new {
                type = "self-test-result",
                ok,
                carDetected = HasEntry(carInspect, "CarContentEntry", "bsr_test_car"),
                trackDetected = HasEntry(trackInspect, "TrackContentEntry", "bsr_test_track"),
                carInstalled,
                trackInstalled,
                root
            });
            Write(new {
                type = "loaded-assemblies",
                assemblies = AppDomain.CurrentDomain.GetAssemblies()
                        .Select(x => x.GetName())
                        .Where(x => !x.Name.StartsWith("System", StringComparison.Ordinal) &&
                                !x.Name.StartsWith("Microsoft", StringComparison.Ordinal) &&
                                x.Name != "mscorlib")
                        .OrderBy(x => x.Name)
                        .Select(x => new { name = x.Name, version = x.Version.ToString() })
                        .ToArray()
            });
            return ok ? 0 : 3;
        }

        private static bool HasEntry(JObject result, string kind, string id) {
            return (result["entries"] as JArray)?.Any(x => x.Value<string>("kind") == kind && x.Value<string>("id") == id) == true;
        }

        private static void EnsureRuntime(string root, bool createFakeRoot) {
            if (string.IsNullOrWhiteSpace(root)) throw new ArgumentException("acRoot is required");
            root = Path.GetFullPath(root);
            if (_acRoot != null) {
                if (!string.Equals(_acRoot, root, StringComparison.OrdinalIgnoreCase)) {
                    AcRootDirectory.Instance.RawValue = root;
                    if (!AcRootDirectory.Instance.IsReady) throw new InvalidOperationException("Invalid Assetto Corsa directory: " + root);
                    _acRoot = root;
                }
                return;
            }

            if (createFakeRoot) CreateFakeAcRoot(root);
            if (System.Windows.Application.Current == null) {
                new System.Windows.Application {
                    ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown
                };
            }
            var data = Path.Combine(Path.GetDirectoryName(typeof(Program).Assembly.Location), "bridge-data");
            Directory.CreateDirectory(data);
            FilesStorage.Initialize(data);
            Logging.Initialize(Path.Combine(data, "bridge.log"), false);
            ValuesStorage.Initialize();
            CacheStorage.Initialize();
            SteamIdHelper.Initialize("76561197960265728");
            AuthenticationStorage.Initialize();
            var plugins = Path.Combine(data, "plugins");
            Directory.CreateDirectory(plugins);
            PluginsManager.Initialize(plugins);
            CupClient.Initialize();
            AcRootDirectory.Initialize(root);
            if (!AcRootDirectory.Instance.IsReady) throw new InvalidOperationException("Invalid Assetto Corsa directory: " + root);
            Superintendent.Initialize();
            NewFilesReporter.NewFileCreated += (sender, filename) => {
                if (string.IsNullOrWhiteSpace(filename)) return;
                string requestId;
                int current;
                lock (InstalledFilesLock) {
                    _installedFiles?.Add(Path.GetFullPath(filename));
                    requestId = _installRequestId;
                    current = _installedFiles?.Count ?? 0;
                }
                if (!string.IsNullOrWhiteSpace(requestId) && IsInside(_acRoot, filename)) {
                    Write(new {
                        type = "progress",
                        id = requestId,
                        state = "InstallingFile",
                        message = Path.GetFullPath(filename).Substring(Path.GetFullPath(_acRoot).TrimEnd(Path.DirectorySeparatorChar).Length).TrimStart(Path.DirectorySeparatorChar),
                        current,
                        total = 0,
                        progress = -1d
                    });
                }
            };
            _acRoot = root;
        }

        private static void CreateFakeAcRoot(string root) {
            Directory.CreateDirectory(Path.Combine(root, "apps"));
            Directory.CreateDirectory(Path.Combine(root, "content", "cars"));
            Directory.CreateDirectory(Path.Combine(root, "content", "tracks"));
            File.WriteAllBytes(Path.Combine(root, "acs.exe"), new byte[0]);
            File.WriteAllBytes(Path.Combine(root, "AssettoCorsa.exe"), new byte[0]);
        }

        private static async Task<JObject> ProcessArchive(string command, string archive, bool install, string requestId) {
            if (command != "inspect" && command != "install") throw new ArgumentException("Unknown command: " + command);
            if (string.IsNullOrWhiteSpace(archive) || !File.Exists(archive)) throw new FileNotFoundException("Archive not found", archive);

            if (install) {
                lock (InstalledFilesLock) {
                    _installedFiles = new List<string>();
                    _installRequestId = requestId;
                }
            }

            var manager = ContentInstallationManager.Instance;
            var before = manager.DownloadList.Count;
            var task = manager.InstallAsync(Path.GetFullPath(archive), AddInstallMode.ForceNewTask,
                    ContentInstallationParams.DefaultWithoutExecutables);
            if (manager.DownloadList.Count <= before) throw new InvalidOperationException("AcTools did not create an installation task");
            var entry = manager.DownloadList[manager.DownloadList.Count - 1];
            entry.PropertyChanged += (sender, eventArgs) => OnEntryChanged(requestId, entry, eventArgs);

            var timeout = DateTime.UtcNow.AddSeconds(30);
            while (!entry.WaitingForConfirmation && entry.State != ContentInstallationEntryState.Finished) {
                if (DateTime.UtcNow > timeout) {
                    entry.CancelCommand.Execute();
                    throw new TimeoutException("AcTools scanner timed out");
                }
                await Task.Delay(20);
            }

            var entries = Describe(entry.Entries);
            if (entry.WaitingForConfirmation) {
                if (install) {
                    entry.ConfirmCommand.Execute();
                    await task;
                } else {
                    entry.CancelCommand.Execute();
                    try { await task; } catch (OperationCanceledException) { }
                }
            } else {
                await task;
            }

            List<string> installedFiles;
            lock (InstalledFilesLock) {
                installedFiles = (_installedFiles ?? new List<string>())
                        .Where(x => IsInside(_acRoot, x) && File.Exists(x))
                        .Select(x => Path.GetFullPath(x))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                _installedFiles = null;
                _installRequestId = null;
            }
            var ok = entries.Count > 0 && (!install || !entry.IsFailed);
            return JObject.FromObject(new {
                type = command + "-result",
                id = requestId,
                ok,
                archive = Path.GetFullPath(archive),
                engineResult = !entry.IsFailed,
                error = entry.FailedMessage,
                commentary = entry.FailedCommentary,
                entries,
                installedFiles
            });
        }

        private static Task<JObject> ExtractArchive(string archive, string destination, string requestId) {
            return Task.Run(() => {
                if (string.IsNullOrWhiteSpace(archive) || !File.Exists(archive)) throw new FileNotFoundException("Archive not found", archive);
                if (string.IsNullOrWhiteSpace(destination)) throw new ArgumentException("destination is required");
                var destinationRoot = Path.GetFullPath(destination);
                Directory.CreateDirectory(destinationRoot);
                var files = new List<string>();
                long expandedBytes = 0;
                const long maxExpandedBytes = 60L * 1024L * 1024L * 1024L;
                const int maxFiles = 100000;

                using (var compressed = ArchiveFactory.Open(Path.GetFullPath(archive)))
                using (var reader = compressed.ExtractAllEntries()) {
                    var totalFiles = compressed.Entries.Count(x => !x.IsDirectory);
                    while (reader.MoveToNextEntry()) {
                        var entry = reader.Entry;
                        if (entry.IsDirectory) continue;
                        var relative = ValidateArchivePath(entry.Key, destinationRoot);
                        if (entry.Size < 0 || entry.Size > maxExpandedBytes - expandedBytes) {
                            throw new InvalidDataException("Expanded content exceeds the safety limit");
                        }
                        expandedBytes += entry.Size;
                        if (files.Count >= maxFiles) throw new InvalidDataException("Archive contains too many files");
                        var target = Path.GetFullPath(Path.Combine(destinationRoot, relative));
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (var input = reader.OpenEntryStream())
                        using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                            CopyWithLimit(input, output, maxExpandedBytes, ref expandedBytes, entry.Size);
                        }
                        files.Add(relative.Replace(Path.DirectorySeparatorChar, '/'));
                        Write(new {
                            type = "progress",
                            id = requestId,
                            state = "Extracting",
                            message = relative,
                            current = files.Count,
                            total = totalFiles,
                            progress = totalFiles > 0 ? Math.Min(1d, (double)files.Count / totalFiles) : 0d
                        });
                    }
                }

                if (files.Count == 0) throw new InvalidDataException("Archive does not contain installable files");
                return JObject.FromObject(new {
                    type = "extract-result",
                    id = requestId,
                    ok = true,
                    archive = Path.GetFullPath(archive),
                    destination = destinationRoot,
                    files,
                    expandedBytes
                });
            });
        }

        private static string ValidateArchivePath(string entryPath, string destinationRoot) {
            if (string.IsNullOrWhiteSpace(entryPath) || entryPath.IndexOf('\0') >= 0) throw new InvalidDataException("Archive contains an invalid path");
            var normalized = entryPath.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            if (Path.IsPathRooted(normalized)) throw new InvalidDataException("Archive contains an absolute path: " + entryPath);
            var parts = normalized.Split(new[] { Path.DirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries)
                    .Where(x => x != ".").ToArray();
            if (parts.Length == 0 || parts.Any(x => x == ".." || x.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) {
                throw new InvalidDataException("Archive tried to write outside the authorized directory: " + entryPath);
            }
            var relative = Path.Combine(parts);
            var root = destinationRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var target = Path.GetFullPath(Path.Combine(destinationRoot, relative));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Archive tried to write outside the authorized directory: " + entryPath);
            return relative;
        }

        private static void CopyWithLimit(Stream input, Stream output, long maxExpandedBytes, ref long expandedBytes, long declaredSize) {
            var buffer = new byte[81920];
            long written = 0;
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
                written += read;
                if (written > declaredSize) {
                    var excess = written - declaredSize;
                    if (expandedBytes > maxExpandedBytes - excess) throw new InvalidDataException("Expanded content exceeds the safety limit");
                    expandedBytes += excess;
                    declaredSize = written;
                }
                output.Write(buffer, 0, read);
            }
        }

        private static bool IsInside(string root, string candidate) {
            if (string.IsNullOrWhiteSpace(root) || string.IsNullOrWhiteSpace(candidate)) return false;
            var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var normalizedCandidate = Path.GetFullPath(candidate);
            return normalizedCandidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
        }

        private static List<object> Describe(IEnumerable<ContentEntryBase> entries) {
            return (entries ?? Enumerable.Empty<ContentEntryBase>()).Select(x => (object)new {
                kind = x.GetType().Name,
                id = x.Id,
                name = x.Name,
                version = x.Version,
                entryPath = x.EntryPath,
                displayName = x.DisplayName,
                isNew = x.IsNew,
                active = x.Active
            }).ToList();
        }

        private static void OnEntryChanged(string requestId, ContentInstallationEntry entry, PropertyChangedEventArgs args) {
            if (args.PropertyName != nameof(ContentInstallationEntry.Progress) &&
                    args.PropertyName != nameof(ContentInstallationEntry.State) &&
                    args.PropertyName != nameof(ContentInstallationEntry.WaitingForConfirmation)) return;
            Write(new {
                type = "progress",
                id = requestId,
                state = entry.State.ToString(),
                message = entry.Progress.Message,
                progress = entry.Progress.Progress
            });
        }

        private static Dictionary<string, string> ParseOptions(string[] args) {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < args.Length; i += 2) {
                if (!args[i].StartsWith("--") || i + 1 >= args.Length) throw new ArgumentException("Expected --name value");
                result[args[i].Substring(2)] = args[i + 1];
            }
            return result;
        }

        private static string Require(Dictionary<string, string> options, string key) {
            string value;
            if (!options.TryGetValue(key, out value) || string.IsNullOrWhiteSpace(value)) throw new ArgumentException("--" + key + " is required");
            return value;
        }

        private static void Write(object value) {
            lock (OutputLock) {
                Console.WriteLine(JsonConvert.SerializeObject(value, Formatting.None));
                Console.Out.Flush();
            }
        }
    }
}
