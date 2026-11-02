import { GRID_SIZE } from './engine.js';

const dragPointInside = (point, size) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x < size && point.y < size;
const dragPointCell = (point, size) => Math.floor(point.y) * size + Math.floor(point.x);

function dragClipEndpoint(from, to, size) {
  const dx = to.x - from.x, dy = to.y - from.y, upper = size - 1e-9;
  let fraction = 1;
  if (to.x < 0) fraction = Math.min(fraction, -from.x / dx);
  if (to.x >= size) fraction = Math.min(fraction, (upper - from.x) / dx);
  if (to.y < 0) fraction = Math.min(fraction, -from.y / dy);
  if (to.y >= size) fraction = Math.min(fraction, (upper - from.y) / dy);
  return { x: Math.max(0, Math.min(upper, from.x + fraction * dx)), y: Math.max(0, Math.min(upper, from.y + fraction * dy)) };
}

/**
 * Grid traversal in pointer order, excluding the starting cell. Coordinates
 * are measured in cells, not pixels. Exact corner crossings go horizontally
 * first, then vertically, so there are never diagonal moves or skipped cells.
 */
export function traceCellSegment(from, to, size = GRID_SIZE) {
  if (!dragPointInside(from, size) || !dragPointInside(to, size)) return [];
  let col = Math.floor(from.x), row = Math.floor(from.y);
  const endCol = Math.floor(to.x), endRow = Math.floor(to.y);
  const dx = to.x - from.x, dy = to.y - from.y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let nextX = dx === 0 ? Infinity : ((sx > 0 ? col + 1 : col) - from.x) / dx;
  let nextY = dy === 0 ? Infinity : ((sy > 0 ? row + 1 : row) - from.y) / dy;
  const cells = [];
  while (col !== endCol || row !== endRow) {
    if (col !== endCol && (row === endRow || nextX <= nextY + 1e-10)) {
      col += sx; nextX += deltaX;
    } else {
      row += sy; nextY += deltaY;
    }
    cells.push(row * size + col);
  }
  return cells;
}

/**
 * DOM-free path state. It follows the actual sampled pointer polyline, never
 * searches for a route. After an obstruction, the pointer must return to the
 * robot's actual cell before following resumes. This prevents repeated wall
 * penalties and prevents joining a route on the far side of an obstacle.
 */
export function createDragPath({ size = GRID_SIZE, getState, getDone = () => false, move }) {
  let active = false, blocked = false, lastPoint = null;
  const cancel = () => { active = false; blocked = false; lastPoint = null; };
  const start = point => {
    if (active || getDone() || !dragPointInside(point, size) || dragPointCell(point, size) !== getState()) return false;
    active = true; blocked = false; lastPoint = { ...point };
    return true;
  };
  const advance = point => {
    const result = { actions: [], transitions: [], blocked: false, terminal: false, outside: false, active };
    if (!active) return result;
    if (getDone()) { cancel(); return { ...result, terminal: true, active: false }; }
    const outside = !dragPointInside(point, size);
    if (outside) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        cancel(); return { ...result, outside: true, active: false };
      }
      // Keep the observed in-bounds part of a fast exit, then release the
      // gesture. A later re-entry cannot connect across the outside region.
      point = dragClipEndpoint(lastPoint, point, size);
    }
    const cells = traceCellSegment(lastPoint, point, size);
    lastPoint = { ...point };
    for (const cell of cells) {
      const current = getState();
      if (blocked) {
        if (cell === current) blocked = false;
        continue;
      }
      if (cell === current) continue;
      const dr = Math.floor(cell / size) - Math.floor(current / size);
      const dc = cell % size - current % size;
      if (Math.abs(dr) + Math.abs(dc) !== 1) { blocked = true; continue; }
      const action = dr === -1 ? 0 : dc === 1 ? 1 : dr === 1 ? 2 : 3;
      const transition = move(action);
      result.actions.push(action);
      result.transitions.push(transition);
      if (transition?.terminal || getDone()) {
        result.terminal = true;
        cancel();
        break;
      }
      if (transition?.blocked || getState() !== cell) {
        blocked = true;
        result.blocked = true;
      }
    }
    if (outside && active) { result.outside = true; cancel(); }
    result.active = active;
    return result;
  };
  return { start, advance, cancel, get active() { return active; }, get blocked() { return blocked; } };
}

/**
 * Unified mouse / touch / pen binding. The stable grid owns pointer capture;
 * only its current robot tile needs CSS touch-action:none (.drag-ready).
 * move(action) must synchronously update getState() and return a transition.
 * announce receives {type, reason?, state, transition?}; controller.cancel()
 * drops queued movement, for resets and keyboard/direction-button input.
 */
export function attachRobotDrag(grid, { size = GRID_SIZE, getState, getDone = () => false, move, announce = () => {} }) {
  const view = grid.ownerDocument?.defaultView ?? globalThis;
  const path = createDragPath({ size, getState, getDone, move });
  const requestFrame = callback => view.requestAnimationFrame ? view.requestAnimationFrame(callback) : view.setTimeout(callback, 16);
  const cancelFrame = id => view.cancelAnimationFrame ? view.cancelAnimationFrame(id) : view.clearTimeout(id);
  let pointerId = null, frame = null, pending = [];

  const notify = (type, reason, transition) => announce({ type, ...(reason ? { reason } : {}), state: getState(), ...(transition ? { transition } : {}) });
  const stop = (type = 'cancel', reason = 'external') => {
    if (frame !== null) cancelFrame(frame);
    frame = null; pending = [];
    const previousId = pointerId;
    pointerId = null;
    path.cancel();
    grid.classList.remove('is-dragging');
    if (previousId === null) return;
    try {
      if (grid.hasPointerCapture?.(previousId)) grid.releasePointerCapture(previousId);
    } catch { /* Pointer capture may already have been released by the browser. */ }
    if (type) notify(type, reason);
  };

  // Actual cell geometry accounts for the grid's padding and gaps. Half of a
  // gap belongs to each adjacent cell; outer grid padding ends the gesture.
  const toPoint = event => {
    const first = grid.querySelector('[data-state="0"]')?.getBoundingClientRect();
    const last = grid.querySelector(`[data-state="${size * size - 1}"]`)?.getBoundingClientRect();
    if (!first || !last) return null;
    const pitchX = size === 1 ? first.width : (last.left - first.left) / (size - 1);
    const pitchY = size === 1 ? first.height : (last.top - first.top) / (size - 1);
    if (!(pitchX > 0 && pitchY > 0)) return null;
    const originX = first.left - (pitchX - first.width) / 2;
    const originY = first.top - (pitchY - first.height) / 2;
    return { x: (event.clientX - originX) / pitchX, y: (event.clientY - originY) / pitchY };
  };

  const flush = () => {
    frame = null;
    const samples = pending;
    pending = [];
    for (const point of samples) {
      if (pointerId === null) break;
      const result = path.advance(point);
      if (result.blocked) notify('blocked', undefined, result.transitions.find(t => t?.blocked));
      if (result.terminal) {
        notify('terminal', undefined, result.transitions.at(-1));
        stop(null);
        break;
      }
      if (result.outside) { stop('cancel', 'outside'); break; }
    }
  };
  const enqueue = (event, schedule = true) => {
    const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of [...samples, event]) pending.push(toPoint(sample));
    if (schedule && frame === null) frame = requestFrame(flush);
  };
  const prevent = event => { if (event.cancelable) event.preventDefault(); };

  const onDown = event => {
    if (pointerId !== null || event.isPrimary === false || event.button !== 0 || getDone()) return;
    const tile = event.target?.closest?.('[data-state]');
    if (!tile || !grid.contains(tile) || Number(tile.dataset.state) !== getState()) return;
    if (!path.start(toPoint(event))) return;
    pointerId = event.pointerId;
    prevent(event);
    grid.classList.add('is-dragging');
    try { grid.setPointerCapture(event.pointerId); }
    catch { stop('cancel', 'capture'); return; }
    notify('start');
  };
  const onMove = event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (event.pointerType === 'mouse' && typeof event.buttons === 'number' && !(event.buttons & 1)) {
      stop('cancel', 'buttons'); return;
    }
    prevent(event);
    enqueue(event);
  };
  const onUp = event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    prevent(event);
    enqueue(event, false);
    if (frame !== null) cancelFrame(frame);
    flush();
    if (pointerId !== null) stop('end', 'pointerup');
  };
  const onCancel = event => { if (pointerId !== null && event.pointerId === pointerId) stop('cancel', 'pointercancel'); };
  const onLostCapture = event => { if (pointerId !== null && event.pointerId === pointerId) stop('cancel', 'lostcapture'); };
  const onBlur = () => stop('cancel', 'blur');
  const onResize = () => stop('cancel', 'resize');
  const handlers = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onCancel, lostpointercapture: onLostCapture };
  for (const [type, listener] of Object.entries(handlers)) grid.addEventListener(type, listener, { passive: false });
  view.addEventListener('blur', onBlur);
  view.addEventListener('resize', onResize);
  return {
    cancel: () => stop('cancel', 'external'),
    destroy() {
      stop('cancel', 'external');
      for (const [type, listener] of Object.entries(handlers)) grid.removeEventListener(type, listener);
      view.removeEventListener('blur', onBlur);
      view.removeEventListener('resize', onResize);
    },
  };
}
