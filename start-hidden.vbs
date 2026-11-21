' Starts discord-presence without a console window; output goes to presence.log next to this file.
' On the first start it also adds itself to the Windows autostart (remove with autostart.ps1 -Remove).
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

link = shell.SpecialFolders("Startup") & "\discord-presence.lnk"
If Not fso.FileExists(link) Then
  Set shortcut = shell.CreateShortcut(link)
  shortcut.TargetPath = "wscript.exe"
  shortcut.Arguments = """" & WScript.ScriptFullName & """"
  shortcut.WorkingDirectory = dir
  shortcut.Save
End If

shell.Run "cmd /c cd /d """ & dir & """ && node """ & dir & "\src\index.js"" > presence.log 2>&1", 0, False
