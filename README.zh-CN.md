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

### Homebrew（macOS，Apple 芯片）

```bash
brew install --cask ziwangprincex/clavis/clavis
```

### 更新

Clavis 启动时会检查更新。也可以手动检查：**Settings → Updates → Check for
Updates**，或命令面板（`Ctrl/Cmd+Shift+P`）→ “Check for Updates…”。有新版本时
会先询问，确认后下载并重启到新版本。

### LaTeX 和 Typst

- LaTeX 是可选的。需要的话装 TeX Live 或 MacTeX（中日韩文字和自定义字体用
  XeLaTeX 效果最好）。
- Typst 不需要额外安装，已内置。

## 项目配置与信任

工作区里可以放一个可选的 `clavis.toml`，写项目元数据和任务定义。打开文件夹时只会
解析和校验这个文件，绝不执行任何命令。如果里面有可执行任务，Clavis 会先询问，然后
把信任状态存到用户配置目录里，和仓库分开。

```toml
[project]
name = "My paper"
main = "paper/main.tex"

[tasks.tables]
command = "Rscript"
args = ["scripts/tables.R"]

[tasks.paper]
command = "latexmk"
args = ["-xelatex", "paper/main.tex"]
depends_on = ["tables"]
```

已信任的任务会出现在命令面板里，显示为 **Run project task: _名称_**。依赖只会按顺序
运行一次，stdout/stderr 流式输出到任务面板，运行中的进程树可以中止。命令始终以参数
数组直接启动，不经过 shell。任务的可选字段：

```toml
[tasks.paper]
command = "quarto"
args = ["render", "paper.qmd"]
cwd = "."
timeout_seconds = 900
depends_on = ["tables"]

[tasks.paper.env]
PAPER_PROFILE = "anonymous"
```

命令面板里的 **Run Project Doctor** 会检查 `clavis.toml`、主文档、任务的工作目录、
信任状态，以及任务命令是否可用。每次运行前 Clavis 都会重新读取配置和信任状态，所以
打开项目之后再改动它，绕不过校验。

## 打包清单（试运行）

对配置了 `project.main` 的 LaTeX 项目，Submission Check 还能生成一份
**Bundle manifest**。它列出 Clavis 受限项目收集器能解析到的源文件、参考文献、样式、
图片、字体和其他资源文件，以及缺失依赖的警告。这只是只读的试运行：不会复制文件、
不跑 LaTeX、不生成 ZIP，也不改动项目。

## 投稿检查（Submission Check）

在命令面板里运行 **Submission Check**，对工作区做一次只读的投稿前检查。它会标出
TODO/FIXME/XXX 标记、明显的本地绝对路径、LaTeX 的 shell-escape 用法，以及匿名投稿
时可能需要注意的作者元数据。已打开的文档会优先用编辑器里的当前文本，并能跳到对应
行。它不会构建、匿名化、修改或打包项目。

## Git 查看与文本差异

Git 侧边栏有意做成只读的：显示仓库/分支状态、ahead/behind 计数、改动过或未跟踪的
文件、最近的提交，以及单个文件的差异。词级的文本视图会高亮增删；LaTeX 模式在比较
前会忽略注释、空白和常见的纯排版命令。这部分不会 stage、commit、restore、reset 或
push 任何东西。

## 写作一致性检查

Writing 侧边栏对打开的 Markdown、Quarto、LaTeX 和 Typst 文档做本地的、可解释的
检查：百分号前后的空格、`p value` 的写法、Figure/Fig. 和 Table/Tab. 混用、常见的
英美拼写混用，以及首次出现的缩写提醒。它会忽略常见注释和代码/逐字环境，有防抖，
输出有上限。这些是一致性提示，不能替代语法检查器或期刊的样式指南。

## 论文字数估算

状态栏会显示 Markdown/Quarto、LaTeX 和 Typst 的 **Main** 和 **Abstract** 正文字数
估算。它排除了常见标记、代码、数学公式、引用和参考文献类内容，所以定位是投稿的
辅助工具，而不是出版方的官方字数。可以在 **Settings → Editor** 里配置可选的 Main
和 Abstract 字数上限；超出上限的数值会高亮。

## 资源引用

Assets 侧边栏会盘点本地的研究资源，并追踪 LaTeX 的 `\includegraphics`、Typst 的
`#image("...")` 和 Markdown/Quarto 图片语法里显式写出的图片引用。它会报告引用缺失
和未被使用的本地资源，可以打开某个资源，也能跳到使用它的位置。动态路径、远程 URL
和代码/逐字环境里的示例是有意排除的。

## CSV / TSV 转表格

命令面板里的 **Convert CSV / TSV to Table** 可以粘贴一段分隔符表格，插入为原生的
Markdown/Quarto、LaTeX `booktabs` 或 Typst `#table` 语法。转换器能处理带引号的 CSV
单元格、制表符、长短不齐的行和常见转义。它有意只做文本表格转换：还不会推断数值列、
显著性星号、标准误或回归表的语义。

## 生成的产物

在 `clavis.toml` 里声明生成的表格、图表或其他文件，并把它们和源文件、以及一个已有的
项目任务关联起来：

```toml
[artifacts.baseline_table]
path = "paper/tables/baseline.tex"
kind = "table"
task = "tables"
sources = ["scripts/tables.R", "data/derived/analysis.csv"]
description = "Baseline regression results"
```

Artifacts 侧边栏会报告 `missing`、`stale` 或 `ready`，可以打开已存在的产物，也能运行
声明的任务。源文件缺失，或比产物更新，就标记为 stale。

## Better BibTeX 导出

可以在 `clavis.toml` 里声明一个本地的 Better BibTeX 导出：

```toml
[bibliography]
provider = "better-bibtex"
files = ["references/library.bib"]
```

Clavis 只轮询这些声明过、且在工作区内的 `.bib` 文件，每五秒一次。当文件大小或修改
时间变化时，刷新本地文献浏览器和跨语言引用索引。它不会读写 Zotero 的数据库，不会
调用 Zotero，也不联网。

## 文献浏览器

工作区的 Bibliography 区块会解析本地 `.bib` 文件，支持跨 citekey、作者/编者、年份、
标题、出处、DOI、关键词、摘要和条目类型的多词排序搜索。项目里的引用频率和最近插入
过的 key 会提升排序，但不会让不匹配的条目进来。条目会展示期刊/图书/出版社、DOI、
URL、摘要、关键词、卷/期/页码、所在位置，支持多选，并按 LaTeX、Typst、
Markdown/Quarto 各自的原生语法插入。

## Quarto 与 Pandoc 渲染

`.qmd` 文件复用 Markdown 编辑器和会话模型，但在状态栏里标识为 Quarto。从命令面板
可以把已保存的 `.qmd` 或 `.md` 文档用 Quarto 或 Pandoc 渲染/导出为 HTML、PDF 或
DOCX。渲染在首次使用时会请求工作区信任，输出走已有的任务面板，支持 Stop 和超时，
成功后打开最新的匹配产物。Project Doctor 会报告工具版本、`_quarto.yml` 和发现的
`.qmd` 文件。Quarto/Pandoc 需要单独安装。

## 交叉引用与文献引用

工作区的 References 区块会为 LaTeX、Typst、BibTeX 和 Markdown/Quarto 里面向论文的
那部分语法建立一个统一索引。它会报告重复、缺失、未使用、无法解析和有歧义的
标签/引用；符号可以展开看它的定义和所有使用位置。

**Rename Label or Citation Key** 会先预览索引里精确的改动，遇到命名冲突、未保存的
文档、Markdown 自动生成的标题 slug、带转义的 Typst 字符串和已过期的文件会拒绝执行，
然后用分阶段写入加回滚的方式更新 LaTeX、Typst、Pandoc/Quarto 引用和 BibTeX key。
插入文献用各自的原生语法：LaTeX 是 `\cite{key}`，Typst 是 `@key`，
Markdown/Quarto 是 `[@key]`。

## 工作区搜索与替换

用 `Ctrl/Cmd+Shift+F`，或命令面板里的 **Search / Replace in Workspace**。搜索支持
字面量或 Rust 正则、区分大小写，结果的文件/行号可以点击。Replace All 需要确认；如果
结果集被截断，或匹配到的文档有未保存的改动，则会禁用。搜索之后磁盘上任何文件发生
变化，Clavis 也会拒绝替换。

## 从源码构建

面向开发。只是想用的话，直接下载上面的安装包。

需要 Rust 1.92+、Node.js 18+，以及 Tauri 需要的系统依赖（Windows 上的 WebView2、
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
