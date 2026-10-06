# 两份极梦匠 APK 的离线对比

对比日期：2026-10-06。本文只比较两份 APK 的文件和反编译代码。本次没有安装 App，也没有连接灯组。

## 样本身份

| 项目 | 旧包 | 新取得的包 |
| --- | --- | --- |
| 原始文件 | `/Users/liuchuan/Downloads/app-debug.apk` | `/Users/liuchuan/Downloads/极梦匠.apk.1` |
| SHA-256 | `bf495209c45f08f636fcf783d52396f7fc5c93fdd07ff37ca84ec17cc1ceb820` | `18e4df590652cc505c18d9d14474007707531d20cbc84d5010a82cf211566949` |
| Manifest 包名 | `com.sanyuehuakai.blueRobot` | 相同 |
| Manifest 版本 | `versionName=1.0.0`；`versionCode=10000` | 相同 |
| APK v2 签名证书 SHA-256 | `10:E1:E7:B7:E2:3C:F8:15:18:A4:87:0E:D6:6D:C5:99:E3:F5:89:0C:FA:1F:BC:B7:A6:B5:C1:68:91:C7:4D:5E` | 相同 |
| Manifest 调试标记 | `debuggable=true` | 相同 |

两个包不是同一文件，但使用相同的包名、版本标记，并内嵌相同的 APK v2 证书。此处核对了签名块中的证书指纹，未独立完成整个 APK 的签名有效性验证。因此不能仅凭这些字段证明发布顺序或官方来源。新包文件名不代表它的 Manifest 版本高于旧包。

## 文件与代码差异

按 APK 内部文件的解压后 SHA-256 比较：旧包有 1056 个文件，新包有 1063 个文件；763 个同名文件内容相同，293 个同名文件内容不同，另有 7 个新文件。`classes.dex` 和 `classes2.dex` 变化；`classes3.dex` 和 `classes4.dex` 逐字节相同。大量二进制 XML 的内容变化可能来自资源编号重排，不能把每个差异都当成新功能。

使用同一版 jadx 1.5.6 反编译两包，并逐文件比较下列关键类：

| 范围 | 对比结果 | 对当前项目的影响 |
| --- | --- | --- |
| `base/CmdUtil.java`、`base/BlueCmdManager.java` | 反编译文本逐字节相同。 | 已记录的 19 条命令编号和组包方法未见变化；`33`、`43` 临时试色格式未见变化。 |
| `ui/UUIDS.java`、`ota/OtaUuids.java` | 反编译文本逐字节相同。 | 常规灯控 `FFF0/FFF3/FFF4` 和 OTA UUID 未见变化。 |
| `ui/activity/FullBodySettingActivity.java`、`PresetSettingActivity.java`、`HighSettingActivity.java` | 反编译文本逐字节相同。 | 这三处编辑页的试色、保存调用未见新路径。 |
| `ui/DataManager.java` | 原有响应解析与灯效名称保留；新增设备切换后的列表重载、加载标记及延迟 150 ms 的界面刷新。 | 新包仍不能解决尚未实测的响应格式和灯效行为。 |
| `base/BlueManagerUtil.java`、`ui/activity/LoginActivity.java` | 增加设备切换期间的 GATT 断开清理控制。 | 改动涉及 App 的连接生命周期，不改变 Python demo 的报文格式。 |
| `adapter/LoginDataHolder.java` | 对空白设备名显示“未知设备”。 | 改动只涉及扫描列表文字。 |
| 新增 `ui/activity/SwitchBluetoothActivity.java` | 扫描、选择、断开旧 GATT、连接新 GATT，并重新绑定读写/通知特征。 | 这是 App 的设备切换功能；不能据此推定灯板新增控制能力。 |
| `base/AppHolder.java` 与 Manifest | 新增崩溃提示处理和相应 Activity、Provider。 | 属于 App 异常界面，不属于灯控协议。 |

`HomeFragment.java` 和 `SettingFragment.java` 增加设备切换入口。新设备连接并发现服务后，代码复用原来的特征绑定，再调用 `DataManager.reloadFromDevice()`；该方法发送原有的全身预设列表查询 `40`。代码证据不表示已在 Android 手机上验证切换体验，也不表示实物灯组因此支持新的灯效。

## 对下一阶段的决定

现有 Python demo 的 `FFF0/FFF3/FFF4`、`30` 列表读取和 `33` 单点试色，不需要因为这份 APK 更改报文。下一次仍按[验证计划](verification-plan.md)用已实测的 D1 红光报文核对 demo。颜色、亮度、呼吸灯、多点同时控制和保存行为仍需要独立实机观察；这份 APK 没有替代这些观察。

新包有与旧包相同的 163 处 jadx 反编译错误。上述“未见变化”限于已经逐文件核对的关键链路，不能推断所有第三方代码或设备固件完全相同。原始 APK 不纳入仓库；本机解码目录分别为 `jadx-output/` 和 `/tmp/model-light-new-jadx/`。复查时应先核对本节 SHA-256。
