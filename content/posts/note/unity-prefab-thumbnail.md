+++
title = 'Unity Prefab 缩略图导出'
description = ''
date = 2026-03-14T15:06:33+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['ILUNP']
tags = ['untagged']
categories = ['']

[cover]
    image = 'thumbnail-exporter.jpg'
    alt = '<alt text>'
    caption = '<text>'
    relative = true
    
+++

### 1. **多轴向视图支持**
- **Front/Back**: 前/后视图（±Z轴）
- **Left/Right**: 左/右视图（±X轴）
- **Top/Bottom**: 顶/底视图（±Y轴）
- **Isometric**: 等轴测视图（-X, -Y, -Z方向）
- **IsometricOpposite**: 相反方向的等轴测视图

### 2. **相机控制**
- **Auto Center**: 自动根据轴向定位相机
- **Custom Rotation**: 手动设置旋转角度

### 3. **预览功能**
- 在场景中创建临时实例
- 自动定位场景相机
- 方便调整角度后导出

### 4. **自动灯光**
- 如果没有光源，自动创建基本的三点光源
- 确保物体被正确照亮

## 使用说明：

1. **选择轴向**：从下拉菜单中选择需要的视图方向
2. **调整设置**：分辨率、背景色、边距等
3. **预览**：点击"Preview in Scene"查看效果
4. **导出**：选择单个或多个Prefab导出

## 轴向后缀：
导出的文件名会自动添加轴向信息，如：
- `EmperorWalkingOverThere_Front_thumbnail.png`
- `EmperorWalkingOverThere_Top_thumbnail.png`
- `EmperorWalkingOverThere_Isometric_thumbnail.png`

## 脚本代码

```csharp
using UnityEditor;
using UnityEngine;
using System.IO;

public class ThumbnailExportSettings : EditorWindow
{
    public int width = 256;
    public int height = 256;
    public bool transparentBackground = true;
    public Color backgroundColor = Color.clear;
    public int padding = 10;
    
    // 轴向选择
    public enum ViewAxis
    {
        Front,
        Back,
        Left,
        Right,
        Top,
        Bottom,
        Isometric,
        IsometricOpposite
    }
    
    public ViewAxis selectedAxis = ViewAxis.Front;
    public bool autoCenter = true;
    public Vector3 customRotation = Vector3.zero;
    
    [MenuItem("Tools/Prefab Thumbnail Exporter")]
    static void ShowWindow()
    {
        GetWindow<ThumbnailExportSettings>("Thumbnail Exporter");
    }
    
    void OnGUI()
    {
        GUILayout.Label("Thumbnail Settings", EditorStyles.boldLabel);
        
        width = EditorGUILayout.IntField("Width", Mathf.Max(1, width));
        height = EditorGUILayout.IntField("Height", Mathf.Max(1, height));
        
        transparentBackground = EditorGUILayout.Toggle("Transparent Background", transparentBackground);
        
        if (!transparentBackground)
        {
            backgroundColor = EditorGUILayout.ColorField("Background Color", backgroundColor);
        }
        
        padding = EditorGUILayout.IntField("Padding", Mathf.Max(0, padding));
        
        GUILayout.Space(10);
        GUILayout.Label("Camera Settings", EditorStyles.boldLabel);
        
        selectedAxis = (ViewAxis)EditorGUILayout.EnumPopup("View Axis", selectedAxis);
        
        if (selectedAxis == ViewAxis.Isometric || selectedAxis == ViewAxis.IsometricOpposite)
        {
            EditorGUILayout.HelpBox("Isometric view combines multiple axes", MessageType.Info);
        }
        
        autoCenter = EditorGUILayout.Toggle("Auto Center Camera", autoCenter);
        
        if (!autoCenter)
        {
            customRotation = EditorGUILayout.Vector3Field("Custom Rotation", customRotation);
        }
        
        GUILayout.Space(10);
        
        if (GUILayout.Button("Export Selected Prefab", GUILayout.Height(30)))
        {
            ExportSelectedPrefab();
        }
        
        if (GUILayout.Button("Export All Selected Prefabs", GUILayout.Height(30)))
        {
            ExportAllSelectedPrefabs();
        }
        
        if (GUILayout.Button("Preview in Scene", GUILayout.Height(25)))
        {
            PreviewSelectedPrefab();
        }
        
        GUILayout.Space(10);
        GUILayout.Label("Tips:", EditorStyles.boldLabel);
        GUILayout.Label("• Front: +Z direction", EditorStyles.miniLabel);
        GUILayout.Label("• Back: -Z direction", EditorStyles.miniLabel);
        GUILayout.Label("• Left: -X direction", EditorStyles.miniLabel);
        GUILayout.Label("• Right: +X direction", EditorStyles.miniLabel);
        GUILayout.Label("• Top: +Y direction", EditorStyles.miniLabel);
        GUILayout.Label("• Bottom: -Y direction", EditorStyles.miniLabel);
    }
    
    void ExportSelectedPrefab()
    {
        GameObject selectedPrefab = Selection.activeObject as GameObject;
        if (selectedPrefab == null)
        {
            Debug.LogError("Please select a Prefab in the Project window!");
            return;
        }
        
        string savePath = EditorUtility.SaveFilePanel(
            "Save Thumbnail",
            "",
            $"{selectedPrefab.name}_{selectedAxis}_thumbnail",
            "png");
        
        if (!string.IsNullOrEmpty(savePath))
        {
            Texture2D thumbnail = CapturePrefabThumbnail(selectedPrefab, width, height);
            if (thumbnail != null)
            {
                byte[] bytes = thumbnail.EncodeToPNG();
                File.WriteAllBytes(savePath, bytes);
                DestroyImmediate(thumbnail);
                Debug.Log($"Thumbnail saved to: {savePath}");
            }
        }
    }
    
    void ExportAllSelectedPrefabs()
    {
        string outputFolder = EditorUtility.SaveFolderPanel("Select Output Folder", "", "");
        if (string.IsNullOrEmpty(outputFolder)) return;
        
        int processed = 0;
        int total = Selection.objects.Length;
        
        for (int i = 0; i < total; i++)
        {
            var obj = Selection.objects[i];
            
            if (obj is GameObject)
            {
                EditorUtility.DisplayProgressBar("Exporting Thumbnails", 
                    $"Processing: {obj.name} ({i + 1}/{total})", 
                    (float)i / total);
                
                Texture2D thumbnail = CapturePrefabThumbnail(obj as GameObject, width, height);
                
                if (thumbnail != null)
                {
                    byte[] bytes = thumbnail.EncodeToPNG();
                    string fileName = GetValidFileName($"{obj.name}_{selectedAxis}") + ".png";
                    File.WriteAllBytes(Path.Combine(outputFolder, fileName), bytes);
                    
                    DestroyImmediate(thumbnail);
                    processed++;
                }
                
                if (i % 5 == 0) System.Threading.Thread.Sleep(10);
            }
        }
        
        EditorUtility.ClearProgressBar();
        Debug.Log($"Finished exporting {processed} out of {total} thumbnails");
    }
    
    void PreviewSelectedPrefab()
    {
        GameObject selectedPrefab = Selection.activeObject as GameObject;
        if (selectedPrefab == null)
        {
            Debug.LogError("Please select a Prefab in the Project window!");
            return;
        }
        
        // 在场景中创建临时实例用于预览
        GameObject previewInstance = PrefabUtility.InstantiatePrefab(selectedPrefab) as GameObject;
        if (previewInstance == null)
        {
            previewInstance = Object.Instantiate(selectedPrefab);
        }
        
        // 定位场景相机
        SceneView.lastActiveSceneView.Frame(previewInstance.GetBounds(), true);
        
        Debug.Log($"Preview instance created for {selectedPrefab.name}. Press Play to capture or delete the instance manually.");
    }
    
    Texture2D CapturePrefabThumbnail(GameObject prefab, int width, int height)
    {
        if (prefab == null) return null;
        
        GameObject tempInstance = null;
        RenderTexture rt = null;
        Camera camera = null;
        GameObject cameraGO = null;
        
        try
        {
            // 实例化Prefab
            tempInstance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (tempInstance == null)
            {
                tempInstance = Object.Instantiate(prefab);
            }
            
            // 计算边界
            Bounds bounds = CalculateBounds(tempInstance);
            
            if (bounds.size == Vector3.zero)
            {
                Debug.LogWarning($"Prefab {prefab.name} has no renderable bounds");
                return null;
            }
            
            // 计算相机距离和位置
            float maxSize = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
            float distance = maxSize * 0.5f + padding * 0.01f;
            
            // 设置渲染纹理
            rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            
            // 创建相机
            cameraGO = new GameObject("ThumbnailCamera");
            camera = cameraGO.AddComponent<Camera>();
            camera.clearFlags = transparentBackground ? 
                CameraClearFlags.SolidColor : CameraClearFlags.Color;
            camera.backgroundColor = transparentBackground ? Color.clear : backgroundColor;
            camera.orthographic = true;
            camera.orthographicSize = distance;
            camera.targetTexture = rt;
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 1000f;
            
            // 设置相机位置和旋转
            Vector3 cameraPosition = bounds.center;
            Quaternion cameraRotation = GetCameraRotation(selectedAxis);
            
            if (autoCenter)
            {
                // 根据轴向计算相机位置
                Vector3 direction = cameraRotation * Vector3.back;
                cameraPosition += direction * (distance * 2f);
            }
            else
            {
                cameraGO.transform.rotation = Quaternion.Euler(customRotation);
                cameraPosition += cameraGO.transform.forward * -(distance * 2f);
            }
            
            cameraGO.transform.position = cameraPosition;
            cameraGO.transform.LookAt(bounds.center);
            
            // 可选：添加简单的灯光
            SetupBasicLighting(tempInstance);
            
            // 渲染
            camera.Render();
            
            // 读取像素
            Texture2D result = new Texture2D(width, height, TextureFormat.RGBA32, false);
            RenderTexture.active = rt;
            result.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            result.Apply();
            RenderTexture.active = null;
            
            return result;
        }
        catch (System.Exception e)
        {
            Debug.LogError($"Error capturing thumbnail for {prefab.name}: {e.Message}");
            return null;
        }
        finally
        {
            // 清理资源
            if (tempInstance != null) DestroyImmediate(tempInstance);
            if (cameraGO != null) DestroyImmediate(cameraGO);
            if (rt != null) RenderTexture.ReleaseTemporary(rt);
        }
    }
    
    Quaternion GetCameraRotation(ViewAxis axis)
    {
        switch (axis)
        {
            case ViewAxis.Front:
                return Quaternion.LookRotation(Vector3.forward, Vector3.up);
            case ViewAxis.Back:
                return Quaternion.LookRotation(Vector3.back, Vector3.up);
            case ViewAxis.Left:
                return Quaternion.LookRotation(Vector3.left, Vector3.up);
            case ViewAxis.Right:
                return Quaternion.LookRotation(Vector3.right, Vector3.up);
            case ViewAxis.Top:
                return Quaternion.LookRotation(Vector3.up, Vector3.forward);
            case ViewAxis.Bottom:
                return Quaternion.LookRotation(Vector3.down, Vector3.back);
            case ViewAxis.Isometric:
                return Quaternion.LookRotation(new Vector3(-1, -0.5f, -1).normalized, Vector3.up);
            case ViewAxis.IsometricOpposite:
                return Quaternion.LookRotation(new Vector3(1, -0.5f, 1).normalized, Vector3.up);
            default:
                return Quaternion.identity;
        }
    }
    
    void SetupBasicLighting(GameObject target)
    {
        // 检查是否已有光源
        Light[] existingLights = Object.FindObjectsOfType<Light>();
        if (existingLights.Length == 0)
        {
            // 创建基本的三点光源
            CreateLight(new Vector3(-5, 5, 5), 1.0f, Color.white); // 主光
            CreateLight(new Vector3(5, 3, 5), 0.5f, new Color(0.8f, 0.8f, 1.0f)); // 辅光
            CreateLight(new Vector3(0, 10, 0), 0.3f, Color.white); // 顶光
        }
    }
    
    void CreateLight(Vector3 position, float intensity, Color color)
    {
        GameObject lightGO = new GameObject("ThumbnailLight");
        Light light = lightGO.AddComponent<Light>();
        light.type = LightType.Directional;
        lightGO.transform.position = position;
        lightGO.transform.LookAt(Vector3.zero);
        light.intensity = intensity;
        light.color = color;
        light.shadows = LightShadows.None; // 为了性能，禁用阴影
    }
    
    Bounds CalculateBounds(GameObject obj)
    {
        Bounds bounds = new Bounds(obj.transform.position, Vector3.zero);
        bool hasBounds = false;
        
        // 获取所有Renderer组件
        Renderer[] renderers = obj.GetComponentsInChildren<Renderer>();
        if (renderers.Length > 0)
        {
            bounds = renderers[0].bounds;
            hasBounds = true;
            foreach (Renderer renderer in renderers)
            {
                bounds.Encapsulate(renderer.bounds);
            }
        }
        
        // 如果没有Renderer，使用Collider
        if (!hasBounds)
        {
            Collider[] colliders = obj.GetComponentsInChildren<Collider>();
            if (colliders.Length > 0)
            {
                bounds = colliders[0].bounds;
                hasBounds = true;
                foreach (Collider collider in colliders)
                {
                    bounds.Encapsulate(collider.bounds);
                }
            }
        }
        
        // 如果仍然没有边界，使用MeshFilter
        if (!hasBounds)
        {
            MeshFilter[] meshFilters = obj.GetComponentsInChildren<MeshFilter>();
            if (meshFilters.Length > 0 && meshFilters[0].sharedMesh != null)
            {
                bounds = meshFilters[0].sharedMesh.bounds;
                bounds.center = obj.transform.position;
                hasBounds = true;
                foreach (MeshFilter meshFilter in meshFilters)
                {
                    if (meshFilter.sharedMesh != null)
                    {
                        bounds.Encapsulate(meshFilter.sharedMesh.bounds);
                    }
                }
            }
        }
        
        return bounds;
    }
    
    string GetValidFileName(string fileName)
    {
        char[] invalidChars = Path.GetInvalidFileNameChars();
        foreach (char c in invalidChars)
        {
            fileName = fileName.Replace(c.ToString(), "");
        }
        return fileName;
    }
}

// 扩展方法用于计算GameObject的边界
public static class GameObjectExtensions
{
    public static Bounds GetBounds(this GameObject obj)
    {
        Bounds bounds = new Bounds(obj.transform.position, Vector3.zero);
        Renderer[] renderers = obj.GetComponentsInChildren<Renderer>();
        
        if (renderers.Length > 0)
        {
            bounds = renderers[0].bounds;
            foreach (Renderer renderer in renderers)
            {
                bounds.Encapsulate(renderer.bounds);
            }
        }
        
        return bounds;
    }
}
```
