' 토익 900 단어장 - 독립 실행 런처
' 서버를 안 보이게 백그라운드로 띄우고, 브라우저를 "앱 모드"(주소창/탭 없는 창)로 엽니다.
' 앱 창을 닫으면 백그라운드 서버도 함께 자동 종료됩니다.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir

' 서버를 콘솔 창 없이 백그라운드로 실행
' (python.exe/py.exe는 콘솔 프로그램이라 숨김 옵션을 줘도 창이 생길 수 있어서,
'  콘솔이 아예 없는 pythonw.exe를 사용합니다 - 확실하게 창이 안 뜸)
pythonwPath = "C:\Program Files (x86)\Microsoft Visual Studio\Shared\Python39_64\pythonw.exe"

Set serverProc = shell.Exec("""" & pythonwPath & """ -m http.server 5500")
serverPID = serverProc.ProcessID

' 서버가 뜰 때까지 잠깐 대기
WScript.Sleep 1000

appUrl = "http://localhost:5500/"
profileDir = scriptDir & "\.appdata"
appArgs = " --app=" & appUrl & " --window-size=480,900 --window-position=200,60" & _
          " --user-data-dir=""" & profileDir & """ --no-first-run --no-default-browser-check"

chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePathX86 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath) Then
  shell.Run """" & chromePath & """" & appArgs, 1, True
ElseIf fso.FileExists(chromePathX86) Then
  shell.Run """" & chromePathX86 & """" & appArgs, 1, True
ElseIf fso.FileExists(edgePath) Then
  shell.Run """" & edgePath & """" & appArgs, 1, True
ElseIf fso.FileExists(edgePath2) Then
  shell.Run """" & edgePath2 & """" & appArgs, 1, True
Else
  ' Chrome/Edge를 못 찾으면 기본 브라우저로라도 열어줌
  shell.Run appUrl, 1, True
End If

' 앱 창이 닫히면(위 Run이 반환되면) 백그라운드 서버를 함께 종료
On Error Resume Next
shell.Run "taskkill /PID " & serverPID & " /T /F", 0, True
On Error Goto 0
