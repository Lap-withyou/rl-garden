import test from 'node:test';
import assert from 'node:assert/strict';
import { traceCellSegment, createDragPath, attachRobotDrag } from '../dist/drag-control.js';

const point = (state, size = 5) => ({ x: state % size + 0.5, y: Math.floor(state / size) + 0.5 });

function fixture({ start = 10, walls = [], hazards = [], goal = 24 } = {}) {
  let state = start, done = false;
  const actions = [], transitions = [];
  const move = action => {
    actions.push(action);
    const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][action];
    const row = Math.floor(state / 5) + dr, col = state % 5 + dc;
    const next = row * 5 + col, blocked = row < 0 || row > 4 || col < 0 || col > 4 || walls.includes(next);
    const old = state;
    if (!blocked) state = next;
    done = state === goal || hazards.includes(state);
    const result = { state: old, nextState: state, blocked, terminal: done, success: state === goal, reward: blocked ? -1 : done ? state === goal ? 10 : -5 : -0.2 };
    transitions.push(result);
    return result;
  };
  const options = { size: 5, getState: () => state, getDone: () => done, move };
  return { ...options, actions, transitions, path: createDragPath(options) };
}

test('fast and diagonal segments traverse adjacent cells in a stable order', () => {
  assert.deepEqual(traceCellSegment(point(0), point(4), 5), [1, 2, 3, 4]);
  assert.deepEqual(traceCellSegment(point(0), point(12), 5), [1, 6, 7, 12]);
  assert.deepEqual(traceCellSegment(point(12), point(0), 5), [11, 6, 5, 0]);
  assert.deepEqual(traceCellSegment(point(12), { x: 2.9, y: 2.9 }, 5), []);
});

test('only the current robot cell may start a drag', () => {
  const f = fixture();
  assert.equal(f.path.start(point(11)), false);
  assert.equal(f.path.start(point(10)), true);
  assert.equal(f.path.start(point(10)), false, 'a second start does not replace the active gesture');
});

test('fast crossing stops at a wall and holding beyond it does not repeat penalties', () => {
  const f = fixture({ walls: [12] });
  f.path.start(point(10));
  const result = f.path.advance(point(14));
  assert.equal(result.blocked, true);
  assert.equal(f.getState(), 11);
  assert.deepEqual(f.actions, [1, 1]);
  f.path.advance(point(14));
  f.path.advance({ x: 4.8, y: 2.7 });
  assert.deepEqual(f.actions, [1, 1]);
  assert.equal(f.transitions.filter(t => t.blocked).length, 1);
  f.path.advance(point(11));
  assert.equal(f.path.blocked, false);
  f.path.advance(point(6));
  assert.equal(f.getState(), 6);
  assert.deepEqual(f.actions, [1, 1, 0]);
});

test('pointer motion around the far side of an obstacle never auto-routes the robot', () => {
  const f = fixture({ walls: [12] });
  f.path.start(point(10));
  for (const state of [14, 19, 18, 17, 16]) f.path.advance(point(state));
  assert.equal(f.getState(), 11);
  assert.deepEqual(f.actions, [1, 1]);
  f.path.advance(point(11));
  f.path.advance(point(6));
  assert.equal(f.getState(), 6);
});

test('mud and destination immediately stop the remainder of a fast segment', () => {
  for (const options of [{ hazards: [12] }, { goal: 12 }]) {
    const f = fixture(options);
    f.path.start(point(10));
    assert.equal(f.path.advance(point(14)).terminal, true);
    assert.equal(f.getState(), 12);
    assert.deepEqual(f.actions, [1, 1]);
    assert.equal(f.path.active, false);
    f.path.advance(point(14));
    assert.deepEqual(f.actions, [1, 1]);
    assert.equal(f.path.start(point(12)), false);
  }
});

test('events remaining inside one cell do not add moves or rewards', () => {
  const f = fixture();
  f.path.start(point(10));
  for (const p of [point(10), { x: 0.1, y: 2.1 }, { x: 0.9, y: 2.9 }]) f.path.advance(p);
  assert.deepEqual(f.actions, []);
});

test('leaving the board cancels the gesture and requires a fresh start at the robot', () => {
  const f = fixture();
  f.path.start(point(10));
  assert.equal(f.path.advance({ x: -0.1, y: 2.5 }).outside, true);
  assert.equal(f.path.active, false);
  f.path.advance(point(14));
  assert.equal(f.getState(), 10);
  assert.equal(f.path.start(point(10)), true);
  f.path.advance(point(11));
  assert.equal(f.getState(), 11);
});

test('a fast segment leaving the board follows its in-bounds portion before stopping', () => {
  const f = fixture();
  f.path.start(point(10));
  const result = f.path.advance({ x: 5.5, y: 2.5 });
  assert.equal(result.outside, true);
  assert.equal(f.getState(), 14);
  assert.deepEqual(f.actions, [1, 1, 1, 1]);
  f.path.advance(point(19));
  assert.equal(f.getState(), 14, 'returning without a new pointerdown cannot reconnect the drag');
});

function browserFixture(options = {}) {
  const f = fixture({ start: 0, ...options });
  const events = [];
  const frames = new Map(); let frameId = 0;
  const listeners = new Map(), windowListeners = new Map(), classes = new Set();
  const win = {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const cells = Array.from({ length: 25 }, (_, state) => ({
    dataset: { state: String(state) },
    closest() { return this; },
    getBoundingClientRect() { return { left: state % 5 * 10, top: Math.floor(state / 5) * 10, width: 10, height: 10 }; },
  }));
  const captured = new Set();
  const grid = {
    ownerDocument: { defaultView: win },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
    querySelector(selector) { return cells[Number(selector.match(/\d+/)[0])]; },
    contains: cell => cells.includes(cell),
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 50, height: 50 }; },
  };
  const controller = attachRobotDrag(grid, { ...f, announce: event => events.push(event) });
  const emit = (type, extra = {}) => {
    const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: 5, clientY: 5, target: cells[f.getState()], cancelable: true, preventDefault() { this.prevented = true; }, ...extra };
    listeners.get(type)?.(event);
    return event;
  };
  const flush = () => { const batch = [...frames]; frames.clear(); batch.forEach(([, fn]) => fn()); };
  return { ...f, grid, controller, emit, flush, frames, captured, classes, events, cells, windowListeners };
}

test('pointer input batches on animation frames and flushes the final pointerup coordinate', () => {
  const f = browserFixture({ goal: 23 });
  f.emit('pointerdown');
  assert.equal(f.captured.has(1), true);
  assert.equal(f.classes.has('is-dragging'), true);
  f.emit('pointermove', { clientX: 35 });
  assert.equal(f.getState(), 0);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.getState(), 3);
  f.emit('pointerup', { clientX: 45, buttons: 0 });
  assert.equal(f.getState(), 4);
  assert.deepEqual(f.actions, [1, 1, 1, 1]);
  assert.equal(f.captured.size, 0);
  assert.equal(f.classes.has('is-dragging'), false);
  assert.deepEqual(f.events.map(e => e.type), ['start', 'end']);
});

test('right clicks and secondary pointers never take over, and unrelated cancels are ignored', () => {
  const f = browserFixture();
  assert.equal(f.emit('pointerdown', { pointerType: 'mouse', button: 2 }).prevented, undefined);
  assert.equal(f.captured.size, 0);
  f.emit('pointerdown', { isPrimary: false, pointerId: 2 });
  assert.equal(f.captured.size, 0);
  f.emit('pointerdown');
  f.emit('pointermove', { pointerId: 2, isPrimary: false, clientX: 45 });
  f.emit('pointercancel', { pointerId: 2 });
  assert.equal(f.captured.has(1), true);
  f.emit('pointermove', { clientX: 25 });
  f.emit('pointercancel');
  f.flush();
  assert.deepEqual(f.actions, []);
  assert.equal(f.captured.size, 0);
  assert.equal(f.events.at(-1).reason, 'pointercancel');
});

test('touches outside the robot remain available for page scrolling and pen input can drag', () => {
  const f = browserFixture();
  const scrolling = f.emit('pointerdown', { target: f.cells[1], clientX: 15 });
  assert.equal(scrolling.prevented, undefined);
  assert.equal(f.captured.size, 0);
  f.emit('pointermove', { clientX: 45 });
  assert.equal(f.frames.size, 0);
  f.emit('pointerdown', { pointerType: 'pen' });
  f.emit('pointerup', { pointerType: 'pen', clientX: 15 });
  assert.equal(f.getState(), 1);
});

test('external reset, blur and resize cancel queued moves and allow a new gesture', () => {
  for (const reason of ['external', 'blur', 'resize']) {
    const f = browserFixture();
    f.emit('pointerdown');
    f.emit('pointermove', { clientX: 45 });
    if (reason === 'external') f.controller.cancel(); else f.windowListeners.get(reason)();
    f.flush();
    assert.deepEqual(f.actions, []);
    assert.equal(f.captured.size, 0);
    assert.equal(f.events.at(-1).reason, reason);
    f.emit('pointerdown');
    f.emit('pointerup', { clientX: 15 });
    assert.equal(f.getState(), 1);
  }
});

test('coalesced input preserves turns instead of connecting only the final sample', () => {
  const f = browserFixture();
  f.emit('pointerdown');
  f.emit('pointermove', { clientX: 25, clientY: 25, getCoalescedEvents: () => [{ clientX: 25, clientY: 5 }, { clientX: 25, clientY: 25 }] });
  f.flush();
  assert.deepEqual(f.actions, [1, 1, 2, 2]);
  assert.equal(f.getState(), 12);
});

test('capture loss discards pending input, while reaching a terminal cell releases capture immediately', () => {
  const cancelled = browserFixture();
  cancelled.emit('pointerdown');
  cancelled.emit('pointermove', { clientX: 35 });
  cancelled.emit('lostpointercapture');
  cancelled.flush();
  assert.deepEqual(cancelled.actions, []);
  assert.equal(cancelled.events.at(-1).reason, 'lostcapture');
  const terminal = browserFixture({ hazards: [2] });
  terminal.emit('pointerdown');
  terminal.emit('pointermove', { clientX: 45 });
  terminal.flush();
  assert.equal(terminal.getState(), 2);
  assert.deepEqual(terminal.actions, [1, 1]);
  assert.equal(terminal.captured.size, 0);
  assert.equal(terminal.events.at(-1).type, 'terminal');
  terminal.emit('pointerup', { clientX: 45 });
  assert.deepEqual(terminal.actions, [1, 1]);
});
