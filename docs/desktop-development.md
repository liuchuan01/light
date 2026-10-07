# Mac 界面开发

## 产品范围

首发仅支持 Mac。日常展示使用四个场景。用户在编辑器中选择灯位、调整灯光、试灯，再替换四个场景之一。

当前工程位于 `desktop/`，采用 Tauri 2、React、TypeScript、Vite 和 SVG。`rust/` 保留为早期验证草稿，与新桌面壳分开。Python 脚本和协议测试保持原有用途。

## 已实现

- 四场景展示台、场景选择、真实设备写入播放和独立模拟模式。
- 独立编辑草稿，支持名称、全身设置、D1–D23 多选和局部设置。
- 根据用户设定画稿生成原生 SVG，支持正面 18 点、背面 5 点切换，图上区域/编号/索引网格联动、键盘选择和实时改色。
- RGB 颜色、亮度档位 1–10；全身灯效 0–10，局部灯效 0–2。方向和速度参数只在全身灯效 3–10 显示，界面说明其中仅跑马完成相应实测。
- 临时模拟试灯约 3 秒，第二次试灯覆盖第一次并重新计时。混合设置的选择不能作为一次局部试灯发送。
- 明确选择目标后替换一个场景；其余场景不变。
- localStorage 持久化、重开恢复、数据格式检查。损坏数据在显式保存时先备份到带时间戳的独立键，再写入新库。
- 场景 JSON 导出。浏览器下载文件；桌面壳使用原生保存对话框。
- 离开编辑器前的未保存提示、浏览器刷新保护、Cmd/Ctrl+S 保存入口。桌面窗口关闭保护已接入 Tauri 事件，待 Mac 验收。

默认四个场景的名称和颜色是可替换的界面示例，不是从硬件读取的预设。首次显式保存前，示例由程序生成。

## 本地运行

Node.js 22.12 或更高版本及 pnpm。本次开发环境为 Node 24。

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 `http://localhost:1420`。开发服务监听 `0.0.0.0:1420`，端口占用时直接报错，不会悄悄换端口。可添加 `--host 127.0.0.1` 限制仅本机访问。

```bash
pnpm build
pnpm test
pnpm exec playwright install chromium --only-shell
pnpm test:e2e
```

逻辑测试覆盖草稿隔离、目标替换、存储验证、模拟连接中断和预览覆盖计时。浏览器测试覆盖编辑保存和刷新恢复、取消/放弃修改、模拟播放与试灯、损坏存储备份、最小窗口宽度。生产构建包含 TypeScript 检查。

## Mac 桌面壳

当前声明最低 macOS 13。Mac 上安装 Xcode Command Line Tools、Rust stable、Node 和 pnpm 后，在 `desktop/` 执行：

```bash
pnpm tauri dev
pnpm tauri build
```

`tauri dev` 会启动 Vite，使用前先结束已占用 1420 的浏览器预览进程。产物配置为 `.app` 和 `.dmg`。签名、公证与发布尚未配置。

桌面默认蓝牙模式，点击「扫描蓝牙灯组」，选择名为「极梦匠」的设备。首次扫描按 macOS 提示授予蓝牙权限，权限说明位于 `src-tauri/Info.plist`。连接会核对 FFF0 服务、FFF3 无响应写入和 FFF4 通知，再读取预设。模拟模式需手动切换；两种模式不会自动互相替代。

本轮在 Linux 完成前端构建、Tauri Rust 编译检查与 Clippy、Rust 核心离线测试、前端逻辑测试和 Chromium 交互测试；另对 Rust BLE 核心完成 Apple Silicon macOS 目标的交叉编译检查。这不等于 Mac 应用打包或硬件验收：蓝牙权限弹窗、CoreBluetooth 实际收发、原生对话框、关闭保护、WKWebView 和 `.app`/`.dmg` 仍需 Mac 上验证。

## 目录与数据边界

| 位置 | 职责 |
| --- | --- |
| `desktop/src/domain/scenes.ts` | 四场景数据结构、校验、灯位编辑和目标替换。 |
| `desktop/src/domain/model.ts` | 灯位名称、D 编号与前后视图的关系。 |
| `desktop/src/assets/unicorn-linework.svg` | 由原稿提取的矢量装甲与线稿，无嵌入位图。 |
| `desktop/src/assets/unicorn-regions.json` | 23 个灯位的可交互 SVG 路径。 |
| `desktop/src/components/ModelView.tsx` | 前后模型 SVG、选区、编号和灯位索引网格。 |
| `desktop/src/device/adapter.ts` | 界面依赖的设备接口。 |
| `desktop/src/device/mock.ts` | 模拟连接、播放快照与临时试灯；没有硬件调用。 |
| `desktop/src/device/native.ts` | Tauri IPC、真实连接状态、串行操作与通信记录。 |
| `desktop/src/components/DevicePanel.tsx` | 模式切换、设备选择、预设详情和日志。 |
| `desktop/ble-core/src/` | 独立 Rust 协议、组包/解析、槽位分配、传输和 BLE 会话。 |
| `desktop/src-tauri/src/ble.rs` | 类型化 BLE 命令入口。 |
| `desktop/src/App.tsx` | 展示、编辑、草稿导航与本地保存流程。 |
| `desktop/src-tauri/` | 桌面窗口、命令、能力权限与应用图标。 |

场景库用 `unicorn-light-studio.library.v1` 保存。浏览器和桌面 WebView 的存储独立。本地场景名称不从硬件推断。重新连接会读取设备的实际预设和开启标记，在设备面板展示，但不会覆盖本地四场景。编辑或保存不自动改变正在播放的场景，需点击「写入并播放」同步。

`Scene.scope` 区分全身与按灯位设置。全身模式用 `light`；按灯位模式用 23 项 `points`。切到按灯位时以当前全身设置初始化；全身专用灯效降为常亮。切回全身使用保留的全身设置。Rust 按相同 RGB、亮度和灯效合并点位；单个局部试灯请求也只能携带一组设置。

## 模型素材接入

已收到 `docs/unicorn1.png` 设定画稿和 `docs/unicorn2.png` 蓝色编号图。编号 1–23 对应 D1–D23；正面 18 个，背面 5 个。左右按模型自身方向命名。

可编辑映射源为 `docs/unicorn-light-map.json`，记录原图坐标、编号、名称、视角、引线锚点及标签位置。`scripts/vectorize_model.py` 从原稿生成 SVG 线稿和区域路径。一个 D 编号的路径允许含多个子路径，表示同一编号对应的多个发光面。眼部 D1 与腰腹横向灯带 D14 是人工简化路径，本轮已按反馈修正位置和形状，其余区域在指定范围内沿原稿红色结构提取。没有标号的背部腿甲不推测关联。详见 [质量核对](model-svg-review.md)。

重建命令（只需要在修改原图或映射时运行）：

```bash
uv run --with opencv-python-headless --with pillow python scripts/vectorize_model.py
```

图像处理依赖只用于离线生成，不进入桌面运行时。生成文件随 Git 提交，普通界面开发无需安装这些依赖。

## 真实设备同步

1. 「保存场景」只更新本机场景库。「写入并播放」才写设备，目标位置直接显示在按钮下方。
2. `scene-1..4` 映射设备槽位 `0..3`：全身场景写全身槽位，按灯位场景写同编号高级组合槽位。切换控制方式时旧类别的预设保留但关闭；不删除设备预设。
3. 每次同步先重新读取三类列表、详情和高级顺序。全身用 `42 → 41 回读 → 44 开启`；局部组合用 `32 → 31 回读 → 53 → 51 回读 → 54 → 52 回读 → 56 开启`。开启后再读取预设，检查只有目标项开启。此前开启的全身/高级预设会先关闭。
4. 局部设置按 RGB、亮度、灯效分组。先预留所有完全匹配的现有局部预设，再复用仅被目标组合引用的槽位，最后使用未占用槽位。其他组合的主引用和顺序引用均受保护。不足时拒绝写入；不会为了腾空间删除无关联预设。
5. 14 个局部槽位由四个产品场景共同使用，不是每场景各 14 个。14/4/4 来自 APK 上限，完整容量未做实机验证。旧组合缩减后遗留的局部预设不会自动清理；容量不足时需后续显式整理，不会暗中覆盖。
6. 试灯使用 `43` 或 `33`，不保存。界面约 3 秒后清除试灯指示，但不推断固件是否恢复之前的灯效。停止发送 `44/56` 关闭已开启预设并回读；不使用未确认的临时试灯中断命令。
7. 所有请求串行，先订阅再发送。长报文分为 20 字节块，块间 20 ms；单次底层写入超时 10 秒，响应超时 4 秒。原始通知逐条记录，再按长度字段拆包/拼包。只接受匹配命令和槽位的详情、逐字节匹配的写入回显。
8. 超时、断线或回读不一致会停止流程并断开，界面显示错误；不自动重发、重连或回滚。多条报文不具备原子性，重连后先读取实际预设，再决定是否重新同步。

`54` 顺序写入用于显式替换旧组合顺序；`44/56` 的关闭值、长帧分片和全部槽位容量尚待本轮 Mac 实机验收。此前证据已确认 `42/44` 的保存开启、`32/53/56` 的同一步组合，以及相关读取和断电恢复。这里的实现进度不改变历史验证结论。

设备面板提供原始预设 JSON，未知颜色类型/亮度/灯效字段按读取值保留，不自动转换成本地编辑参数。应用没有任意报文、删除或 OTA 入口。

## 调试位置和测试

打开「设备与通信记录」可刷新预设、看开启项和最近 100 条事件。完整 TX/RX JSONL 写入 Tauri 的应用日志目录，Mac 通常为 `~/Library/Logs/com.modellight.unicorn-studio/ble-*.jsonl`；面板显示当前实际路径。RX 保留每条原始通知，TX 记录完整逻辑报文。日志不进入 Git。

```bash
# 仓库根目录：无需蓝牙适配器
cargo test --manifest-path desktop/ble-core/Cargo.toml
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml -- -D warnings

# desktop/：测试真实适配器时，IPC 响应由测试替身提供
pnpm test
pnpm test:e2e
pnpm build
```

Rust 测试覆盖已录报文、长度/索引校验、碎片通知、长报文分段、超时不重发、即时响应、共享槽位保护和容量不足。前端测试覆盖延迟响应、并发拒绝、断线后的迟到结果、错误提示和设备选择至写入的 UI 流程。这些均为离线验证。

## 下一步

- 收到更清晰设定图后，重绘简化轮廓；本轮只纠正 D1、D14，不把自动提取的杂乱底图当成最终稿。
- 在 Mac 上运行 `pnpm tauri dev`，先扫描连接、检查回读预设，再试灯和同步单个场景。协议差异可从 `ble-core/src/protocol.rs`、`planner.rs`、`transport.rs`、`controller.rs` 分别调整；保留日志便于对照。
- 完成原生权限、实物灯效、异常断线、切换全身/局部场景、重新上电恢复及打包验收。
