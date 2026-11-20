; Ringside Booker - Windows installer (POL9-09), Inno Setup 6.
;
; Built by game/tools/build-installer.sh, which packages the game first and then runs:
;   ISCC.exe /DAppVersion=<version> /DSourceDir=<packaged folder> /DOutputDir=<game\Builds>
;            [/DSetupIcon=<app .ico>] [/DSignToolName=rbsign "/Srbsign=<signtool command>"]
;            game\installer\RingsideBooker.iss
; See game/docs/installer.md for the options, silent install and the signing hook.
;
; Never change AppId: a newer installer with the same AppId upgrades the game in place.

#ifndef AppVersion
  #error Pass the game version: ISCC /DAppVersion=0.1.0-alpha.1+abcdef12 ...
#endif
#ifndef SourceDir
  #error Pass the packaged game folder: ISCC /DSourceDir=C:\...\RingsideBooker-<version>-win64 ...
#endif
#ifndef OutputDir
  #define OutputDir "..\Builds"
#endif

#define AppName "Ringside Booker"
#define AppPublisher "jpDxsolo"
#define AppExeName "RingsideBooker.exe"
#define AppUrl "https://github.com/jpDxsoloOrg/ringside-booker"

; Windows file-version resources need four numbers. Take "0.1.0" from the front of the version and
; the alpha number N from "-alpha.N" when there is one: 0.1.0-alpha.3+abc -> 0.1.0.3.
#define VersionCore Copy(AppVersion, 1, Pos("-", AppVersion + "-") - 1)
#define VersionCore Copy(VersionCore, 1, Pos("+", VersionCore + "+") - 1)
#define AlphaPos Pos("-alpha.", AppVersion)
#if AlphaPos > 0
  #define AlphaTail Copy(AppVersion, AlphaPos + 7, 32)
  #define AlphaTail Copy(AlphaTail, 1, Pos("+", AlphaTail + "+") - 1)
  #define AlphaTail Copy(AlphaTail, 1, Pos(".", AlphaTail + ".") - 1)
  #define FileVersion VersionCore + "." + AlphaTail
#else
  #define FileVersion VersionCore + ".0"
#endif

[Setup]
AppId={{56E79425-5C38-4649-9270-1D9D6D0497BE}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
VersionInfoVersion={#FileVersion}
VersionInfoProductVersion={#FileVersion}
VersionInfoProductTextVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup
; Per user by default (no admin prompt): {autopf} is %LOCALAPPDATA%\Programs. The first page offers
; "install for all users" (Program Files, needs admin) as well.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
LicenseFile=LICENSE-alpha.txt
InfoBeforeFile={#SourceDir}\licenses\THIRD-PARTY-NOTICES.txt
OutputDir={#OutputDir}
OutputBaseFilename=RingsideBooker-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
; Upgrades: close a running game through the Restart Manager before files are replaced; don't
; restart it afterwards (the finished page offers "Launch").
CloseApplications=force
CloseApplicationsFilter=*.exe,*.dll
RestartApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
#ifdef SetupIcon
SetupIconFile={#SetupIcon}
#endif
; Code-signing hook (no certificate yet): build-installer.sh passes /DSignToolName=rbsign and
; "/Srbsign=<signtool command with $f>" when RB_SIGNTOOL is set. Setup and uninstaller get signed.
#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; An upgrade replaces the whole player, so files a newer build no longer has don't linger.
; Saves live elsewhere (AppData\LocalLow), never under {app}.
Type: filesandordirs; Name: "{app}\RingsideBooker_Data"
Type: filesandordirs; Name: "{app}\MonoBleedingEdge"
Type: filesandordirs; Name: "{app}\D3D12"
Type: filesandordirs; Name: "{app}\licenses"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "LICENSE-alpha.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; In-game update (POL9-11): the game starts this installer with /SILENT ... /RBUPDATE and quits;
; start the updated game again when the install is done (as the player, not elevated).
Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Flags: nowait runasoriginaluser skipifnotsilent; Check: CmdLineHas('/RBUPDATE')

[UninstallDelete]
; Unity writes nothing under {app} at run time, but clear the folder if anything was left.
Type: dirifempty; Name: "{app}"

[Code]
// Saves, imported workshop worlds and logs live in Unity's persistentDataPath:
// %USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker. Uninstall keeps them unless the player
// ticks "Also delete my saves and imported worlds" (off by default), or a silent uninstall is run
// with /DELETESAVES. Settings (PlayerPrefs, HKCU\Software\jpDxsolo\Ringside Booker) are kept.
var
  DeleteSaves: Boolean;

function SavesDir(): String;
begin
  // {localappdata} is ...\AppData\Local; LocalLow is its sibling.
  Result := ExtractFileDir(ExpandConstant('{localappdata}')) + '\LocalLow\{#AppPublisher}\{#AppName}';
end;

function CmdLineHas(const Flag: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Flag) = 0 then
      Result := True;
end;

function AskDeleteSaves(): Boolean;
var
  Form: TSetupForm;
  Info: TNewStaticText;
  Box: TNewCheckBox;
  OkButton, CancelButton: TNewButton;
begin
  Result := False;
  DeleteSaves := False;
  Form := CreateCustomForm(ScaleX(440), ScaleY(170), False, True);
  try
    Form.Caption := 'Uninstall {#AppName}';

    Info := TNewStaticText.Create(Form);
    Info.Parent := Form;
    Info.Left := ScaleX(16);
    Info.Top := ScaleY(16);
    Info.Width := Form.ClientWidth - ScaleX(32);
    Info.AutoSize := False;
    Info.WordWrap := True;
    Info.Height := ScaleY(48);
    Info.Caption := '{#AppName} will be removed from your computer. Your saves and imported ' +
      'worlds are kept, so they are still there if you install the game again.';

    Box := TNewCheckBox.Create(Form);
    Box.Parent := Form;
    Box.Left := ScaleX(16);
    Box.Top := Info.Top + Info.Height + ScaleY(12);
    Box.Width := Form.ClientWidth - ScaleX(32);
    Box.Height := ScaleY(20);
    Box.Caption := 'Also delete my saves and imported worlds';
    Box.Checked := False;

    OkButton := TNewButton.Create(Form);
    OkButton.Parent := Form;
    OkButton.Caption := 'Uninstall';
    OkButton.Width := ScaleX(90);
    OkButton.Height := ScaleY(26);
    OkButton.Left := Form.ClientWidth - ScaleX(16) - 2 * OkButton.Width - ScaleX(8);
    OkButton.Top := Form.ClientHeight - ScaleY(16) - OkButton.Height;
    OkButton.ModalResult := mrOk;
    OkButton.Default := True;

    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.Caption := SetupMessage(msgButtonCancel);
    CancelButton.Width := OkButton.Width;
    CancelButton.Height := OkButton.Height;
    CancelButton.Left := Form.ClientWidth - ScaleX(16) - CancelButton.Width;
    CancelButton.Top := OkButton.Top;
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;

    if Form.ShowModal() = mrOk then
    begin
      Result := True;
      DeleteSaves := Box.Checked;
    end;
  finally
    Form.Free();
  end;
end;

function InitializeUninstall(): Boolean;
begin
  if UninstallSilent() then
  begin
    DeleteSaves := CmdLineHas('/DELETESAVES');
    Result := True;
  end
  else
    Result := AskDeleteSaves();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Dir: String;
begin
  if (CurUninstallStep = usPostUninstall) and DeleteSaves then
  begin
    Dir := SavesDir();
    if DirExists(Dir) then
    begin
      Log('Deleting saves and imported worlds: ' + Dir);
      if not DelTree(Dir, True, True, True) then
        Log('Could not delete everything in ' + Dir);
    end;
  end;
end;
