import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ScanLine, Tags } from 'lucide-react';
import { MODEL_POINTS, MODEL_REGIONS, MODEL_VIEWS, type ModelViewId } from '../domain/model';
import linework from '../assets/unicorn-linework.svg';
import { effectiveLights, POINT_IDS, type Scene } from '../domain/scenes';

interface Props {
  scene: Scene;
  selected?: number[];
  onSelect?: (index: number) => void;
  previewPoints?: number[];
}

export default function ModelView({ scene, selected = [], onSelect, previewPoints }: Props) {
  const [view, setView] = useState<ModelViewId>('front');
  const [showLabels, setShowLabels] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);
  const filterId = `light-glow-${useId().replace(/:/g, '')}`;
  const clipId = `${filterId}-body`;
  const lights = effectiveLights(scene);
  const visibleRegions = MODEL_REGIONS.filter(region => region.view === view);
  const selectedHere = selected.filter(index => MODEL_POINTS[index].view === view).length;
  useEffect(() => {
    if (selected.length === 1) setView(MODEL_POINTS[selected[0]].view);
  }, [selected]);
  const selectWithKeyboard = (event: KeyboardEvent<SVGGElement>, index: number) => {
    if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(index); }
  };

  return <div className="model-view">
    <div className="model-topline"><span><ScanLine size={14} /> MODEL VIEW</span><span>RX-0 / MG EX</span></div>
    <div className="model-controls">
      <div className="model-view-switch" role="group" aria-label="模型视角">
        {(['front', 'back'] as const).map(value => <button key={value} aria-pressed={view === value}
          className={view === value ? 'active' : ''} onClick={() => { setView(value); setHovered(null); }}>
          {MODEL_VIEWS[value].label} <span>{MODEL_VIEWS[value].count}</span>
        </button>)}
      </div>
      <button className={`model-label-toggle ${showLabels ? 'active' : ''}`} aria-label="显示灯位编号" aria-pressed={showLabels} onClick={() => setShowLabels(value => !value)}><Tags size={14} /> 编号</button>
    </div>
    <div className="model-stage">
      <span className="model-view-label">{view === 'front' ? 'FRONT' : 'REAR'} VIEW</span>
      <svg className="unicorn-model" viewBox={MODEL_VIEWS[view].viewBox} role="group" aria-label={`独角兽${MODEL_VIEWS[view].label}灯位图`}>
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2" /></filter>
          <clipPath id={clipId}><rect x={view === 'front' ? 0 : 460} y="0" width={view === 'front' ? 445 : 384} height="690" /></clipPath>
        </defs>
        <image className="model-linework" href={linework} width="844" height="681" clipPath={`url(#${clipId})`} aria-hidden="true" />
        {visibleRegions.map(region => {
          const index = POINT_IDS.indexOf(region.id);
          const light = lights[index];
          const active = selected.includes(index);
          const testing = previewPoints?.includes(index);
          return <g key={region.id} data-point-id={region.id} className={`model-region ${active ? 'is-selected' : ''} ${hovered === index ? 'is-hovered' : ''} ${testing ? 'is-testing' : ''}`}
            style={{ '--light': light.color, '--intensity': .4 + light.brightness * .06 } as CSSProperties}
            role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
            aria-label={`${region.id} ${region.name}`} aria-pressed={onSelect ? active : undefined}
            onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}
            onClick={() => onSelect?.(index)} onKeyDown={event => selectWithKeyboard(event, index)}>
            <title>{region.id} · {region.name}{region.geometry === 'schematic' ? '（区域为简化示意）' : ''}</title>
            <path className="region-glow" d={region.path} filter={`url(#${filterId})`} />
            <path className="region-light" d={region.path} />
            {onSelect && <path className="region-hit-area" d={region.path} />}
            {(showLabels || hovered === index) && <g className="model-callout">
              <path className="region-leader" d={`M${region.anchor[0]} ${region.anchor[1]} L${region.label[0]} ${region.label[1]}`} />
              <circle className="region-anchor" cx={region.anchor[0]} cy={region.anchor[1]} r="1.7" />
              <g className="model-label" data-point-id={region.id} transform={`translate(${region.label[0]} ${region.label[1]})`}>
                <rect x="-23" y="-13" width="46" height="26" rx="5" />
                <text textAnchor="middle" y="4.3">{region.id}</text>
              </g>
            </g>}
          </g>;
        })}
      </svg>
      <div className="model-view-status"><span>{hovered !== null ? `${POINT_IDS[hovered]} · ${MODEL_POINTS[hovered].regionName}` : onSelect ? '点击发光区域或编号选择灯位' : '灯位按标注图映射'}</span>
        <span>{onSelect ? `本视图已选 ${selectedHere} / ${visibleRegions.length}` : `${visibleRegions.length} 个灯位`}</span></div>
    </div>
    <div className="point-grid-header"><span>全部灯位 <b>23</b></span><small>正面 18 · 背面 5</small></div>
    <div className="point-grid">
      {lights.map((light, index) => {
        const style = { '--light': light.color, '--intensity': .35 + light.brightness * .065 } as CSSProperties;
        const className = `point ${selected.includes(index) ? 'selected' : ''} ${hovered === index ? 'hovered' : ''} ${previewPoints?.includes(index) ? 'testing' : ''}`;
        const title = `${POINT_IDS[index]} · ${MODEL_POINTS[index].regionName} · ${MODEL_VIEWS[MODEL_POINTS[index].view].label}`;
        return onSelect ? <button key={index} className={className} style={style} title={title}
          aria-label={`灯位 ${POINT_IDS[index]}`} aria-pressed={selected.includes(index)}
          onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}
          onClick={() => { setView(MODEL_POINTS[index].view); onSelect(index); }}>
          <i /><span>{POINT_IDS[index]}</span><small>{MODEL_POINTS[index].view === 'back' ? '背' : ''}</small>
        </button> : <div key={index} className={className} style={style} title={title}><i /><span>{POINT_IDS[index]}</span><small>{MODEL_POINTS[index].view === 'back' ? '背' : ''}</small></div>;
      })}
    </div>
    <div className="model-caption"><span className="tiny-dot" /> 颜色与发光范围为示意<span>原设定画稿 © SUNRISE</span></div>
  </div>;
}
