+++
title = 'Houdini_mantra_list'
description = 'Houdini_mantra_list'
date = 2026-03-16T16:41:57+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['NACGNOH']
tags = ['untagged']
categories = ['']

[cover]
    image = '<image path(hugo-logo-wide.svg)/url>'
    alt = '<alt text>'
    caption = '<text>'
    relative = true
    
+++

该脚本用于在 `/obj` 级别创建一个名为 `MANTRA_VECTOR_MONITOR` 的监控节点，集中显示和管理场景中所有 Mantra 渲染节点的帧范围。

## 概述
`MANTRA_VECTOR_MONITOR` 是一个 `Houdini` 场景监控工具，以一个自定义 `Null` 节点的形式存在于 `/obj` 上下文中。它会自动扫描 `/out` 网络中所有的 `Mantra` 渲染节点，并将其帧范围（f1、f2、f3）以只读的向量参数形式聚合展示，同时提供快速跳转功能。

### 主要用途：
- 在一个统一的控制面板中概览所有 `Mantra` 节点的渲染帧设置。
- 快速定位并打开特定的渲染节点网络。
- 可视化区分不同的帧范围模式（`Single` / `Range` / `Range Strict`）。

## 安装
将完整脚本复制粘贴到 `Houdini` 的 `Python Source Editor` 中，或在 `Python Shell` 内逐段执行：
1. **方法 A（推荐）**：在菜单栏选择 `Windows -> Python Source Editor`，将全部代码粘贴进去，点击 `Apply` 或运行按钮。
2. **方法 B**：在 `Windows -> Python Shell` 中逐段粘贴并回车执行。

脚本执行完后，会自动在 `/obj` 节点树下创建名为 `MANTRA_VECTOR_MONITOR` 的节点，并立即执行首次刷新。您可以在 `Network View` 中看到该节点。

```python
import hou

def create_structured_vector_monitor():
    obj = hou.node("/obj")
    node_name = "MANTRA_VECTOR_MONITOR"
    node = hou.node(f"/obj/{node_name}")
    
    if not node:
        node = obj.createNode("null", node_name)
        node.setUserData("nodeshape", "rect")
        node.setColor(hou.Color((0.15, 0.25, 0.35)))
    
    callback_code = """import hou
node = hou.pwd()
out = hou.node('/out')
m_nodes = [n for n in out.children() if n.type().name() == 'ifd'] if out else []
mode_map = {'off': 'Single', 'normal': 'Range', 'on': 'Range(Strict)'}

group = node.parmTemplateGroup()

folder_name = 'nodes_list'
folder = group.find(folder_name)
if folder:
    folder.setParmTemplates([])
else:
    folder = hou.FolderParmTemplate(folder_name, 'Mantra Nodes', folder_type=hou.folderType.Simple)

for i, n in enumerate(m_nodes):
    v_name = 'm_range' + str(i)
    b_name = 'm_mode' + str(i)
    j_name = 'm_jump' + str(i)
    
    m_val = n.parm('trange').evalAsString()
    m_text = mode_map.get(m_val, m_val)
    m_path = n.path()
    
    new_vec = hou.IntParmTemplate(v_name, n.name(), 3)
    new_vec.setJoinWithNext(True)
    new_vec.setDisableWhen("{ 1 }")
    
    mode_btn = hou.ButtonParmTemplate(b_name, m_text)
    mode_btn.setJoinWithNext(True)
    mode_btn.setDisableWhen("{ 1 }")
    
    jump_script = "n=hou.node('"+m_path+"'); n.setSelected(True,True); pane=hou.ui.paneTabOfType(hou.paneTabType.NetworkEditor); pane.setCurrentNode(n)"
    jump_btn = hou.ButtonParmTemplate(j_name, "Jump to Node", script_callback=jump_script, script_callback_language=hou.scriptLanguage.Python)

    folder.addParmTemplate(new_vec)
    folder.addParmTemplate(mode_btn)
    folder.addParmTemplate(jump_btn)

group.replace(folder_name, folder)
node.setParmTemplateGroup(group)

for i, n in enumerate(m_nodes):
    try:
        v_tuple = node.parmTuple('m_range' + str(i))
        v_tuple.lock((False, False, False))
        f_vals = (int(n.parm('f1').eval()), int(n.parm('f2').eval()), int(n.parm('f3').eval()))
        v_tuple.set(f_vals)
        v_tuple.lock((True, True, True))
    except: continue
"""

    group = node.parmTemplateGroup()
    group.clear()
    
    btn_tpl = hou.ButtonParmTemplate(
        "refresh", 
        "Refresh", 
        script_callback=callback_code, 
        script_callback_language=hou.scriptLanguage.Python
    )
    group.append(btn_tpl)
    
    folder = hou.FolderParmTemplate("nodes_list", "Mantra Nodes", folder_type=hou.folderType.Simple)
    group.append(folder)
    
    node.setParmTemplateGroup(group)
    
    try:
        node.parm("refresh").pressButton()
    except:
        pass

create_structured_vector_monitor()
```