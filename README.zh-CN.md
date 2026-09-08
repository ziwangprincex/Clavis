<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="icons/logo-source-dark.svg">
    <img src="icons/logo-source.svg" alt="Clavis" width="128" height="128">
  </picture>
</p>

<h1 align="center">Clavis</h1>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

一个用于 Markdown、LaTeX 和 Typst 的桌面写作工具。

## 功能

- 实时预览、数学公式与 PDF 导出。
- LaTeX 编译、SyncTeX 双向跳转、多文件大纲与 BibTeX 引用。
- 多标签、工作区搜索替换与命令面板。
- 自动保存与会话恢复。

## 安装

从 [Releases](https://github.com/ziwangprincex/Clavis/releases/latest) 下载：
Windows `.exe`、macOS `.dmg`、Linux `.AppImage`。

Apple 芯片 Mac 也可以用 Homebrew：

```bash
brew install --cask ziwangprincex/clavis/clavis
```

Typst 已内置。LaTeX 需安装 TeX Live 或 MacTeX，中文和自定义字体建议用 XeLaTeX。
Quarto、Pandoc 导出需另行安装对应工具。

## 使用

打开文件或文件夹即可写作，大部分操作都能在命令面板里找到。

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 命令面板 | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| 编译 | `Cmd+B` | `Ctrl+B` |
| 工作区搜索 | `Cmd+Shift+F` | `Ctrl+Shift+F` |

检查更新：Settings → Updates。

## 开发

需要 Rust 1.92+、Node.js 22 LTS（22.13+）和
[Tauri 1 系统依赖](https://v1.tauri.app/v1/guides/getting-started/prerequisites)。
在仓库根目录运行：

```bash
npm --prefix web ci
npm run tauri -- dev
```

检查：

```bash
npm run typecheck
npm test
cargo test --locked
```

打包见 [macOS 构建](BUILD_MACOS.md)，发布见 [发布流程](RELEASING.md)。
