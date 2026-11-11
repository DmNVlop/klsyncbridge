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
SetupMutex=KLSyncBridgeSetupMutex
UninstallDisplayIcon={app}\public\favicon.ico
WizardStyle=modern

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "prepare.ps1"; Flags: dontcopy
Source: "rollback-legacy.ps1"; Flags: dontcopy
Source: "..\build\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{commonappdata}\KLSyncBridge"

[Run]
; La post-instalación (installer-setup.js) se lanza desde [Code] para comprobar su código de salida.
Filename: "http://localhost:3847"; Description: "Abrir KLSyncBridge"; Flags: postinstall shellexec nowait skipifsilent; Check: PostInstallSucceeded

[UninstallRun]
Filename: "{app}\node.exe"; Parameters: """{app}\scripts\uninstall-service.js"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\src\daemon"

[Code]
var
  PostInstallOk: Boolean;
  PrepareRan: Boolean;

function MigrationMarker: String;
begin
  Result := ExpandConstant('{commonappdata}\KLSyncBridge\legacy-migration.json');
end;

function PostInstallSucceeded: Boolean;
begin
  Result := PostInstallOk;
end;

// [Run] ignora el código de salida: aquí se comprueba y, si falla, se avisa con la ruta del log.
procedure RunPostInstall;
var
  ResultCode: Integer;
  LogDir, LogFile: String;
begin
  LogDir := ExpandConstant('{commonappdata}\KLSyncBridge\logs');
  LogFile := LogDir + '\installer-setup.log';
  ForceDirectories(LogDir);
  WizardForm.StatusLabel.Caption := 'Configurando el servicio KLSyncBridge...';
  PostInstallOk := Exec(ExpandConstant('{cmd}'),
      '/C ""' + ExpandConstant('{app}\node.exe') + '" "' + ExpandConstant('{app}\scripts\installer-setup.js') +
      '" "' + ExpandConstant('{commonappdata}\KLSyncBridge') + '" > "' + LogFile + '" 2>&1"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  if PostInstallOk then
    DeleteFile(MigrationMarker)
  else
  begin
    Log('installer-setup.js falló. Código: ' + IntToStr(ResultCode) + '. Log: ' + LogFile);
    SuppressibleMsgBox('Los ficheros se han copiado, pero no se pudo configurar el servicio KLSyncBridge (código ' +
        IntToStr(ResultCode) + ').' + #13#10#13#10 + 'Revisa el log:' + #13#10 + LogFile + #13#10#13#10 +
        'Si era una instalación antigua, se intenta restaurar el servicio anterior (log: legacy-rollback.log, en la misma carpeta de logs).' + #13#10#13#10 +
        'Vuelve a ejecutar el instalador como administrador. Si sigue fallando, sigue los pasos de' + #13#10 +
        ExpandConstant('{app}\docs\INSTALL.md') + ' (apartado «Si el instalador falla») o contacta con soporte.', mbError, MB_OK, IDOK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    RunPostInstall;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Script, PersistentDir: String;
begin
  Result := '';
  ExtractTemporaryFile('prepare.ps1');
  ExtractTemporaryFile('rollback-legacy.ps1');
  // Copia persistente del rollback: la usa DeinitializeSetup y también soporte, a mano.
  PersistentDir := ExpandConstant('{commonappdata}\KLSyncBridge\installer');
  ForceDirectories(PersistentDir);
  if not FileCopy(ExpandConstant('{tmp}\rollback-legacy.ps1'), PersistentDir + '\rollback-legacy.ps1', False) then
    Log('No se pudo copiar rollback-legacy.ps1 a ' + PersistentDir);
  Script := ExpandConstant('{tmp}\prepare.ps1');
  PrepareRan := True;
  if not Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + ExpandConstant('{app}') +
      '" -DataRoot "' + ExpandConstant('{commonappdata}\KLSyncBridge') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    Result := 'No se pudo preparar la instalación (parar el servicio previo o migrar sus datos). Código: ' + IntToStr(ResultCode);
end;

// Si el Setup falló tras parar un servicio antiguo (marcador presente), se restaura ese servicio.
// Sin WizardForm: aquí la interfaz ya puede no existir.
procedure DeinitializeSetup;
var
  ResultCode: Integer;
  Script: String;
begin
  if PrepareRan and (not PostInstallOk) and FileExists(MigrationMarker) then
  begin
    Script := ExpandConstant('{commonappdata}\KLSyncBridge\installer\rollback-legacy.ps1');
    Log('Setup fallido con migración pendiente: restaurando el servicio antiguo.');
    if Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + ExpandConstant('{app}') +
        '" -DataRoot "' + ExpandConstant('{commonappdata}\KLSyncBridge') + '"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Log('rollback-legacy.ps1 terminó con código ' + IntToStr(ResultCode))
    else
      Log('No se pudo ejecutar rollback-legacy.ps1: ' + SysErrorMessage(ResultCode));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if MsgBox('¿Borrar también los datos de KLSyncBridge (configuración, automatizaciones e historial)?' + #13#10 +
        ExpandConstant('{commonappdata}\KLSyncBridge'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{commonappdata}\KLSyncBridge'), True, True, True);
end;
