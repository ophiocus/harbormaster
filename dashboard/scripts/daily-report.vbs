' daily-report.vbs - the silent launcher.
'
' Task Scheduler running powershell.exe -WindowStyle Hidden STILL creates a
' console host and steals focus at every fire. Launching through wscript with
' window style 0 means no console is ever created, so a daily report cannot
' interrupt whatever is on screen.
'
' powershell.exe (5.1), not pwsh: the WinRT toast API does not load on 7.

Option Explicit
Dim shell, fso, here, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = here & "\daily-report.ps1"

' 0 = hidden window, False = do not wait for it to finish.
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
