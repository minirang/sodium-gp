export const LAPS = 3;
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;

// ox: 차체 중심의 전방 오프셋, hx/hz: 충돌 박스 반길이/반폭
export const CARS = [
    { id: 'f458', name: '458 이탈리아', desc: '미드십 V8 · 실차 3D 모델', model: 'ferrari', mass: 1380, power: 1.2, top: 84, grip: 2.7, color: '#d1142a', hx: 2.26, hz: 0.97, ox: 0.2 },
    { id: 'cc', name: '컨셉 GT', desc: '중앙 운전석 미드십 하이퍼카 · 3D 모델', model: 'concept', mass: 1250, power: 1.25, top: 86, grip: 2.7, color: '#d4141c', hx: 2.2, hz: 0.98, ox: 0.15 },
    { id: 'vx', name: 'VX 쿠페', desc: '균형 잡힌 후륜 쿠페', mass: 1150, power: 1.0, top: 68, grip: 2.5, color: '#2fb6e8', hx: 2.15, hz: 0.93, ox: 0 },
    { id: 'gt', name: 'GT 머슬', desc: '무겁지만 토크가 강력', mass: 1400, power: 1.22, top: 71, grip: 2.3, color: '#f2b632', hx: 2.15, hz: 0.93, ox: 0 },
];
export const COLORS = ['#d1142a', '#2fb6e8', '#f2b632', '#eef1f7', '#1d1f26', '#7bd16a', '#a06bff', '#ff7a1a'];
export const RIM_COLORS = ['#d9dde6', '#ffb454', '#14161c', '#e5483a', '#3fd0c9'];
export const WHEEL_SIZES = [0.33, 0.36, 0.39];
export const SPOKES = [5, 6, 10];
export const AI_LEVELS = [{ name: '쉬움', skill: 0.72 }, { name: '보통', skill: 0.86 }, { name: '어려움', skill: 0.98 }];
export const QUALITY = [
    { pr: 0.75, shadow: 0, fog: 300, bloom: 0, msaa: 0, trees: 0.35 },
    { pr: 1, shadow: 1024, fog: 450, bloom: 0, msaa: 0, trees: 0.6 },
    { pr: 1.5, shadow: 2048, fog: 650, bloom: 1, msaa: 4, trees: 1 },
    { pr: 2, shadow: 4096, fog: 900, bloom: 1, msaa: 4, trees: 1 },
];
export const TIMES = {
    dusk: { name: '황혼', top: 0x1a2048, mid: 0x6a4a78, hor: 0xf08a55, fog: 0x7a587a, sun: 0xffa65e, sunI: 2.4, sky: [0x9a9cd8, 0x2c2430, 0.85], dir: [-0.55, 0.28, -0.78], win: 0.75, lamp: 1, stars: 0, head: 380, exp: 1.0 },
    night: { name: '밤', top: 0x03061a, mid: 0x0b1230, hor: 0x1a2148, fog: 0x0d1230, sun: 0x8aa4ff, sunI: 0.6, sky: [0x4a5aa0, 0x080a14, 0.7], dir: [0.3, 0.5, 0.6], win: 1.0, lamp: 1, stars: 1, head: 700, exp: 1.05 },
    day: { name: '낮', top: 0x2f74d0, mid: 0x86bdf0, hor: 0xe6f1ff, fog: 0xbdd5ea, sun: 0xfff0d8, sunI: 3.0, sky: [0xbfd8ff, 0x58604a, 1.05], dir: [-0.45, 0.8, -0.35], win: 0.08, lamp: 0, stars: 0, head: 0, exp: 0.9 },
};
export const TRACKS = [
    {
        id: 'downtown', name: '다운타운 서킷', desc: '빌딩 숲을 가르는 빠른 시가지 코스', seed: 7, scale: 1.3, buildings: 170, trees: 260,
        pts: [[0, -200], [150, -180], [250, -60], [200, 80], [80, 150], [-60, 100], [-150, 170], [-260, 60], [-220, -90], [-100, -160]]
    },
    {
        id: 'riverside', name: '리버사이드 스프린트', desc: '넓은 곡선이 이어지는 강변 코스', seed: 21, scale: 1.1, buildings: 150, trees: 320,
        pts: [[0, -260], [210, -250], [330, -110], [260, 30], [340, 170], [160, 280], [-40, 220], [-110, 90], [-300, 130], [-360, -70], [-210, -230]]
    },
    {
        id: 'harbor', name: '하버 나이트 서킷', desc: '헤어핀과 시케인이 이어지는 기술적인 항구 코스', seed: 33, scale: 1.15, buildings: 160, trees: 200,
        pts: [[0, -220], [160, -230], [300, -150], [330, -10], [260, 90], [290, 200], [180, 290], [40, 250], [-40, 150], [-150, 190], [-280, 120], [-320, -20], [-240, -120], [-130, -90], [-60, -170]]
    },
];
export const DEFAULTS = { quality: coarse ? 1 : 3, master: 0.8, engine: 0.7, fov: 70, cam: 'chase', shift: 'auto', assist: 1, steer: 1, mouse: false, touch: 'auto', units: 'kmh', map: true, time: 'dusk' };
export const SCHEMA = [
    { k: 'quality', t: 'sel', l: '3D 품질', o: [[0, '낮음'], [1, '보통'], [2, '높음'], [3, '최고']] },
    { k: 'time', t: 'sel', l: '시간대', o: [['dusk', '황혼'], ['night', '밤'], ['day', '낮']] },
    { k: 'master', t: 'range', l: '전체 볼륨', min: 0, max: 1, step: 0.05 },
    { k: 'engine', t: 'range', l: '엔진 사운드', min: 0, max: 1, step: 0.05 },
    { k: 'fov', t: 'range', l: '시야각(FOV)', min: 55, max: 100, step: 1 },
    { k: 'cam', t: 'sel', l: '기본 시점', o: [['chase', '3인칭'], ['cockpit', '1인칭']] },
    { k: 'shift', t: 'sel', l: '기어 모드', o: [['auto', '자동'], ['manual', '수동 (E/Q)']] },
    { k: 'assist', t: 'sel', l: '주행 보조', o: [[0, '끔'], [1, '조향 보조'], [2, '조향 + 구동력 제어']] },
    { k: 'steer', t: 'range', l: '키보드 조향 민감도', min: 0.5, max: 2, step: 0.1 },
    { k: 'mouse', t: 'chk', l: '마우스 위치로 조향' },
    { k: 'touch', t: 'sel', l: '터치 버튼', o: [['auto', '자동'], ['on', '항상 표시'], ['off', '숨김']] },
    { k: 'units', t: 'sel', l: '속도 단위', o: [['kmh', 'km/h'], ['mph', 'mph']] },
    { k: 'map', t: 'chk', l: '미니맵 표시' },
];
