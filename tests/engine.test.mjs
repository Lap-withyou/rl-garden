import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_SIZE, START, GOAL, WALLS, HAZARDS, ACTIONS, createAgent, transition, trainEpisode, train, greedyPath, resetAgent,
} from '../dist/engine.js';

// Independent graph search verifies the map's teaching premise, not its learner.
function shortestSafePath(forbidden = new Set()) {
  const unsafe = new Set([...WALLS, ...HAZARDS, ...forbidden]);
  const queue = [[START]], visited = new Set([START]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index], state = path.at(-1);
    if (state === GOAL) return path;
    const row = Math.floor(state / GRID_SIZE), col = state % GRID_SIZE;
    for (const { dr, dc } of ACTIONS) {
      const r = row + dr, c = col + dc, next = r * GRID_SIZE + c;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE || unsafe.has(next) || visited.has(next)) continue;
      visited.add(next); queue.push([...path, next]);
    }
  }
  return null;
}

test('nearby central endpoints require a safe 26-step detour', () => {
  assert.equal(GRID_SIZE, 11);
  assert.equal(START, 59);
  assert.equal(GOAL, 61);
  assert.equal(Math.floor(START / GRID_SIZE), 5);
  assert.equal(Math.floor(GOAL / GRID_SIZE), 5);
  assert.equal(Math.abs(START % GRID_SIZE - GOAL % GRID_SIZE), 2);
  assert.ok(HAZARDS.includes(60), 'the tempting direct step is a terminal mud pit');
  assert.equal(shortestSafePath().length - 1, 26);
  assert.equal(new Set([...WALLS, ...HAZARDS]).size, WALLS.length + HAZARDS.length);
});

test('every safe route must visit both side edges and the lower detour', () => {
  const leftEdge = new Set(Array.from({ length: GRID_SIZE }, (_, r) => r * GRID_SIZE));
  const rightEdge = new Set(Array.from({ length: GRID_SIZE }, (_, r) => r * GRID_SIZE + GRID_SIZE - 1));
  const lowerRows = new Set(Array.from({ length: 2 * GRID_SIZE }, (_, i) => 9 * GRID_SIZE + i));
  assert.equal(shortestSafePath(leftEdge), null);
  assert.equal(shortestSafePath(rightEdge), null);
  assert.equal(shortestSafePath(lowerRows), null);
});

test('actions and maze transitions match the teaching example', () => {
  assert.deepEqual(ACTIONS.map(a => a.name), ['上', '右', '下', '左']);
  assert.equal(transition(START, 0).nextState, 48);
  assert.equal(transition(START, 0).reward, -0.2);
  for (const [state, action] of [[55, 3], [110, 2], [48, 1]]) {
    const step = transition(state, action);
    assert.equal(step.nextState, state);
    assert.equal(step.reward, -1);
    assert.equal(step.terminal, false);
    assert.equal(step.blocked, true);
  }
  assert.equal(transition(50, 2).reward, 10);
  assert.equal(transition(50, 2).success, true);
  assert.equal(transition(START, 1).reward, -5);
  assert.equal(transition(START, 1).terminal, true);
  assert.equal(transition(START, 1).success, false);
});

test('goal and hazard terminal states do not issue repeated rewards', () => {
  for (const state of [GOAL, ...HAZARDS]) {
    const step = transition(state, 1);
    assert.equal(step.nextState, state);
    assert.equal(step.reward, 0);
    assert.equal(step.terminal, true);
  }
});

test('Q updates use the observed reward and discounted best next value', () => {
  const agent = createAgent(42);
  agent.q[START][0] = 2;
  agent.q[48][0] = 4;
  const episode = trainEpisode(agent, { alpha: 0.5, gamma: 0.9, epsilon: 0, maxSteps: 1 });
  const update = episode.updates[0];
  assert.equal(update.state, START);
  assert.equal(update.action, 0);
  assert.equal(update.oldQ, 2);
  assert.equal(update.maxNext, 4);
  assert.equal(update.target, 3.4);
  assert.equal(update.newQ, 2.7);
  assert.equal(agent.q[START][0], 2.7);
  assert.equal(episode.reward, -0.2);
  assert.equal(episode.steps, 1);
});

test('a terminal transition bootstraps zero even when terminal Q values are large', () => {
  const agent = createAgent(9);
  const path = shortestSafePath();
  for (let i = 0; i < path.length - 1; i++) {
    const dr = Math.floor(path[i + 1] / GRID_SIZE) - Math.floor(path[i] / GRID_SIZE);
    const dc = path[i + 1] % GRID_SIZE - path[i] % GRID_SIZE;
    const action = ACTIONS.findIndex(a => a.dr === dr && a.dc === dc);
    agent.q[path[i]][action] = 2;
  }
  agent.q[GOAL].fill(1000);
  const result = trainEpisode(agent, { alpha: 0.5, gamma: 0.9, epsilon: 0, maxSteps: 50 });
  const terminalUpdate = result.updates.at(-1);
  assert.equal(result.success, true);
  assert.equal(result.steps, 26);
  assert.equal(terminalUpdate.terminal, true);
  assert.equal(terminalUpdate.maxNext, 0);
  assert.equal(terminalUpdate.target, 10);
  assert.equal(terminalUpdate.newQ, 6);
  assert.equal(agent.successes, 1);
});

test('the tempting direct action ends at a hazard and also bootstraps zero', () => {
  const agent = createAgent(12);
  agent.q[START][1] = 2;
  agent.q[60].fill(1000);
  const result = trainEpisode(agent, { alpha: 0.5, gamma: 0.97, epsilon: 0 });
  assert.equal(result.steps, 1);
  assert.equal(result.success, false);
  assert.equal(result.reward, -5);
  assert.equal(result.updates[0].maxNext, 0);
  assert.equal(result.updates[0].target, -5);
  assert.equal(result.updates[0].newQ, -1.5);
});

test('same seed and training inputs produce identical learning history', () => {
  const first = createAgent(123);
  const second = createAgent(123);
  train(first, 250, { epsilon: 0.2 });
  train(second, 250, { epsilon: 0.2 });
  assert.deepEqual(first.q, second.q);
  assert.deepEqual(first.returns, second.returns);
  assert.equal(first.episodes, 250);
  assert.equal(first.successes, second.successes);
});

test('training learns the safe 26-step detour with better average reward', () => {
  const agent = createAgent(42);
  const before = greedyPath(agent);
  assert.equal(before.success, false);
  assert.equal(before.steps, 120);
  train(agent, 500);
  const after = greedyPath(agent);
  assert.equal(after.success, true);
  assert.equal(after.states[0], START);
  assert.equal(after.states.at(-1), GOAL);
  assert.equal(after.steps, 26);
  assert.equal(after.states.some(s => WALLS.includes(s) || HAZARDS.includes(s)), false);
  assert.ok(Math.abs(after.reward - 5) < 1e-10);
  const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
  assert.ok(mean(agent.returns.slice(-50)) > mean(agent.returns.slice(0, 50)));
});

test('a training cutoff defaults to 300 steps and is not an environment terminal', () => {
  const agent = createAgent(42);
  for (const row of agent.q) row[0] = 2;
  const result = trainEpisode(agent, { alpha: 0, epsilon: 0 });
  assert.equal(result.steps, 300);
  assert.equal(result.success, false);
  const lastUpdate = result.updates.at(-1);
  assert.equal(lastUpdate.terminal, false);
  assert.equal(lastUpdate.maxNext, 2);
  assert.ok(Math.abs(lastUpdate.target - 0.8) < 1e-10);
});

test('reset restores an untrained reproducible agent in place', () => {
  const agent = createAgent(42);
  train(agent, 30);
  assert.equal(resetAgent(agent), agent);
  const fresh = createAgent(42);
  assert.deepEqual(agent.q, fresh.q);
  assert.deepEqual(agent.returns, []);
  assert.equal(agent.episodes, 0);
  assert.equal(agent.successes, 0);
  assert.equal(agent.rng(), fresh.rng());
});
