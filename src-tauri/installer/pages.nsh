; MUI draws the installer icon at the right of the standard header. A blank
; right-side header image replaces that icon; the page title stays on the left.
!define MUI_HEADERIMAGE_RIGHT

; The installer opens directly on the main flow: skip MUI's welcome page.
!macroundef MUI_PAGE_WELCOME
!macro MUI_PAGE_WELCOME
  !insertmacro MUI_UNSET MUI_PAGE_CUSTOMFUNCTION_PRE
!macroend

; MUI's finish page reserves a 164px bitmap column. It is redefined as a
; regular full-width page so the installer has no sidebar.

!macroundef MUI_PAGE_FINISH
!macro MUI_PAGE_FINISH
  !insertmacro MUI_PAGE_INIT
  !insertmacro MUI_SET MUI_${MUI_PAGE_UNINSTALLER_PREFIX}FINISHPAGE ""
  !insertmacro MUI_DEFAULT MUI_FINISHPAGE_BUTTON "$(MUI_BUTTONTEXT_FINISH)"
  !insertmacro MUI_DEFAULT MUI_FINISHPAGE_RUN_TEXT "$(MUI_TEXT_FINISH_RUN)"

  Page custom OrdoFinishCreate OrdoFinishLeave
  Var OrdoFinishRun
  Var OrdoFinishShortcut

  Function OrdoFinishCreate
    ${If} $PassiveMode = 1
      Abort
    ${Else}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:${MUI_FINISHPAGE_BUTTON}"
      !insertmacro MUI_HEADER_TEXT "$(MUI_TEXT_FINISH_INFO_TITLE)" ""
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 55u "$(MUI_TEXT_FINISH_INFO_TEXT)"
      Pop $0
      ${NSD_CreateCheckbox} 0 60u 100% 10u "${MUI_FINISHPAGE_RUN_TEXT}"
      Pop $OrdoFinishRun
      SendMessage $OrdoFinishRun ${BM_SETCHECK} ${BST_CHECKED} 0
      ${NSD_CreateCheckbox} 0 75u 100% 10u "${MUI_FINISHPAGE_SHOWREADME_TEXT}"
      Pop $OrdoFinishShortcut
      SendMessage $OrdoFinishShortcut ${BM_SETCHECK} ${BST_CHECKED} 0
      nsDialogs::Show
    ${EndIf}
  FunctionEnd

  Function OrdoFinishLeave
    ${NSD_GetState} $OrdoFinishRun $0
    ${If} $0 == ${BST_CHECKED}
      Call "${MUI_FINISHPAGE_RUN_FUNCTION}"
    ${EndIf}
    ${NSD_GetState} $OrdoFinishShortcut $0
    ${If} $0 == ${BST_CHECKED}
      Call "${MUI_FINISHPAGE_SHOWREADME_FUNCTION}"
    ${EndIf}
  FunctionEnd
  !insertmacro MUI_UNSET MUI_PAGE_CUSTOMFUNCTION_PRE
  !insertmacro MUI_UNSET MUI_PAGE_CUSTOMFUNCTION_SHOW
  !insertmacro MUI_UNSET MUI_PAGE_CUSTOMFUNCTION_LEAVE
!macroend