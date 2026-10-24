Option Explicit
Dim shell, fso, base, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "windows")
command = Chr(34) & base & "\runtime\node\node.exe" & Chr(34) & " " & Chr(34) & base & "\start.mjs" & Chr(34) & " settings"
shell.Run command, 0, False

