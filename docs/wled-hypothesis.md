# WLED 来源假设核对

## 线索

用户看到某个灯控 App 界面似乎显示 `WLED`，并提供 [WLED 项目](https://github.com/wled/WLED)作为可能的开源来源。目前尚未取得该界面的截图或新版 APK。以下核对只针对仓库已保存的旧 APK `app-debug.apk`。

## 可核对的差异

| 项目 | 旧 APK 与实机 | WLED 官方项目 |
| --- | --- | --- |
| 主控与连接 | 用户提供的芯片刻印以 `ST17H66B` 开头；实机使用 BLE `FFF0/FFF3/FFF4`。 | [官方仓库](https://github.com/wled/WLED)介绍以 ESP32 和 Wi-Fi 控制灯珠。 |
| 控制接口 | 本机实测向 `FFF3` 发送 `BC … 55` 二进制报文，从 `FFF4` 收到 `CC … 55` 通知。 | [官方 JSON API](https://github.com/wled/WLED-Docs/blob/main/docs/interfaces/json-api.md)使用 HTTP `/json`，通过 JSON 字段设置状态、颜色、灯效和预设。 |
| Android 应用标识 | 旧 APK Manifest 包名为 `com.sanyuehuakai.blueRobot`；应用名称为“极梦匠”。 | [WLED Android 客户端](https://github.com/Moustachauve/WLED-Android)的应用标识为 `ca.cgagnier.wlednativeandroid`，并通过网络发现 WLED 设备。 |
| 旧 APK 可见品牌 | `res/drawable-xxhdpi/splash_bg.png` 的画面文字为 `OPEN SOURCE KEYES`。旧 APK 已提取的 Java 源码和字符串资源中未找到独立的 `WLED` 文本。 | 官方仓库名称为 WLED。 |
| 灯效列表 | 旧 APK 固定列出 19 个中文灯效名称，编号 `0–18`。 | 官方 JSON API 从设备查询灯效列表，示例列表与旧 APK 的 19 项不一致。 |

这些差异支持当前判断：**不能把本台 BLE 灯组直接当作官方 WLED 设备，也不能套用 WLED 的 HTTP/JSON 命令。** 它们不能排除某个 App 借用了 WLED 的图标、文案、界面设计或部分代码。仅凭界面相似不能确认代码来源或许可证关系。

## 新版 APK 到手后的核对

1. 保存原始 APK、来源、版本号与 SHA-256。保留旧 APK，不覆盖。
2. 核对包名、签名证书、Manifest 权限、服务 UUID、写入特征和通知特征。
3. 搜索 `WLED` 文本、图像与第三方组件，并比较界面资源的实际画面。
4. 对照旧 APK 的命令号、组包字段、接收解析和灯效列表，列出新增、删除及变化项。
5. 只把新增代码能力记为“可编码”。实机是否支持，仍须逐项测试。

灯组当前已关闭。本轮核对没有连接设备或发送请求。
