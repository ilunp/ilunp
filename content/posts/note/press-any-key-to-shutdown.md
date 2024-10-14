+++
title = '手机连接电脑 Press Any Key to Shutdown 错误'
description = ''
date = 2024-10-12T11:45:48+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['ILUNP']
tags = ['untagged']
categories = ['']

[cover]
    image = ''
    alt = '<alt text>'
    caption = '<text>'
    relative = true
    
+++
> 原文地址：https://miuiver.com/press-any-key-to-shutdown/

## 问题症状:
手机进入 Fastboot 模式后用数据线连接电脑，手机左上角显示 press any key to shutdown 信息，电脑识别设备失败。

## 解决方法:
更换电脑 USB 2.0 端口连接便可解决。如果电脑没有 USB 2.0 端口，也可以使用 USB 集线器连接。

如果都没有，可以将下面内容用记事本另存为 `.bat` 批处理文件，然后以管理员身份运行，之后再连接便不会有问题。
### add-usb3-fix
```bat
@echo off
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "osvc" /t REG_BINARY /d "0000" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "SkipContainerIdQuery" /t REG_BINARY /d "01000000" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "SkipBOSDescriptorQuery" /t REG_BINARY /d "01000000" /f
pause
```
---
### delete-usb3-fix
```bat
@echo off
reg delete "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "osvc" /f
reg delete "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "SkipContainerIdQuery" /f
reg delete "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\usbflags\18D1D00D0100" /v "SkipBOSDescriptorQuery" /f
pause
```