import { initSdk, loadingReady, gameplayStart, gameplayStop, showFullscreen, showRewarded } from './ysdk.js';
import { dbg } from './debug.js'; // ВРЕМЕННО: диагностика черновика

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Игра живёт в виртуальной системе координат и масштабируется под любой экран.
// Так один код работает и на мобилке, и на десктопе, и на TV — требование платформы.
const W = 400;
const H = 700;

const BLOCK_H = 34;
const BASE_W = 200;
// Сколько этажей помещается над вершиной башни. Управляет композицией кадра:
// вершина встаёт на высоту H - 80 - BLOCK_H*(CAMERA_LEAD-1), то есть при 4
// башня жалась к нижней четверти экрана, а над ней зияло пустое небо.
const CAMERA_LEAD = 8;

const SPEED_START = 2.8;
const SPEED_STEP = 0.1;
const SPEED_MAX = 6; // потолок обязателен: без него блок за кадр перепрыгивает башню
const PERFECT_SNAP = 5; // допуск в пикселях, при котором попадание считается точным

const state = {
  phase: 'menu', // menu | playing | dead
  blocks: [],
  moving: null,
  debris: [], // отвалившиеся куски, чистая косметика
  score: 0,
  best: Number(localStorage.getItem('best') || 0),
  cameraY: 0,
  speed: SPEED_START,
  usedContinue: false,
  paused: false,
  flash: 0, // затухающая вспышка после точного попадания
  flashIndex: -1, // этаж, на котором она сработала
  scorePop: 0, // подскок счёта при засчитанном блоке
};

window.__state = state; // ВРЕМЕННО: чтобы диагностический оверлей видел состояние

function reset() {
  state.blocks = [{ x: (W - BASE_W) / 2, w: BASE_W, hue: 200 }];
  state.debris = [];
  state.score = 0;
  state.cameraY = 0;
  state.speed = SPEED_START;
  state.usedContinue = false;
  state.flash = 0;
  state.flashIndex = -1;
  state.scorePop = 0;
  spawnMoving();
}

/**
 * Кусок, отвалившийся при обрезке. Живёт в координатах этажа, на котором
 * появился, чтобы падать вместе с камерой, а не уплывать от башни.
 */
function addDebris(x, w, hue, index, dir) {
  state.debris.push({
    x, w, hue, index,
    fall: 0,
    vy: -1.5, // короткий подскок вверх перед падением — так отрыв читается лучше
    vx: dir * (0.6 + Math.random() * 0.7),
    rot: 0,
    vrot: dir * (0.03 + Math.random() * 0.03),
    alpha: 1,
  });
}

function spawnMoving() {
  const prev = state.blocks[state.blocks.length - 1];
  const fromLeft = state.blocks.length % 2 === 0;
  state.moving = {
    // Блок стартует у края, а не полностью за экраном: иначе первые доли секунды
    // после спавна любой тап — гарантированный промах, и игрок не понимает почему.
    x: fromLeft ? -prev.w * 0.35 : W - prev.w * 0.65,
    w: prev.w,
    dir: fromLeft ? 1 : -1,
    hue: (200 + state.blocks.length * 9) % 360,
  };
}

/** Обрезает движущийся блок по нависанию над предыдущим. Возвращает false при промахе. */
function drop() {
  const prev = state.blocks[state.blocks.length - 1];
  const m = state.moving;
  const overlapL = Math.max(m.x, prev.x);
  const overlapR = Math.min(m.x + m.w, prev.x + prev.w);
  const overlap = overlapR - overlapL;

  if (overlap <= 0) return false;

  const index = state.blocks.length;

  // Почти точное попадание подтягиваем до идеального и не отрезаем ничего.
  // Иначе башня осыпается по пикселю даже при аккуратной игре и забег быстро глохнет.
  if (Math.abs(m.x - prev.x) <= PERFECT_SNAP) {
    state.blocks.push({ x: prev.x, w: prev.w, hue: m.hue });
    state.flash = 1;
    state.flashIndex = index;
  } else {
    state.blocks.push({ x: overlapL, w: overlap, hue: m.hue });
    // Свисающий хвост — слева или справа, смотря с какой стороны промахнулись.
    if (m.x < overlapL) addDebris(m.x, overlapL - m.x, m.hue, index, -1);
    else addDebris(overlapR, m.x + m.w - overlapR, m.hue, index, 1);
  }

  state.score++;
  state.scorePop = 1;
  state.speed = Math.min(SPEED_MAX, SPEED_START + state.score * SPEED_STEP);
  spawnMoving();
  return true;
}

function die() {
  state.phase = 'dead';
  gameplayStop();
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('best', String(state.best));
  }
  render();
}

/** Возврат в игру после rewarded: восстанавливаем ширину, чтобы шанс был реальным. */
function continueRun() {
  const prev = state.blocks[state.blocks.length - 1];
  const revived = Math.max(prev.w, 90);
  state.blocks.push({ x: (W - revived) / 2, w: revived, hue: prev.hue });
  state.usedContinue = true;
  spawnMoving();
  state.phase = 'playing';
  // Реклама уводит документ в hidden, и visibilitychange может не вернуться
  // после её закрытия. Сверяемся с реальным состоянием, иначе пауза залипает
  // и игра выглядит замершей после просмотра ролика.
  state.paused = document.hidden;
  gameplayStart();
  syncButtons();
  render();
}

function update() {
  if (state.phase !== 'playing' || state.paused) return;

  const m = state.moving;
  m.x += state.speed * m.dir;
  if (m.dir > 0 && m.x > W) m.dir = -1;
  if (m.dir < 0 && m.x + m.w < 0) m.dir = 1;

  const targetCam = Math.max(0, (state.blocks.length - CAMERA_LEAD) * BLOCK_H);
  state.cameraY += (targetCam - state.cameraY) * 0.12;

  state.flash *= 0.93; // ~0.6 c: успеваешь заметить, но она не висит в кадре
  state.scorePop *= 0.86;

  for (const d of state.debris) {
    d.vy += 0.55; // гравитация
    d.fall += d.vy;
    d.x += d.vx;
    d.rot += d.vrot;
    if (d.fall > 220) d.alpha -= 0.06; // растворяем, только когда кусок уже ушёл вниз
  }
  state.debris = state.debris.filter((d) => d.alpha > 0);
}

/** Экранная Y для этажа с номером index, с учётом камеры. */
function floorY(index) {
  return H - 80 - index * BLOCK_H + state.cameraY;
}

// Синтаксис hsl() строго через запятые: платформа заявляет поддержку iOS 9,
// а пробельная форма из CSS Color 4 работает только с Safari 12.1+.
const hsl = (h, s, l) => `hsl(${h.toFixed(0)},${s}%,${l}%)`;

/** Блок с верхней подсветкой и тёмным низом — дешёвый псевдо-объём. */
function paintSlab(x, y, w, hue) {
  ctx.fillStyle = hsl(hue, 62, 54);
  ctx.fillRect(x, y, w, BLOCK_H - 2);
  ctx.fillStyle = hsl(hue, 70, 70);
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = hsl(hue, 55, 40);
  ctx.fillRect(x, y + BLOCK_H - 7, w, 5);
}

function drawBlock(b, index) {
  const y = floorY(index);
  if (y < -BLOCK_H || y > H) return;
  paintSlab(b.x, y, b.w, b.hue);
}

function drawDebris() {
  for (const d of state.debris) {
    const y = floorY(d.index) + d.fall;
    if (y > H + 60) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, d.alpha);
    ctx.translate(d.x + d.w / 2, y + BLOCK_H / 2);
    ctx.rotate(d.rot);
    paintSlab(-d.w / 2, -BLOCK_H / 2, d.w, d.hue);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// Звёзды фиксированы в мире и едут медленнее камеры — получается параллакс.
const STARS = Array.from({ length: 60 }, (_, i) => ({
  x: (i * 977) % W,
  y: (i * 613) % 2400,
  r: 0.6 + ((i * 7) % 10) / 8,
  a: 0.25 + ((i * 13) % 10) / 22,
}));

function drawSky() {
  // Чем выше башня, тем светлее и теплее небо — видимый прогресс без единого ассета.
  const climb = Math.min(1, state.score / 45);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, hsl(228 - climb * 30, Math.round(38 - climb * 12), Math.round(11 + climb * 20)));
  grad.addColorStop(1, hsl(272 - climb * 40, Math.round(33 - climb * 8), Math.round(18 + climb * 22)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#fff';
  for (const s of STARS) {
    const y = (s.y + state.cameraY * 0.35) % 2400;
    if (y > H) continue;
    ctx.globalAlpha = s.a * (1 - climb * 0.55); // на рассвете звёзды гаснут
    ctx.beginPath();
    ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Расходящийся контур вокруг блока, на котором сработало точное попадание.
 * Привязка именно к этому этажу, а не к вершине башни: пока вспышка гаснет,
 * игрок успевает поставить следующие блоки, и рамка переезжала на чужой блок.
 */
function drawFlash() {
  if (state.flash <= 0.02) return;
  const top = state.blocks[state.flashIndex];
  if (!top) return;
  const y = floorY(state.flashIndex);
  const grow = (1 - state.flash) * 22;
  ctx.save();
  ctx.globalAlpha = state.flash; // альфа через globalAlpha, а не через hsl(... / a)
  ctx.strokeStyle = hsl(top.hue, 90, 78);
  ctx.lineWidth = 3;
  ctx.strokeRect(top.x - grow, y - grow, top.w + grow * 2, BLOCK_H - 2 + grow * 2);
  ctx.restore();
}


function render() {
  drawSky();

  state.blocks.forEach(drawBlock);
  drawDebris();
  if (state.phase === 'playing') {
    drawBlock(state.moving, state.blocks.length);
  }
  drawFlash();

  ctx.textAlign = 'center';

  if (state.phase === 'playing') {
    // Счёт подскакивает на каждом уложенном блоке.
    const scale = 1 + state.scorePop * 0.3;
    ctx.save();
    ctx.translate(W / 2, 78);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillText(String(state.score), 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(10,12,22,0.78)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';

    if (state.phase === 'menu') {
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillText('БАШНЯ', W / 2, H / 2 - 40);
      ctx.font = '19px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText('Тап — поставить блок', W / 2, H / 2 + 4);
      ctx.fillText('Рекорд: ' + state.best, W / 2, H / 2 + 34);
    } else {
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText('Этажей: ' + state.score, W / 2, H / 2 - 60);
      ctx.font = '19px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText('Рекорд: ' + state.best, W / 2, H / 2 - 24);
    }
  }

  syncButtons();
}

function loop() {
  update();
  if (state.phase === 'playing') render();
  requestAnimationFrame(loop);
}

// --- Кнопки: настоящий DOM, а не отрисовка на канвасе.
// Модерация часто валит игры за то, что UI не тапается или обрезается на других экранах.
const btnPlay = document.getElementById('btn-play');
const btnRevive = document.getElementById('btn-revive');
const btnRestart = document.getElementById('btn-restart');

function syncButtons() {
  btnPlay.hidden = state.phase !== 'menu';
  btnRevive.hidden = state.phase !== 'dead' || state.usedContinue;
  btnRestart.hidden = state.phase !== 'dead';
}

btnPlay.addEventListener('click', () => {
  dbg('click: играть');
  reset();
  state.phase = 'playing';
  gameplayStart();
  render();
});

btnRevive.addEventListener('click', async () => {
  dbg('click: продолжить');
  btnRevive.disabled = true;
  const ok = await showRewarded();
  dbg('rewarded -> ' + ok);
  btnRevive.disabled = false;
  if (ok) continueRun();
  else render();
});

btnRestart.addEventListener('click', () => {
  dbg('click: заново');
  // Игра перезапускается мгновенно и НЕ ждёт рекламу: полноэкранный блок всё
  // равно перекрывает экран, а когда закроется — игрок увидит новый забег.
  // Ожидание ответа платформы давало паузу в несколько секунд на пустом месте.
  showFullscreen().then(() => dbg('fullscreen завершён'));
  reset();
  state.phase = 'playing';
  state.paused = document.hidden; // как и после rewarded — не даём паузе залипнуть
  gameplayStart();
  render();
});

// Тап по полю ставит блок только во время игры — иначе случайный тап
// по оверлею мгновенно начинал бы новый забег.
// Платформа требует останавливать игру и звук при сворачивании страницы.
// Заодно перерисовываем на возврате: пока вкладка скрыта, rAF заморожен браузером.
document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden;
  if (document.hidden) {
    gameplayStop();
  } else {
    if (state.phase === 'playing') gameplayStart();
    render();
  }
});

function onTap(e) {
  if (state.phase !== 'playing' || state.paused) return;
  e.preventDefault();
  if (!drop()) die();
}
canvas.addEventListener('pointerdown', onTap);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') onTap(e);
});

// Масштабирование под экран с сохранением пропорций.
// Замеряем контейнер, а не window: при старте в скрытой вкладке или в iframe
// window.innerHeight может быть 0, и игра схлопывается в scale(0).
const stage = document.getElementById('stage');

function fit() {
  const availW = stage.clientWidth || window.innerWidth;
  const availH = stage.clientHeight || window.innerHeight;
  const scale = Math.min(availW / W, availH / H);
  const wrap = document.getElementById('wrap');
  wrap.style.width = W + 'px';
  wrap.style.height = H + 'px';
  // Пока размеры не пришли, держим 1 — ResizeObserver пересчитает, как только они появятся.
  wrap.style.transform = `scale(${scale > 0 ? scale : 1})`;
  canvas.width = W;
  canvas.height = H;
  render();
}
new ResizeObserver(fit).observe(stage);
window.addEventListener('orientationchange', fit);

(async function start() {
  await initSdk();
  try {
    reset();
    fit();
  } finally {
    // Сигнал о запуске уходит в любом случае: если он не дойдёт, платформа
    // считает, что игра ни разу не запускалась, и не пускает её в каталог.
    // Ошибку инициализации лучше показать в метриках, чем потерять игру целиком.
    loadingReady();
  }
  loop();
})();
