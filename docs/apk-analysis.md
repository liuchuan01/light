# APK 静态分析与蓝牙协议记录

分析日期：2026-10-06

状态：已梳理旧 APK 自有业务代码、入口可达页面、资源和命令；设备连接、列表读取、全身白光与红光、局部点位逐项试色见[实机记录](device-test-2026-10-06.md)。其他颜色、灯效、保存与高级组合尚未验证。

## 样本与方法

| 项目 | 结果 |
| --- | --- |
| 文件 | `/Users/liuchuan/Downloads/app-debug.apk` |
| SHA-256 | `bf495209c45f08f636fcf783d52396f7fc5c93fdd07ff37ca84ec17cc1ceb820` |
| 包名 | `com.sanyuehuakai.blueRobot` |
| 版本 | `1.0.0`，`versionCode=10000` |
| 系统要求 | Android 7.0 起，声明 BLE 为必需功能 |
| 代码 | 4 个 DEX 文件；使用 jadx 1.5.6 静态反编译 |

jadx 报告 163 处反编译错误；下述关键类的相关方法可以阅读。反编译结果只作为代码线索，实物行为仍需验证。用户提供的芯片刻字为 `st17h66be2gt2549shtl2854`；它较可能属于 `ST17H66B` 系列，但完整子型号与本机固件协议仍未知。详见[控制芯片识别记录](hardware-identification.md)。

## 实际启动路径与 BLE 连接

`AndroidManifest.xml` 中的启动 Activity 是 `SplashActivity`，其代码跳转到 `ui.activity.LoginActivity`，连接成功后进入 `ui.activity.HomeActivity`。APK 里还包含较早的 `ui.DoActivity`；它使用另一套 ASCII 指令格式，不能直接套用到上述启动路径。

在 `LoginActivity` 中，App 扫描 BLE 设备，将有名称的设备加入列表；用户选中设备后调用 `connectGatt`，发现服务并请求 MTU 256。App 遍历发现的特征，以 UUID 识别读写通道：

| 用途 | UUID |
| --- | --- |
| 目标服务，定义于 `UUIDS` | `0000FFF0-0000-1000-8000-00805F9B34FB` |
| 写入特征 | `0000FFF3-0000-1000-8000-00805F9B34FB` |
| 接收通知/指示特征 | `0000FFF4-0000-1000-8000-00805F9B34FB` |
| 通知配置描述符 CCCD | `00002902-0000-1000-8000-00805F9B34FB` |

App 根据接收特征的属性启用 notification 或 indication。写入时设置 Android `WRITE_TYPE_NO_RESPONSE`（数值 1）；长报文按协商 MTU 减 3 分段写入，分段之间约等待 20 ms。`FFF0` 是代码定义的目标服务 UUID；连接代码实际上遍历全部已发现服务并匹配特征 UUID，因此仍需在实物上确认服务归属。

## 当前启动路径的二进制报文

`CmdUtil.createCMDAndWrite(cmd, readOrWrite, data)` 构造以下字节序列：

```text
BC | cmd | readOrWrite | data.length | data... | 55
```

- `BC`：发送包头，十进制 188。源码通过 `PictureConfig.CHOOSE_REQUEST` 引用该值。
- `cmd`：一字节命令号。
- `readOrWrite`：`00` 为读取，`01` 为写入。
- `data.length`：一字节数据长度，不含包头等固定字段。
- `55`：发送包尾。组包代码未加入校验和。

例如，读取全体灯效列表的命令号为十进制 64（`0x40`），数据为空，因此**按代码推导**的报文为：

```text
BC 40 00 00 55
```

该报文已在首次实机测试中发送，收到 `CC 40 00 00 55`；详见 [实机记录](device-test-2026-10-06.md)。接收侧 `BlueManagerUtil.handleRecData` 接受长度大于 4 且满足“首字节为 `CC` **或** 末字节为 `55`”的内容，再按第二字节分派；这里的逻辑不能作为完整的响应格式或校验规则。仍需积累原始通知数据后再定义响应解析。

## 已定位的命令

命令号来自 `CmdUtil`；数据布局来自 `BlueCmdManager`。下表中的数值均为十六进制。

| 命令 | 操作 | 已读出的数据布局 |
| --- | --- | --- |
| `30` | 读取预设组列表 | 空 |
| `31` | 读取预设组详情 | `index` |
| `32` | 保存预设组 | `index, pointNum, pointIndex..., colorType, R, G, B, light, effectMode` |
| `33` | 临时预览预设组 | 与 `32` 相同 |
| `34` | 删除预设组 | `index` |
| `40` | 读取全体灯效列表 | 空 |
| `41` | 读取全体灯效详情 | `index` |
| `42` | 保存全体灯效 | `index, 00, colorType, R, G, B, light, effectMode, lightType, speed` |
| `43` | 临时预览全体灯效 | `index, isOpen(0/1), colorType, R, G, B, light, effectMode, lightType, speed` |
| `44` | 切换全体灯效 | `index, flag`；代码传入 `!isOpen`，实际含义待实测 |
| `45` | 删除全体灯效 | `index` |
| `50`–`57` | 高级分组：列表、详情、顺序、保存、预览、开启、删除 | 发送字段详见下表；设备行为待实测 |

高级分组的八条命令现已进一步核对：

| 命令 | 用途 | 数据布局（按 `BlueCmdManager`） |
| --- | --- | --- |
| `50` | 查询高级预设列表 | 空 |
| `51` | 查询高级预设详情 | `index` |
| `52` | 查询高级预设的自定义顺序 | `index` |
| `53` | 保存高级预设 | `index, isOpen, pointNum, presetIndex..., mode, lightType, speed, step` |
| `54` | 保存自定义顺序 | `index, [slotIndex, pointNum, pointIndex...]...`；仅写入已设置的顺序项 |
| `55` | 临时预览高级预设 | `index, isOpen, pointNum, presetIndex..., mode, lightType, speed, 01` |
| `56` | 切换高级预设 | `index, !isOpen`；实际开关语义待实测 |
| `57` | 删除高级预设 | `index` |

`50`–`57` 是十六进制，对应十进制 80–87。高级预设选择已经保存的局部预设，而 `54` 中的 `slotIndex` 是顺序设置页的 14 个位置之一。上表为发送侧代码布局，未实测接收端。

## App 功能清单与可达性

启动链路为 `SplashActivity → LoginActivity → ui.activity.HomeActivity`。主界面有“全身、高级、预设、设置”四页。`DataManager` 在收到列表后按全身 4、高级 4、局部预设 14 个槽位建模；这属于 App 界面假设，尚未由设备确认。

| 模块 | 从当前启动链路可达的功能 | 代码位置 |
| --- | --- | --- |
| 蓝牙连接 | 搜索有名称的 BLE 设备、选择并连接、服务发现、MTU 协商、订阅通知、断开 | `ui.activity.LoginActivity` |
| 全身预设 | 查询列表与详情、切换、长按删除；编辑单色/渐变色、取色、模式、正反方向、亮度、速度，临时“试色”及保存 | `ui.fragment.HomeFragment`、`ui.activity.FullBodySettingActivity` |
| 高级预设 | 查询列表与详情、切换、长按删除；选取已设置的局部预设、正反方向、速度、开启间隔，试色及保存 | `ui.fragment.SecondFragment`、`ui.activity.HighSettingActivity` |
| 高级顺序 | 为 14 个位置选择局部预设组合并保存自定义顺序 | `ui.activity.SortSetActivity`、`dialog.DialogSelectDialog` |
| 局部预设 | 查询列表与详情、长按删除；在 40 个点位中选择、编辑单色/渐变色、取色、模式、亮度，试色及保存 | `ui.fragment.ThirdFragment`、`ui.activity.PresetSettingActivity` |
| 设置 | 显示连接设备名称与地址；进入软件升级 | `ui.fragment.SettingFragment` |
| 软件升级 | 选择 `.hex` 文件、显示设备模式和日志、进度、取消；含应用态到 OTA 模式的切换和分阶段传输代码 | `ui.activity.OtaUpgradeActivity`、`ota/*` |

模式选择列表由 `DataManager.modelList` 定义，索引从 0 到 18，依次是：默认、单色呼吸、彩色呼吸、单向跑马、往返跑马、环形跑马、流光、彩虹流光、彩虹循环、彩虹渐变、波浪、涟漪、心跳、脉冲、星光闪烁、流星雨、极光、火焰、随机炫彩。它们是 App 发给设备的模式编号与显示名称；动画算法未包含在 App 中，实际效果须由固件和实物确认。

设置页布局还显示“设备当前时间”“定时开机设置”“定时关机设置”“APP版本”“软件版本”“恢复出厂设置”，但 `SettingFragment.initView` 只给“软件升级”绑定点击事件，并未见读写时间、定时或恢复出厂的业务调用。因此不能把这些布局项算作这个 APK 已实现的设备功能。布局静态写着 `V1.1.0`，Manifest 版本是 `1.0.0`，不能用前者代替 APK 版本。

全身和局部编辑页有“渐变色”和第二色块，但 `BlueCmdManager` 对应保存及预览命令只发送一个 RGB 三元组；第二色是否由设备自行生成、或 UI 尚未完成，静态代码不能确定。

### 音乐律动核对

**在这个 APK 的当前控制链路中，没有找到随音乐律动的实现或入口。** 依据是：主界面四页及模式列表均无音乐项；Manifest 未声明 `RECORD_AUDIO`；自有业务代码没有 `AudioRecord`、`MediaRecorder`、`MediaPlayer` 或 `Visualizer` 的采样与节拍分析调用；`BlueCmdManager` 也没有专门的音乐指令。资源中的 `ps_audio`、`ps_preview_audio` 等属于打包的 `com.luck.picture.lib` 图片选择库，不能据此认定灯效支持音乐律动。

APK 还保留旧版 `ui.HomeActivity → ui.DoActivity`，其中 `DoActivity` 请求录音权限并调用 Android `SpeechRecognizer`；`onResults` 只是显示识别结果，`onRmsChanged` 为空实现。这段代码没有把音量或节拍转换成灯光指令，而且旧版首页没有从当前 `Splash → Login → ui.activity.HomeActivity` 链路进入的调用。旧版页面另有机器人按键、摇杆、重力/方向传感器控制，功能/表情/自定义开关，追踪、关押、躲避、跟随、光敏、火等界面项及数值设置弹窗；它们走下面的 ASCII 协议，不能混入当前灯组二进制协议。宣传中的音乐律动可能属于另一版 App、另一个固件功能或设备内置模式；仅凭这份 APK 无法确认是哪一种。

### OTA 与其他代码边界

OTA 通道与常规灯控 GATT 不同：`ota.OtaUuids` 使用服务 `5833ff01-9b8b-5191-6142-22a4536ef123`，命令、响应、数据特征末字节依次为 `02`、`03`、`04`；引导态名称为 `PPlusOTA`。代码包含 HEX 解析、设备模式检测、分阶段升级、CRC 与进度回调。这里只记录功能，不将其视为已验证可安全升级某块实物控制板。

APK 另外打包了 AndroidX、Kotlin、图片选择、弹窗、权限、工具等第三方库以及旧版机器人页面。功能清单按应用自有业务代码和当前入口分类；打包库可提供的通用能力不等于 App 已接入的灯组功能。jadx 报告 163 处错误，且没有安卓设备和灯组进行动态验证；因此“未找到音乐律动”是对当前 APK 静态代码的结论，不是对产品宣传或硬件固件的否定。

RGB 按红、绿、蓝各一字节发送。这里的 `colorType` 是界面的单色 `0` / 渐变色 `1`，`effectMode` 才是 0–18 的灯效索引；`BlueCmdManager` 的函数参数将两者分别命名为 `mode` 和 `spec`，但页面调用链明确将 `colorType` 传给前者、`model` 传给后者。`light`、`speed` 等字段在组包时也转为一字节；设备接受范围和实际效果尚未验证。删除、保存和 OTA 操作会改变设备状态，实测应从扫描与只读查询开始。

## 下游连接与点亮试验报文

**优先验证只读链路**：在发现的服务中确认 `FFF3` 可写、`FFF4` 可通知，订阅 `FFF4`，再向 `FFF3` 发送全身列表查询 `BC 40 00 00 55`；保存原始通知、MTU 和写入结果。`FFF0` 是代码常量，实物服务归属仍需确认。APK 写入使用无响应类型；“写入 API 成功”不能代替设备确认。

全身预设的“试色”调用 `BlueCmdManager.writeBLEAppTestWholeBodyCommand`，完整格式为 `BC 43 01 0A | index isOpen colorType R G B light effectMode lightType speed | 55`，总长 15 字节。`0A` 是后续 10 个数据字节的长度，不是 23 颗灯珠数量。

| 用途 | 完整十六进制报文 | 解释 |
| --- | --- | --- |
| APK 新建空槽位、未修改任何控件就按“试色” | `BC 43 01 0A 00 00 00 FF FF FF 00 01 00 00 55` | 槽位 0、`isOpen=0`、单色、白色、亮度 0、模式 1（单色呼吸）、正向、速度 0。这是默认数据对象的组包结果，**预计不适合作为点亮验证**。 |
| 建议的明确白光试验向量 | `BC 43 01 0A 00 01 00 FF FF FF 64 00 00 00 55` | 槽位 0、`isOpen=1`、单色白光、亮度 100、模式 0（默认）、正向、速度 0。它符合 APK 的组包规则，**不是 APK 空槽位的原样默认值**；设备是否接受、模式 0 是否常亮均待实测。 |

第二条是为了下游点亮试验显式指定参数的静态向量。全身试色报文不含灯珠总数，也不传点位列表，所以“实物有 23 颗灯珠”不会改变它的长度。局部预设可选 40 个点位索引。本台设备的逐点实测结果见[实机记录](device-test-2026-10-06.md)：`0–22` 依次只亮 `D1–D23`，`23` 不亮，`24–39` 每次只亮 `D1`。APK 编辑页和组包代码未定义 `23–39` 的特殊含义。`43` 属于临时预览；目前没有证据保证它不会影响设备当前显示状态，测试时应记录试验前后状态。

### 逆向完成度与障碍

本轮覆盖了四个 DEX 中应用自有业务包的入口、页面、数据对象、收发分派、19 条当前灯控命令及 OTA；当前灯控的组包关键方法可读。类名和方法名大体保留，未发现阻断这些关键路径的加壳或严重名称混淆。jadx 全 APK 仍报告 163 处反编译错误，第三方库没有逐方法审计；这不能称为“APK 每一行代码都已无损还原”。尤其设备固件、灯珠物理映射、通知分包方式、参数范围和实际灯效不在 APK 静态证据范围内。下游首先需要 GATT 实测和原始通知，再校正读响应解析和点亮向量。

## APK 中另一套协议

`ui.DoActivity.createCMD` 生成 UTF-8 文本，形如 `&-长度-读写标记-命令号-数据...-#`；该 Activity 还兼容 `FFE0/FFE1`、`FFE0/FFE2` 和 Nordic UART 风格的 GATT 特征。它与当前 `SplashActivity → LoginActivity` 路径的二进制协议分开记录，避免混用。若实物的 GATT 服务不是 `FFF0/FFF3/FFF4`，需要重新检查它是否匹配这套兼容路径。

## 代码证据索引

以下路径是 APK 反编译后的包名与类名，复查时可用 jadx 打开原始 APK：

| 结论 | 类与方法 |
| --- | --- |
| 启动与跳转 | `AndroidManifest.xml`；`ui.activity.SplashActivity` |
| 扫描、连接、特征选择、订阅通知 | `ui.activity.LoginActivity` |
| UUID 常量 | `ui.UUIDS` |
| 二进制组包、命令号 | `base.CmdUtil.createCMDAndWrite` |
| 数据字段及命令用途 | `base.BlueCmdManager` |
| 分段写入、接收分派 | `base.BlueManagerUtil.writeCMD`、`handleRecData` |
| 旧版 ASCII 格式 | `ui.DoActivity.createCMD` |

## 实物验证时需要记录

- 设备广播名称、MAC 地址、服务与特征 UUID，以及各特征的属性。
- 连接后 MTU 协商结果、通知订阅结果。
- `BC 40 00 00 55` 的写入结果和原始响应十六进制数据。
- 每条控制命令发出前后的可见灯效、设备状态和响应。
- 芯片与控制板清晰照片，便于核对芯片刻字及硬件型号。
