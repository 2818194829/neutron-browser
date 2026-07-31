/**
 * 应用菜单模块
 * 创建适用于 Windows/macOS/Linux 的原生菜单
 */
const { Menu, app, shell, dialog } = require('electron');
const { IPC_CHANNELS, INTERNAL_PAGES } = require('../shared/constants');

function createAppMenu() {
  const isMac = process.platform === 'darwin';

  // 获取 windowManager 的引用（运行时解析）
  const getWM = () => global.windowManager;

  const template = [
    // macOS 应用菜单
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 Neutron Browser' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    }] : []),

    // 文件菜单
    {
      label: '文件',
      submenu: [
        {
          label: '新建标签页',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.NEW_TAB);
          },
        },
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const wm = getWM();
            if (wm) wm.createMainWindow();
          },
        },
        {
          label: '新建无痕窗口',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            // TODO: 实现无痕模式
          },
        },
        { type: 'separator' },
        {
          label: '打开文件...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [
                { name: '网页', extensions: ['html', 'htm'] },
                { name: '所有文件', extensions: ['*'] },
              ],
            }).then(result => {
              if (!result.canceled && result.filePaths.length > 0) {
                const wm = getWM();
                if (wm) wm.createTab(`file://${result.filePaths[0]}`);
              }
            });
          },
        },
        { type: 'separator' },
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) wm.closeTab(wm.activeTabId);
          },
        },
        {
          label: '关闭窗口',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            const win = require('electron').BrowserWindow.getFocusedWindow();
            if (win) win.close();
          },
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit', label: '退出' }]),
      ],
    },

    // 编辑菜单
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },

    // 视图菜单
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) tab.view.webContents.reload();
            }
          },
        },
        {
          label: '强制重新加载',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) tab.view.webContents.reloadIgnoringCache();
            }
          },
        },
        { type: 'separator' },
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) {
                const currentZoom = tab.view.webContents.getZoomLevel();
                tab.view.webContents.setZoomLevel(currentZoom + 0.5);
              }
            }
          },
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) {
                const currentZoom = tab.view.webContents.getZoomLevel();
                tab.view.webContents.setZoomLevel(currentZoom - 0.5);
              }
            }
          },
        },
        {
          label: '实际大小',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) tab.view.webContents.setZoomLevel(0);
            }
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const wm = getWM();
            if (wm && wm.activeTabId) {
              const tab = wm.tabs.find(t => t.id === wm.activeTabId);
              if (tab && tab.view) tab.view.webContents.openDevTools({ mode: 'detach' });
            } else if (wm && wm.mainWindow) {
              wm.mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
          },
        },
      ],
    },

    // 历史菜单
    {
      label: '历史',
      submenu: [
        {
          label: '显示全部历史记录',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.HISTORY);
          },
        },
        {
          label: '显示最近关闭的标签页',
          click: () => {
            // TODO
          },
        },
        { type: 'separator' },
        {
          label: '清除浏览数据...',
          accelerator: 'CmdOrCtrl+Shift+Delete',
          click: () => {
            const wm = getWM();
            if (wm && wm.mainWindow) {
              wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action: 'clearBrowsingData' });
            }
          },
        },
      ],
    },

    // 书签菜单
    {
      label: '书签',
      submenu: [
        {
          label: '为此页面添加书签',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            const wm = getWM();
            if (wm && wm.mainWindow) {
              wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action: 'addBookmark' });
            }
          },
        },
        {
          label: '书签管理器',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.BOOKMARKS);
          },
        },
        { type: 'separator' },
        {
          label: '导入书签',
          click: () => {
            const wm = getWM();
            if (wm && wm.mainWindow) {
              wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action: 'importBookmarks' });
            }
          },
        },
        {
          label: '导出书签',
          click: () => {
            const wm = getWM();
            if (wm && wm.mainWindow) {
              wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action: 'exportBookmarks' });
            }
          },
        },
      ],
    },

    // 工具菜单
    {
      label: '工具',
      submenu: [
        {
          label: '下载内容',
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.DOWNLOADS);
          },
        },
        {
          label: '扩展程序',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.EXTENSIONS);
          },
        },
        { type: 'separator' },
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const wm = getWM();
            if (wm) wm.createTab(INTERNAL_PAGES.SETTINGS);
          },
        },
      ],
    },

    // 帮助菜单
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Neutron Browser',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 Neutron Browser',
              message: 'Neutron Browser v1.0.0',
              detail: '一款基于 Electron 的现代 PC 级浏览器。\n具备多标签页、书签管理、历史记录、下载管理等核心功能。\n\n基于 Chromium 内核构建。',
            });
          },
        },
        {
          label: '报告问题',
          click: () => {
            shell.openExternal('https://github.com/neutron-browser/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { createAppMenu };
