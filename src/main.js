import { Game } from './game.js';
import { initUI } from './ui/ui.js';
import { loadModels } from './vehicle/model.js';

(async () => {
    try { await loadModels(); } catch (e) { console.error('모델 로드 실패, 기본 모델로 대체합니다', e); }
    const game = new Game();
    initUI(game);
    if (location.hash === '#debug') window.sodium = game; // 개발용: 콘솔에서 게임 상태 확인
    document.getElementById('loading').remove();
})();
