# MG EX 独角兽模型灯组控制

本项目记录“极梦匠”蓝牙灯组的协议验证。用户说明该灯组用于 MG EX 独角兽高达的全身透明件，灯组有 23 颗标有 `D1–D23` 的灯珠。已在本台设备上逐个试色 APK 界面的 40 个点位索引：`0–22` 依次只亮 `D1–D23`；`23` 不亮；`24–39` 每次只亮 `D1`。详见[实机记录](docs/device-test-2026-10-06.md)。

当前阶段：前置实机验证已完成，开始 Mac 界面开发。最新实测已覆盖全身预设的保存、读取、开启、断电恢复和删除，以及局部预设经高级组合同时显示不同颜色并断电恢复。完整结果以 [T-017 至 T-044 实机记录](docs/device-test-2026-10-06-demo.md)为准；部分早期概述尚未同步。Python CLI 仍是受限验证工具，`rust/` 是暂停的旧草稿。

## Mac 界面开发

`desktop/` 使用 Tauri 2、React、TypeScript 和 SVG。首版围绕四个本地展示场景与一个灯位编辑器开发，当前仅接模拟设备。

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm dev
```

浏览器预览端口为 `1420`，默认监听 `0.0.0.0`。支持 D1–D23 多选、颜色/亮度/灯效编辑、模拟试灯、四场景替换保存及 JSON 导出。已根据用户提供的设定画稿和蓝色编号接入原生 SVG：正面 18 个灯位、背面 5 个灯位，图上选区和编号网格联动。素材质量与简化边界见 [SVG 核对记录](docs/model-svg-review.md)，独立图见 [完整点位 SVG](docs/unicorn-map.svg)。

Mac 环境准备、测试命令、素材接入位置和实现边界见 [界面开发说明](docs/desktop-development.md)。

| 阅读顺序 | 文档 |
| --- | --- |
| 1. 目前做到哪里、下次怎么测 | [下一阶段验证计划](docs/verification-plan.md) |
| 2. 实际发送过什么、看到什么 | [首次实机记录](docs/device-test-2026-10-06.md)、[Python demo 首轮实测](docs/device-test-2026-10-06-demo.md) |
| 3. 哪些能力有证据、哪些仍未知 | [控制能力与验证边界](docs/capability-model.md) |
| 4. 文件和实物资产在哪里 | [资产与证据清单](docs/asset-and-evidence.md) |
| 5. 新旧 APK 有何差异 | [两份 APK 离线对比](docs/apk-version-comparison.md) |

协议术语见[灯组控制概念](docs/concepts.md)。代码推导见[APK 分析](docs/apk-analysis.md)和[响应解析](docs/response-parser-and-color.md)。来源资料见[控制芯片识别](docs/hardware-identification.md)和[APK 来源记录](docs/source-and-vendor-clues.md)。[WLED 假设核对](docs/wled-hypothesis.md)仅作历史记录，不作为当前协议线索。

文档统一使用中文。写法借鉴 ASD-STE100 的清晰表达原则：使用短句、固定术语和明确动作。ASD-STE100 是英语受控语言标准；中文文档不声明符合其英语词典规则。

## Python 验证环境

`uv` 使用 Python 3.12。`bleak` 提供 macOS BLE 接口。只准备环境和执行离线测试时，不连接灯组。

```bash
uv sync
uv run python -m unittest discover -s tests -q
```

历史脚本的用途和写入行为列在[资产清单](docs/asset-and-evidence.md)。下一次实机测试以[验证计划](docs/verification-plan.md)为准。`scripts/preview_default_once.py` 会发送一次点亮报文。

两份原始 APK 位于 `Downloads/`。各自的 SHA-256 见[两份 APK 离线对比](docs/apk-version-comparison.md)。仓库不收录 APK、反编译输出或 `.venv/`。

## Python demo

demo 每次最多发送一条请求；`scan` 不连接设备，也不发送请求。普通试色默认使用已测的灯效编号 `0`。`--effect-mode 1` 是受限的单色呼吸试验入口，已在 D1 上观察到重复明暗变化；不会保存预设。

```bash
uv run python -m model_light scan --id 1BAA3B72-5D5A-32C5-0FD6-4B579EE6566C
uv run python -m model_light list --id 1BAA3B72-5D5A-32C5-0FD6-4B579EE6566C --kind 30
uv run python -m model_light preview --id 1BAA3B72-5D5A-32C5-0FD6-4B579EE6566C --target D1 --rgb FF0000
```

第三条命令与已实测的 `D1` 红光报文完全相同，默认亮度字节为十进制 `10`。demo 还允许 `--target all`、任意六位 RGB 及十进制 `1–10` 的亮度；这些参数的各种组合仍需逐项实机观察。原始收发事件写入本地 `logs/`。
