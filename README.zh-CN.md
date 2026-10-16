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

Clavis 是一款用于编辑 Markdown、LaTeX 与 Typst 文档的桌面应用。

## 功能

- Markdown 在排版视图中编辑：标题、强调、列表、表格、公式、脚注、带语法高亮的代码、Mermaid 图表与图片就地渲染，仅在光标处显示 Markdown 源码。
- 粘贴或拖入已保存 Markdown 文档的图片，会复制到文档旁的文件夹（`assets`、`文档名.assets` 或自选文件夹，单篇文档也可在文件头用 `typora-copy-images-to` 指定），并以相对路径引用。
- 可选的智能标点：输入时把直引号转为弯引号，`--` / `---` 转为短破折号与长破折号。
- Markdown 另支持 YAML 文件头、`==高亮==`、`^上标^`、`~下标~` 与 GitHub 风格的 `> [!NOTE]` 提示框。编辑表格时，表格上方的工具条可调整列对齐，其菜单可插入、移动、删除行与列，复制或删除整个表格。
- Markdown 文档可导出为单个自包含的 HTML 文件。
- 专注模式下，当前段落以外的内容淡化；打字机滚动使当前行保持在窗口中部。
- LaTeX 与 Typst 以源码形式编辑，提供实时预览与 PDF 导出；编译问题标注在对应行旁，点击标记即在该处显示错误说明。
- LaTeX 编译支持 SyncTeX、多文件大纲以及 BibTeX/Biber 文献引用；大纲另列出图片、表格、标签与引用，可折叠，也可只显示前几级标题。引用与标签的补全会显示文献的作者、年份、题目，或标签所指的内容。
- PDF 预览提供保留彩色的深色纸张（可让图片保持原样）、双页并排、随编辑器滚动，以及可移到另一块显示器的独立窗口。
- 待办注释（`% TODO`、`\todo{…}`、`// TODO`、`<!-- TODO -->`）列于侧栏。
- 多标签页、工作区范围的搜索与替换，以及命令面板。文件树会跟随在 Clavis 之外所做的改动。
- 自定义 CSS：`<配置目录>/clavis/user.css` 在 Clavis 自身样式之后注入，改写颜色变量即可改变整个窗口（设置 → 外观 → 自定义 CSS）。
- 字数统计显示预计阅读时间。
- 自动保存与会话恢复。

## 安装

安装包见 [Releases](https://github.com/ziwangprincex/Clavis/releases/latest)：Windows 为 `.exe`，macOS 为 `.dmg`，Linux 为 `.AppImage`。

搭载 Apple 芯片的 Mac 也可通过 Homebrew 安装：

```bash
brew install --cask ziwangprincex/clavis/clavis
```

Typst 已内置。LaTeX 需要 TeX Live 或 MacTeX；中文与自定义字体建议使用 XeLaTeX。

## 使用

通过工具栏打开文件或文件夹。大部分命令可在命令面板中找到。

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 命令面板 | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| 快速打开（文件、标题、标签、`:行号`） | `Cmd+P` | `Ctrl+P` |
| 编译（LaTeX） | `Cmd+B` | `Ctrl+B` |
| 工作区搜索 | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| 导出 PDF（LaTeX、Typst）/ HTML（Markdown） | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Markdown 源码视图 | `Cmd+/` | `Ctrl+/` |
| 加粗 / 斜体 / 链接（Markdown） | `Cmd+B` / `Cmd+I` / `Cmd+K` | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| 一至六级标题 / 正文（Markdown） | `Cmd+1`–`Cmd+6` / `Cmd+0` | `Ctrl+1`–`Ctrl+6` / `Ctrl+0` |
| 写作 / 分栏 / 阅读（LaTeX、Typst） | `Cmd+2` / `Cmd+3` / `Cmd+4` | `Ctrl+2` / `Ctrl+3` / `Ctrl+4` |
| 移动表格行 / 列（Markdown） | `Cmd+Option+↑↓` / `Cmd+Option+←→` | `Ctrl+Alt+↑↓` / `Ctrl+Alt+←→` |
| 专注模式 | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| 侧栏 | `Cmd+Shift+L` | `Ctrl+Shift+L` |

在 Markdown 表格中，`Tab` 与 `Shift+Tab` 在单元格间移动。

更新检查位于“设置 → 更新”。

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
