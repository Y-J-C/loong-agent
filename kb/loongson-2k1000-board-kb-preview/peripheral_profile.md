# 外设只读画像

> 来源版本：第二阶段 v0.1。本文已纳入 preview v0.1 目录结构。

## 1. 文档说明

本文档整理当前 GPIO、I2C、SPI、UART、USB、Ethernet、Display、Audio、RTC、PCI 等外设节点和只读状态。  
本阶段未进行接线测试、未 export GPIO、未 i2cdetect 扫描、未 SPI 写入、未修改权限、未加载/卸载内核模块。

原始证据文件：

```text
raw/stage2/raw_stage2_readonly_collection_20260610.txt
```

---

## 2. 外设总览

| 外设 | 是否存在 | 设备节点/线索 | 当前状态 | 风险 |
|---|---|---|---|---|
| GPIO | 是 | /sys/class/gpio/gpiochip0 | 仅确认控制器存在 | 禁止盲目 export 和接线 |
| I2C | 是 | /dev/i2c-0, /dev/i2c-1 | 节点存在 | 禁止未确认电压接线 |
| SPI | 是 | /dev/spidev0.1, /dev/spidev0.4 | 节点存在，仅 root 可访问 | 禁止写入测试 |
| UART | 是 | /dev/ttyS0-ttyS3 | 节点存在 | 串口电平需确认 |
| USB | 是 | USB 1.1/2.0/3.0 root hub | 控制器和 root hub 存在 | 外设兼容性待验证 |
| Ethernet | 是 | eth0, eth1 | eth0 可用，eth1 DOWN | eth0 不可随意改配置 |
| Display / DRM | 是 | /dev/dri/card0, card1, renderD128 | DRM 节点存在，显示输出待验证 | CRTC 异常 |
| Audio | 部分存在 | /dev/snd/seq, timer | 未确认声卡可用 | no codecs found |
| RTC | 是 | /dev/rtc -> rtc0 | 节点存在，时间异常待验证 | RTC alarm 无效 |
| PCIe | 是 | Loongson PCI bridges, ASM1042A | PCI 枚举成功 | 外接 PCIe 待验证 |

---

## 3. GPIO

| 项目 | 内容 |
|---|---|
| 是否存在 | 是 |
| 节点 | /sys/class/gpio |
| 控制器 | gpiochip0 |
| 路径 | ../../devices/platform/soc/1fe00500.gpio/gpio/gpiochip0 |
| export/unexport | 存在，但本阶段未使用 |
| 当前状态 | 仅确认 sysfs GPIO 控制器存在 |
| 风险 | GPIO 接线前必须确认引脚、电压、GND |

### 结论

```markdown
结论：系统存在 GPIO 控制器 gpiochip0，但具体引脚映射和可用性待验证。
证据：ls -al /sys/class/gpio 显示 gpiochip0。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 4. I2C

| 项目 | 内容 |
|---|---|
| 是否存在 | 是 |
| 设备节点 | /dev/i2c-0、/dev/i2c-1 |
| 权限 | root:i2c，crw-rw---- |
| 当前状态 | 节点存在，未扫描总线 |
| 风险 | 未确认外设电压前不得接线 |

### 结论

```markdown
结论：当前系统存在两个 I2C 设备节点。
证据：ls -al /dev/i2c* 输出 /dev/i2c-0 和 /dev/i2c-1。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 5. SPI

| 项目 | 内容 |
|---|---|
| 是否存在 | 是 |
| 设备节点 | /dev/spidev0.1、/dev/spidev0.4 |
| 权限 | root:root，crw------- |
| 当前状态 | 节点存在，普通用户可能不可直接访问 |
| 风险 | SPI 写入可能影响外设或系统，禁止盲测 |

### 结论

```markdown
结论：当前系统存在 SPI spidev 设备节点，但权限仅 root 可访问。
证据：ls -al /dev/spidev* 输出 /dev/spidev0.1、/dev/spidev0.4，权限为 crw------- root root。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 6. UART

| 节点 | 权限 | 组 | 说明 |
|---|---|---|---|
| /dev/ttyS0 | crw--w---- | tty | 可能为控制台串口 |
| /dev/ttyS1 | crw-rw---- | dialout | 串口 |
| /dev/ttyS2 | crw-rw---- | dialout | 串口 |
| /dev/ttyS3 | crw-rw---- | dialout | 串口 |

### 结论

```markdown
结论：系统存在 4 个 ttyS 串口节点，但实际引脚、电平和用途待验证。
证据：ls -al /dev/ttyS* 输出 ttyS0-ttyS3。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 7. USB

| 项目 | 内容 |
|---|---|
| USB 3.0 | Linux Foundation 3.0 root hub |
| USB 2.0 | 多个 Linux Foundation 2.0 root hub |
| USB 1.1 | Linux Foundation 1.1 root hub |
| PCI USB 控制器 | ASMedia ASM1042A USB 3.0 Host Controller |
| 当前外接设备 | 未见非 root hub 外设 |

### 结论

```markdown
结论：USB 控制器和 root hub 可见，但外接 USB 设备兼容性未验证。
证据：lsusb 输出多个 root hub；lspci 输出 ASMedia ASM1042A USB 3.0 Host Controller。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 8. Display / DRM / GPU

| 项目 | 内容 |
|---|---|
| DRM 节点 | /dev/dri/card0、card1、renderD128 |
| 权限组 | video、render |
| 日志线索 | etnaviv initialized |
| 异常 | Cannot find any crtc or sizes |

### 结论

```markdown
结论：系统存在 DRM 设备节点和 etnaviv 相关日志，图形子系统被识别。
证据：/dev/dri 下存在 card0、card1、renderD128；dmesg tail 显示 Initialized etnaviv。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：显示输出是否正常仍待验证。
证据：dmesg tail 中出现 [drm] Cannot find any crtc or sizes。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 9. Audio

| 项目 | 内容 |
|---|---|
| /dev/snd 节点 | seq、timer |
| codec 状态 | dmesg 显示 no codecs found |
| 声卡状态 | 当前无法确认可用 |

### 结论

```markdown
结论：当前无法确认音频可用，dmesg 存在 no codecs found。
证据：/dev/snd 仅有 seq、timer；dmesg 显示 loongson-audio 400d0000.hda: no codecs found!。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 10. RTC

| 项目 | 内容 |
|---|---|
| 节点 | /dev/rtc -> rtc0 |
| 设备 | /dev/rtc0 |
| 权限 | crw------- root root |
| 日志线索 | 系统时间异常、RTC alarm 无效 |

### 结论

```markdown
结论：RTC 设备节点存在，但 RTC 时间或 alarm 状态存在异常线索。
证据：ls -al /dev/rtc* 显示 /dev/rtc -> rtc0 和 /dev/rtc0；dmesg 第一阶段补采曾显示 invalid alarm value，第二阶段 dmesg tail 显示 System time before build time。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 11. 外设后续验证原则

禁止直接执行：

```text
echo N > /sys/class/gpio/export
i2cdetect
SPI 写入测试
串口接线测试
修改 /dev 权限
加载/卸载内核模块
```

建议后续验证顺序：

1. 先查官方引脚图和电压说明。
2. 再确认 GND、电平、接口复用关系。
3. 先做只读命令验证。
4. 最后在人工确认后进行低风险外设测试。
