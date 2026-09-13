Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fs.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
result = shell.Run("node scripts\desktop.mjs", 0, True)
If Err.Number <> 0 Or result <> 0 Then
  MsgBox "WebM TV could not start. Install Node.js LTS from nodejs.org, then try again. See data\desktop.log for details.", 48, "WebM TV"
End If
