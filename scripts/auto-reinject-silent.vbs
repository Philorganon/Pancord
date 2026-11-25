Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "d:\Pancord"
shell.Run "node scripts/auto-reinject.mjs", 0, False
