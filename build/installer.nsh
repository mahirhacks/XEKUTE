!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!macro customHeader
  !undef UNINSTALL_FILENAME
  !define UNINSTALL_FILENAME "uninstall.exe"
  ShowInstDetails show
!macroend

!ifndef BUILD_UNINSTALLER
  Var desktopShortcutCheckbox
  Var taskbarShortcutCheckbox
  Var desktopShortcutChoice
  Var taskbarShortcutChoice

  !macro customPageAfterChangeDir
    Page custom installerShortcutsPageCreate installerShortcutsPageLeave
  !macroend

  Function installerShortcutsPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "Choose shortcuts"
    Pop $0
    ${NSD_CreateLabel} 0 20u 100% 32u "Windows cannot silently pin an application to the taskbar. The second option creates a Start Menu shortcut that you can pin manually if desired."
    Pop $0

    ${NSD_CreateCheckbox} 0 62u 100% 12u "Create a desktop shortcut"
    Pop $desktopShortcutCheckbox
    ${NSD_SetState} $desktopShortcutCheckbox ${BST_CHECKED}

    ${NSD_CreateCheckbox} 0 84u 100% 12u "Create a Start Menu shortcut (taskbar alternative)"
    Pop $taskbarShortcutCheckbox
    ${NSD_SetState} $taskbarShortcutCheckbox ${BST_CHECKED}

    nsDialogs::Show
  FunctionEnd

  Function installerShortcutsPageLeave
    ${NSD_GetState} $desktopShortcutCheckbox $desktopShortcutChoice
    ${NSD_GetState} $taskbarShortcutCheckbox $taskbarShortcutChoice
  FunctionEnd
!endif

!macro customInstall
  ${If} $desktopShortcutChoice == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    DetailPrint "Created desktop shortcut."
  ${Else}
    DetailPrint "Desktop shortcut skipped."
  ${EndIf}

  ${If} $taskbarShortcutChoice == ${BST_CHECKED}
    CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    DetailPrint "Created Start Menu shortcut. Pin it to the taskbar manually if desired."
  ${Else}
    DetailPrint "Start Menu shortcut skipped."
  ${EndIf}

  DetailPrint "NSIS will create uninstall.exe in the selected installation directory."
!macroend
