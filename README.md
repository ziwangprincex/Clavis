# Clavis

Clavis 是一个基于 Tauri 的桌面文档编辑器，支持 Markdown、LaTeX 和 Typst。

## 功能

- Markdown 实时预览
- LaTeX 编译与 PDF 预览
- Typst 渲染与 PDF 导出
- 文件夹浏览、标签页、快捷键和项目文件管理

## 使用

- 打开应用后，先选择文件或文件夹
- LaTeX 需要使用 XeLaTeX 编译
- 如果项目里有本地字体或资源文件，Clavis 会一并打包到临时编译目录

## 发布文件

- `target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg`

## 说明

这是源码仓库，构建产物不纳入版本控制。