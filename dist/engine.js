/** A small, deterministic tabular Q-learning example. No browser dependencies. */
export const GRID_SIZE = 11;
export const START = 59; // (row 5, column 4), with zero-based coordinates.
export const GOAL = 61; // Only two cells away; the direct route is unsafe.
// The central partition and two branches force a route around both side edges.
// Mud pits replace selected partition cells and end the episode on entry.
export const WALLS = Object.freeze([5, 16, 27, 38, 49, 71, 72, 73, 82, 89, 92, 93]);
export const HAZARDS = Object.freeze([41, 60, 74, 75, 84, 90, 91]);
export const ACTIONS = Object.freeze([
  Object.freeze({ name: '上', dr: -1, dc: 0 }),
  Object.freeze({ name: '右', dr: 0, dc: 1 }),
  Object.freeze({ name: '下', dr: 1, dc: 0 }),
  Object.freeze({ name: '左', dr: 0, dc: -1 }),
]);

const walls = new Set(WALLS);
const hazards = new Set(HAZARDS);
const isTerminal = state => state === GOAL || hazards.has(state);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAgent(seed = 42) {
  if (!Number.isFinite(seed)) throw new TypeError('seed must be a finite number');
  return {
    seed: seed >>> 0,
    q: Array.from({ length: GRID_SIZE * GRID_SIZE }, () => [0, 0, 0, 0]),
    episodes: 0,
    returns: [],
    successes: 0,
    rng: seededRandom(seed),
  };
}

/** Reset the same object, including its random stream. */
export function resetAgent(agent, seed = agent.seed) {
  Object.assign(agent, createAgent(seed));
  return agent;
}

/** Reward belongs to the transition: entering a goal/hazard ends the episode. */
export function transition(state, action) {
  if (!Number.isInteger(state) || state < 0 || state >= GRID_SIZE * GRID_SIZE) {
    throw new RangeError(`state must be an integer from 0 to ${GRID_SIZE * GRID_SIZE - 1}`);
  }
  if (!Number.isInteger(action) || action < 0 || action >= ACTIONS.length) {
    throw new RangeError('action must be an integer from 0 to 3');
  }
  if (isTerminal(state)) {
    return { state, action, nextState: state, reward: 0, terminal: true, success: state === GOAL, blocked: false };
  }
  const row = Math.floor(state / GRID_SIZE) + ACTIONS[action].dr;
  const col = state % GRID_SIZE + ACTIONS[action].dc;
  const candidate = row * GRID_SIZE + col;
  const blocked = row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE || walls.has(candidate);
  const nextState = blocked ? state : candidate;
  const success = nextState === GOAL;
  const terminal = isTerminal(nextState);
  const reward = blocked ? -1 : success ? 10 : hazards.has(nextState) ? -5 : -0.2;
  return { state, action, nextState, reward, terminal, success, blocked };
}

function bestActions(values) {
  const max = Math.max(...values);
  return values.reduce((choices, value, index) => {
    if (value === max) choices.push(index);
    return choices;
  }, []);
}

function probability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

/**
 * One episode begins at START. maxSteps is a training cutoff, not an extra
 * terminal state in the maze; its final nonterminal update still bootstraps.
 */
export function trainEpisode(agent, { alpha = 0.2, gamma = 0.9, epsilon = 0.2, maxSteps = 300 } = {}) {
  probability(alpha, 'alpha');
  probability(gamma, 'gamma');
  probability(epsilon, 'epsilon');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive integer');
  let state = START;
  let reward = 0;
  let success = false;
  const updates = [];

  for (let step = 0; step < maxSteps; step++) {
    let action;
    if (agent.rng() < epsilon) {
      action = Math.floor(agent.rng() * ACTIONS.length);
    } else {
      const choices = bestActions(agent.q[state]);
      action = choices[Math.floor(agent.rng() * choices.length)];
    }
    const observed = transition(state, action);
    const oldQ = agent.q[state][action];
    const maxNext = observed.terminal ? 0 : Math.max(...agent.q[observed.nextState]);
    const target = observed.reward + gamma * maxNext;
    const newQ = oldQ + alpha * (target - oldQ);
    agent.q[state][action] = newQ;
    updates.push({
      state, action, reward: observed.reward, nextState: observed.nextState,
      terminal: observed.terminal, oldQ, maxNext, target, newQ,
    });
    reward += observed.reward;
    state = observed.nextState;
    success = observed.success;
    if (observed.terminal) break;
  }

  agent.episodes++;
  agent.returns.push(reward);
  if (success) agent.successes++;
  return { reward, steps: updates.length, success, updates };
}

/** Train synchronously and return the completed episodes for UI inspection. */
export function train(agent, episodes, options = {}) {
  if (!Number.isInteger(episodes) || episodes < 0) throw new RangeError('episodes must be a nonnegative integer');
  return Array.from({ length: episodes }, () => trainEpisode(agent, options));
}

/** Evaluation is greedy, with stable tie-breaking, and does not modify agent. */
export function greedyPath(agent, start = START, maxSteps = 120) {
  if (!Number.isInteger(start) || start < 0 || start >= GRID_SIZE * GRID_SIZE || walls.has(start)) {
    throw new RangeError('start must be a traversable maze state');
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 0) throw new RangeError('maxSteps must be a nonnegative integer');
  const states = [start];
  const actions = [];
  const rewards = [];
  let state = start;
  let success = start === GOAL;
  let terminal = isTerminal(start);
  for (let step = 0; step < maxSteps && !terminal; step++) {
    const action = bestActions(agent.q[state])[0];
    const observed = transition(state, action);
    actions.push(action);
    rewards.push(observed.reward);
    states.push(observed.nextState);
    state = observed.nextState;
    success = observed.success;
    terminal = observed.terminal;
  }
  return { states, actions, rewards, steps: actions.length, reward: rewards.reduce((sum, n) => sum + n, 0), success, terminal };
}
