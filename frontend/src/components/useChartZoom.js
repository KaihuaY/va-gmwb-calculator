import { useState } from 'react';

/**
 * Recharts drag-to-zoom hook.
 *
 * Usage:
 *   const { chartHandlers, filterData, xDomain, refArea, isZoomed, reset } = useChartZoom();
 *
 *   <ComposedChart {...chartHandlers} style={{ cursor: 'crosshair' }}>
 *     <XAxis domain={xDomain} />
 *     ...
 *     {refArea && <ReferenceArea x1={refArea.x1} x2={refArea.x2} strokeOpacity={0.3} fill="#6366f1" fillOpacity={0.1} />}
 *   </ComposedChart>
 *
 *   const visibleData = filterData(allData, d => d.age);
 */
export default function useChartZoom() {
  const [refAreaLeft,  setRefAreaLeft]  = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const [selecting,    setSelecting]    = useState(false);
  const [domain,       setDomain]       = useState(null); // null = full range

  const onMouseDown = (e) => {
    if (!e?.activeLabel) return;
    setRefAreaLeft(e.activeLabel);
    setRefAreaRight(e.activeLabel);
    setSelecting(true);
  };

  const onMouseMove = (e) => {
    if (!selecting || !e?.activeLabel) return;
    setRefAreaRight(e.activeLabel);
  };

  const onMouseUp = () => {
    if (!selecting) return;
    setSelecting(false);
    const l = Number(refAreaLeft);
    const r = Number(refAreaRight);
    if (isNaN(l) || isNaN(r) || l === r) {
      setRefAreaLeft('');
      setRefAreaRight('');
      return;
    }
    setDomain([Math.min(l, r), Math.max(l, r)]);
    setRefAreaLeft('');
    setRefAreaRight('');
  };

  const reset = () => setDomain(null);

  const isZoomed = domain !== null;

  // Filter a data array to the zoomed range
  const filterData = (data, keyFn = d => d.age) =>
    isZoomed
      ? data.filter(d => { const v = keyFn(d); return v >= domain[0] && v <= domain[1]; })
      : data;

  // XAxis domain prop value
  const xDomain = isZoomed ? domain : undefined;

  // ReferenceArea while the user is dragging a selection
  const refArea = (selecting && refAreaLeft !== '' && refAreaRight !== '')
    ? { x1: Math.min(Number(refAreaLeft), Number(refAreaRight)),
        x2: Math.max(Number(refAreaLeft), Number(refAreaRight)) }
    : null;

  return {
    chartHandlers: { onMouseDown, onMouseMove, onMouseUp },
    filterData,
    xDomain,
    refArea,
    isZoomed,
    reset,
  };
}
