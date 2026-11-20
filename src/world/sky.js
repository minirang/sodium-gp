import * as THREE from 'three';
import { TIMES } from '../config.js';

// 하늘: 높이·태양 방향에 따른 그라데이션 + 태양/달 원반과 산란광 + fbm 노이즈 구름(바람에 흐름) + 반짝이는 별
const vs = 'varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const fs = (oct) => `uniform vec3 top,mid,hor,fogC,sunC,sun,cloudC,cloudS;uniform float stars,time,cov,disc,discI,halo;varying vec3 d;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<${oct};i++){s+=a*vn(p);p=p*2.07+vec2(3.1,1.7);a*=.5;}return s;}
void main(){
  vec3 n=normalize(d);float h=n.y,hp=max(h,0.);
  vec2 sh=normalize(sun.xz+1e-4),nh=normalize(n.xz+1e-4);
  float toward=pow(max(dot(nh,sh),0.),2.)*(1.-smoothstep(.0,.6,sun.y));
  vec3 horizon=mix(fogC,hor,toward*.85+.15);
  vec3 c=mix(horizon,mid,smoothstep(0.,.28,hp));c=mix(c,top,smoothstep(.22,.95,hp));
  c=mix(c,fogC*.9,smoothstep(0.,-.12,h));
  float sd=max(dot(n,sun),0.);
  c+=sunC*(pow(sd,5.)*.22+pow(sd,48.)*.5)*halo;
  c+=sunC*smoothstep(disc,disc+.00025,sd)*discI;
  if(h>0.){
    vec2 uv=n.xz/(h+.1)*1.15+vec2(time*.006,time*.0022);
    float f=fbm(uv),f2=fbm(uv+sh*.09);
    float k=smoothstep(1.-cov,1.-cov+.32,f)*smoothstep(0.,.14,h);
    float light=clamp(.55+(f-f2)*4.,0.,1.);
    vec3 cc=mix(cloudS,cloudC,light)+sunC*pow(sd,10.)*.6*light;
    c=mix(c,cc,k*.9);
    float r=fract(sin(dot(floor(n*300.),vec3(12.9898,78.233,37.719)))*43758.5453);
    float tw=.6+.4*sin(time*3.+r*60.);
    c+=vec3(step(.9986,r))*stars*tw*smoothstep(.1,.5,h)*(1.-k);
  }
  gl_FragColor=vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSky(quality = 2) {
    const C = () => ({ value: new THREE.Color() });
    const u = { top: C(), mid: C(), hor: C(), fogC: C(), sunC: C(), cloudC: C(), cloudS: C(), sun: { value: new THREE.Vector3() }, stars: { value: 0 }, time: { value: 0 }, cov: { value: 0.4 }, disc: { value: 0.9995 }, discI: { value: 6 }, halo: { value: 1 } };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs(quality < 1 ? 3 : quality < 2 ? 4 : 5), side: THREE.BackSide, depthWrite: false, fog: false });
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -1;
    return {
        mesh, u, clone: () => new THREE.Mesh(geo, mat),
        set(id) {
            const t = TIMES[id];
            u.top.value.set(t.top); u.mid.value.set(t.mid); u.hor.value.set(t.hor); u.fogC.value.set(t.fog); u.sunC.value.set(t.sun);
            u.cloudC.value.set(t.cloud[0]); u.cloudS.value.set(t.cloud[1]); u.cov.value = t.cloud[2];
            u.sun.value.set(...t.dir).normalize(); u.stars.value = t.stars;
            // 밤에는 같은 자리에 작고 흐린 달을 그린다
            u.disc.value = t.stars ? 0.99965 : 0.99955; u.discI.value = t.stars ? 1.6 : 7; u.halo.value = t.stars ? 0.35 : 1;
            return t;
        },
        update(time) { u.time.value = time; },
    };
}
