+++
title = 'HUGO 食用系列（一）'
description = ''
date = 2023-11-24T18:07:22+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['ILUNP']
tags = ['HUGO']
categories = ['HUGO']

+++

> 采用 Hugo(Extended) + Github Pages + Github Action 部署方案。

## 优雅的在 Windows 中安装 HUGO 环境：

现在可以使用 WinGet 包管理器来安装 HUGO 所需的基础环境，只需要在终端（PowerShell）中分别运行以下命令，等待片刻即可：

```powershell
# 安装 Hugo Extended
winget install Hugo.Hugo.Extended

# 安装 Git
winget install -e --id Git.Git
```

* 安装 [Github Desktop](https://desktop.github.com/) 方便文件更改前后的对比，当然 VSCode 也可以做到这些。

```powershell
# 安装 Github Desktop
winget install -e --id GitHub.GitHubDesktop
```

> 如果遇到问题，请确认您使用的 Windows 版本安装了 [WinGet](https://learn.microsoft.com/ZH-CN/windows/package-manager/) 包管理器。
>
> 如果没有安装 [WinGet](https://learn.microsoft.com/ZH-CN/windows/package-manager/) 包管理器，请立刻使用传统方法安装 HUGO 环境，不值得过多纠结。

## 为 HUGO 创建 Github Pages 仓库：

在 Github 中创建一个名为 ``` <username>.github.io ``` 的存储库。

![New Repo](repo-create.jpeg)

> 如果遇到问题，请参考：[创建 GitHub Pages 站点](https://docs.github.com/zh/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 初始化 HUGO 和运行 HUGO ：

将 Github 新创建的存储库克隆到本地，并将项目文件夹打开中右键打开 终端（PowerShell） 运行初始化命令，等待初始化完成：

```powershell
# HUGO 初始化命令
hugo new site ./ -f

# 安装 PaperMod 主题
git submodule add --depth=1 https://github.com/adityatelange/hugo-PaperMod.git themes/PaperMod
```
使用 VSCode 打开站点配置文件 ``` hugo.toml ``` ，在配置文件中添加配置，并保存编辑：

```toml
theme = "PaperMod"
```

启动 HUGO 开发服务预览站点，``` Ctrl+C ``` 可以停止 HUGO 开发服务。

```powershell
hugo server
```

> 如果遇到问题，请参考：[HUGO 官方文档](https://gohugo.io/getting-started/quick-start/)

## 配置 Github Action 持续化部署
在存储库根目录中，创建 ``` .github/workflows/ ``` 目录来存储工作流文件，并在 ``` .github/workflows/ ``` 目录中，创建一个 ``` gh-page.yml ``` 的文件并添加以下代码。

* **特别提醒**：首次在储存库中使用 Github Action 部署 Github Page 请设置 `GITHUB_TOKEN` 默认权限， 详情看：[Configuring the default `GITHUB_TOKEN` permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-default-github_token-permissions) ；或在 `.github/workflows/gh-pages.yml` 文件中添加  `permissions` ，详情看：[Defining access for the `GITHUB_TOKEN` scopes](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#defining-access-for-the-github_token-scopes)

```yml
name: GitHub Pages Deploy

on:
  push:
    branches:
      - main  # Set a branch to deploy
  pull_request:

permissions: 
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true  # Fetch Hugo themes (true OR recursive)
          fetch-depth: 0    # Fetch all history for .GitInfo and .Lastmod

      - name: Setup Hugo
        uses: peaceiris/actions-hugo@v2
        with:
          hugo-version: 'latest'
          extended: true

      - name: Build
        run: hugo --minify

      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        if: github.ref == 'refs/heads/main'
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
```

> 如果遇到问题，请参考：[Create Your Workflow](https://github.com/marketplace/actions/hugo-setup#%EF%B8%8F-create-your-workflow)、 [了解 GitHub Actions](https://docs.github.com/zh/actions/learn-github-actions/understanding-github-actions) 文章

## 推送站点到 Github 存储库
完成以上工作后可以直接将本地存储库推送至 Github 存储库主分支 ``` main ``` 并等待 `Github Action` 自动部署，该过程会自动创建新的名为 ``` gh-pages ``` 的分支并将生成的静态文件存储在内。

最后通过访问 ``` <username>.github.io ``` 部署在 Github Page 的 HUGO 站点吧！