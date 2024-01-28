+++
title = 'HUGO 食用系列（二）'
description = ''
date = 2024-01-28T22:49:31+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['ILUNP']
tags = ['HUGO']
categories = ['HUGO']
    
+++

## 修改目录结构：
完成初始化 HUGO 后，生成默认的目录结构为：

```
my-site/
...
└── hugo.toml         <-- 站点配置文件
```

为了使目录看起来清爽一些，创建一个父文件夹 ``` config ``` 和一个子文件夹 ``` _default ``` 并把所有的配置文件放在该目录中:

```
my-site/
...
├── config/           <-- 站点配置文件
│   └── _default/
│       └── hugo.toml
...
```

## 站点配置文件
 HUGO 完成初始化后默认创建的站点 ```hugo.toml``` 只有三行配置：
```toml
baseURL = 'https://example.org/'
languageCode = 'en-us'
title = 'My New Hugo Site'
```

后续对站点设置时会添加更多的配置项，以 ``` PaperMod ``` 主题的部分配置为例：
```toml
baseURL = 'https://example.org/'
languageCode = 'en-us'
title = 'My New Hugo Site'
theme = 'PaperMod'

enableEmoji = true

[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true

[params]
DateFormat = '2006-01-02'

defaultTheme = 'auto'
# defaultTheme = 'light'
# defaultTheme = 'dark'

ShowWordCount = true
ShowReadingTime = true
ShowPostNavLinks = true
ShowCodeCopyButtons = true
ShowAllPagesInArchive = true

[params.profileMode]
    enabled = true

    title = "My New Hugo Site"
    subtitle = 'My New Hugo Site'
    imageUrl = ''

    [[params.profileMode.buttons]]
        name = 'Gallery'
        url = '/gallery/'

    [[params.socialIcons]]
        name = 'rss'
        url = 'index.xml'

[[menus.main]]
    identifier = "Posts"
    name = "Posts"
    url = "/posts/"
    weight = 20

[[menus.main]]
    identifier = "Archives"
    name = "Archives"
    url = "/archives/"
    weight = 30

[[menus.main]]
    identifier = "About"
    name = "About"
    url = "/about/"
    weight = 50
```

避免篇幅过长省略了大部分配置项，反正一大长串的配置文件本人是不想再看一眼了，因此需要按照配置关键字对这单个配置文件进行拆分成如下形式：

```
my-site/
└── config/
    └── _default/
        ├── hugo.toml
        ├── params.toml
        └── menus.toml

```

> #### hugo.toml
> ```toml
> baseURL = 'https://example.org/'
> languageCode = 'en-us'
> title = 'My New Hugo Site'
> theme = 'PaperMod'
> 
> enableEmoji = true
> 
> [markup]
>   [markup.goldmark]
>     [markup.goldmark.renderer]
>       unsafe = true
> ```
> 但也不要为了拆分而拆分， ``` [markup] ``` 是一个很好的例子。

> #### params.toml
> ```toml
> DateFormat = '2006-01-02'
> 
> defaultTheme = 'auto'
> # defaultTheme = 'light'
> # defaultTheme = 'dark'
> 
> ShowWordCount = true
> ShowReadingTime = true
> ShowPostNavLinks = true
> ShowCodeCopyButtons = true
> ShowAllPagesInArchive = true
> 
> [profileMode]
>     enabled = true
> 
>     title = "My New Hugo Site"
>     subtitle = 'My New Hugo Site'
>     imageUrl = ''
> 
>     [[profileMode.buttons]]
>         name = 'Gallery'
>         url = '/gallery/'
> 
>     [[socialIcons]]
>         name = 'rss'
>         url = 'index.xml'
> ```

> #### menus.toml
> ```toml
> [[main]]
>     identifier = "Posts"
>     name = "Posts"
>     url = "/posts/"
>     weight = 20
> 
> [[main]]
>     identifier = "Archives"
>     name = "Archives"
>     url = "/archives/"
>     weight = 30
> 
> [[main]]
>     identifier = "About"
>     name = "About"
>     url = "/about/"
>     weight = 50
> ```


# 未完待续...