import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';

/**
 * The tools, in the order the toolbar shows them. They are keys, not labels:
 * each one is looked up as `shot.tool.{id}` in the catalogues, so renaming one
 * means renaming the message too.
 */
const TOOLS = ['arrow', 'rect', 'pen', 'text', 'highlight', 'blur', 'crop'] as const;
type Tool = (typeof TOOLS)[number];

/**
 * How many steps back the editor can go. Undo keeps whole copies of the image
 * rather than a list of shapes, which is what lets one stack cover a crop and a
 * redaction as well as a stroke — at the cost of a few full-screen bitmaps held
 * for as long as the editor is open.
 */
const UNDO_DEPTH = 5;

/**
 * The drawing palette, as keys looked up under `shot.color.{id}`. Only the
 * accent comes from the design tokens; the rest are chosen to stay legible over
 * an arbitrary screenshot, which is not what the interface palette is for.
 */
const COLORS = ['accent', 'yellow', 'green', 'blue', 'dark', 'white'] as const;
type ColorId = (typeof COLORS)[number];

const COLOR_VALUES: Record<Exclude<ColorId, 'accent'>, string> = {
  yellow: '#f5c400',
  green: '#1f9d55',
  blue: '#1565c0',
  dark: '#111111',
  white: '#ffffff',
};

function colorValue(id: ColorId, accent: string): string {
  return id === 'accent' ? accent : COLOR_VALUES[id];
}

const STROKE_MIN = 1;
/** Wide enough to circle a whole panel of a 1080p screenshot in one stroke. */
const STROKE_MAX = 60;
const STROKE_DEFAULT = 5;

/**
 * Text scales with the line, so one control covers both: a thick arrow next to
 * tiny lettering is not a combination anyone reaches for.
 *
 * It is a gentler slope than the line itself, spread so that the whole slider
 * covers a usable range of type. Tracking the stroke one-to-one would put the
 * top of the range at a couple of hundred pixels, which is not a caption.
 */
function fontSizeFor(stroke: number): number {
  return Math.round(12 + stroke * 2.2);
}

/** Neither the colour nor the width means anything to these two. */
function usesStyle(tool: Tool): boolean {
  return tool !== 'blur' && tool !== 'crop';
}

/** How far the pixels are shrunk before being blown back up, when redacting. */
const REDACT_BLOCK = 14;

/**
 * Side of a corner handle, and the grab radius around it, **on screen**. It is
 * converted into image pixels through the display scale so a handle stays the
 * same size to the hand whatever resolution the capture happens to be.
 */
const HANDLE_SCREEN = 10;

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a drag on the crop region is doing: sizing it by a corner, or sliding it. */
type CropGrab = 'nw' | 'ne' | 'sw' | 'se' | 'move';

const CROP_CURSORS: Record<CropGrab, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  move: 'move',
};

function cornersOf(area: Rect): [CropGrab, Point][] {
  return [
    ['nw', { x: area.x, y: area.y }],
    ['ne', { x: area.x + area.w, y: area.y }],
    ['sw', { x: area.x, y: area.y + area.h }],
    ['se', { x: area.x + area.w, y: area.y + area.h }],
  ];
}

/** The corner a `nw`-style grab pivots around: the one diagonally opposite. */
function anchorOf(grab: CropGrab, area: Rect): Point {
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  if (grab === 'nw') return { x: right, y: bottom };
  if (grab === 'ne') return { x: area.x, y: bottom };
  if (grab === 'sw') return { x: right, y: area.y };
  return { x: area.x, y: area.y };
}

function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/**
 * Which part of the crop region the pointer is on, or null when it is outside
 * and a press should start a fresh region. Corners win over the interior, so
 * the handles stay grabbable on a region too small to have much inside.
 */
function cropGrabAt(at: Point, area: Rect, reach: number): CropGrab | null {
  for (const [id, corner] of cornersOf(area)) {
    if (Math.abs(at.x - corner.x) <= reach && Math.abs(at.y - corner.y) <= reach) return id;
  }
  const inside =
    at.x >= area.x && at.x <= area.x + area.w && at.y >= area.y && at.y <= area.y + area.h;
  return inside ? 'move' : null;
}

/** What the current colour and weight amount to when something is drawn. */
interface Style {
  color: string;
  stroke: number;
  font: number;
}

/** The shape being dragged right now. Anything committed is already pixels. */
interface Stroke {
  tool: Tool;
  from: Point;
  to: Point;
  /** Only the pen accumulates a path; the rest are defined by their corners. */
  points: Point[];
}

interface ScreenshotEditorProps {
  /** Base64 PNG of the raw capture, without the data-URL prefix. */
  source: string;
  /** Seconds into the recording, frozen when the shot was taken. */
  timeSec: number;
  /**
   * Re-annotating one that is already saved, rather than a fresh capture. The
   * note exists, so there is no caption to ask for and the save overwrites the
   * file in place.
   */
  editing: boolean;
  onSave: (pngBase64: string, caption: string) => void;
  onCancel: () => void;
  busy: boolean;
}

function rectOf(stroke: Stroke): Rect {
  return rectBetween(stroke.from, stroke.to);
}

/**
 * The crop region as every other editor draws it: everything outside dimmed,
 * a light outline, and a square on each corner to drag. It is painted over the
 * preview canvas only — the committed image never sees any of it.
 */
function drawCropOverlay(ctx: CanvasRenderingContext2D, area: Rect, view: Rect, handle: number) {
  ctx.save();
  // `evenodd` punches the region out of the dimming in one fill, so the part
  // being kept shows at full brightness.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.rect(view.x, view.y, view.w, view.h);
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.fill('evenodd');

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, handle / 6);
  ctx.strokeRect(area.x, area.y, area.w, area.h);

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1, handle / 10);
  for (const [, corner] of cornersOf(area)) {
    ctx.fillRect(corner.x - handle / 2, corner.y - handle / 2, handle, handle);
    ctx.strokeRect(corner.x - handle / 2, corner.y - handle / 2, handle, handle);
  }
  ctx.restore();
}

/** Replaces a region with coarse blocks. The pixels underneath are gone. */
function redact(target: HTMLCanvasElement, area: Rect) {
  const ctx = target.getContext('2d');
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(area.w / REDACT_BLOCK));
  small.height = Math.max(1, Math.round(area.h / REDACT_BLOCK));
  const shrunk = small.getContext('2d');
  if (!ctx || !shrunk) return;

  shrunk.drawImage(target, area.x, area.y, area.w, area.h, 0, 0, small.width, small.height);
  ctx.save();
  // Nearest-neighbour on the way back up, so the result reads unmistakably as
  // redacted rather than as an out-of-focus photograph.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, area.x, area.y, area.w, area.h);
  ctx.restore();
}

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

/**
 * Marks up a screenshot before it becomes a note.
 *
 * Every tool bakes into a single committed canvas as soon as the pointer comes
 * up; nothing is kept as a shape. That is what redacting requires — a rectangle
 * drawn over data is not a redaction if the data is still underneath — and it
 * also means the crop has nothing to reposition and the export can never differ
 * from what is on screen.
 */
export function ScreenshotEditor({
  source,
  timeSec,
  editing,
  onSave,
  onCancel,
  busy,
}: ScreenshotEditorProps) {
  const { t } = useI18n();
  const viewRef = useRef<HTMLCanvasElement>(null);
  /** Full-resolution and offscreen: what has been committed so far. */
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const undoRef = useRef<HTMLCanvasElement[]>([]);

  const [tool, setTool] = useState<Tool>('arrow');
  const [colorId, setColorId] = useState<ColorId>('accent');
  const [strokeWidth, setStrokeWidth] = useState(STROKE_DEFAULT);
  const [stroke, setStroke] = useState<Stroke | null>(null);
  /**
   * The crop region survives the drag that created it, so it can be nudged by
   * its corners before being applied. Every other tool commits on pointer up
   * and keeps nothing.
   */
  const [crop, setCrop] = useState<Rect | null>(null);
  /** The crop drag in flight. A ref: it is read from move handlers, not rendered. */
  const grabRef = useRef<{ mode: CropGrab; anchor: Point; from: Point; start: Rect } | null>(null);
  const [cursor, setCursor] = useState('crosshair');
  const [typing, setTyping] = useState<{ at: Point; value: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [ready, setReady] = useState(false);
  const [depth, setDepth] = useState(0);
  /** Canvas cannot resolve CSS variables, so the token is read once. */
  const [accent, setAccent] = useState('#ec3013');

  useEffect(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (value) setAccent(value);
  }, []);

  // Memoized so `paint` does not rebuild on every render over a fresh object.
  const style = useMemo<Style>(
    () => ({
      color: colorValue(colorId, accent),
      stroke: strokeWidth,
      font: fontSizeFor(strokeWidth),
    }),
    [accent, colorId, strokeWidth],
  );

  /**
   * How much smaller the canvas is drawn than the image it holds. Sizes meant
   * to be constant to the eye — the crop handles — divide by it.
   */
  const displayScale = useCallback(() => {
    const view = viewRef.current;
    if (!view || view.width === 0) return 1;
    const width = view.getBoundingClientRect().width;
    return width > 0 ? width / view.width : 1;
  }, []);

  /** Repaints the visible canvas: what is committed, plus the live stroke. */
  const paint = useCallback(() => {
    const view = viewRef.current;
    const base = baseRef.current;
    const ctx = view?.getContext('2d');
    if (!view || !base || !ctx) return;

    if (view.width !== base.width || view.height !== base.height) {
      view.width = base.width;
      view.height = base.height;
    }
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(base, 0, 0);
    if (stroke) draw(ctx, stroke, style, true);
    if (tool === 'crop' && crop) {
      drawCropOverlay(
        ctx,
        crop,
        { x: 0, y: 0, w: view.width, h: view.height },
        HANDLE_SCREEN / displayScale(),
      );
    }
  }, [crop, displayScale, style, stroke, tool]);

  // The capture arrives as a data URL, which is same-origin: a canvas that drew
  // it can still be read back, which an `asset://` image would not allow.
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const base = document.createElement('canvas');
      base.width = image.naturalWidth;
      base.height = image.naturalHeight;
      base.getContext('2d')?.drawImage(image, 0, 0);
      baseRef.current = base;
      undoRef.current = [];
      setDepth(0);
      setReady(true);
    };
    image.src = `data:image/png;base64,${source}`;
  }, [source]);

  useEffect(paint, [paint, ready]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !typing) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, typing]);

  /** Snapshots the committed image so the next change can be undone. */
  const snapshot = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    undoRef.current = [...undoRef.current, copyOf(base)].slice(-UNDO_DEPTH);
    setDepth(undoRef.current.length);
  }, []);

  const undo = useCallback(() => {
    const previous = undoRef.current[undoRef.current.length - 1];
    if (!previous) return;
    undoRef.current = undoRef.current.slice(0, -1);
    baseRef.current = previous;
    setDepth(undoRef.current.length);
    setStroke(null);
    // Undoing a crop restores a differently sized image, so a region measured
    // against the old one would point at the wrong pixels.
    setCrop(null);
    paint();
  }, [paint]);

  /** Pointer position in image pixels; the canvas is only scaled by CSS. */
  const toImage = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const view = event.currentTarget;
    const box = view.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * view.width,
      y: ((event.clientY - box.top) / box.height) * view.height,
    };
  };

  const commitStroke = (finished: Stroke) => {
    const base = baseRef.current;
    const ctx = base?.getContext('2d');
    if (!base || !ctx) return;
    snapshot();
    if (finished.tool === 'blur') redact(base, rectOf(finished));
    else draw(ctx, finished, style, false);
    setStroke(null);
    paint();
  };

  const applyCrop = () => {
    const base = baseRef.current;
    if (!base || !crop || crop.w < 8 || crop.h < 8) return;
    snapshot();
    const cropped = document.createElement('canvas');
    cropped.width = Math.round(crop.w);
    cropped.height = Math.round(crop.h);
    cropped
      .getContext('2d')
      ?.drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, cropped.width, cropped.height);
    baseRef.current = cropped;
    // The region is gone with the pixels it selected: keeping it would leave a
    // rectangle floating over an image whose coordinates just changed.
    setCrop(null);
    paint();
  };

  /** Bakes the floating text field into the image at the point it was placed. */
  const commitText = () => {
    const base = baseRef.current;
    const ctx = base?.getContext('2d');
    const text = typing?.value.trim();
    if (!base || !ctx || !typing || !text) {
      setTyping(null);
      return;
    }
    snapshot();
    ctx.save();
    ctx.font = `700 ${style.font}px Archivo, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    // An outline under the fill, so the text stays readable whatever it happens
    // to land on. White, unless the text itself is white.
    ctx.lineWidth = Math.max(4, style.font / 5);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colorId === 'white' ? '#111111' : '#ffffff';
    ctx.strokeText(text, typing.at.x, typing.at.y);
    ctx.fillStyle = style.color;
    ctx.fillText(text, typing.at.x, typing.at.y);
    ctx.restore();
    setTyping(null);
    paint();
  };

  /** Keeps a region inside the image: dragging off the canvas must not lose it. */
  const clampToImage = (at: Point): Point => {
    const base = baseRef.current;
    if (!base) return at;
    return {
      x: Math.min(Math.max(at.x, 0), base.width),
      y: Math.min(Math.max(at.y, 0), base.height),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || busy) return;
    // A field still open belongs to an earlier click: bake it before doing
    // anything else. Blur cannot be relied on here, because the canvas is kept
    // from taking focus — see `onMouseDown` on it.
    if (typing) commitText();

    const at = toImage(event);
    if (tool === 'text') {
      setTyping({ at, value: '' });
      return;
    }

    if (tool === 'crop') {
      event.currentTarget.setPointerCapture(event.pointerId);
      const reach = HANDLE_SCREEN / displayScale();
      const grab = crop ? cropGrabAt(at, crop, reach) : null;
      if (crop && grab) {
        grabRef.current = { mode: grab, anchor: anchorOf(grab, crop), from: at, start: crop };
      } else {
        // Outside the region — or there is none yet: press and drag draws a new
        // one, anchored where the press landed.
        const empty: Rect = { x: at.x, y: at.y, w: 0, h: 0 };
        grabRef.current = { mode: 'se', anchor: at, from: at, start: empty };
        setCrop(empty);
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setStroke({ tool, from: at, to: at, points: [at] });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'crop') {
      const at = clampToImage(toImage(event));
      const grab = grabRef.current;
      if (!grab) {
        // Not dragging: the cursor is the only thing that says a corner is live.
        const reach = HANDLE_SCREEN / displayScale();
        const over = crop ? cropGrabAt(at, crop, reach) : null;
        setCursor(over ? CROP_CURSORS[over] : 'crosshair');
        return;
      }
      if (grab.mode === 'move') {
        const base = baseRef.current;
        const dx = at.x - grab.from.x;
        const dy = at.y - grab.from.y;
        const maxX = (base?.width ?? grab.start.w) - grab.start.w;
        const maxY = (base?.height ?? grab.start.h) - grab.start.h;
        setCrop({
          ...grab.start,
          x: Math.min(Math.max(grab.start.x + dx, 0), Math.max(0, maxX)),
          y: Math.min(Math.max(grab.start.y + dy, 0), Math.max(0, maxY)),
        });
      } else {
        // Sized against the opposite corner, so dragging past it flips the
        // region rather than collapsing it — the way every other editor behaves.
        setCrop(rectBetween(grab.anchor, at));
      }
      return;
    }

    if (!stroke) return;
    const at = toImage(event);
    setStroke({ ...stroke, to: at, points: [...stroke.points, at] });
  };

  const onPointerUp = () => {
    if (tool === 'crop') {
      grabRef.current = null;
      // A press that never moved leaves a zero-sized region behind; drop it so
      // the overlay does not linger as a dot.
      setCrop((current) => (current && current.w >= 1 && current.h >= 1 ? current : null));
      return;
    }
    if (!stroke) return;
    commitStroke(stroke);
  };

  const save = () => {
    const base = baseRef.current;
    if (!base) return;
    const url = base.toDataURL('image/png');
    onSave(url.slice(url.indexOf(',') + 1), caption);
  };

  const hint = tool === 'crop' ? t('shot.cropHint') : tool === 'blur' ? t('shot.blurHint') : '';

  return (
    <div className="shot-overlay" role="dialog" aria-modal="true" aria-label={t('shot.title')}>
      <div className="shot-panel">
        <header className="shot-header">
          <h2 className="shot-title">{editing ? t('shot.editTitle') : t('shot.title')}</h2>
          <span className="shot-time">{t('shot.at', { time: formatTime(timeSec) })}</span>
        </header>

        <div className="shot-toolbar">
          {TOOLS.map((id) => (
            <button
              key={id}
              type="button"
              className={`shot-tool${id === tool ? ' shot-tool--active' : ''}`}
              aria-pressed={id === tool}
              onClick={() => {
                setStroke(null);
                // Leaving the crop tool abandons the region: it is a selection,
                // not something committed, and it means nothing to the others.
                if (id !== 'crop') setCrop(null);
                grabRef.current = null;
                setCursor('crosshair');
                setTool(id);
              }}
            >
              {t(`shot.tool.${id}`)}
            </button>
          ))}
          <span className="shot-toolbar-gap" />
          {tool === 'crop' && (
            <button
              type="button"
              className="shot-tool"
              onClick={applyCrop}
              disabled={!crop || crop.w < 8 || crop.h < 8}
            >
              {t('shot.cropApply')}
            </button>
          )}
          <button type="button" className="shot-tool" onClick={undo} disabled={depth === 0}>
            {t('shot.undo')}
          </button>
        </div>

        {/* Disabled rather than hidden for redact and crop: neither draws
            anything, and a control that silently does nothing is worse than one
            that says so. Hiding them would also make the row jump. */}
        <div className="shot-controls">
          <div className="shot-group" role="group" aria-label={t('shot.colorGroup')}>
            {COLORS.map((id) => (
              <button
                key={id}
                type="button"
                className={`shot-swatch${id === colorId ? ' shot-swatch--active' : ''}`}
                style={{ background: colorValue(id, accent) }}
                aria-label={t(`shot.color.${id}`)}
                aria-pressed={id === colorId}
                title={t(`shot.color.${id}`)}
                disabled={!usesStyle(tool)}
                onClick={() => setColorId(id)}
              />
            ))}
          </div>
          <div className="shot-group">
            <span className="shot-group-label">{t('shot.weightGroup')}</span>
            <input
              type="range"
              className="shot-slider"
              min={STROKE_MIN}
              max={STROKE_MAX}
              step={1}
              value={strokeWidth}
              aria-label={t('shot.weightGroup')}
              disabled={!usesStyle(tool)}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
            />
            {/* The number rather than a sample of the line: at the top of the
                range a faithful bar would not fit the row, and one capped to
                fit would show 30 and 60 as the same thickness. */}
            <span className="shot-weight-value" aria-hidden="true">
              {strokeWidth}
            </span>
          </div>
        </div>

        {hint && <p className="shot-hint">{hint}</p>}

        <div className="shot-stage">
          <canvas
            ref={viewRef}
            className="shot-canvas"
            aria-label={t('shot.canvas')}
            style={{ cursor }}
            /* The canvas must never take focus. The text field is focused the
               moment it mounts, on `pointerdown`; the `mousedown` that follows
               would blur it right back, `onBlur` would commit an empty string
               and the field would vanish on the very click that opened it. */
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {typing && (
            <input
              type="text"
              className="shot-text-input"
              autoFocus
              value={typing.value}
              placeholder={t('shot.textPlaceholder')}
              aria-label={t('shot.tool.text')}
              style={textFieldStyle(typing.at, viewRef.current, style)}
              onChange={(event) => setTyping({ ...typing, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitText();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setTyping(null);
                }
              }}
              onBlur={commitText}
            />
          )}
        </div>

        {/* Only for a fresh capture. Re-editing keeps the note it already has;
            offering the field here would imply a caption change this does not
            save, since the file is overwritten and the note is left alone. */}
        {!editing && (
          <label className="shot-caption">
            <span className="shot-caption-label">{t('shot.caption')}</span>
            <input
              type="text"
              className="shot-caption-field"
              value={caption}
              placeholder={t('shot.captionPlaceholder')}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
        )}

        <footer className="shot-actions">
          <button type="button" className="btn-outline" onClick={onCancel} disabled={busy}>
            {editing ? t('shot.editCancel') : t('shot.cancel')}
          </button>
          <button type="button" className="btn-solid" onClick={save} disabled={busy || !ready}>
            {busy ? t('shot.saving') : editing ? t('shot.editSave') : t('shot.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Places the floating field over the point that was clicked. Two corrections
 * are needed, and both are easy to miss:
 *
 * - the canvas is displayed smaller than the image it holds, so the position
 *   has to come back through the same scale the pointer went in by;
 * - the field is positioned against `.shot-stage`, but the point is in canvas
 *   coordinates, and the stage centres a canvas narrower than itself. Without
 *   `offsetLeft` the field lands short of the click by half the leftover width,
 *   and the text then bakes where the pointer was rather than where it was
 *   typed.
 */
function textFieldStyle(at: Point, view: HTMLCanvasElement | null, style: Style) {
  if (!view || view.width === 0) return { display: 'none' as const };
  const box = view.getBoundingClientRect();
  const scale = box.width / view.width;
  return {
    left: `${view.offsetLeft + at.x * scale}px`,
    top: `${view.offsetTop + at.y * scale - (style.font * scale) / 2}px`,
    // Typed at the size and colour it will be baked at, so the field is a
    // preview rather than a box that turns into something else on Enter.
    fontSize: `${style.font * scale}px`,
    color: style.color,
  };
}

/**
 * Draws one shape. `preview` is the live version dragged under the pointer;
 * committed shapes go through the same code, so what is exported is what was
 * on screen.
 */
function draw(ctx: CanvasRenderingContext2D, stroke: Stroke, style: Style, preview: boolean) {
  const area = rectOf(stroke);
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (stroke.tool) {
    case 'arrow': {
      const angle = Math.atan2(stroke.to.y - stroke.from.y, stroke.to.x - stroke.from.x);
      const length = Math.hypot(stroke.to.x - stroke.from.x, stroke.to.y - stroke.from.y);
      // The head grows with the line, so a thick arrow does not end in a stub.
      const head = Math.min(style.stroke * 5, length / 3);
      ctx.beginPath();
      ctx.moveTo(stroke.from.x, stroke.from.y);
      ctx.lineTo(stroke.to.x, stroke.to.y);
      for (const spread of [0.4, -0.4]) {
        ctx.moveTo(stroke.to.x, stroke.to.y);
        ctx.lineTo(
          stroke.to.x - head * Math.cos(angle - spread),
          stroke.to.y - head * Math.sin(angle - spread),
        );
      }
      ctx.stroke();
      break;
    }
    case 'rect':
      ctx.strokeRect(area.x, area.y, area.w, area.h);
      break;
    case 'pen': {
      const start = stroke.points[0];
      if (start) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      break;
    }
    case 'highlight':
      // The chosen colour, laid on like ink rather than paint: `multiply` keeps
      // whatever is underneath readable through it.
      ctx.globalAlpha = 0.3;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(area.x, area.y, area.w, area.h);
      break;
    case 'blur':
      // Destructive and only ever previewed here: the outline shows what the
      // region is, and the commit does the actual work. It is not drawn in the
      // chosen colour — redacting draws nothing.
      if (preview) {
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#111111';
        ctx.strokeRect(area.x, area.y, area.w, area.h);
      }
      break;
    case 'crop':
      // Never reaches here: the crop region is its own state, painted by
      // `drawCropOverlay` so it can outlive the drag that made it.
      break;
  }
  ctx.restore();
}
