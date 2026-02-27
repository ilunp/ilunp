+++
title = 'Hugo 食用之 Render Image'
description = ''
date = 2025-03-05T01:22:24+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['NACGNOH']
tags = ['HUGO', 'WEBP', 'EXIF']
categories = ['HUGO']
    
+++

### 前言：
由于博客部署在```Github Page```上图片加载缓慢😮‍💨，改代码基于```PaperMod```主题的```render-image.html```进行修改，其他主题的渲染方式可能不一样，自行研究吧🧐。

支持将```png、jpg、jpeg、bmp、tiff```的图片格式转换至```Webp```（应该能减少一半的时间☝️），有但没完全有用的CDN前缀设置（因为ta只作用于非```Webp```，还需要保持路径一致），还有啥支持的？啊！我不道啊，以后需要再写吧！😋

### 食用：
* 在 Hugo 项目的 ```layouts/_default/_markup/``` 目录下创建 ```render-image.html``` 文件，将代码复制到 ```render-image.html``` 文件中。

```go
{{- $u := urls.Parse .Destination -}}
{{- $src := $u.String -}}
{{- $webpSrc := "" -}}
{{- $wcsrc := "" -}}

{{- if not $u.IsAbs -}}
  {{- $path := strings.TrimPrefix "./" $u.Path }}
  {{- with or (.PageInner.Resources.Get $path) (resources.Get $path) -}}
    {{- $src = .RelPermalink -}}
    {{- $isConvertible := false -}}
    {{- if in (slice "png" "jpg" "jpeg" "bmp" "tiff") .MediaType.SubType -}}
      {{- $isConvertible = true -}}

      {{- $image := . -}}
      {{- with .Exif -}}
        {{- if eq .Tags.Orientation 3 }}
          {{- $image = $image.Resize (printf "%dx%d r180" $image.Width $image.Height) -}}
        {{- else if eq .Tags.Orientation 6 }}
          {{- $image = $image.Resize (printf "%dx%d r270" $image.Height $image.Width) -}}
        {{- else if eq .Tags.Orientation 8 }}
          {{- $image = $image.Resize (printf "%dx%d r90" $image.Height $image.Width) -}}
        {{- end -}}
      {{- end -}}

      {{- $webpSrc = ($image.Resize (printf "%dx%d webp q50" $image.Width $image.Height)).RelPermalink -}}
    {{- end -}}
    {{- with $u.RawQuery -}}
      {{- $src = printf "%s?%s" $src . -}}
      {{- if $isConvertible -}}
        {{- $webpSrc = printf "%s?%s" $webpSrc . -}}
      {{- end -}}
    {{- end -}}
    {{- with $u.Fragment -}}
      {{- $src = printf "%s#%s" $src . -}}
      {{- if $isConvertible -}}
        {{- $webpSrc = printf "%s#%s" $webpSrc . -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}

{{- if not site.Params.webpCloudProxy.enabled -}}
  {{- $cdnPrefix := .Page.Site.Params.cdnPrefix -}} 
  {{- if $cdnPrefix -}}
    {{- $src = printf "%s%s" $cdnPrefix $src -}}
  {{- end -}}
{{- else -}}
  {{- $src = replace ((printf "%s%s" site.BaseURL $src) | safeURL) site.BaseURL site.Params.webpCloudProxy.proxyUrl -}}
{{- end -}}

{{- $attributes := merge .Attributes (dict "alt" .Text "src" $src "title" (.Title | transform.HTMLEscape) "loading" "lazy") -}}

<picture>
  {{- if $webpSrc -}}
    <source type="image/webp" srcset="{{ $webpSrc }}">
  {{- end -}}
  <img
    {{- range $k, $v := $attributes -}}
      {{- if $v -}}
        {{- printf " %s=%q" $k $v | safeHTMLAttr -}}
      {{- end -}}
    {{- end -}}>
</picture>
{{- /* END */ -}}
```

<details>
<summary> 旧版代码归档 </summary>

```go
{{- $u := urls.Parse .Destination -}}
{{- $src := $u.String -}}
{{- $webpSrc := "" -}}

{{- if not $u.IsAbs -}}
  {{- $path := strings.TrimPrefix "./" $u.Path }}
  {{- with or (.PageInner.Resources.Get $path) (resources.Get $path) -}}
    {{- $src = .RelPermalink -}}
    {{- $isConvertible := false -}}
    {{- if in (slice "png" "jpg" "jpeg" "bmp" "tiff") .MediaType.SubType -}}
      {{- $isConvertible = true -}}

      {{- $image := . -}}
      {{- with .Exif -}}
        {{- if eq .Tags.Orientation 3 }}
          {{- $image = $image.Resize (printf "%dx%d r180" $image.Width $image.Height) -}}
        {{- else if eq .Tags.Orientation 6 }}
          {{- $image = $image.Resize (printf "%dx%d r270" $image.Height $image.Width) -}}
        {{- else if eq .Tags.Orientation 8 }}
          {{- $image = $image.Resize (printf "%dx%d r90" $image.Height $image.Width) -}}
        {{- end -}}
      {{- end -}}

      {{- $webpSrc = ($image.Resize (printf "%dx%d webp q50" $image.Width $image.Height)).RelPermalink -}}
    {{- end -}}
    {{- with $u.RawQuery -}}
      {{- $src = printf "%s?%s" $src . -}}
      {{- if $isConvertible -}}
        {{- $webpSrc = printf "%s?%s" $webpSrc . -}}
      {{- end -}}
    {{- end -}}
    {{- with $u.Fragment -}}
      {{- $src = printf "%s#%s" $src . -}}
      {{- if $isConvertible -}}
        {{- $webpSrc = printf "%s#%s" $webpSrc . -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}

{{- $cdnPrefix := .Page.Site.Params.cdnPrefix -}} 
{{- if $cdnPrefix -}}
  {{- $src = printf "%s%s" $cdnPrefix $src -}}
{{- end -}}

{{- $attributes := merge .Attributes (dict "alt" .Text "src" $src "title" (.Title | transform.HTMLEscape) "loading" "lazy") -}}

<picture>
  {{- if $webpSrc -}}
    <source type="image/webp" srcset="{{ $webpSrc }}">
  {{- end -}}
  <img
    {{- range $k, $v := $attributes -}}
      {{- if $v -}}
        {{- printf " %s=%q" $k $v | safeHTMLAttr -}}
      {{- end -}}
    {{- end -}}>
</picture>
{{- /* END */ -}}
```
</details>

#### 配置 CDN 前缀 **（可选）**

在 Hugo 配置文件（如 ```params.toml```）中添加 CDN 前缀配置，如果未配置 CDN 前缀，则使用本地路径：
```toml
cdnPrefix = "https://cdn.example.com"
```

#### 添加 WebP Cloud 服务 **（可选）** -- [UPDATE] 2025.11.11
集成 WebP Cloud 服务进行图片优化，在 Hugo 配置文件（如 ```params.toml```）中添加 WebP Cloud 配置：
```toml
[webpCloudProxy]
  enabled = true
  proxyUrl = "https://xxxxx.webp.li"
  convertTypeList = ["jpg", "jpeg", "png", "gif"]
```



#### 使用 Markdown 插入图片

在 Markdown 文件中插入图片时，使用以下语法：
```markdown
![Alt Text](image.jpg "Title")
```
模板会自动处理图片的 Exif 方向、WebP 转换和 CDN 前缀。

### 参考：
[Hugo图片自动转webp的方法](https://iblog.ren/posts/hugo_img_to_webp/)

[HUGO DOC - Image processing](https://gohugo.io/content-management/image-processing/)

[WebP Cloud Services Docs - Access](https://docs.webp.se/webp-cloud/access/)