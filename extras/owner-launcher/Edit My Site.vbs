' Edit My Site — opens the website editor with no console window.
' The owner double-clicks a desktop shortcut to this file.
'
' INSTALLER: set the client folder name on the line marked below, then make a
' desktop shortcut to this .vbs (rename it and give it an icon). This file and
' editor-launcher.ps1 must sit together at the repo root (next to engine\).

Option Explicit
Dim shell, scriptDir, client, cmd
Set shell = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' --- INSTALLER: put the client folder name between the quotes ----------------
client = "CLIENT_NAME_HERE"
' ----------------------------------------------------------------------------

cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ _
    & scriptDir & "editor-launcher.ps1"" -Client """ & client & """"

' 0 = hidden window, False = don't wait — nothing flashes on screen.
shell.Run cmd, 0, False
