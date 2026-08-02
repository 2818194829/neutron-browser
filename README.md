# Neutron Browser

Neutron Browser 是一款基于 Electron 的现代 PC 级浏览器，支持多标签页、书签管理、历史记录、下载管理、扩展安装，以及接近 Edge 的网页右键菜单体验。

当前版本：**1.7.0**

GitHub：[https://github.com/2818194829/neutron-browser](https://github.com/2818194829/neutron-browser)

Release：[v1.7.0](https://github.com/2818194829/neutron-browser/releases/tag/v1.7.0)

## 功能特性

### 浏览器核心

- **多标签页浏览**：新建、切换、关闭、拖拽排序、固定、静音、复制标签页
- **智能地址栏**：自动识别网址、IP、本地路径和搜索关键词
- **导航控制**：后退、前进、刷新、停止、主页，支持鼠标侧键
- **网页右键菜单**：参考 Edge 提供链接、图片、媒体、文本编辑、页面导航、打印和检查元素等操作
- **书签栏网站图标**：自动读取网站 favicon，失败时自动回退
- **书签栏右键菜单**：打开、后台打开、编辑、删除、复制链接
- **无边框窗口**：自定义标题栏、窗口控制按钮和窗口状态记忆
- **Edge 风格主题系统**：7 种强调色 × 12 套主题皮肤（含花纹 / 动漫氛围）× 明暗模式，设置页可视化选择
- **完整快捷键**：Chrome 风格快捷键

### 数据管理

- **书签管理**：书签栏快捷访问、文件夹整理、书签管理器、添加/编辑/移除
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
build\Neutron Browser Setup 1.7.0.exe
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

### 1.7.0

- 全新 Edge 风格主题系统：7 种强调色（蓝 / 红 / 绿 / 紫 / 橙 / 粉 / 青）× 12 套主题皮肤（海洋 / 森林 / 日落 / 午夜 / 玫瑰 + 波纹 / 棋盘 / 星空 / 樱花 / 薄荷 / 黄昏）× 明暗模式，三维正交自由组合
- 设置页外观面板重构：强调色色点选择器 + 主题皮肤卡片网格（含迷你预览），修改即时生效、主窗口实时同步
- 主题皮肤覆盖整个浏览器色带：标题栏、标签栏、工具栏、书签栏连成渐变 / 花纹色带，激活标签页"浮起"效果
- 书签栏跟随主题皮肤变色，文件夹文字自动适配色带可读性
- 修复设置页修改主题后主窗口不实时生效的问题
- 修复历史记录和书签栏中网站图标与标题串站的问题，历史记录按真实页面 URL 记录标题和图标
- 修复"检查更新"导致应用闪退的问题
- 安装包、桌面快捷方式与软件图标保持统一，新增图标生成脚本


### 1.6.3

- 修复历史记录和书签栏中网站图标与标题串站的问题
- 历史记录按真实页面 URL 记录标题和图标，页面标题/图标更新后自动同步
- 清除历史遗留的错误 favicon 和无效默认标题

### 1.6.2

- 修复“检查更新”导致应用闪退的问题
- 安装包、桌面快捷方式与软件图标保持统一
- 新增图标生成脚本，打包时自动从源图标刷新构建图标

### 1.6.0

- 新增设置页“检查更新”功能，支持检测 GitHub 最新版本并跳转下载
- 下载界面重构为工具栏悬浮面板，支持实时进度、打开文件、打开文件夹、删除、搜索、清空列表
- 历史记录重构为工具栏悬浮面板，支持搜索、时间分组、最近关闭标签页恢复、固定面板
- 修复标签页独立会话导致网站登录状态丢失的问题，Cookie 和本地存储跨标签页共享并持久保存
- 修复书签栏空文件夹弹层过窄，以及点击其他书签不跳转的问题
- 修复下载记录保存路径为空导致“打开文件/打开文件夹”无反应的问题
- 修复视频网站点击全屏无法全屏播放的问题
- 历史记录图标支持多级自动识别，并随访问保存网站 favicon
- run.bat 启动时清理 ELECTRON_RUN_AS_NODE，避免特殊环境下 Electron 被当作 Node 启动

### 1.5.2

- 修复标签页使用独立会话导致网站登录状态丢失的问题，Cookie 和本地存储现在跨标签页共享并持久保存
- 修复书签栏空文件夹弹层过窄，以及点击其他书签不跳转的问题
- 书签栏文件夹右键菜单改为原生菜单，避免被网页视图遮挡
- 文件夹内书签支持网站图标识别，并可拖到书签栏
- run.bat 启动时清理 ELECTRON_RUN_AS_NODE，避免特殊环境下 Electron 被当作 Node 启动

### 1.5.1

- 修复书签栏文件夹弹窗被网页内容遮挡，导致无法查看二级书签的问题

### 1.5.0

- 新增工具栏 Edge 风格扩展弹窗：快速查看已安装扩展、站点权限开关
- 扩展管理页整体重构为 Edge 风格左右两栏布局，支持暗色主题
- 扩展信息增强：记录扩展来源（Edge 商店 / 本地）、后台类型与权限列表
- 书签栏文件夹支持弹出子菜单，新增书签文件夹新建/编辑对话框
- 新增内容快照机制，解决弹窗被 BrowserView 遮挡的问题
- UI 样式引入 Tailwind 构建（ui.css），主界面样式统一管理

### 1.4.0

- 设置页整体重构为 Edge 风格左右两栏布局
- 外观板块改为卡片式分组布局
- 启动、主页和新选项卡页支持启动模式、首页按钮、新选项卡预加载和 Windows 自启动设置

### 1.3.0

- 新增书签栏文件夹整理：文件夹可显示在书签栏，支持创建子文件夹并存放书签
- 书签栏支持拖拽排序书签和文件夹，并可将书签或文件夹拖入其他文件夹
- 书签管理器显示嵌套文件夹，支持直接新建文件夹

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
