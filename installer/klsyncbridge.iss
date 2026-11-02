; KLSyncBridge — Setup autocontenido (node.exe portátil + node_modules ya compilado).
; Se compila en GitHub Actions: iscc /DAppVersion=X.Y.Z installer\klsyncbridge.iss
; Fichero en UTF-8 con BOM (Inno lo necesita para los acentos).

#ifndef AppVersion
  #error Falta /DAppVersion=X.Y.Z
#endif

[Setup]
; AppId fijo para siempre: identifica el producto ante Windows (actualizar/desinstalar).
AppId={{D34C65EE-E5A1-4E2D-8DE5-743D2407A3BC}
AppName=KLSyncBridge
AppVersion={#AppVersion}
AppPublisher=KL
DefaultDirName={autopf}\KLSyncBridge
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=KLSyncBridge-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
SetupLogging=yes
UninstallDisplayIcon={app}\public\favicon.ico
WizardStyle=modern

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "prepare.ps1"; Flags: dontcopy
Source: "..\build\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{commonappdata}\KLSyncBridge"

[Run]
Filename: "{app}\node.exe"; Parameters: """{app}\scripts\installer-setup.js"" ""{commonappdata}\KLSyncBridge"""; WorkingDir: "{app}"; StatusMsg: "Configurando el servicio KLSyncBridge..."; Flags: runhidden waituntilterminated
Filename: "http://localhost:3847"; Description: "Abrir KLSyncBridge"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\node.exe"; Parameters: """{app}\scripts\uninstall-service.js"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\src\daemon"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Script: String;
begin
  Result := '';
  ExtractTemporaryFile('prepare.ps1');
  Script := ExpandConstant('{tmp}\prepare.ps1');
  if not Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + ExpandConstant('{app}') +
      '" -DataRoot "' + ExpandConstant('{commonappdata}\KLSyncBridge') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    Result := 'No se pudo preparar la instalación (parar el servicio previo o migrar sus datos). Código: ' + IntToStr(ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if MsgBox('¿Borrar también los datos de KLSyncBridge (configuración, automatizaciones e historial)?' + #13#10 +
        ExpandConstant('{commonappdata}\KLSyncBridge'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{commonappdata}\KLSyncBridge'), True, True, True);
end;
