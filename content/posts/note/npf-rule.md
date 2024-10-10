+++
title = '星空摄影之 NPF 法则'
description = ''
date = 2024-02-26T02:48:31+08:00

draft = false
showToc = true
mathjax = true
hidemeta = false

author = ['ILUNP']
tags = ['NPF']
categories = ['']

[cover]
    image = ''
    alt = '<alt text>'
    caption = '<text>'
    relative = true
    
+++

## NPF法则?

拍摄星空时会使用慢门来保证画面的曝光量，而我们的地球一直在转动，结果长时间曝光拍出来的星星会带着长长的拖影。为了解决这个问题，人们通过反复试验找到了一些规律性的方法。比如：300 法则、400 法则、500 法则。但是，这些规则是针对在胶片摄影时期，使用较高 ISO 下的 35mm 胶片而设计的规则。而当下大部分人使用的数码相机并不太适用。为了获得更准确的曝光时间，必须考虑焦距和光圈以及传感器尺寸和分辨率，这样的一种方法叫做 NPF 法则。

### NPF 公式：
$$ t=\frac{(35N+30p)}{f} $$

> - $t$ : 快门(s)，控制曝光时间
> - $N$ : 光圈值，控制进光量
> - $p$ : 像素间距(μm)
> - $f$ : 焦距(mm)，控制视野范围

根据公式可以知道 **快门 ($t$)** 是由$N$ 、 $p$ 、 $f$ 决定，因此叫NPF法则。

### 像素间距公式：

$$ p=\frac{传感器长边尺寸}{传感器长边像素}×1000 $$

> - 以 NIKON Z6Ⅱ 的FX模式下为例：
> $$ p=\frac{36}{6048}×1000≈5.95(μm) $$

> - 以 NIKON Z7Ⅱ 的FX模式下为例：
> $$ p=\frac{36}{8256}×1000≈4.36(μm) $$

其余的 $N$、$f$ 直接代入NPF法则公式。

## 计算工具：

> 这里提供了一个计算器, 只需要输入参数即可获得曝光时间

- 多数情况下 **像素间距 ($p$)** 值取 $5$ 即可
|   | 描述  |  | |
|:---:|:---:|:---:|:---:|
| $N$ | 光圈值  | <input type="number" id="aperture" style="width: 50px;background-color: #FFF2" placeholder=" N"> | |
| $p$ | 像素间距(μm) | <input type="number" id="pixelPitch" style="width: 50px;background-color: #FFF2" placeholder=" p"> | |
| $f$ | 焦距(mm) | <input type="number" id="focalLength" style="width: 50px;background-color: #FFF2" placeholder=" f"> | |
| $t$ | 快门(s)  | <span id="speed">00</span> | <button onclick="calculateNPF()" style="width: 50px;background-color: #FFF5">GO</button> |


<script>
    function calculateNPF() {
        const aperture = parseFloat(document.getElementById("aperture").value);
        const pixelPitch = parseFloat(document.getElementById("pixelPitch").value);
        const focalLength = parseFloat(document.getElementById("focalLength").value);

        const  speed= (35 * aperture + 30 * pixelPitch) / focalLength;
        document.getElementById("speed").textContent = speed.toFixed(2);
    }
</script>
