+++
title = '注册表 Win32PrioritySeparation 数值'
description = 'Win32PrioritySeparation数值控制Windows如何分配CPU给各个程序'
date = 2024-10-14T17:43:23+08:00

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

Key: `HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl`

REG_DWORD: `Win32PrioritySeparation`

data: 2

### Default:

#### Optimize Performance for Applications:
```txt
32 + 4 + 2 = 38 Dec / 26 Hex = Short Quantum, Variable Quantum for foreground, High foreground boost.
```

#### Optimize Performance for Background Services:
```txt
16 + 8 + 0 = 24 Dec / 18 Hex = Long Quantum, Fixed Quantum, No foreground boots.
```

### Variations:
```txt
32 + 8 + 2 = 42 Dec / 2A Hex = Short, Fixed , High foreground boost.
32 + 8 + 1 = 41 Dec / 29 Hex = Short, Fixed , Medium foreground boost.
32 + 8 + 0 = 40 Dec / 28 Hex = Short, Fixed , No foreground boost.

32 + 4 + 2 = 38 Dec / 26 Hex = Short, Variable , High foreground boost.
32 + 4 + 1 = 37 Dec / 25 Hex = Short, Variable , Medium foreground boost.
32 + 4 + 0 = 36 Dec / 24 Hex = Short, Variable , No foreground boost.

16 + 8 + 2 = 26 Dec / 1A Hex = Long, Fixed, High foreground boost.
16 + 8 + 1 = 25 Dec / 19 Hex = Long, Fixed, Medium foreground boost.
16 + 8 + 0 = 24 Dec / 18 Hex = Long, Fixed, No foreground boost.

16 + 4 + 2 = 22 Dec / 16 Hex = Long, Variable, High foreground boost.
16 + 4 + 1 = 21 Dec / 15 Hex = Long, Variable, Medium foreground boost.
16 + 4 + 0 = 20 Dec / 14 Hex = Long, Variable, No foreground boost.
```