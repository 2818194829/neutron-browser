; ============================================================
; Neutron Browser - NSIS 自定义脚本（Modern 风格向导）
; 作用：为向导式安装器补上「欢迎页」——electron-builder 26
; 默认不插入 MUI_PAGE_WELCOME，导致品牌侧边栏图
; （MUI_WELCOMEFINISHPAGE_BITMAP）只在完成页/卸载页显示。
; 此宏会被 assistedInstaller.nsh 的 !ifmacrodef 检测并插入。
; 本文件由 git 跟踪（assets/installer/），不会像 build/ 一样丢失。
; ============================================================

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
