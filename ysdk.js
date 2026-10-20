/**
 * Обёртка над SDK Яндекс Игр.
 *
 * Локально (file:// или localhost) настоящий SDK не грузится — платформа отдаёт его
 * только со своего домена. Поэтому здесь есть заглушка: она логирует вызовы и
 * мгновенно "показывает" рекламу, чтобы игровой цикл можно было отлаживать не деплоя.
 */

const IS_LOCAL = location.protocol === 'file:' || /localhost|127\.0\.0\.1/.test(location.hostname);

// ?adsilent — заглушка вообще не отвечает на рекламные вызовы. Так проверяется
// главный сценарий сбоя на платформе: реклама молчит, а игра обязана продолжиться.
const AD_SILENT = /[?&]adsilent\b/.test(location.search);

const stub = {
  adv: {
    showFullscreenAdv({ onOpen, onClose } = {}) {
      console.log('[ysdk-stub] fullscreen adv', AD_SILENT ? '(молчит)' : '');
      if (AD_SILENT) return;
      setTimeout(() => {
        onOpen && onOpen();
        setTimeout(() => onClose && onClose(true), 200);
      }, 100);
    },
    showRewardedVideo({ onOpen, onRewarded, onClose } = {}) {
      console.log('[ysdk-stub] rewarded video', AD_SILENT ? '(молчит)' : '');
      if (AD_SILENT) return;
      setTimeout(() => {
        onOpen && onOpen();
        onRewarded && onRewarded();
        setTimeout(() => onClose && onClose(true), 200);
      }, 100);
    },
  },
  features: {},
};

let ysdk = stub;

export async function initSdk() {
  if (IS_LOCAL || typeof YaGames === 'undefined') {
    console.warn('[ysdk] заглушка: реальный SDK доступен только на домене Яндекс Игр');
    window.__sdkStatus = IS_LOCAL ? 'stub(local)' : 'stub(YaGames не найден)';
    return ysdk;
  }
  try {
    ysdk = await YaGames.init();
    window.__sdkStatus = 'real';
    console.log('[ysdk] init ok');
  } catch (e) {
    // Откат на заглушку оставляет игру играбельной, но платформа не получит
    // сигнал о запуске — поэтому ошибка должна быть громкой.
    console.error('[ysdk] init failed, откат на заглушку — сигнал о запуске не уйдёт', e);
    window.__sdkStatus = 'init failed: ' + (e && e.message);
    ysdk = stub;
  }
  return ysdk;
}

/**
 * Игра отрисована и готова к вводу.
 * Без этого вызова платформа считает, что игра ни разу не запускалась,
 * и не выпускает её в каталог.
 */
export function loadingReady() {
  const api = ysdk.features?.LoadingAPI;
  if (!api?.ready) {
    console.warn('[ysdk] LoadingAPI недоступен — сигнал о запуске не отправлен');
    return;
  }
  api.ready();
  console.log('[ysdk] LoadingAPI.ready() отправлен');
}

/** Начался/возобновился геймплей: старт уровня, закрытие меню, возврат из рекламы. */
export function gameplayStart() {
  ysdk.features?.GameplayAPI?.start();
}

/** Геймплей прервался: гибель, меню, пауза, показ рекламы. */
export function gameplayStop() {
  ysdk.features?.GameplayAPI?.stop();
}

// Сколько ждём, что реклама вообще откроется. Не открылась — значит платформа
// её показывать не будет (срезала по частоте, нет заполнения, превью черновика).
const AD_OPEN_TIMEOUT = 3000;
// Предохранитель на случай, если ролик открылся, но onClose так и не пришёл.
const AD_CLOSE_TIMEOUT = 90000;

/**
 * Общая обвязка над рекламными вызовами.
 *
 * Главное правило: геймплей НИКОГДА не ждёт рекламу бесконечно. Если платформа
 * не ответила, игра продолжается без неё. Обратное означает, что при любом сбое
 * рекламы игрок упирается в мёртвую кнопку — что и происходило в черновике.
 */
function runAd(label, invoke) {
  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let closeTimer = null;

    const finish = (rewarded, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      gameplayStart();
      console.log(`[ysdk] ${label}: завершено (${why}), награда: ${rewarded}`);
      resolve(rewarded);
    };

    const openTimer = setTimeout(() => {
      if (!opened) finish(false, 'реклама не открылась');
    }, AD_OPEN_TIMEOUT);

    const onOpen = () => {
      opened = true;
      clearTimeout(openTimer);
      console.log(`[ysdk] ${label}: onOpen`);
      closeTimer = setTimeout(() => finish(false, 'onClose не пришёл'), AD_CLOSE_TIMEOUT);
    };

    gameplayStop();
    try {
      invoke({ onOpen, finish, isOpened: () => opened });
    } catch (e) {
      console.error(`[ysdk] ${label}: вызов упал`, e);
      finish(false, 'исключение при вызове');
    }
  });
}

/**
 * Полноэкранная реклама. Частоту показа регулирует сама платформа,
 * поэтому дёргать можно на каждом проигрыше — лишнего не покажет.
 */
export function showFullscreen() {
  return runAd('fullscreen', ({ onOpen, finish }) => {
    ysdk.adv.showFullscreenAdv({
      onOpen,
      onClose: (wasShown) => finish(false, `onClose, показана: ${wasShown}`),
      onError: (e) => {
        console.warn('[ysdk] fullscreen error', e);
        finish(false, 'onError');
      },
    });
  });
}

/**
 * Реклама за награду. Частота не ограничена платформой.
 * Резолвится в true только если onRewarded действительно сработал.
 */
export function showRewarded() {
  return runAd('rewarded', ({ onOpen, finish }) => {
    let rewarded = false;
    ysdk.adv.showRewardedVideo({
      onOpen,
      onRewarded: () => {
        console.log('[ysdk] rewarded: onRewarded');
        rewarded = true;
        // Награда засчитана — дальше ждём закрытия лишь короткую паузу.
        // Порядок onRewarded/onClose у платформы не гарантирован.
        setTimeout(() => finish(true, 'после onRewarded'), 1200);
      },
      onClose: () => finish(rewarded, 'onClose'),
      onError: (e) => {
        console.warn('[ysdk] rewarded error', e);
        finish(rewarded, 'onError');
      },
    });
  });
}
