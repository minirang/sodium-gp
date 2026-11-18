export const LAPS = 3;
export const CARS = [
    { id: 'vx', name: 'VX 쿠페', desc: '균형 잡힌 후륜 쿠페', mass: 1150, power: 1.0, top: 68, grip: 2.5, color: '#e5483a' },
    { id: 'rs', name: 'RS 하이퍼', desc: '가볍고 빠른 고속형', mass: 1000, power: 1.12, top: 76, grip: 2.7, color: '#2fb6e8' },
    { id: 'gt', name: 'GT 머슬', desc: '무겁지만 토크가 강력', mass: 1400, power: 1.22, top: 71, grip: 2.3, color: '#f2b632' },
];
export const COLORS = ['#e5483a', '#2fb6e8', '#f2b632', '#eef1f7', '#1d1f26', '#7bd16a', '#a06bff'];
export const RIM_COLORS = ['#d9dde6', '#ffb454', '#14161c', '#e5483a', '#3fd0c9'];
export const WHEEL_SIZES = [0.33, 0.36, 0.39];
export const SPOKES = [5, 6, 10];
export const AI_LEVELS = [{ name: '쉬움', skill: 0.72 }, { name: '보통', skill: 0.86 }, { name: '어려움', skill: 0.98 }];
export const QUALITY = [
    { pr: 0.7, shadow: 0, fog: 260 },
    { pr: 1, shadow: 1024, fog: 420 },
    { pr: 1.5, shadow: 2048, fog: 650 },
    { pr: 2, shadow: 4096, fog: 900 },
];
export const TRACKS = [
    {
        id: 'downtown', name: '다운타운 서킷', desc: '빌딩 숲을 가르는 빠른 시가지 코스', seed: 7, scale: 1.3, buildings: 170,
        pts: [[0, -200], [150, -180], [250, -60], [200, 80], [80, 150], [-60, 100], [-150, 170], [-260, 60], [-220, -90], [-100, -160]]
    },
    {
        id: 'riverside', name: '리버사이드 스프린트', desc: '넓은 곡선이 이어지는 강변 코스', seed: 21, scale: 1.1, buildings: 150,
        pts: [[0, -260], [210, -250], [330, -110], [260, 30], [340, 170], [160, 280], [-40, 220], [-110, 90], [-300, 130], [-360, -70], [-210, -230]]
    },
];
export const DEFAULTS = { quality: 2, master: 0.8, engine: 0.7, fov: 70, cam: 'chase', shift: 'auto', steer: 1, mouse: false, touch: 'auto', units: 'kmh', map: true };
export const SCHEMA = [
    { k: 'quality', t: 'sel', l: '3D 품질', o: [[0, '낮음'], [1, '보통'], [2, '높음'], [3, '최고']] },
    { k: 'master', t: 'range', l: '전체 볼륨', min: 0, max: 1, step: 0.05 },
    { k: 'engine', t: 'range', l: '엔진 사운드', min: 0, max: 1, step: 0.05 },
    { k: 'fov', t: 'range', l: '시야각(FOV)', min: 55, max: 100, step: 1 },
    { k: 'cam', t: 'sel', l: '기본 시점', o: [['chase', '3인칭'], ['cockpit', '1인칭']] },
    { k: 'shift', t: 'sel', l: '기어 모드', o: [['auto', '자동'], ['manual', '수동 (E/Q)']] },
    { k: 'steer', t: 'range', l: '키보드 조향 민감도', min: 0.5, max: 2, step: 0.1 },
    { k: 'mouse', t: 'chk', l: '마우스 위치로 조향' },
    { k: 'touch', t: 'sel', l: '터치 버튼', o: [['auto', '자동'], ['on', '항상 표시'], ['off', '숨김']] },
    { k: 'units', t: 'sel', l: '속도 단위', o: [['kmh', 'km/h'], ['mph', 'mph']] },
    { k: 'map', t: 'chk', l: '미니맵 표시' },
];
