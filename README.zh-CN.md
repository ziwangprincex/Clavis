# Clavis

[English](README.md) · [简体中文](README.zh-CN.md)

一个用 Tauri 做的桌面编辑器，支持 Markdown、LaTeX 和 Typst。有实时预览、
带 SyncTeX 的 LaTeX 编译、BibTeX 支持和 PDF 搜索。

## 功能

- Markdown 预览，支持 KaTeX 数学公式
- LaTeX 编译（pdflatex / xelatex / lualatex）、PDF 预览、SyncTeX（源码和 PDF 互相跳转）
- Typst 预览和 PDF 导出
- 多文件 LaTeX 项目：合并的大纲、可点击的 `\input`/`\include`、编译错误能打开对应文件、引用能跳到它的 `.bib` 条目
- 多标签、文件夹树、命令面板、快捷键
- 自动保存和会话恢复；最近文件和文件夹
- 设置按类别分组（外观、编辑器、LaTeX & PDF、预览、更新）
- 项目里的字体和资源会自动打包进编译目录
- 内置更新检查

## 安装

从 [Releases 页面](https://github.com/ziwangprincex/Clavis/releases/latest)
下载对应平台的安装包：

- Windows — `.exe`
- macOS — `.dmg`
- Linux — `.AppImage`

应用还没有做操作系统级的代码签名，所以首次打开时 Windows 的 SmartScreen 或
macOS 的 Gatekeeper 可能会提示，选“仍要打开 / 仍要运行”即可。

### 更新

Clavis 启动时会检查更新。也可以手动检查：**设置 → Updates → Check for Updates**，
或命令面板（`Ctrl/Cmd+Shift+P`）→ “Check for Updates…”。有新版本时会先询问，
确认后下载并重启到新版本。

### LaTeX 和 Typst

- LaTeX 是可选的。需要的话装 TeX Live 或 MiKTeX（XeLaTeX 对中文和自定义字体支持最好）。
- Typst 不需要额外安装，已内置。

## 从源码构建

面向开发。只是想用的话，直接下载上面的安装包。

需要 Rust 1.75+、Node.js 18+，以及 Tauri 需要的系统依赖（Windows 上的 WebView2、
macOS 的 Xcode 命令行工具、Linux 上的 `webkit2gtk-4.0` 等）。

```bash
git clone https://github.com/ziwangprincex/Clavis.git
cd Clavis
cd web && npm install && cd ..
cargo tauri dev          # 打开一个带热重载的窗口
```

第一次构建要编译很多 Rust crate，需要几分钟；之后就快了。

### 测试

```bash
cargo test               # Rust
cd web && npm test       # 前端（Vitest）
```

### 打包安装程序

```bash
cargo tauri build
```

产物在 `target/release/bundle/` 下。macOS 构建脚本见
[`BUILD_MACOS.md`](BUILD_MACOS.md)；发布流程见 [`RELEASING.md`](RELEASING.md)。

## 使用提示

- 启动后先选一个文件或文件夹作为工作目录。
- 中文和自定义字体建议用 XeLaTeX。
- 命令面板：`Ctrl+Shift+P`（macOS 是 `Cmd+Shift+P`）；编译：`Ctrl+B` / `Cmd+B`。

## 说明

构建产物不纳入版本控制。安全模型见
[`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)。
