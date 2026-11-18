import { Game } from './game.js';
import { initUI } from './ui/ui.js';
import { loadModels } from './vehicle/model.js';

(async () => {
  try { await loadModels(); } catch (e) { console.error('모델 로드 실패, 기본 모델로 대체합니다', e); }
  initUI(new Game());
  document.getElementById('loading').remove();
})();
