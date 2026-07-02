# Clavis

Clavis 是一个基于 Tauri 的桌面文档编辑器，支持 Markdown、LaTeX 和 Typst，
提供实时预览、SyncTeX、BibTeX 集成、PDF 全文搜索等功能。

## 功能

- Markdown 实时预览（KaTeX 数学公式）
- LaTeX 编译（pdflatex / xelatex / lualatex）+ PDF 预览 + SyncTeX
- Typst 内嵌渲染 + PDF 导出
- 多标签、文件夹浏览、命令面板、快捷键
- 项目本地字体、资源文件自动打包到编译目录

## 安装（预编译版）

- macOS Apple Silicon: 下载 Release 里的 `Clavis_1.0.0_aarch64.dmg`

其他平台目前需要从源码构建。

## 从源码构建

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

克隆并进入项目：

```bash
git clone https://github.com/nanawanzii/Clavis.git
cd Clavis
```

安装前端依赖：

```bash
cd web
npm install
cd ..
```

启动开发环境（会自动开一个原生窗口，代码热重载）：

```bash
cargo tauri dev
```

首次运行需要编译 ~570 个 Rust crate，约 4-8 分钟。之后增量编译只需几秒。

### 构建可分发安装包

```bash
cargo tauri build
```

产物位置：

- Windows: `target/release/bundle/nsis/Clavis_1.0.0_x64-setup.exe`
- macOS: `target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg`
- Linux: `target/release/bundle/deb/` 或 `appimage/`

macOS 的一键构建脚本见 [`BUILD_MACOS.md`](BUILD_MACOS.md)。

## 使用提示

- 启动后先选择文件或文件夹作为工作目录
- LaTeX 推荐使用 XeLaTeX（对中文和自定义字体支持最好）
- 如果项目里有本地字体或资源，Clavis 会一并打包到临时编译目录
- 命令面板：`Ctrl+Shift+P`（macOS: `Cmd+Shift+P`）
- 编译：`Ctrl+R`

## 说明

这是源码仓库，构建产物不纳入版本控制。
