Set WshShell = CreateObject("WScript.Shell")
Dim fso, currentDir
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run Chr(34) & currentDir & "\START-PRINTER.bat" & Chr(34), 0, False
Set WshShell = Nothing
