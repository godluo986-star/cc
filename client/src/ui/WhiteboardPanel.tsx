import { useEffect, useRef, useState } from 'react';
import { useWorld } from '../state/stores';
import { connection } from '../net/connection';
import { WHITEBOARD_MAX_POINTS } from '@nexuspark/shared';
import type { Stroke } from '@nexuspark/shared';

const COLORS = ['#22262c', '#e63946', '#2f6fdb', '#2f9e5f', '#e8862f', '#8e44ad', '#f2f2f2'];
const CW = 640, CH = 400;

export default function WhiteboardPanel({ boardId }: { boardId: string }) {
  const strokes = useWorld((s) => s.whiteboards[boardId]);
  const addStroke = useWorld((s) => s.addStroke);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(0.006);
  const drawing = useRef<{ pts: number[] } | null>(null);

  // full redraw when stroke list changes
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 0, CW, CH);
    for (const s of strokes ?? []) drawStroke(ctx, s);
  }, [strokes]);

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1.2, s.width * CW);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      const x = s.pts[i] * CW, y = s.pts[i + 1] * CH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const pointOf = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  };

  const flush = () => {
    const d = drawing.current;
    drawing.current = null;
    if (!d || d.pts.length < 4) return;
    // split long strokes to fit the protocol cap
    for (let start = 0; start < d.pts.length; start += (WHITEBOARD_MAX_POINTS - 1) * 2) {
      const slice = d.pts.slice(Math.max(0, start - 2), start + WHITEBOARD_MAX_POINTS * 2);
      if (slice.length < 4) continue;
      const stroke: Stroke = { pts: slice, color, width };
      connection.send('wb_stroke', { boardId, ...stroke });
      addStroke(boardId, stroke); // server does not echo to the sender
    }
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="wb-canvas"
        width={CW}
        height={CH}
        style={{ width: '100%', maxWidth: 560 }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const [x, y] = pointOf(e);
          drawing.current = { pts: [x, y] };
        }}
        onPointerMove={(e) => {
          const d = drawing.current;
          if (!d) return;
          const [x, y] = pointOf(e);
          const lx = d.pts[d.pts.length - 2], ly = d.pts[d.pts.length - 1];
          if (Math.hypot(x - lx, y - ly) < 0.004) return;
          d.pts.push(x, y);
          const ctx = canvasRef.current!.getContext('2d')!;
          drawStroke(ctx, { pts: [lx, ly, x, y], color, width });
        }}
        onPointerUp={flush}
        onPointerLeave={() => { if (drawing.current) flush(); }}
      />
      <div className="wb-tools">
        {COLORS.map((c) => (
          <div
            key={c}
            className={`wb-color ${color === c ? 'sel' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <select className="input" style={{ width: 110 }} value={width} onChange={(e) => setWidth(Number(e.target.value))}>
          <option value={0.003}>Fine</option>
          <option value={0.006}>Medium</option>
          <option value={0.014}>Thick</option>
          <option value={0.03}>Marker</option>
        </select>
        <div className="spacer" />
        <button className="btn small danger" onClick={() => connection.send('wb_clear', { boardId })}>Clear board</button>
      </div>
    </div>
  );
}
