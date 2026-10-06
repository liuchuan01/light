# Mac 界面开发

## 产品范围

首发仅支持 Mac。日常展示使用四个场景。用户在编辑器中选择灯位、调整灯光、试灯，再替换四个场景之一。

当前工程位于 `desktop/`，采用 Tauri 2、React、TypeScript、Vite 和 SVG。`rust/` 保留为早期验证草稿，与新桌面壳分开。Python 脚本和协议测试保持原有用途。

## 已实现

- 四场景展示台、场景选择和模拟播放。
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

桌面壳只有运行信息和场景导出命令，不扫描或写入 BLE。蓝牙能力后续接 Rust 设备适配器，届时补充 macOS 蓝牙权限声明与实际连接验收。

当前 Linux 环境缺少 Rust、Cargo 和 WebKitGTK 构建依赖，只完成了前端构建、逻辑测试和 Chromium 交互测试。Tauri 配置可由 CLI 读取，但 Rust 壳尚未编译，Mac 原生对话框、关闭保护、WKWebView 和打包未验收。

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
| `desktop/src/App.tsx` | 展示、编辑、草稿导航与本地保存流程。 |
| `desktop/src-tauri/` | 桌面窗口、命令、能力权限与应用图标。 |

场景库用 `unicorn-light-studio.library.v1` 保存。浏览器和桌面 WebView 的存储独立。播放状态不随场景库重开恢复，因为程序没有读取真实设备状态。编辑或保存时，正在模拟播放的内容保持原快照，界面提示版本差异。

`Scene.scope` 区分全身与按灯位设置。全身模式用 `light`；按灯位模式用 23 项 `points`。切到按灯位时以当前全身设置初始化；全身专用灯效降为常亮。切回全身使用保留的全身设置。相同 RGB、亮度、灯效的点位可由后续协议层合并为一组。

## 模型素材接入

已收到 `docs/unicorn1.png` 设定画稿和 `docs/unicorn2.png` 蓝色编号图。编号 1–23 对应 D1–D23；正面 18 个，背面 5 个。左右按模型自身方向命名。

可编辑映射源为 `docs/unicorn-light-map.json`，记录原图坐标、编号、名称、视角、引线锚点及标签位置。`scripts/vectorize_model.py` 从原稿生成 SVG 线稿和区域路径。一个 D 编号的路径允许含多个子路径，表示同一编号对应的多个发光面。眼部 D1 与腹部 D14 是人工简化路径，其余区域在指定范围内沿原稿红色结构提取。没有标号的背部腿甲不推测关联。详见 [质量核对](model-svg-review.md)。

重建命令（只需要在修改原图或映射时运行）：

```bash
uv run --with opencv-python-headless --with pillow python scripts/vectorize_model.py
```

图像处理依赖只用于离线生成，不进入桌面运行时。生成文件随 Git 提交，普通界面开发无需安装这些依赖。

## 下一阶段

1. 根据用户核对反馈修正灯位边界，尤其是 D1、D14 的示意路径。
2. Mac 上验证桌面构建、存储、导出、窗口关闭和 WebView 样式。
3. 用已有 Python 报文及最新实机记录实现 Rust 协议、通知解析与 BLE 会话管理。
4. 实现四个产品场景到设备全身、局部、高级槽位的分配与同步。四个产品场景目前不等于四个已驻留硬件槽位；局部容量与跨场景共享需要单独处理，不能让修改一个场景影响其他场景。

当前灯位示意只表达配置颜色与选择状态，不复刻设备动画。模拟器在临时试灯结束后显示原播放快照是界面开发规则，不是对固件恢复行为的结论。真实设备同步、自定义顺序和完整硬件容量验证未包含在本轮界面实现中。
