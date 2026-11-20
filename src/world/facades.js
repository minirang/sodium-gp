import * as THREE from 'three';

// 건물 외벽 텍스처 배열(텍스처 2D 배열 한 장). 모든 건물이 머티리얼 하나를 공유해 청크마다 드로우콜 1번으로 그려진다.
// RGB = 외벽/유리 색, A = 유리(창) 마스크. 밤에 켜지는 창은 셰이더에서 창 칸마다 해시로 정해 패턴이 반복되지 않는다.
// u, v: 타일 한 장이 덮는 실제 크기(m) · cols, rows: 타일 안의 창 격자 · lit: 불 켜질 확률 보정
export const LAYERS = {
    office: { u: 24, v: 28, cols: 8, rows: 8, lit: 1 },
    curtain: { u: 24, v: 28, cols: 8, rows: 8, lit: 0.9 },
    concrete: { u: 24, v: 24, cols: 8, rows: 8, lit: 1.1 },
    brick: { u: 24, v: 24, cols: 8, rows: 8, lit: 1.2 },
    ribbon: { u: 24, v: 28, cols: 8, rows: 8, lit: 0.9 },
    fins: { u: 16, v: 28, cols: 8, rows: 8, lit: 0.8 },
    apt: { u: 24, v: 22.4, cols: 8, rows: 8, lit: 1.3 },
    shop: { u: 24, v: 6, cols: 4, rows: 1, lit: 2.2 },
    shed: { u: 24, v: 12, cols: 8, rows: 1, lit: 0.5 },
    house: { u: 8, v: 3.2, cols: 2, rows: 1, lit: 1.4 },
    hotel: { u: 24, v: 24, cols: 6, rows: 8, lit: 1.2 },
    dark: { u: 24, v: 28, cols: 8, rows: 8, lit: 0.7 },
    roof: { u: 30, v: 30, cols: 1, rows: 1, lit: 0 },
    tiles: { u: 6, v: 6, cols: 1, rows: 1, lit: 0 },
    stucco: { u: 10, v: 10, cols: 1, rows: 1, lit: 0 },
    mirror: { u: 24, v: 28, cols: 8, rows: 8, lit: 0.6 },
};
export const LAYER_IDS = Object.fromEntries(Object.keys(LAYERS).map((k, i) => [k, i]));

function draw(name, c, m, S, rand) {
    const L = LAYERS[name], cw = S / L.cols, rh = S / L.rows;
    const fill = (ctx, col, x, y, w, h) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    const noise = (col, n = 2500, a = 0.06) => { for (let i = 0; i < n; i++) { c.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`; c.fillRect(rand() * S, rand() * S, 2, 2); } };
    const grid = (fn) => { for (let j = 0; j < L.rows; j++) for (let i = 0; i < L.cols; i++) fn(i * cw, j * rh, i, j); };
    // 창: 색 캔버스에 유리색, 마스크 캔버스에 흰색
    const win = (x, y, w, h, glass, frame) => {
        if (frame) fill(c, frame, x - 2, y - 2, w + 4, h + 4);
        const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, glass[0]); g.addColorStop(1, glass[1]); c.fillStyle = g; c.fillRect(x, y, w, h);
        fill(m, '#fff', x, y, w, h);
    };
    switch (name) {
        case 'office': fill(c, '#2c3443', 0, 0, S, S); noise(); grid((x, y) => win(x + cw * 0.08, y + rh * 0.2, cw * 0.84, rh * 0.68, ['#2b3b52', '#16202e'], '#56606e')); break;
        case 'curtain': fill(c, '#3a4a5e', 0, 0, S, S); grid((x, y) => { win(x + 1.5, y + rh * 0.12, cw - 3, rh * 0.86, ['#3a5e86', '#1c2f48']); fill(c, '#8ea0b4', x, y, 1.5, rh); }); break;
        case 'concrete': fill(c, '#bdb5a6', 0, 0, S, S); noise(); grid((x, y) => { win(x + cw * 0.25, y + rh * 0.25, cw * 0.5, rh * 0.52, ['#2e3846', '#1a212b'], '#8a8478'); fill(c, '#d6cfc2', x + cw * 0.2, y + rh * 0.79, cw * 0.6, rh * 0.05); }); break;
        case 'brick':
            fill(c, '#8a4c38', 0, 0, S, S);
            for (let y = 0; y < S; y += 6) { fill(c, 'rgba(40,20,14,.35)', 0, y, S, 1); for (let x = (y / 6) % 2 ? 0 : 6; x < S; x += 12) fill(c, 'rgba(40,20,14,.3)', x, y, 1, 6); }
            noise('', 1500, 0.08);
            grid((x, y) => win(x + cw * 0.28, y + rh * 0.22, cw * 0.44, rh * 0.56, ['#2a3340', '#161c24'], '#e8e2d6'));
            break;
        case 'ribbon': fill(c, '#e4e4df', 0, 0, S, S); noise('', 1200, 0.04); for (let j = 0; j < L.rows; j++) { win(0, j * rh + rh * 0.3, S, rh * 0.5, ['#2a3644', '#141b24']); for (let i = 0; i < L.cols; i++) fill(c, '#9aa3ad', i * cw, j * rh + rh * 0.3, 2, rh * 0.5); } break;
        case 'fins': fill(c, '#d0d4da', 0, 0, S, S); grid((x, y) => { win(x + cw * 0.22, y + 2, cw * 0.56, rh - 4, ['#33465e', '#1a2636']); fill(c, '#e9ecf0', x, y, cw * 0.12, rh); }); for (let j = 0; j < L.rows; j++) fill(c, '#aeb4bc', 0, j * rh, S, 3); break;
        case 'apt':
            fill(c, '#ecebe6', 0, 0, S, S); noise('', 1500, 0.04);
            grid((x, y, i) => { win(x + cw * 0.08, y + rh * 0.18, cw * 0.84, rh * 0.62, ['#5d6f80', '#2a3644'], '#c9c8c2'); fill(c, 'rgba(255,255,255,.75)', x + cw * 0.06, y + rh * 0.56, cw * 0.88, 2); fill(c, 'rgba(255,255,255,.75)', x + cw * 0.06, y + rh * 0.66, cw * 0.88, 2); if (i % 4 === 0) fill(c, '#d9d6cf', x, y, 3, rh); });
            break;
        case 'shop': {
            fill(c, '#d8d3c8', 0, 0, S, S);
            const cols = ['#c42c2c', '#1d6f8e', '#f2b632', '#2f7d3a', '#7a3dff', '#ff7a1a', '#ececec', '#13315c'];
            grid((x) => { fill(c, cols[Math.floor(rand() * cols.length)], x + 3, 0, cw - 6, S * 0.2); win(x + cw * 0.06, S * 0.3, cw * 0.88, S * 0.66, ['#3d4c5c', '#1b232d'], '#15171b'); fill(c, 'rgba(255,255,255,.5)', x + cw * 0.2, S * 0.07, cw * 0.6, S * 0.06); });
            break;
        }
        case 'shed': fill(c, '#c4c8ce', 0, 0, S, S); for (let x = 0; x < S; x += 8) fill(c, 'rgba(0,0,0,.16)', x, 0, 3, S); grid((x) => win(x + cw * 0.1, S * 0.08, cw * 0.8, S * 0.16, ['#3a4654', '#202833'])); fill(c, 'rgba(0,0,0,.25)', 0, S * 0.96, S, S * 0.04); break;
        case 'house': fill(c, '#ece6d8', 0, 0, S, S); noise('', 1200, 0.05); grid((x) => { win(x + cw * 0.28, S * 0.26, cw * 0.44, S * 0.5, ['#3a4656', '#1e2632'], '#6b5a48'); fill(c, '#5a4a3a', x + cw * 0.24, S * 0.24, cw * 0.04, S * 0.54); fill(c, '#5a4a3a', x + cw * 0.72, S * 0.24, cw * 0.04, S * 0.54); }); fill(c, 'rgba(0,0,0,.18)', 0, S * 0.94, S, S * 0.06); break;
        case 'hotel': fill(c, '#f2f0ea', 0, 0, S, S); grid((x, y) => { fill(c, '#c9c6be', x + cw * 0.04, y + rh * 0.1, cw * 0.92, rh * 0.8); win(x + cw * 0.14, y + rh * 0.14, cw * 0.72, rh * 0.62, ['#5c8fb0', '#2b4a62']); fill(c, '#ffffff', x + cw * 0.04, y + rh * 0.62, cw * 0.92, rh * 0.06); fill(c, 'rgba(255,255,255,.8)', x + cw * 0.04, y + rh * 0.68, cw * 0.92, 2); }); break;
        case 'dark': fill(c, '#11141a', 0, 0, S, S); grid((x, y) => win(x + 1, y + rh * 0.06, cw - 2, rh * 0.9, ['#1d2633', '#0b0f15'])); for (let j = 0; j < L.rows; j++) fill(c, '#2c333e', 0, j * rh, S, 2); break;
        case 'mirror': fill(c, '#5a7896', 0, 0, S, S); grid((x, y) => win(x + 1, y + 1, cw - 2, rh - 2, ['#6c96c0', '#3b6488'])); break;
        case 'roof': fill(c, '#77797d', 0, 0, S, S); noise('', 9000, 0.08); for (let i = 0; i < 12; i++) fill(c, 'rgba(0,0,0,.07)', rand() * S, rand() * S, 40 + rand() * 120, 40 + rand() * 120); break;
        case 'tiles': fill(c, '#8f8f8f', 0, 0, S, S); for (let y = 0; y < S; y += 32) { fill(c, 'rgba(0,0,0,.35)', 0, y + 28, S, 4); for (let x = (y / 32) % 2 ? 0 : 16; x < S; x += 32) fill(c, 'rgba(0,0,0,.18)', x, y, 2, 30); fill(c, 'rgba(255,255,255,.12)', 0, y, S, 3); } break;
        case 'stucco': fill(c, '#e2e0da', 0, 0, S, S); noise('', 6000, 0.05); break;
    }
}

let cache = null;
export function facadeArray(size, rand) {
    if (cache && cache.size === size) return cache;
    const names = Object.keys(LAYERS), n = names.length, data = new Uint8Array(size * size * 4 * n);
    const cc = document.createElement('canvas'), mc = document.createElement('canvas');
    cc.width = cc.height = mc.width = mc.height = size;
    const c = cc.getContext('2d', { willReadFrequently: true }), m = mc.getContext('2d', { willReadFrequently: true });
    names.forEach((name, k) => {
        m.fillStyle = '#000'; m.fillRect(0, 0, size, size);
        draw(name, c, m, size, rand);
        const a = c.getImageData(0, 0, size, size).data, b = m.getImageData(0, 0, size, size).data, o = k * size * size * 4;
        for (let i = 0; i < size * size; i++) { data[o + i * 4] = a[i * 4]; data[o + i * 4 + 1] = a[i * 4 + 1]; data[o + i * 4 + 2] = a[i * 4 + 2]; data[o + i * 4 + 3] = b[i * 4]; }
    });
    const tex = new THREE.DataArrayTexture(data, size, size, n);
    Object.assign(tex, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, anisotropy: 4 });
    tex.needsUpdate = true;
    cache = { size, tex };
    return cache;
}

// 건물 공용 머티리얼: 유리는 매끈하게(하늘 반사), 외벽은 정점 색으로 톤을 바꾸고, 밤에는 창 칸마다 무작위로 불을 켠다
export function facadeMaterial(tex) {
    const u = { facadeArr: { value: tex }, litFrac: { value: 0.4 }, winI: { value: 1 }, grid: { value: Object.values(LAYERS).map((l) => new THREE.Vector4(l.cols, l.rows, l.lit, 0)) } };
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, envMapIntensity: 0.9 });
    m.defines = { USE_UV: '' };
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float layer;attribute float seed;attribute vec3 tint;flat varying float vLayer;varying float vSeed;varying vec3 vTint;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer=layer;vSeed=seed;vTint=tint;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
precision highp sampler2DArray;uniform sampler2DArray facadeArr;uniform vec4 grid[${Object.keys(LAYERS).length}];uniform float litFrac,winI;flat varying float vLayer;varying float vSeed;varying vec3 vTint;
float hh(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*45758.5453);}`)
            .replace('#include <map_fragment>', `vec4 fac=texture(facadeArr,vec3(vUv,vLayer));float glass=fac.a;
diffuseColor.rgb*=mix(fac.rgb*vTint,fac.rgb,glass);
vec4 gi=grid[int(vLayer+.5)];vec2 cell=floor(vUv*gi.xy);float r1=hh(cell+vSeed*17.),r2=hh(cell.yx+vSeed*7.+3.1);
float lit=step(r1,litFrac*gi.z)*glass*(.2+.8*r2*r2);`)
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.08,glass);metalnessFactor=mix(metalnessFactor,.55,glass);')
            .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=mix(vec3(1.,.78,.48),vec3(.75,.88,1.),step(.72,hh(cell*.37+vSeed)))*lit*winI;');
    };
    m.customProgramCacheKey = () => 'facade';
    m.userData.u = u;
    return m;
}
