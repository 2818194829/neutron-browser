# Neutron Browser

Neutron Browser 是一款基于 Electron 的现代 PC 级浏览器，支持多标签页、书签管理、历史记录、下载管理、扩展安装，以及接近 Edge 的网页右键菜单体验。

当前版本：**1.2.0**

GitHub：[https://github.com/2818194829/neutron-browser](https://github.com/2818194829/neutron-browser)

Release：[v1.2.0](https://github.com/2818194829/neutron-browser/releases/tag/v1.2.0)

## 功能特性

### 浏览器核心

- **多标签页浏览**：新建、切换、关闭、拖拽排序、固定、静音、复制标签页
- **智能地址栏**：自动识别网址、IP、本地路径和搜索关键词
- **导航控制**：后退、前进、刷新、停止、主页，支持鼠标侧键
- **网页右键菜单**：参考 Edge 提供链接、图片、媒体、文本编辑、页面导航、打印和检查元素等操作
- **书签栏网站图标**：自动读取网站 favicon，失败时自动回退
- **书签栏右键菜单**：打开、后台打开、编辑、删除、复制链接
- **无边框窗口**：自定义标题栏、窗口控制按钮和窗口状态记忆
- **亮色 / 暗色主题**：支持跟随系统
- **完整快捷键**：Chrome 风格快捷键

### 数据管理

- **书签管理**：书签栏快捷访问、书签管理器、添加/编辑/移除
- **历史记录**：按日期分组、搜索、单条删除、一键清除
- **下载管理**：下载进度、状态、速度、打开所在文件夹
- **JSON 持久化**：书签、历史、下载记录、设置、扩展信息

### 扩展系统

- 工具栏 Edge 风格扩展图标
- 扩展管理页
- 安装 `.crx` / `.zip` 扩展包
- 从微软 Edge 扩展商店按链接或扩展 ID 安装
- 加载已解压的扩展目录
- 启用 / 禁用扩展
- 卸载扩展
- 重启后自动加载已启用扩展

> 说明：Electron 对 Chrome/Edge 扩展 API 的支持不是 100%，简单扩展可以正常工作，复杂扩展可能无法完整运行。

## 技术栈

- **Electron** ≥ v28
- **原生 JavaScript**（ES2022+）
- **HTML5 / CSS3**：Flexbox、Grid、CSS Variables
- **electron-builder**：Windows NSIS 安装包
- **adm-zip**：扩展包解压
- **JSON 文件存储**：无需数据库
- **IPC 通信**：contextBridge + ipcMain / ipcRenderer

## 环境要求

- Windows 10 / 11
- Node.js ≥ 18.x
- npm ≥ 9.x

## 快速开始

```bash
cd "我的开发/02 我的PC浏览器"
npm install
```

运行开发版本：

```bash
npm start
```

打开 DevTools：

```bash
npm run dev
```

## 打包 Windows 安装程序

推荐使用项目内置的一键打包脚本：

```bash
npm run build:installer
```

脚本会自动完成：

1. 使用本地 Electron 目录打包，避免重复从 GitHub 下载
2. 使用国内镜像下载 NSIS 构建工具
3. 写入产品图标和版本信息
4. 生成带安装向导的 NSIS 安装包

生成位置：

```text
build\Neutron Browser Setup 1.2.0.exe
```

安装包支持：

- 向导式安装界面
- 自定义安装目录
- 创建桌面快捷方式
- 创建开始菜单快捷方式

如果直接使用 electron-builder：

```bash
npm run build:win
```

## 项目结构

```text
├── package.json                 # 项目配置、脚本、依赖
├── package-lock.json            # 依赖锁定文件
├── electron-builder.yml         # electron-builder 配置
├── build-installer.ps1          # Windows 一键打包脚本
├── README.md                    # 项目说明
├── assets/                      # 构建资源、应用图标
├── icon/                        # 原始图标资源
├── src/
│   ├── main/
│   │   ├── index.js             # 主进程入口
│   │   ├── windowManager.js     # 窗口、标签页、右键菜单管理
│   │   ├── menu.js              # 应用菜单
│   │   ├── ipcHandlers.js       # IPC 处理器
│   │   ├── extensions.js        # 扩展安装、加载、卸载
│   │   └── storage/
│   │       └── index.js         # JSON 数据存储
│   ├── renderer/
│   │   ├── app.html             # 主窗口结构
│   │   ├── app.css              # 全局样式
│   │   ├── app.js               # 主界面逻辑
│   │   ├── preload.js           # 安全预加载桥接
│   │   └── pages/               # 内置页面
│   │       ├── newtab.html      # 新标签页
│   │       ├── settings.html    # 设置
│   │       ├── history.html     # 历史记录
│   │       ├── bookmarks.html   # 书签管理器
│   │       ├── downloads.html   # 下载管理
│   │       └── extensions.html  # 扩展管理
│   └── shared/
│       └── constants.js         # 共享 IPC 常量和默认配置
└── build/                       # 打包输出目录
```

## 键盘快捷键

| 功能 | Windows/Linux | macOS |
|---|---|---|
| 新建标签页 | Ctrl+T | Cmd+T |
| 关闭标签页 | Ctrl+W | Cmd+W |
| 切换标签页 | Ctrl+Tab | Cmd+Tab |
| 聚焦地址栏 | Ctrl+L | Cmd+L |
| 刷新 | Ctrl+R / F5 | Cmd+R |
| 硬刷新 | Ctrl+Shift+R | Cmd+Shift+R |
| 添加书签 | Ctrl+D | Cmd+D |
| 书签管理器 | Ctrl+Shift+O | Cmd+Shift+O |
| 历史记录 | Ctrl+H | Cmd+H |
| 下载内容 | Ctrl+J | Cmd+J |
| 设置 | Ctrl+, | Cmd+, |

## 内置页面

可通过地址栏输入或快捷键访问：

- `neutron://newtab` - 新标签页
- `neutron://settings` - 设置
- `neutron://history` - 历史记录
- `neutron://bookmarks` - 书签管理器
- `neutron://downloads` - 下载管理
- `neutron://extensions` - 扩展管理

## 扩展安装说明

1. 点击工具栏中的拼图扩展图标
2. 在扩展管理页点击“安装扩展 (.crx/.zip)”
3. 选择本地扩展包
4. 安装成功后可在扩展页启用、禁用或卸载

也可以点击“加载已解压扩展”，直接选择包含 `manifest.json` 的扩展目录。

扩展文件会保存在：

```text
%APPDATA%\neutron-browser\NeutronBrowser\extensions\
```

## 数据存储位置

浏览器数据保存在：

```text
%APPDATA%\neutron-browser\NeutronBrowser\
```

包含：

- `bookmarks.json`：书签
- `history.json`：历史记录
- `downloads.json`：下载记录
- `settings.json`：设置
- `extensions.json`：扩展信息
- `extensions\`：扩展文件

## 安全设计

- `contextIsolation: true`
- `nodeIntegration: false`
- 通过 `contextBridge` 暴露受限 API
- 内部页面使用 `neutron://` 协议
- 下载、权限、弹窗和渲染进程崩溃均有处理

## 已知限制

- Electron 对扩展 API 支持有限，复杂扩展可能无法使用
- 暂不支持账户同步、密码管理器、自动更新
- 暂不支持无痕模式
- 暂不支持完整 Manifest V3 后台 Service Worker 生态

## 版本记录

### 1.2.0

- 新增从微软 Edge 扩展商店安装扩展
- 新增书签栏右键菜单
- 针对微软扩展商店使用 Edge User-Agent，避免页面提示浏览器不兼容

### 1.1.0

- 新增扩展管理：工具栏扩展图标、`.crx/.zip` 安装、已解压扩展加载、启用/禁用/卸载
- 新增 Edge 风格网页右键菜单
- 书签栏自动显示网站 favicon
- 修复书签栏初始化不渲染的问题
- 修复添加书签弹窗被 BrowserView 遮挡的问题

### 1.0.0

- 初始版本
- 多标签页、导航、书签、历史、下载、设置、主题、快捷键

## 许可证

MIT
