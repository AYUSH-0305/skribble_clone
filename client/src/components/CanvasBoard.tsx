import { useEffect, useRef } from 'react';
import { socket } from '../socket';
import type { DrawTool, Point, Stroke } from '../types/events';

interface Props {
  isDrawer: boolean;
  color: string;
  size: number; // normalized (fraction of canvas width)
  tool: DrawTool;
}

const BG = '#ffffff';

/**
 * The shared drawing surface.
 *
 * - Renders from a local stroke buffer fed by socket events (single source of
 *   truth is the server; even the drawer draws from server echoes).
 * - Coordinates are normalized 0..1, so the picture is identical on every
 *   screen size. The canvas box is locked to a 4:3 aspect ratio so all clients
 *   share the same shape.
 * - When this client is the drawer, pointer input is captured and streamed as
 *   draw_start / draw_move / draw_end. Moves are coalesced to one per frame.
 */
export function CanvasBoard({ isDrawer, color, size, tool }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const byId = useRef<Map<string, Stroke>>(new Map());

  // Live drawing (drawer) refs
  const drawingRef = useRef(false);
  const pendingPoint = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);

  // Keep latest tool settings without re-subscribing.
  const toolRef = useRef({ color, size, tool });
  toolRef.current = { color, size, tool };
  const isDrawerRef = useRef(isDrawer);
  isDrawerRef.current = isDrawer;

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  const ctx = () => canvasRef.current?.getContext('2d') ?? null;

  const drawStroke = (c: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) => {
    if (stroke.points.length === 0) return;
    c.strokeStyle = stroke.tool === 'eraser' ? BG : stroke.color;
    c.fillStyle = c.strokeStyle;
    c.lineWidth = Math.max(1, stroke.size * w);
    c.lineJoin = 'round';
    c.lineCap = 'round';

    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      c.beginPath();
      c.arc(p.x * w, p.y * h, c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
    for (let i = 1; i < stroke.points.length; i++) {
      c.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
    }
    c.stroke();
  };

  const redrawAll = () => {
    const c = ctx();
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    c.fillStyle = BG;
    c.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(c, stroke, canvas.width, canvas.height);
  };

  const drawLastSegment = (stroke: Stroke) => {
    const c = ctx();
    const canvas = canvasRef.current;
    if (!c || !canvas || stroke.points.length < 2) return;
    const w = canvas.width;
    const h = canvas.height;
    const a = stroke.points[stroke.points.length - 2];
    const b = stroke.points[stroke.points.length - 1];
    c.strokeStyle = stroke.tool === 'eraser' ? BG : stroke.color;
    c.lineWidth = Math.max(1, stroke.size * w);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(a.x * w, a.y * h);
    c.lineTo(b.x * w, b.y * h);
    c.stroke();
  };

  // -------------------------------------------------------------------------
  // Sizing (DPR-aware, 4:3 box). Redraw from buffer on resize.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redrawAll();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // -------------------------------------------------------------------------
  // Socket subscriptions (drawing data in)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onData = ({ stroke }: { stroke: Stroke }) => {
      const existing = byId.current.get(stroke.id);
      if (existing) {
        existing.points = stroke.points;
      } else {
        byId.current.set(stroke.id, stroke);
        strokesRef.current.push(stroke);
      }
      const c = ctx();
      const canvas = canvasRef.current;
      if (c && canvas) drawStroke(c, stroke, canvas.width, canvas.height);
    };

    const onPoint = ({ strokeId, point }: { strokeId: string; point: Point }) => {
      const stroke = byId.current.get(strokeId);
      if (!stroke) return;
      stroke.points.push(point);
      drawLastSegment(stroke);
    };

    const onClear = () => {
      strokesRef.current = [];
      byId.current.clear();
      redrawAll();
    };

    const onState = ({ strokes }: { strokes: Stroke[] }) => {
      strokesRef.current = strokes.map((s) => ({ ...s }));
      byId.current = new Map(strokesRef.current.map((s) => [s.id, s]));
      redrawAll();
    };

    // Pull the authoritative canvas now (covers mount, resume, and reload), and
    // again after any reconnect so a backgrounded phone repaints what it missed.
    const requestCanvas = () => socket.emit('request_canvas');

    socket.on('draw_data', onData);
    socket.on('draw_point', onPoint);
    socket.on('canvas_clear', onClear);
    socket.on('canvas_state', onState);
    socket.on('connect', requestCanvas);
    requestCanvas();

    return () => {
      socket.off('draw_data', onData);
      socket.off('draw_point', onPoint);
      socket.off('canvas_clear', onClear);
      socket.off('canvas_state', onState);
      socket.off('connect', requestCanvas);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Pointer input (drawer only) -> emit intents
  // -------------------------------------------------------------------------
  const toNorm = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const flush = () => {
    rafRef.current = null;
    if (pendingPoint.current && drawingRef.current) {
      socket.emit('draw_move', pendingPoint.current);
      pendingPoint.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isDrawerRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = toNorm(e);
    const { color: cc, size: ss, tool: tt } = toolRef.current;
    socket.emit('draw_start', { x: p.x, y: p.y, color: cc, size: ss, tool: tt });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawerRef.current || !drawingRef.current) return;
    pendingPoint.current = toNorm(e);
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingPoint.current) {
      socket.emit('draw_move', pendingPoint.current);
      pendingPoint.current = null;
    }
    socket.emit('draw_end');
  };

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        className="board"
        style={{ cursor: isDrawer ? 'crosshair' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />
      {!isDrawer && <div className="canvas-lock" aria-hidden />}
    </div>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
