import { ACTIONS, GRID_SIZE, START, GOAL, WALLS, HAZARDS, createAgent, resetAgent, transition, trainEpisode, greedyPath } from './engine.js';
import { history } from './history.js';
import { attachRobotDrag } from './drag-control.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const arrows = ['↑', '→', '↓', '←'];
const fmt = (n, digits=2) => Number(n).toFixed(digits).replace('-', '−');
const robotHTML = '<span class="robot" aria-hidden="true"></span>';
const stateLabel = s => `第 ${Math.floor(s/GRID_SIZE)+1} 行，第 ${s%GRID_SIZE+1} 列`;

// The same transition rules drive the visitor's route and the learning agent.
let manualState = START, manualSteps = 0, manualReward = 0, manualDone = false;
let manualVisited = new Set([START]);
let manualRobot=null,manualDrag=null,dragWasBlocked=false;
function renderGrid(target, position, {interactive=false, policy=false, agent=null, visited=new Set(), selected=-1}={}) {
  const grid = $(target);
  grid.style.setProperty('--grid-size',GRID_SIZE);
  grid.innerHTML = Array.from({length:GRID_SIZE*GRID_SIZE}, (_, s) => {
    const wall=WALLS.includes(s), hazard=HAZARDS.includes(s), goal=s===GOAL;
    const isOpen=!wall&&!hazard&&!goal;
    let content='';
    const row=agent?.q[s];
    const learned=row&&row.some(v=>v!==0);
    if(policy&&isOpen&&learned) content=`<span aria-hidden="true">${arrows[row.indexOf(Math.max(...row))]}</span>`;
    if(s===position) content=robotHTML;
    const classes=['cell',wall?'wall':'',hazard?'hazard':'',goal?'goal':'',s===START?'start':'',visited.has(s)?'visited':'',s===selected?'selected':''].filter(Boolean).join(' ');
    const label=`${stateLabel(s)}${wall?'，灌木':hazard?'，泥潭':goal?'，目的地':''}${s===START?'，起点':''}${s===position?'，机器人当前位置':''}`;
    return interactive?`<button class="${classes}" data-state="${s}" aria-label="${label}" ${wall?'disabled':''}>${content}</button>`:`<div class="${classes}" data-state="${s}" aria-label="${label}">${content}</div>`;
  }).join('');
}
function renderManual(){
  const grid=$('#manual-grid');
  if(!manualRobot){
    renderGrid('#manual-grid',manualState,{visited:manualVisited});
    grid.querySelector('.robot')?.remove();
    manualRobot=document.createElement('span');
    manualRobot.className='robot manual-robot';
    manualRobot.setAttribute('aria-hidden','true');
    grid.append(manualRobot);
  }
  grid.querySelectorAll('.cell').forEach(cell=>{
    const state=Number(cell.dataset.state),current=state===manualState;
    cell.classList.toggle('visited',manualVisited.has(state));
    cell.classList.toggle('drag-ready',current&&!manualDone);
    cell.setAttribute('aria-label',`${stateLabel(state)}${WALLS.includes(state)?'，灌木':HAZARDS.includes(state)?'，泥潭':state===GOAL?'，目的地':''}${state===START?'，起点':''}${current?manualDone?'，机器人当前位置，本轮已结束':'，机器人当前位置，可按住拖动':''}`);
  });
  positionManualRobot();
  $('#manual-steps').textContent=String(manualSteps).padStart(2,'0');
  $('#manual-reward').textContent=fmt(manualReward,1);
  $$('[data-move]').forEach(b=>b.disabled=manualDone);
}
function positionManualRobot(){
  if(!manualRobot)return;
  const cell=$(`#manual-grid [data-state="${manualState}"]`);
  if(!cell)return;
  const size=Math.min(cell.offsetWidth,cell.offsetHeight)*.76;
  manualRobot.style.setProperty('--robot-size',`${size}px`);
  manualRobot.style.setProperty('--robot-x',`${cell.offsetLeft+(cell.offsetWidth-size)/2}px`);
  manualRobot.style.setProperty('--robot-y',`${cell.offsetTop+(cell.offsetHeight-size)/2}px`);
}
function moveManual(a){
  if(manualDone)return;
  const tr=transition(manualState,a);
  if(!tr.blocked)dragWasBlocked=false;
  manualState=tr.nextState; manualSteps++; manualReward+=tr.reward; manualDone=tr.terminal;
  manualVisited.add(manualState);
  const message=tr.success?`包裹送达！用了 ${manualSteps} 步，累计奖励 ${fmt(manualReward,1)}。你找到了怎样的路线？`:
    tr.terminal?'掉进泥潭了！终点看起来很近，但这条近路走不通。重新出发，试试先远离终点。':
    tr.blocked?'这里走不通。位置没有改变，但撞到障碍也会付出 −1 的代价。':
    `向${ACTIONS[a].name}移动一步，奖励 −0.2。暂时远离目的地，也可能是绕过隔断的必要选择。`;
  if(!$('#manual-grid').classList.contains('is-dragging')||tr.blocked||tr.terminal)$('#manual-message').textContent=message;
  renderManual();
  return tr;
}
$$('[data-move]').forEach(b=>b.addEventListener('click',()=>{manualDrag?.cancel();moveManual(Number(b.dataset.move))}));
$('#manual-grid').tabIndex=0;
$('#manual-grid').addEventListener('keydown',e=>{const a={ArrowUp:0,ArrowRight:1,ArrowDown:2,ArrowLeft:3}[e.key];if(a!==undefined){e.preventDefault();manualDrag?.cancel();moveManual(a)}});
$('#manual-reset').addEventListener('click',()=>{manualDrag?.cancel();manualState=START;manualSteps=0;manualReward=0;manualDone=false;manualVisited=new Set([START]);$('#manual-message').textContent='重新出发。按住机器人拖动，或点方向键，先寻找地图外侧的缺口。';renderManual()});
renderManual();
manualDrag=attachRobotDrag($('#manual-grid'),{
  getState:()=>manualState,
  getDone:()=>manualDone,
  move:moveManual,
  size:GRID_SIZE,
  announce:({type,reason})=>{
    if(manualDone)return;
    if(type==='start'){
      dragWasBlocked=false;
      $('#manual-message').textContent='已抓住机器人。沿着想走的格子拖动，松手就停；灌木和泥潭仍按原规则结算。';
    }else if(type==='blocked'){
      dragWasBlocked=true;
      $('#manual-message').textContent='碰到灌木或边界，奖励 −1，机器人停在原地。把手指或鼠标移回机器人所在格，再换方向。';
    }else if(type==='end'&&!dragWasBlocked){
      $('#manual-message').textContent=`已松手，机器人停在${stateLabel(manualState)}。目前走了 ${manualSteps} 步，累计奖励 ${fmt(manualReward,1)}；可以继续拖动或点方向按钮。`;
    }else if(type==='cancel'&&reason!=='external'){
      $('#manual-message').textContent='拖动已暂停，机器人留在当前格。重新按住它即可继续，方向按钮也能使用。';
    }
  }
});
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{manualDrag.cancel();positionManualRobot()}).observe($('#manual-grid'));

const concepts={
  state:'<strong>状态 s：足够做决定的信息。</strong> 在这座固定的花园里，状态就是“当前位置”。地图和规则不变，只看这个位置，就能判断下一步的结果。现实中的状态也可能包含速度、电量或观测历史。',
  action:'<strong>动作 a：你能作出的选择。</strong> 本例有上、右、下、左四种动作。动作本身不等于成功移动：撞到边界或灌木时，机器人会留在原地。',
  reward:'<strong>奖励 r：环境对一次转移的即时反馈。</strong> 走一步 −0.2、送达 +10。奖励是一个数，不是正确路线；机器人要学会怎样组合很多步，让长期结果更好。',
  policy:'<strong>策略 π：在不同状态下怎样选动作。</strong> 它可以是一条确定规则，也可以是动作的概率分布。π(a|s) 的意思是“在状态 s，选择动作 a 的概率”。学习的目标，是改善这套选择规则。'
};
function setConcept(key){$$('[data-concept]').forEach(b=>{const active=b.dataset.concept===key;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});$('#concept-detail').innerHTML=concepts[key]}
$$('[data-concept]').forEach(b=>b.addEventListener('click',()=>setConcept(b.dataset.concept)));setConcept('state');

const symbol=(s,t)=>`<span><b>${s}</b>${t}</span>`;
const slider=(id,label,value,min,max,step)=>`<div class="slider-group"><label for="${id}">${label}<output id="${id}-out">${fmt(value)}</output></label><input type="range" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}"></div>`;
const mathIntro=(n,h,p)=>`<div class="math-intro"><span class="math-index">${n}</span><div><h3>${h}</h3><p>${p}</p></div></div>`;
let currentMath='return';
function renderMath(key){
  currentMath=key;
  $$('[data-math]').forEach(b=>{const on=b.dataset.math===key;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});
  const panel=$('#math-panel'); panel.setAttribute('aria-labelledby',`tab-${key}`);
  if(key==='return'){
    panel.innerHTML=mathIntro('01','别只问这一步得几分。','要问：从现在开始，这一串选择最终有多划算？长期回报把未来的奖励加在一起。')+
    `<div class="math-equation" role="math" aria-label="G t 等于从 k等于0到T减t减1，对gamma的k次方乘r t加k加1求和"><i>G<sub>t</sub></i> = <span class="term-orange">r<sub>t+1</sub></span> + <span class="term">γ</span>r<sub>t+2</sub> + <span class="term">γ<sup>2</sup></span>r<sub>t+3</sub> + ···<small>即 G<sub>t</sub> = ∑<sub>k=0</sub><sup>T−t−1</sup> γ<sup>k</sup> r<sub>t+k+1</sub>；T 是这一轮结束的时刻</small></div>`+
    `<div class="symbols">${symbol('G','从当前开始的回报')}${symbol('t','当前时刻')}${symbol('r','每一步得到的奖励')}${symbol('γ','折扣因子（gamma）')}${symbol('∑','把各项加起来')}</div>`+
    `<div class="math-workbench"><div><h4>同一张地图：绕行 26 步，最后一步送达</h4>${slider('return-gamma','未来有多重要？ γ',.9,0,1,.01)}<p>前 25 步各得 −0.2，第 26 步得到 +10。两个点只相隔两格，安全路线却要绕 26 步；不能把几何距离当成通行距离。</p></div><div class="calculation"><span class="small-label">把整条安全路线的奖励加起来</span><div id="return-line" class="calc-line"></div><div id="return-result" class="calc-result"></div><div id="return-description" class="calc-description"></div></div></div><p class="value-note">成功路线的未折扣累计奖励是 +5；γ=0.9 时折扣回报约 −1.14。负回报不等于任务失败：它仍高于直接掉进眼前泥潭的 −5。算法比较不同选择的长期结果。</p>`;
    const update=()=>{const g=Number($('#return-gamma').value),stepSum=Array.from({length:25},(_,k)=>g**k).reduce((a,b)=>a+b,0);$('#return-gamma-out').textContent=fmt(g);$('#return-line').textContent=`−0.2 × (1 + γ + ··· + γ²⁴) + 10 × γ²⁵`;
      $('#return-result').textContent=`G = ${fmt(-.2*stepSum+10*g**25)}`;$('#return-description').textContent=g===0?'γ = 0：只看第一步的 −0.2。远处的 +10 无法影响现在的选择。':g===1?'γ = 1：不打折，25 × (−0.2) + 10 = 5.00。':'绕路要先付出成本，再得到奖励。γ 决定远处 +10 的分量；它不是送达概率。'};
    $('#return-gamma').addEventListener('input',update);update();
  }else if(key==='value'){
    panel.innerHTML=mathIntro('02','“我在这里，长期会怎么样？”','价值是对未来回报的期望。把长远问题拆成“下一步奖励 + 后面还值多少”，就是 Bellman 的核心想法。')+
    `<div class="math-equation" role="math" aria-label="V pi s 等于遵循策略pi时从s开始的回报期望，等于下一步奖励加gamma乘下一状态价值的期望"><i>V<sup>π</sup>(s)</i> = 𝔼<sub>π</sub>[G<sub>t</sub> | S<sub>t</sub> = s]<br><span style="font-size:.82em">= 𝔼<sub>π</sub>[<span class="term-orange">r<sub>t+1</sub></span> + <span class="term">γV<sup>π</sup>(S<sub>t+1</sub>)</span> | S<sub>t</sub> = s]</span></div>`+
    `<div class="symbols">${symbol('V<sup>π</sup>','遵循策略 π 时的位置价值')}${symbol('𝔼','多次可能结果的概率加权平均')}${symbol('|','在给定条件下')}${symbol('S','表示可能变化的状态')}</div>`+
    `<div class="math-workbench"><div><h4>用一个确定的下一步来理解</h4>${slider('value-next','下一位置估计的价值 Vπ(s′)',6,0,10,.5)}<p>假设当前策略在这里总是选择同一个动作，正常走一步得到 −0.2；γ 固定为 0.9。价值会沿着走过的路逐步传回来。</p></div><div class="calculation"><span class="small-label">一步分解 · 假设下一步是确定的</span><div class="calc-line" id="value-line"></div><div class="calc-result" id="value-result"></div><div class="calc-description">若策略或环境有随机性，就要对可能的动作和下一状态求期望。</div></div></div><p class="value-note">V 给“状态”打分；Q<sup>π</sup>(s,a) 则给“在状态 s 先做动作 a，再遵循 π”打分。Q* 表示最优动作价值；下一页的 max 对应学习最优行为。</p>`;
    const update=()=>{const v=Number($('#value-next').value);$('#value-next-out').textContent=fmt(v);$('#value-line').textContent=`−0.2 + 0.90 × ${fmt(v)}`;$('#value-result').textContent=`一步估计 = ${fmt(-.2+.9*v)}`};$('#value-next').addEventListener('input',update);update();
  }else if(key==='q'){
    panel.innerHTML=mathIntro('03','旧判断，向新经验靠近一点。','Q 表记录每个位置、每个动作的评分。一次体验后，用“实际奖励 + 下一位置的最好评分”修正旧判断。')+
    `<div class="math-equation" role="math" aria-label="Q s a 更新为旧Q加alpha乘以r加gamma乘max Q下一状态动作减旧Q"><i>Q(s,a)</i> ← Q(s,a) + <span class="term-orange">α</span>[<span class="term">r + γ max<sub>a′</sub> Q(s′,a′)</span> − Q(s,a)]<small>绿色部分是学习目标；整个方括号是“学习目标 − 旧估计”，即时间差分（TD）误差</small></div>`+
    `<div class="symbols">${symbol('α','学习率（alpha）')}${symbol('s′','动作之后的新状态')}${symbol('max','取所有下一动作评分的最大值')}${symbol('←','用右边的数更新左边')}</div>`+
    `<div class="math-workbench"><div><h4>固定旧 Q = 2，γ = 0.9，下一步最高 Q = 6</h4>${slider('q-alpha','相信新经验的幅度 α',.5,0,1,.05)}<label class="switch-label"><input type="checkbox" id="q-terminal"> 这一步已经送达（r = +10）</label><p>未勾选时，假设本次撞到障碍：r = −1。勾选后这一轮结束，后续价值必须设为 0。</p></div><div class="calculation"><span class="small-label">这次更新是怎么算出来的？</span><div class="calc-line" id="q-target"></div><div class="calc-line" id="q-line"></div><div class="calc-result" id="q-result"></div><div class="calc-description" id="q-description"></div></div></div>`;
    const update=()=>{const a=Number($('#q-alpha').value),end=$('#q-terminal').checked,target=end?10:-1+.9*6;$('#q-alpha-out').textContent=fmt(a);$('#q-target').textContent=end?'目标 = 10 + 0.9 × 0 = 10':'目标 = −1 + 0.9 × 6 = 4.4';$('#q-line').textContent=`2 + ${fmt(a)} × (${fmt(target,1)} − 2)`;$('#q-result').textContent=`新 Q = ${fmt(2+a*(target-2))}`;$('#q-description').textContent=end?'送达或掉坑是终止状态。没有后续回报，不能再把下一格的 Q 值加进来。':'α = 0 完全不更新；α = 1 直接采用本次目标。撞墙留在原地，6 来自同一格的其他动作；更新后的评分仍低于 6，因此撞墙不会变成这里的最好选择。'};
    $('#q-alpha').addEventListener('input',update);$('#q-terminal').addEventListener('change',update);update();
  }else{
    panel.innerHTML=mathIntro('04','走熟悉的路，还是试试新方向？','只走眼下评分最高的路，可能永远发现不了更好的选择。ε-greedy 用一小部分尝试来换取新信息。')+
    `<div class="math-equation" role="math" aria-label="唯一最优动作的概率是1减epsilon加epsilon除4，其他动作概率epsilon除4"><i>π(a|s)</i> = <span class="term">1 − ε + ε/4</span><small>唯一最优动作的概率；其余每个动作的概率是 ε/4</small></div>`+
    `<div class="symbols">${symbol('ε','探索率（epsilon）')}${symbol('π(a|s)','在位置 s 选动作 a 的概率')}${symbol('4','本例一共有四个动作')}</div>`+
    `<div class="math-workbench"><div><h4>假设“向上”是唯一评分最高的动作</h4>${slider('explore-epsilon','有多少时候随机试试？ ε',.2,0,1,.05)}<p>以 1−ε 的概率利用当前最好选择；以 ε 的概率在四个动作里均匀随机抽一个。随机时也可能抽中“最好动作”。</p></div><div class="calculation"><span class="small-label">四个方向实际被选择的概率</span><div class="calc-result" id="explore-result"></div><div id="prob-bars" class="prob-bars"></div><div class="calc-description" id="explore-description"></div></div></div><p class="value-note">因此 ε=0.2 时，最优动作被选的概率是 85%，不是 80%。若多个动作并列最高，本实验训练时在它们之间均匀选择；配送演示按固定方向顺序打破平局；ε=0 也可能因并列而随机。</p>`;
    const update=()=>{const e=Number($('#explore-epsilon').value),best=1-e+e/4,other=e/4;$('#explore-epsilon-out').textContent=fmt(e);$('#explore-result').textContent=`↑ ${fmt(best*100,1)}%`;
      $('#prob-bars').innerHTML=[best,other,other,other].map((p,i)=>`<span style="width:${p*100}%" title="${arrows[i]} ${(p*100).toFixed(1)}%">${p>.08?arrows[i]:''}</span>`).join('');$('#explore-description').textContent=`↑ ${(best*100).toFixed(1)}% · → ↓ ← 各 ${(other*100).toFixed(1)}%。${e===1?'完全随机，不利用评分。':e===0?'总选当前唯一最好动作，不主动探索。':'探索帮助发现新路线，也会使已经学会的机器人偶尔走错。'}`};$('#explore-epsilon').addEventListener('input',update);update();
  }
}
$$('[data-math]').forEach(b=>{b.addEventListener('click',()=>renderMath(b.dataset.math));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=$$('[data-math]'),idx=tabs.indexOf(b);const next=e.key==='Home'?0:e.key==='End'?3:(idx+(e.key==='ArrowRight'?1:3))%4;renderMath(tabs[next].dataset.math);tabs[next].focus()})});renderMath('return');

// Learning is real tabular Q-learning. Animation only renders greedy evaluation.
const agent=createAgent(42);
const TRAIN_BATCH=500;
let recentSuccess=[],selectedState=START,labPosition=START,labVisited=new Set(),busy=false,animationTimer=null;
const options=()=>({alpha:Number($('#alpha').value),gamma:Number($('#lab-gamma').value),epsilon:Number($('#epsilon').value)});
function drawLab(){renderGrid('#lab-grid',labPosition,{interactive:true,policy:$('#show-policy').checked,agent,visited:labVisited,selected:selectedState});drawInspector()}
function drawInspector(){
  const row=agent.q[selectedState],best=Math.max(...row),terminal=HAZARDS.includes(selectedState)||selectedState===GOAL;
  $('#q-inspector').innerHTML=`<span>${stateLabel(selectedState)}${terminal?'<br>终止格，不再决策':''}<br>动作价值 Q</span>`+row.map((q,i)=>`<div class="q-value ${!terminal&&best===q&&q!==0?'best':''}"><small>${arrows[i]} ${ACTIONS[i].name}</small>${fmt(q)}</div>`).join('');
}
$('#lab-grid').addEventListener('click',e=>{const b=e.target.closest('[data-state]');if(b){selectedState=Number(b.dataset.state);drawLab()}});
$('#show-policy').addEventListener('change',drawLab);
['epsilon','alpha','lab-gamma'].forEach(id=>$('#'+id).addEventListener('input',()=>{$('#'+id+'-out').textContent=fmt(Number($('#'+id).value));if(agent.episodes)$('#lab-feedback').textContent='参数已调整。旧经验仍在，接下来训练会使用新参数；需要公平比较时先清空经验。'}));
function setBusy(on){busy=on;$('#train-btn').disabled=on;$('#watch-btn').disabled=on;['epsilon','alpha','lab-gamma'].forEach(id=>$('#'+id).disabled=on)}
function stats(){
  $('#episodes').textContent=agent.episodes.toLocaleString();
  $('#success-rate').textContent=recentSuccess.length?Math.round(recentSuccess.reduce((a,b)=>a+b,0)/recentSuccess.length*100)+'%':'—';drawChart();
}
function drawChart(){
  const svg=$('#learning-chart'),w=900,h=180,pad={l:38,r:13,t:16,b:23},n=agent.returns.length;
  const points=[];for(let i=0;i<n;i+=10){const group=agent.returns.slice(i,i+10);points.push({x:i+group.length,y:group.reduce((a,b)=>a+b,0)/group.length})}
  const ymin=Math.min(-10,...points.map(p=>p.y)),ymax=10,xmax=Math.max(100,n),x=v=>pad.l+v/xmax*(w-pad.l-pad.r),y=v=>pad.t+(ymax-v)/(ymax-ymin)*(h-pad.t-pad.b);
  let content='';
  [ymax,0,ymin].forEach(v=>{content+=`<line x1="${pad.l}" y1="${y(v)}" x2="${w-pad.r}" y2="${y(v)}" stroke="#52664b" stroke-width=".7" stroke-dasharray="3 5"/><text x="${pad.l-9}" y="${y(v)+3}" text-anchor="end" fill="#97ac84" font-size="10">${v.toFixed(0)}</text>`});
  [0,xmax/2,xmax].forEach(v=>content+=`<text x="${x(v)}" y="${h-4}" text-anchor="middle" fill="#97ac84" font-size="10">${v}</text>`);
  if(points.length){const d=points.map((p,i)=>`${i?'L':'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(' ');content+=`<path d="${d}" fill="none" stroke="#dfbd8c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;const last=points.at(-1);content+=`<circle cx="${x(last.x)}" cy="${y(last.y)}" r="3" fill="#ebcf9e"/>`;$('#chart-summary').textContent=`最近 10 回合平均奖励 ${fmt(last.y,1)} · 训练期间包含探索`;
    svg.setAttribute('aria-label',`学习曲线，已训练${n}回合，第一组平均回报${fmt(points[0].y,1)}，最近一组${fmt(last.y,1)}`);
  }else{$('#chart-summary').textContent='还没有经验。点击“训练 500 回合”观察。';svg.setAttribute('aria-label','训练回报曲线，尚未训练')}
  svg.innerHTML=content;
}
$('#train-btn').addEventListener('click',()=>{
  if(busy)return;setBusy(true);const opts=options();let count=0;labVisited=new Set();labPosition=START;$('#train-btn').textContent='正在积累经验…';
  const batch=()=>{for(let i=0;i<20;i++){const r=trainEpisode(agent,opts);recentSuccess.push(Number(r.success));recentSuccess=recentSuccess.slice(-50);count++}stats();drawLab();
    if(count<TRAIN_BATCH){animationTimer=setTimeout(batch,35)}else{setBusy(false);animationTimer=null;$('#train-btn').innerHTML='再训练 500 回合 <span>↗</span>';const result=greedyPath(agent);$('#lab-feedback').textContent=result.success?`已训练 ${agent.episodes} 回合。机器人学会绕行，用 ${result.steps} 步送达，累计奖励 ${fmt(result.reward,1)}。注意它怎样先远离终点，再从外侧绕回来。`:`已训练 ${agent.episodes} 回合。当前贪心路线还没能送达。再训练几轮，或调整参数后重新比较；低 γ 可能让它看不到远处奖励。`}
  };animationTimer=setTimeout(batch,30);
});
$('#watch-btn').addEventListener('click',()=>{
  if(busy)return;
  if(!agent.episodes){$('#lab-feedback').textContent='Q 表还是全零，当前没有学到任何评分。请先训练 500 回合，再看它如何绕路。';return}
  const path=greedyPath(agent,START,120),loopAt=path.states.findIndex((s,index)=>path.states.indexOf(s)!==index),previewSteps=loopAt>=0?loopAt:path.steps;let i=0;labPosition=START;labVisited=new Set([START]);setBusy(true);$('#lab-feedback').textContent='正在按当前评分最高的动作绕行，本次不进行探索，也不更新 Q 表。';drawLab();
  const tick=()=>{i++;labPosition=path.states[i];labVisited.add(labPosition);selectedState=labPosition;drawLab();
    if(i<previewSteps){animationTimer=setTimeout(tick,window.matchMedia('(prefers-reduced-motion: reduce)').matches?35:180)}else{setBusy(false);animationTimer=null;$('#lab-feedback').textContent=path.success?`绕行送达！${path.steps} 步，累计奖励 ${fmt(path.reward,1)}。两格之隔，需要先离开终点附近，再绕一大圈回来。`:path.terminal?'当前策略掉进了泥潭。增加经验可能帮助它修正评分。':loopAt>=0?'演示已停止：当前策略陷入了循环。继续训练，成功的奖励需要沿着长路线逐步传回来。':'演示在 120 步后停止：当前评分还没有产生一条成功路线。'}
  };animationTimer=setTimeout(tick,220);
});
$('#reset-agent').addEventListener('click',()=>{if(animationTimer)clearTimeout(animationTimer);animationTimer=null;resetAgent(agent);recentSuccess=[];labPosition=START;labVisited=new Set();selectedState=START;setBusy(false);$('#train-btn').innerHTML='训练 500 回合 <span>↗</span>';$('#lab-feedback').textContent='经验已清空，Q 表重新变为零。随机种子也已重置，可以比较不同参数的表现。';stats();drawLab()});
stats();drawLab();

function renderHistory(era='all'){
  const items=history.filter(h=>era==='all'||(era==='foundation'?h.numericYear<2010:era==='deep'?h.numericYear>=2010&&h.numericYear<2020:h.numericYear>=2020));
  $('#timeline').innerHTML=items.map(h=>`<article class="timeline-item"><div class="timeline-year">${h.year}</div><h3>${h.title}</h3><div class="timeline-subtitle">${h.subtitle}</div><details><summary>展开这一刻</summary><p>${h.body}</p><p><b>带来了什么：</b>${h.achievement}</p><p><b>如何理解边界：</b>${h.limitation}</p><a href="${h.url}" target="_blank" rel="noopener">原始来源：${h.source} ↗</a>${(h.references||[]).map(r=>`<a href="${r.url}" target="_blank" rel="noopener">${r.title} ↗</a>`).join('')}</details></article>`).join('');
  $$('[data-era]').forEach(b=>{const on=b.dataset.era===era;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
}
$$('[data-era]').forEach(b=>b.addEventListener('click',()=>renderHistory(b.dataset.era)));renderHistory();

const quiz=[
  {q:'01 / 终点就在右边，机器人为什么反而先向左绕行？',options:['它应该只按离终点的距离选动作。','右边的近路是泥潭，先远离才能找到安全路线。'],answer:1,explain:'几何距离没有考虑灌木与泥潭。绕路的即时成本，能够换来之后送达的奖励；Q 值比较的是长期结果。'},
  {q:'02 / 一步已经送达终点，Q-learning 的目标该怎么算？',options:['只用本次奖励，后续价值为 0。','再加上终点格子里最高的 Q 值。'],answer:0,explain:'这一轮已经结束，没有接下来的动作和奖励，所以目标就是这次送达奖励 +10。'},
  {q:'03 / ε = 0.2，四个动作中只有一个最优。最优动作被选中的概率是多少？',options:['80%，因为剩下 20% 都会走别的路。','85%，随机探索也可能选中最优动作。'],answer:1,explain:'利用部分给它 80%，探索部分再给它 20% ÷ 4 = 5%，总共 85%。'}
];
let qi=0,score=0,answered=false;
function drawQuiz(){answered=false;$('#quiz-question').textContent=quiz[qi].q;$('#quiz-options').innerHTML=quiz[qi].options.map((o,i)=>`<button data-answer="${i}">${String.fromCharCode(65+i)}. ${o}</button>`).join('');$('#quiz-feedback').textContent='选择一个答案，看看你是否已经掌握。';$('#quiz-next').hidden=true}
$('#quiz-options').addEventListener('click',e=>{const b=e.target.closest('[data-answer]');if(!b||answered)return;answered=true;const choice=Number(b.dataset.answer),correct=choice===quiz[qi].answer;if(correct)score++;
  $$('[data-answer]').forEach(x=>{x.disabled=true;x.classList.toggle('correct',Number(x.dataset.answer)===quiz[qi].answer);x.classList.toggle('incorrect',x===b&&!correct)});
  $('#quiz-feedback').textContent=(correct?'答对了。':'再想一步。')+quiz[qi].explain+(qi===2?` 你答对了 ${score}/3 题。可以随时回到公式或实验室再试。`:'');$('#quiz-next').textContent=qi===2?'再测一次 ↻':'下一题 →';$('#quiz-next').hidden=false;
});
$('#quiz-next').addEventListener('click',()=>{qi=(qi+1)%3;if(qi===0)score=0;drawQuiz()});drawQuiz();

$('#menu-toggle').addEventListener('click',()=>{const on=$('.sidebar').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String(on));$('#menu-toggle').textContent=on?'关闭 ×':'目录 ☰'});
$$('.sidebar nav a').forEach(a=>a.addEventListener('click',()=>{$('.sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').textContent='目录 ☰'}));
const chapters=$$('.chapter');
let scrollQueued=false;
function updateProgress(){
  const position=window.scrollY+window.innerHeight*.25;let active=chapters[0].id;chapters.forEach(c=>{if(c.offsetTop<=position)active=c.id});
  $$('.sidebar nav a').forEach(a=>{const on=a.hash==='#'+active;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')});
  const total=document.documentElement.scrollHeight-window.innerHeight,progress=total>0?Math.min(100,window.scrollY/total*100):100;
  $('#reading-progress').style.width=progress+'%';$('#progress-label').textContent=progress<1?'准备出发':`阅读进度 ${Math.round(progress)}%`;scrollQueued=false;
}
window.addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateProgress)}},{passive:true});window.addEventListener('resize',updateProgress);updateProgress();
