import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight,
  CircleHelp, Edit3, FlaskConical, Grid2X2, Layers3, Lightbulb, Play,
  RotateCcw, Save, SlidersHorizontal, Square, X } from 'lucide-react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ModelView from './components/ModelView';
import Dialog from './components/Dialog';
import { changeScope, copyScene, effectiveLights, EFFECTS, groupCount, loadLibrary,
  patchLights, POINT_IDS, replaceScene, SCENE_IDS, STORAGE_KEY, type SceneId, type SceneLibrary } from './domain/scenes';
import { device as mockDevice } from './device/mock';
import { nativeDevice } from './device/native';
import type { DeviceAdapter } from './device/adapter';
import DevicePanel from './components/DevicePanel';

type Page = 'display' | 'editor';
type Navigation = { page: Page; sceneId: SceneId };
type Modal = 'save' | 'discard' | 'about' | null;
const palette = ['#ff5267', '#ff925c', '#ffc580', '#f1f1e8', '#66e6b2', '#65d5e8', '#6c9fff', '#b58aff'];
const allPoints = POINT_IDS.map((_, index) => index);
const twoDigits = (index: number) => String(index + 1).padStart(2, '0');

async function downloadLibrary(library: SceneLibrary): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('export_scenes', { contents: JSON.stringify(library, null, 2) });
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'unicorn-scenes.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export default function App() {
  const [initial] = useState(() => {
    try { return loadLibrary(window.localStorage); }
    catch { return loadLibrary({ getItem: () => { throw new Error('Storage unavailable'); } }); }
  });
  const [library, setLibrary] = useState(initial.library);
  const [page, setPage] = useState<Page>('display');
  const [sceneId, setSceneId] = useState<SceneId>('scene-1');
  const [draft, setDraft] = useState(() => copyScene(initial.library.scenes[0]));
  const [selected, setSelected] = useState<number[]>([0]);
  const [modal, setModal] = useState<Modal>(null);
  const [pending, setPending] = useState<Navigation | null>(null);
  const [closingWindow, setClosingWindow] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SceneId>('scene-1');
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState(initial.error ?? '');
  const [runtime, setRuntime] = useState('浏览器预览');
  const [hexInput, setHexInput] = useState('');
  const [mode, setMode] = useState<'mock' | 'ble'>(() => isTauri() ? 'ble' : 'mock');
  const device: DeviceAdapter = mode === 'ble' ? nativeDevice : mockDevice;
  const real = mode === 'ble';
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const native = useSyncExternalStore(nativeDevice.subscribe, nativeDevice.getSnapshot);
  const busy = real && native.busy;
  const saved = library.scenes.find(scene => scene.id === sceneId)!;
  const scene = page === 'editor' ? draft : saved;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const connected = snapshot.connection === 'connected';
  const editablePoints = draft.scope === 'whole' ? allPoints : selected;
  const selectedLights = editablePoints.map(index => effectiveLights(draft)[index]);
  const currentLight = selectedLights[0] ?? draft.light;
  const mixed = selectedLights.some(light => JSON.stringify(light) !== JSON.stringify(currentLight));
  const canPreview = connected && !busy && editablePoints.length > 0 && !mixed;

  useEffect(() => {
    if (!isTauri()) return;
    invoke<{ label: string }>('runtime_info').then(info => setRuntime(info.label))
      .catch(() => setRuntime('Mac 桌面 · 后端未就绪'));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!dirty || page !== 'editor') return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, page]);
  useEffect(() => { setHexInput(currentLight.color.toUpperCase()); }, [currentLight.color, selected, draft.scope]);
  useEffect(() => {
    if (!isTauri() || page !== 'editor' || !dirty) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(event => {
      event.preventDefault();
      setClosingWindow(true); setPending(null); setModal('discard');
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {
      setToast('窗口关闭保护未就绪，请先保存修改再关闭。');
    });
    return () => { disposed = true; unlisten?.(); };
  }, [page, dirty]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (page === 'editor' && draft.name.trim() && !modal) { setSaveTarget(sceneId); setModal('save'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, draft.name, sceneId, modal]);

  function commitNavigation(next: Navigation) {
    setSceneId(next.sceneId);
    setDraft(copyScene(library.scenes.find(item => item.id === next.sceneId)!));
    setSelected([0]);
    setPage(next.page);
    setPending(null);
    setModal(null);
  }
  function navigate(next: Navigation) {
    if (next.page === page && next.sceneId === sceneId) return;
    if (page === 'editor' && dirty) { setPending(next); setModal('discard'); }
    else commitNavigation(next);
  }
  async function run(action: () => void | Promise<void>, message?: string) {
    try { await action(); if (message) setToast(message); }
    catch (error) { setToast(error instanceof Error ? error.message : '操作未完成，请重试。'); }
  }
  function saveDraft() {
    const normalized = { ...draft, name: draft.name.trim() };
    if (!normalized.name) return;
    const next = replaceScene(library, saveTarget, normalized);
    try {
      if (storageError) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) window.localStorage.setItem(`${STORAGE_KEY}.backup.${Date.now()}`, raw);
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setLibrary(next);
      setSceneId(saveTarget);
      setDraft(copyScene(next.scenes.find(item => item.id === saveTarget)!));
      setStorageError('');
      setModal(null);
      setToast('场景已保存到本机。播放中的内容保持不变，可重新播放新版本。');
    } catch { setToast('本地保存失败，草稿仍保留；请检查存储权限或可用空间。'); }
  }
  function updateLight(patch: Parameters<typeof patchLights>[2]) {
    setDraft(value => patchLights(value, selected, patch));
  }
  function selectPoint(index: number) {
    if (draft.scope === 'whole') {
      setDraft(value => changeScope(value, 'points'));
      setSelected([index]);
    } else setSelected(value => value.includes(index) ? value.filter(item => item !== index) : [...value, index]);
  }
  function openSave() { setSaveTarget(sceneId); setModal('save'); }
  function cancelDiscard() { setModal(null); setPending(null); setClosingWindow(false); }
  const previewing = snapshot.preview !== null;
  const activeUpdated = snapshot.activeScene && JSON.stringify(snapshot.activeScene) !== JSON.stringify(library.scenes.find(item => item.id === snapshot.activeScene?.id));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol"><Lightbulb size={21} /></div><div>UNICORN<span>LIGHT STUDIO</span></div></div>
      <div className="workspace-label">工作空间 <span>01</span></div>
      <nav aria-label="主导航">
        <button className={page === 'display' ? 'nav-item active' : 'nav-item'} onClick={() => navigate({ page: 'display', sceneId })}><Grid2X2 size={17} /> 展示台 <ChevronRight size={14} /></button>
        <button className={page === 'editor' ? 'nav-item active' : 'nav-item'} onClick={() => navigate({ page: 'editor', sceneId })}><SlidersHorizontal size={17} /> 场景编辑 <ChevronRight size={14} /></button>
      </nav>
      <div className="workspace-label scene-label">我的场景 <span>4 / 4</span></div>
      <div className="sidebar-scenes">{library.scenes.map((item, index) => <button key={item.id}
        className={sceneId === item.id ? 'sidebar-scene selected' : 'sidebar-scene'}
        onClick={() => navigate({ page, sceneId: item.id })}>
        <span className="scene-swatch" style={{ background: effectiveLights(item)[0].color }} />
        <span>{item.name}</span><small>{twoDigits(index)}</small>
      </button>)}</div>
      <div className="sidebar-bottom">
        <DevicePanel device={device} snapshot={snapshot} mode={mode} run={run} onMode={async next => {
          if (next === mode) return;
          if (snapshot.connection !== 'disconnected') await device.disconnect();
          setMode(next);
        }} />
        <button className="about-button" onClick={() => setModal('about')}><CircleHelp size={15} /> 关于当前预览 <span>v0.1</span></button>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={13} /><span>{page === 'display' ? '展示台' : '场景编辑'}</span></div>
        <div className="topbar-actions"><span className="simulation-badge"><FlaskConical size={13} /> {real ? '蓝牙模式' : '模拟模式'}</span>
          <button className="icon-button" aria-label="导出已保存场景" title="导出已保存场景" onClick={() => run(async () => { if (await downloadLibrary(library)) setToast('已导出四个已保存场景，编辑草稿不包含在内。'); })}><ArrowDownToLine size={17} /></button></div>
      </header>
      {storageError && <div className="storage-warning" role="alert">{storageError}</div>}
      <main>
        <div className="page-heading"><div><div className="eyebrow">{page === 'display' ? 'YOUR PERSONAL LIGHT COLLECTION' : `SCENE ${twoDigits(SCENE_IDS.indexOf(sceneId))} / EDITOR`}</div>
          <h1>{page === 'display' ? '让独角兽，亮出你的设定。' : '雕琢每一处光。'}</h1>
          <p>{page === 'display' ? '四种光影，为每一次展示留一个位置。' : '选择灯位，调整颜色与灯效，然后保存到你的场景。'}</p></div>
          {page === 'display' ? <button className="button secondary" onClick={() => navigate({ page: 'editor', sceneId })}><Edit3 size={15} /> 编辑当前场景</button>
            : <div className="heading-actions"><span className={`draft-badge ${dirty ? 'dirty' : ''}`}>{dirty ? '有未保存修改' : '已保存到本机'}</span><button className="button primary" onClick={openSave} disabled={!draft.name.trim()}><Save size={15} /> 保存场景</button></div>}
        </div>

        {page === 'display' ? <>
          <div className="showcase-layout">
            <section className="showcase-panel"><div className="panel-heading"><span><span className="tiny-dot" /> 场景预览</span><span>{twoDigits(SCENE_IDS.indexOf(sceneId))} / 04</span></div>
              <ModelView scene={scene} />
            </section>
            <section className="scene-detail" style={{ '--scene-color': effectiveLights(saved)[0].color } as CSSProperties}>
              <div className="detail-top"><span className="eyebrow">SELECTED SCENE</span><span className="scene-number">{twoDigits(SCENE_IDS.indexOf(sceneId))}</span></div>
              <div className="detail-orbit"><div className="orbit outer" /><div className="orbit inner" /><div className="orbit-light"><Lightbulb size={35} strokeWidth={1.15} /></div><span className="orbit-spark" /></div>
              <h2>{saved.name}</h2><p className="detail-subtitle">{saved.scope === 'whole' ? '全身统一灯光' : '自定义灯位组合'}</p>
              <div className="detail-stats"><div><span>灯位</span><strong>23 <small>POINTS</small></strong></div><div><span>灯效</span><strong>{saved.scope === 'whole' ? EFFECTS[saved.light.effect] : `${groupCount(saved)} 组设置`}</strong></div></div>
              <div className="color-strip">{effectiveLights(saved).map((light, index) => <i key={index} style={{ background: light.color }} />)}</div>
              <button className="button primary full" disabled={!connected || busy} onClick={() => run(() => device.activate(saved), real ? `「${saved.name}」已写入，设备回报已开启` : `正在模拟播放「${saved.name}」`)}><Play size={16} fill="currentColor" /> {real ? '写入并播放' : '模拟播放'}</button>
              <button className="button text full" onClick={() => navigate({ page: 'editor', sceneId })}>进入编辑器 <ArrowRight size={15} /></button>
              <p className="simulation-note">{real ? `写入设备${saved.scope === 'whole' ? '全身' : '组合'}预设 ${twoDigits(SCENE_IDS.indexOf(sceneId))}，替换该位置并开启播放` : connected ? '仅在应用中模拟，不控制实物灯组' : '连接模拟设备后可体验播放流程'}</p>
            </section>
          </div>
          <div className="section-heading"><h2>四个展示场景 <span>YOUR SCENES</span></h2><span>本地场景库</span></div>
          <div className="scene-cards">{library.scenes.map((item, index) => <button key={item.id} className={`scene-card ${item.id === sceneId ? 'selected' : ''}`}
            style={{ '--scene-color': effectiveLights(item)[0].color } as CSSProperties} onClick={() => navigate({ page: 'display', sceneId: item.id })}>
            <div className="card-top"><span>{twoDigits(index)}</span>{sceneId === item.id ? <Check size={15} /> : <ArrowRight size={15} />}</div>
            <div className="card-lights">{effectiveLights(item).slice(0, 9).map((light, i) => <i key={i} style={{ background: light.color }} />)}</div>
            <div className="card-bottom"><strong>{item.name}</strong><small>{item.scope === 'whole' ? EFFECTS[item.light.effect] : '灯位组合'}</small></div>
          </button>)}</div>
        </> : <div className="editor-layout">
          <section className="editor-canvas"><div className="selection-toolbar"><span><Layers3 size={15} /> {draft.scope === 'whole' ? '全身 · 23 个灯位' : `已选 ${selected.length} / 23 个灯位`}</span>
            <div><button onClick={() => { setDraft(value => changeScope(value, 'points')); setSelected(allPoints); }}>全选</button><button disabled={draft.scope === 'whole' || !selected.length} onClick={() => setSelected([])}>清空选择</button></div></div>
            <ModelView scene={draft} selected={draft.scope === 'whole' ? allPoints : selected} onSelect={selectPoint}
              previewPoints={snapshot.preview?.points} />
            <div className="canvas-footnote"><Activity size={14} /><span>{previewing ? real ? '试灯命令已响应，持续时间以实物为准' : '正在模拟试灯，约 3 秒后结束' : '点击灯位可多选，同一组选择共享本次调整'}</span><span className="key-hint">D1–D23</span></div>
          </section>
          <section className="properties-panel" aria-label="灯光属性">
            <div className="properties-heading"><h2>场景设置</h2><SlidersHorizontal size={16} /></div>
            <label className="field-label" htmlFor="scene-name">场景名称</label>
            <input id="scene-name" maxLength={24} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            <div className="field-label">控制方式</div>
            <div className="segmented" role="group" aria-label="控制方式"><button aria-pressed={draft.scope === 'whole'} className={draft.scope === 'whole' ? 'active' : ''} onClick={() => setDraft(value => changeScope(value, 'whole'))}>全身统一</button><button aria-pressed={draft.scope === 'points'} className={draft.scope === 'points' ? 'active' : ''} onClick={() => setDraft(value => changeScope(value, 'points'))}>按灯位设置</button></div>
            <div className="selection-info">{draft.scope === 'whole' ? '参数将应用到全部 23 个灯位' : selected.length ? selected.map(index => POINT_IDS[index]).join(' · ') : '先在左侧选择灯位'}</div>
            {draft.scope === 'whole' && draft.light.effect > 2 && <p className="field-note">转为按灯位设置时，全身专用灯效会改为常亮。</p>}
            {mixed && <div className="mixed-notice">所选灯位含多种设置。修改某一项，仅统一该项。</div>}
            <fieldset disabled={!editablePoints.length}>
              <div className="field-label color-label"><label htmlFor="light-color">灯光颜色</label><span>RGB</span></div>
              <div className="color-input-row"><input id="light-color" type="color" value={currentLight.color} onChange={event => updateLight({ color: event.target.value })} />
                <input aria-label="颜色十六进制" className="hex-input" value={hexInput} maxLength={7} onChange={event => {
                  const value = event.target.value.toUpperCase(); setHexInput(value);
                  if (/^#[\dA-F]{6}$/.test(value)) updateLight({ color: value.toLowerCase() });
                }} onBlur={() => setHexInput(currentLight.color.toUpperCase())} /></div>
              <div className="palette">{palette.map(color => <button key={color} aria-label={`使用颜色 ${color}`} title={color} style={{ background: color }} className={currentLight.color.toLowerCase() === color ? 'chosen' : ''} onClick={() => updateLight({ color })}>{currentLight.color.toLowerCase() === color && <Check size={13} />}</button>)}</div>
              <div className="field-label"><label htmlFor="brightness">亮度档位</label><span>{currentLight.brightness} <small>/ 10</small></span></div>
              <input id="brightness" type="range" min={1} max={10} value={currentLight.brightness} onChange={event => updateLight({ brightness: Number(event.target.value) })} />
              <div className="range-caption"><span>柔和</span><span>当前试用范围 1–10</span></div>
              <label className="field-label" htmlFor="effect">灯光效果</label>
              <select id="effect" value={currentLight.effect} onChange={event => updateLight({ effect: Number(event.target.value) })}>
                {EFFECTS.slice(0, draft.scope === 'whole' ? 11 : 3).map((label, index) => <option key={index} value={index}>{label}</option>)}
              </select>
              {draft.scope === 'whole' && currentLight.effect >= 3 && <>
                <label className="field-label" htmlFor="direction">播放方向</label><select id="direction" value={draft.direction} onChange={event => setDraft({ ...draft, direction: Number(event.target.value) as 0 | 1 })}><option value={0}>正向</option><option value={1}>反向</option></select>
                <div className="field-label"><label htmlFor="speed">速度参数</label><span>{draft.speed === 0 ? '默认' : draft.speed}</span></div><input id="speed" type="range" min={0} max={100} value={draft.speed} onChange={event => setDraft({ ...draft, speed: Number(event.target.value) })} />
                <p className="field-note">方向与速度已在单向跑马中观察；其他效果待确认。</p>
              </>}
            </fieldset>
            <div className="test-section"><button className="button secondary full" disabled={!canPreview} onClick={() => run(() => device.preview(draft, editablePoints), real ? '试灯命令已响应，请观察模型效果' : '模拟试灯已开始，约 3 秒后结束')}><FlaskConical size={15} /> {real ? previewing ? '重新试灯' : '实物试灯 · 约 3 秒' : previewing ? '重新模拟试灯' : '模拟试灯 · 3 秒'}</button>
              <p>{!connected ? real ? '先连接左下方的蓝牙灯组' : '先连接左下方的模拟设备' : mixed ? '请选择同一组颜色、亮度与灯效进行试灯' : '仅预览所选灯位，不保存修改'}</p></div>
            <button className="button text full" disabled={!dirty} onClick={() => { setPending({ page: 'editor', sceneId }); setModal('discard'); }}><RotateCcw size={14} /> 还原未保存修改</button>
          </section>
        </div>}
      </main>
      <footer className="statusbar"><span><span className={`connection-dot ${connected ? 'connected' : ''}`} />{busy ? '正在与设备通信…' : connected ? real ? '蓝牙灯组已连接' : '模拟设备已连接' : '离线编辑'}</span>
        <span className="playback-status">{previewing ? real ? '试灯命令已响应' : '正在模拟试灯' : snapshot.activeScene ? `${real ? '设备已开启' : '模拟播放'}：${snapshot.activeScene.name}${activeUpdated ? '（保存前版本）' : ''}` : real && connected ? '查看设备预设可确认开启项' : '尚未播放'}{connected && (real || snapshot.activeScene || previewing) && <button disabled={busy} aria-label={real ? '停止设备播放' : '停止模拟播放'} onClick={() => run(() => device.stop(), real ? '设备回报预设已关闭；临时试灯由固件自行结束' : undefined)}><Square size={10} fill="currentColor" /> 停止</button>}</span>
        <span>{runtime}</span></footer>
    </div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={15} /></button></div>}

    {modal === 'save' && <Dialog title="保存到展示场景" onClose={() => setModal(null)}><p className="dialog-description">将「{draft.name.trim()}」保存到下面一个位置。替换只影响所选场景，不会自动播放。</p>
      <div className="save-targets">{library.scenes.map((item, index) => <button key={item.id} aria-pressed={saveTarget === item.id} className={saveTarget === item.id ? 'save-target selected' : 'save-target'} onClick={() => setSaveTarget(item.id)}><span>{twoDigits(index)}</span><strong>{item.name}</strong>{saveTarget === item.id && <Check size={16} />}</button>)}</div>
      <p className="field-note">保存到本机。回到展示台，连接真实灯组后，点击「写入并播放」同步到设备对应位置。</p>
      <div className="dialog-actions"><button className="button secondary" onClick={() => setModal(null)}>继续编辑</button><button className="button primary" onClick={saveDraft}><Save size={15} /> 替换并保存</button></div>
    </Dialog>}
    {modal === 'discard' && <Dialog title="保留这次修改吗？" onClose={cancelDiscard}><p className="dialog-description">当前场景还有未保存的修改。放弃后将恢复到上次保存的内容。</p><div className="dialog-actions"><button className="button secondary" onClick={cancelDiscard}><ArrowLeft size={14} /> 继续编辑</button><button className="button danger" onClick={() => closingWindow ? run(() => getCurrentWindow().destroy()) : pending && commitNavigation(pending)}>放弃修改</button></div></Dialog>}
    {modal === 'about' && <Dialog title="Unicorn Light Studio" onClose={() => setModal(null)}><div className="about-content"><span className="simulation-badge"><FlaskConical size={14} /> 界面开发预览 · v0.1</span><p>为 MG EX 独角兽的 23 颗灯珠准备四个展示场景。Mac 桌面版可通过蓝牙连接真实灯组，也可切换模拟模式。浏览器预览仅支持模拟。</p><p>场景保存在本机应用存储中，浏览器与桌面应用各自独立。模型 SVG 按提供的画稿和编号映射，正面 18 个灯位、背面 5 个灯位。</p><p>眼部 D1 和腰腹横向灯带 D14 使用简化区域；发光范围、颜色与亮度均为示意。动态灯效与试灯结束后的行为仍以实物为准。</p></div><button className="button primary full" onClick={() => setModal(null)}>知道了</button></Dialog>}
  </div>;
}
