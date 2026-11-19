import * as THREE from 'three';
import { TIMES } from '../config.js';

const vs = 'varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const fs = `uniform vec3 top,mid,hor,sunC,sun;uniform float stars;varying vec3 d;
void main(){
  vec3 n=normalize(d);float h=max(n.y,0.);
  vec3 c=mix(hor,mid,smoothstep(0.,.22,h));c=mix(c,top,smoothstep(.15,.85,h));
  float s=max(dot(n,sun),0.);c+=sunC*(pow(s,900.)*4.+pow(s,10.)*.3);
  float r=fract(sin(dot(floor(n*260.),vec3(12.9898,78.233,37.719)))*43758.5453);
  c+=vec3(step(.9988,r))*stars*smoothstep(.25,.7,h);
  gl_FragColor=vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSky() {
    const u = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunC: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() }, stars: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.BackSide, depthWrite: false, fog: false });
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
    return {
        mesh, clone: () => new THREE.Mesh(geo, mat),
        set(id) {
            const t = TIMES[id];
            u.top.value.set(t.top); u.mid.value.set(t.mid); u.hor.value.set(t.hor); u.sunC.value.set(t.sun);
            u.sun.value.set(...t.dir).normalize(); u.stars.value = t.stars;
            return t;
        },
    };
}
