# Clavis

**English** · [简体中文](#clavis-中文)

Clavis is a Tauri-based desktop document editor for **Markdown, LaTeX, and
Typst**, with live preview, SyncTeX, BibTeX integration, and full-text PDF
search.

## Features

- Live Markdown preview (KaTeX math)
- LaTeX compilation (pdflatex / xelatex / lualatex) + PDF preview + forward/reverse SyncTeX
- Embedded Typst rendering + PDF export
- Multi-file LaTeX projects: merged outline, click-through on `\input`/`\include`,
  compile errors that jump to the right source file, citations that jump to their
  `.bib` definition
- Tabs, folder browser, command palette, keyboard shortcuts
- Autosave & session restore, recent files / recent projects
- Layered settings (Appearance / Editor / LaTeX & PDF / Preview / Updates)
- Project-local fonts & assets bundled into the compile directory automatically
- In-app update check with auto-update

## Install

### Download an installer (recommended)

Grab the installer for your platform from the
[Releases page](https://github.com/ziwangprincex/Clavis/releases/latest):

- **Windows**: `.exe` (NSIS installer)
- **macOS**: `.dmg`
- **Linux**: `.AppImage`

> The app is not yet OS-code-signed, so the first launch may trigger a Gatekeeper
> (macOS) or SmartScreen (Windows) prompt — choose “Open / Run anyway”.

### Auto-update

After install, Clavis silently checks for updates on startup, and you can check
manually any time:

- **Settings → Updates → Check for Updates**, or
- Command palette (`Ctrl/Cmd+Shift+P`) → “Check for Updates…”

When a new version is found it prompts you; on confirm it downloads, verifies the
signature, and relaunches into the new version.

### For LaTeX / Typst

- **LaTeX** (optional): install TeX Live or MiKTeX (XeLaTeX recommended — best CJK
  and custom-font support).
- **Typst**: nothing extra to install; rendering and fonts are built in.

## Build from source

For developers / contributors. For normal use, download an installer (above).

### Prerequisites

- **Rust 1.75+** — <https://rustup.rs/>
- **Node.js 18+** and npm — <https://nodejs.org/>
- **Tauri CLI** (installed automatically on first build via `cargo install`, or use the project-local one)
- **System dependencies**:
  - **Windows**: WebView2 (bundled on Windows 11; on Win10 install the Edge WebView2 Runtime)
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `webkit2gtk-4.0`, `libappindicator`, `librsvg2-dev` (apt on Debian/Ubuntu)
- **A LaTeX engine** (optional, only for LaTeX): TeX Live or MiKTeX (XeLaTeX recommended)

### Steps

```bash
git clone https://github.com/ziwangprincex/Clavis.git
cd Clavis
cd web && npm install && cd ..
cargo tauri dev          # native window with hot reload
```

First run compiles ~570 Rust crates (~4–8 min); incremental builds are seconds.

### Tests

```bash
cargo test               # Rust unit tests
cd web && npm test       # frontend unit tests (Vitest)
```

### Build a distributable

```bash
cargo tauri build
```

Output:

- Windows: `target/release/bundle/nsis/Clavis_1.0.0_x64-setup.exe`
- macOS: `target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg`
- Linux: `target/release/bundle/deb/` or `appimage/`

macOS one-shot build script: [`BUILD_MACOS.md`](BUILD_MACOS.md).
Release process (tag → multi-platform build + signing): [`RELEASING.md`](RELEASING.md).

## Tips

- On launch, pick a file or folder as your working directory
- XeLaTeX is recommended (best CJK / custom-font support)
- Local fonts / assets in your project are bundled into the temp compile directory
- Command palette: `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`); Compile: `Ctrl+B` / `Cmd+B`

## Notes

This is the source repository; build artifacts are not version-controlled. See the
security model in [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md).

---

# Clavis (中文)

[English](#clavis) · **简体中文**

Clavis 是一个基于 Tauri 的桌面文档编辑器，支持 **Markdown、LaTeX 和 Typst**，
提供实时预览、SyncTeX、BibTeX 集成、PDF 全文搜索等功能。

## 功能

- Markdown 实时预览（KaTeX 数学公式）
- LaTeX 编译（pdflatex / xelatex / lualatex）+ PDF 预览 + SyncTeX 正反向跳转
- Typst 内嵌渲染 + PDF 导出
- 多文件 LaTeX 项目：合并大纲、点击 `\input`/`\include` 跳转、编译错误直达对应源文件、参考文献跳转到 `.bib` 定义
- 多标签、文件夹浏览、命令面板、快捷键
- 自动保存与会话恢复、最近文件 / 最近项目
- 分层设置面板（外观 / 编辑器 / LaTeX & PDF / 预览 / 更新）
- 项目本地字体、资源文件自动打包到编译目录
- 应用内检查与自动更新

## 安装

### 下载安装包（推荐）

从 [Releases 页面](https://github.com/ziwangprincex/Clavis/releases/latest)
下载对应平台的安装包：

- **Windows**：`.exe`（NSIS 安装程序）
- **macOS**：`.dmg`
- **Linux**：`.AppImage`

> 应用暂未做操作系统级代码签名，首次打开可能触发 Gatekeeper（macOS）或
> SmartScreen（Windows）提示，选择“仍要打开 / 运行”即可。

### 自动更新

安装后，Clavis 会在启动时静默检查更新，也可随时手动检查：

- **设置 → Updates → Check for Updates**，或
- 命令面板（`Ctrl/Cmd+Shift+P`）→ “Check for Updates…”

发现新版本时会提示，确认后自动下载、校验签名并重启到新版本。

### 使用 LaTeX / Typst

- **LaTeX**（可选）：安装 TeX Live 或 MiKTeX（推荐 XeLaTeX，对中文和自定义字体支持最好）。
- **Typst**：无需额外安装，渲染与字体已内置。

## 从源码构建

面向开发者 / 贡献者。普通使用请直接下载安装包（见上）。

### 依赖

- **Rust 1.75+** — <https://rustup.rs/>
- **Node.js 18+** 和 npm — <https://nodejs.org/>
- **Tauri CLI**（首次构建自动通过 `cargo install` 安装，也可用项目本地版本）
- **系统级依赖**：
  - **Windows**: WebView2（Windows 11 已内置，Win10 需手动装 Edge WebView2 Runtime）
  - **macOS**: Xcode Command Line Tools（`xcode-select --install`）
  - **Linux**: `webkit2gtk-4.0`、`libappindicator`、`librsvg2-dev`（Debian/Ubuntu 用 apt 装）
- **LaTeX 引擎**（可选，仅使用 LaTeX 功能时需要）：TeX Live 或 MiKTeX（推荐 XeLaTeX）

### 步骤

```bash
git clone https://github.com/ziwangprincex/Clavis.git
cd Clavis
cd web && npm install && cd ..
cargo tauri dev          # 原生窗口 + 热重载
```

首次运行需要编译 ~570 个 Rust crate，约 4-8 分钟；之后增量编译只需几秒。

### 运行测试

```bash
cargo test               # Rust 单元测试
cd web && npm test       # 前端单元测试（Vitest）
```

### 构建可分发安装包

```bash
cargo tauri build
```

产物位置：

- Windows: `target/release/bundle/nsis/Clavis_1.0.0_x64-setup.exe`
- macOS: `target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg`
- Linux: `target/release/bundle/deb/` 或 `appimage/`

macOS 的一键构建脚本见 [`BUILD_MACOS.md`](BUILD_MACOS.md)。
发布新版本（打 tag 触发多平台自动构建 + 签名）的流程见 [`RELEASING.md`](RELEASING.md)。

## 使用提示

- 启动后先选择文件或文件夹作为工作目录
- LaTeX 推荐使用 XeLaTeX（对中文和自定义字体支持最好）
- 如果项目里有本地字体或资源，Clavis 会一并打包到临时编译目录
- 命令面板：`Ctrl+Shift+P`（macOS: `Cmd+Shift+P`）；编译：`Ctrl+B` / `Cmd+B`

## 说明

这是源码仓库，构建产物不纳入版本控制。安全模型见
[`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)。
