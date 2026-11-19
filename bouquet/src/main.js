import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const INNER_R = 0.10;
const OUTER_R = 1.0;
const THETA_SEG = 72;
const RADIAL_SEG = 28;
const RELAX_ITERS = 2;
const RELAX_BLEND = 0.5;

// Dial HSV hue is 0–255 (0 = red). Glow uses Ethiopia Yirgacheffe Aricha, hue 16.
const WEEK_TOP_HUE = 16;
const MOUTH_Y = -1.42;
const BUNDLE = new THREE.Vector3(0, -1.58, 0);

// One stem, framed with the mug. Closer than the old 60-head bouquet camera.
const CAM_POS = new THREE.Vector3(2.85, 1.42, 6.05);
const CAM_TARGET = new THREE.Vector3(0, -0.12, 0);
const SOLO_ANGLE = -0.11;
const SOLO_RADIUS = 0.42;
const SOLO_YBASE = 0.92;
const SOLO_LEAN = 22 * Math.PI / 180;

const DOSE_MIN = 14;
const DOSE_REF = 18;
const DOSE_XL = 22;
const SCALE_AT_REF = 0.74;
const SCALE_AT_XL = 1.00;

// Fine Ethiopia (~8.2) stays a deep tulip; ~9.0 is almost a sunflower disk.
const GRIND_CUPPED = 8.24;
const GRIND_FLAT = 9.05;

const LEAN_INNER = 30 * Math.PI / 180;
const LEAN_OUTER = 56 * Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const BLOOM_LAYER = 1;

// Soft atmospheric shell so the set's top-bean hue glows behind the bouquet.
const ATMOS_RADIUS = 9.5;
const ATMOS_OPACITY = 0.30;
const ATMOS_Y = 1.2;
const GROUND_SIZE = 12;

const DEFAULTS = {
  stemHeight: 1,
  stemSoftness: 1,
  sizeExag: 1
};

const LIMITS = {
  stemHeight: [0.6, 1.6],
  stemSoftness: [0.4, 2.2],
  sizeExag: [0.5, 2.2]
};

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function clamp01(x) { return clamp(x, 0, 1); }

function hsvDial(h, s, v) {
  const hh = ((Number(h) % 256) / 255) * 6;
  const ss = Math.max(0, Math.min(255, s)) / 255;
  const vv = Math.max(0, Math.min(255, v)) / 255;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - f * ss);
  const t = vv * (1 - (1 - f) * ss);
  let r, g, b;
  switch (i % 6) {
    case 0: r = vv; g = t; b = p; break;
    case 1: r = q; g = vv; b = p; break;
    case 2: r = p; g = vv; b = t; break;
    case 3: r = p; g = q; b = vv; break;
    case 4: r = t; g = p; b = vv; break;
    default: r = vv; g = p; b = q; break;
  }
  return new THREE.Color(r, g, b);
}

function stemColor(hue) {
  const col = hsvDial(hue, 200, 150);
  col.lerp(new THREE.Color(0x4a2c14), 0.55);
  col.multiplyScalar(0.55);
  return col;
}

// Modifier hues are CSS HSL degrees (the hue of the named color).
// HE BASKET is purple, FROZEN BALL is cyan, SLOW FEED is red.
// Bag hues stay on the dial scale above; the petal art is already that bean color.
const MODIFIER_HUES = {
  "HE BASKET": 300,
  "FROZEN BALL": 180,
  "SLOW FEED": 0
};

const MODIFIER_ALIASES = {
  "he basket": "HE BASKET",
  "frozen ball": "FROZEN BALL",
  "frozen ss ball": "FROZEN BALL",
  "slow feed": "SLOW FEED"
};

function modifierKey(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function canonicalModifier(raw) {
  const key = modifierKey(raw);
  if (!key || key === "none" || key === "null" || key === "n/a") return "";
  if (MODIFIER_ALIASES[key]) return MODIFIER_ALIASES[key];
  return key.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function modifierHue(label) {
  if (Object.prototype.hasOwnProperty.call(MODIFIER_HUES, label)) return MODIFIER_HUES[label];
  let h = 0;
  const key = modifierKey(label);
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

// One label, or several separated by comma, slash, plus, or semicolon.
// "none" and blank contribute no wedge. At most four wedges (vec4 hues).
function parseModifiers(raw) {
  if (Array.isArray(raw)) {
    const out = [];
    for (const item of raw) {
      for (const label of parseModifiers(item)) {
        if (!out.includes(label)) out.push(label);
      }
    }
    return out.slice(0, 4);
  }
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return [];
  const parts = text.split(/\s*(?:,|;|\+|\/|\|)\s*/);
  const out = [];
  for (const part of parts) {
    const label = canonicalModifier(part);
    if (!label || out.includes(label)) continue;
    out.push(label);
  }
  return out.slice(0, 4);
}

// The published view is one flower: 19 Nov 2026, 11:55 AM HKT,
// Guatemala Antigua La Flor, bag 8, hue 143, modifier HE BASKET.
// The 8:58 AM brew is modifier none and must not be shown.
function isHebasketPreview(shot) {
  if (!shot || typeof shot !== "object") return false;
  const name = String(shot.name || "").toUpperCase();
  const when = String(shot.when || "");
  const iso = String(shot.iso || "");
  const at1155 = when.includes("11:55")
    || iso.startsWith("2026-11-19T11:55")
    || iso.startsWith("2026-11-19T03:55");
  return Number(shot.bag_id) === 8
    && Number(shot.hue) === 143
    && name.includes("ANTIGUA LA FLOR")
    && at1155
    && canonicalModifier(shot.modifier) === "HE BASKET";
}

function selectPreviewShot(shots) {
  const matches = (Array.isArray(shots) ? shots : []).filter(isHebasketPreview);
  return matches.length ? matches[matches.length - 1] : null;
}

// Radial bean→modifier diffusion, with equal wedges when a brew has
// more than one modifier. Slice edges use a short angular feather.
const RIM_DYE_GLSL = `
uniform float uDyeCount;
uniform vec4 uDyeHues;

vec3 bouquetEncodeSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = pow(c, vec3(0.41666)) * 1.055 - vec3(0.055);
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

vec3 bouquetDecodeSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 0.0773993808;
  vec3 hi = pow((c + vec3(0.055)) / vec3(1.055), vec3(2.4));
  return mix(hi, lo, step(c, vec3(0.04045)));
}

float bouquetHueToRgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 0.1666667) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 0.6666667) return p + (q - p) * (0.6666667 - t) * 6.0;
  return p;
}

vec3 bouquetHslToRgb(vec3 hsl) {
  float h = hsl.x;
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  if (s < 0.0001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    bouquetHueToRgb(p, q, h + 0.3333333),
    bouquetHueToRgb(p, q, h),
    bouquetHueToRgb(p, q, h - 0.3333333)
  );
}

vec3 bouquetRgbToHsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float d = maxC - minC;
  if (d < 0.00001) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r) {
    h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  } else if (maxC == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  return vec3(h / 6.0, s, l);
}

float bouquetMixHue(float aDeg, float bDeg, float t) {
  float d = mod(bDeg - aDeg + 540.0, 360.0) - 180.0;
  return mod(aDeg + d * t + 360.0, 360.0);
}

float bouquetHueAt(int idx, int n) {
  float fk = mod(float(idx), float(n));
  if (fk < 0.0) fk += float(n);
  int k = int(floor(fk + 0.0001));
  if (k >= n) k = 0;
  if (k == 0) return uDyeHues.x;
  if (k == 1) return uDyeHues.y;
  if (k == 2) return uDyeHues.z;
  return uDyeHues.w;
}

float bouquetModifierHue(vec2 uv) {
  int n = int(uDyeCount + 0.5);
  if (n <= 1) return uDyeHues.x;
  float ang = atan(uv.y - 0.5, uv.x - 0.5);
  float ang01 = fract(ang * RECIPROCAL_PI2 + 0.5);
  float pos = ang01 * float(n);
  int i0 = int(floor(pos));
  float f = fract(pos);
  float slice = 1.0 / float(n);
  float featherTurn = min(0.05, slice * 0.35);
  float fw = featherTurn / slice;
  float h0 = bouquetHueAt(i0, n);
  if (f < fw) {
    float t = smoothstep(0.0, fw, f);
    float hPrev = bouquetHueAt(i0 - 1, n);
    return bouquetMixHue(hPrev, h0, mix(0.5, 1.0, t));
  }
  if (f > 1.0 - fw) {
    float t = smoothstep(1.0 - fw, 1.0, f);
    float hNext = bouquetHueAt(i0 + 1, n);
    return bouquetMixHue(h0, hNext, t * 0.5);
  }
  return h0;
}

// d is UV distance from the petal center: 0 at the center, 0.5 at the outer
// ring. RingGeometry sets uv = (position / outerRadius + 1) / 2, so
// d = geometricRadius / 2 (geometricRadius is 0 at the center and 1 at the edge).
// r is that span from the inner hole (d = 0.05, radius 0.10) to the edge
// (d = 0.50, radius 1).
// Previously smoothstep(0.30, 0.98, r) started at radius 0.37 and dyed the
// whole outer petal. The rim is the outer half of the span (r >= 0.5,
// radius >= 0.55). Dye only its outer half: no tint inboard of r = 0.75
// (radius 0.775), then a smoothstep up to the modifier hue by r = 0.92
// (radius 0.928), held out to the edge.
float bouquetRadial(vec2 uv) {
  float d = length(uv - vec2(0.5));
  float r = clamp((d - 0.05) / 0.45, 0.0, 1.0);
  return smoothstep(0.75, 0.92, r);
}

vec3 bouquetRimDye(vec3 linearRgb, vec2 uv) {
  if (uDyeCount < 0.5) return linearRgb;
  float amount = bouquetRadial(uv);
  if (amount <= 0.0) return linearRgb;
  float peak = max(linearRgb.r, max(linearRgb.g, linearRgb.b));
  if (peak < 0.0001) return linearRgb;
  vec3 srgb = bouquetEncodeSRGB(linearRgb / peak);
  vec3 hsl = bouquetRgbToHsl(srgb);
  float dyedHue = bouquetMixHue(hsl.x * 360.0, bouquetModifierHue(uv), amount);
  float sat = mix(hsl.y, max(hsl.y, 0.82), amount);
  vec3 shifted = bouquetDecodeSRGB(bouquetHslToRgb(vec3(dyedHue / 360.0, sat, hsl.z)));
  float newPeak = max(shifted.r, max(shifted.g, shifted.b));
  return shifted * (peak / max(newPeak, 0.0001));
}
`;

function onBeforeCompileRim(shader) {
  if (!shader.fragmentShader || shader.fragmentShader.indexOf("#include <color_fragment>") === -1) return;
  shader.uniforms.uDyeCount = { value: this.userData.dyeCount || 0 };
  shader.uniforms.uDyeHues = { value: this.userData.dyeHues };
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + RIM_DYE_GLSL)
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n\tdiffuseColor.rgb = bouquetRimDye(diffuseColor.rgb, vMapUv);"
    )
    .replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = bouquetRimDye(totalEmissiveRadiance, vMapUv);"
    );
}

function attachRimDye(mat, labels) {
  const hues = [0, 0, 0, 0];
  const used = (labels || []).slice(0, 4);
  for (let i = 0; i < used.length; i++) hues[i] = modifierHue(used[i]);
  mat.userData.dyeCount = used.length;
  mat.userData.dyeLabels = used;
  mat.userData.dyeHues = new THREE.Vector4(hues[0], hues[1], hues[2], hues[3]);
  mat.onBeforeCompile = onBeforeCompileRim;
  mat.customProgramCacheKey = () => "bouquet-rim-dye-v2";
}

function hermite(y0, y1, m0, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0
    + (t3 - 2 * t2 + t) * m0
    + (-2 * t3 + 3 * t2) * y1
    + (t3 - t2) * m1;
}

function smootherstep(t) {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function doseScale(dose) {
  const slope = (SCALE_AT_XL - SCALE_AT_REF) / (DOSE_XL - DOSE_REF);
  const s = SCALE_AT_REF + slope * (Number(dose) - DOSE_REF);
  const lo = SCALE_AT_REF + slope * (DOSE_MIN - DOSE_REF);
  const hi = SCALE_AT_XL + slope * 1.0;
  return clamp(s, lo, hi);
}

// At 1.0, today's doseScale is unchanged (18g ≈ 0.74, 22g = 1.00).
// Above 1, stretch dose differences and lift overall size a little so
// even the tight 17.8–18.3g set spreads, and a 22g XL head reads larger.
function sizedScale(dose, exaggeration) {
  const base = doseScale(dose);
  const spread = SCALE_AT_REF + (base - SCALE_AT_REF) * exaggeration;
  const overall = 1 + 0.08 * (exaggeration - 1);
  return clamp(spread * overall, 0.35, 1.85);
}

function grindOpenness(grind) {
  return clamp01((Number(grind) - GRIND_CUPPED) / (GRIND_FLAT - GRIND_CUPPED));
}

function unique(arr) { return Array.from(new Set(arr)); }

function config() {
  return window.BOUQUET_CONFIG || {};
}

function textureUrlFor(id) {
  const cfg = config();
  if (typeof cfg.textureUrl === "function") return cfg.textureUrl(id);
  if (typeof cfg.textureBase === "string") return cfg.textureBase + id + ".png";
  return "textures/" + id + ".png";
}

function shotsUrl() {
  return config().shotsUrl || "data/shots.json";
}

function viewportSize() {
  const vv = window.visualViewport;
  if (vv && vv.width && vv.height) return { w: vv.width, h: vv.height };
  return { w: window.innerWidth, h: window.innerHeight };
}

function readParams() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const get = (k) => {
    const v = q.get(k);
    if (v != null && v !== "") return v;
    return h.get(k);
  };
  const num = (k, def, lo, hi) => {
    const v = get(k);
    const n = v == null ? def : Number(v);
    return Number.isFinite(n) ? clamp(n, lo, hi) : def;
  };
  return {
    still: q.has("still"),
    stemHeight: num("height", DEFAULTS.stemHeight, LIMITS.stemHeight[0], LIMITS.stemHeight[1]),
    stemSoftness: num("soft", DEFAULTS.stemSoftness, LIMITS.stemSoftness[0], LIMITS.stemSoftness[1]),
    sizeExag: num("size", DEFAULTS.sizeExag, LIMITS.sizeExag[0], LIMITS.sizeExag[1])
  };
}

function fmt(n, digits) {
  const d = digits == null ? 2 : digits;
  return Number(n).toFixed(d).replace(/\.?0+$/, (m, offset, s) => (s.includes(".") ? m : ""));
}

async function __main() {
  const weekGlow = hsvDial(WEEK_TOP_HUE, 210, 200);

  const start = readParams();
  const params = {
    stemHeight: start.stemHeight,
    stemSoftness: start.stemSoftness,
    sizeExag: start.sizeExag
  };
  const stillMode = start.still;
  if (stillMode) document.documentElement.dataset.still = "1";

  const { w: vw0, h: vh0 } = viewportSize();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(36, vw0 / Math.max(1, vh0), 0.1, 80);
  camera.position.copy(CAM_POS);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  const coarse = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.setSize(vw0, vh0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.id = "bouquet-canvas";
  document.body.prepend(canvas);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.copy(CAM_TARGET);
  controls.minDistance = 2.8;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.49;

  // Neutral fill on the bouquet so every petal keeps its own hue.
  // Top-bean color lives on the background globe and the ground pool, not as a wash on the heads.
  scene.add(new THREE.AmbientLight(0x9a9590, 0.28));
  const key = new THREE.DirectionalLight("#d8d4ce", 0.42);
  key.position.set(2.8, 5.2, 3.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight("#b8c0c4", 0.18);
  fill.position.set(-3.4, 1.8, -1.6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(weekGlow, 0.08);
  rim.position.set(0.2, 1.2, -4.2);
  scene.add(rim);
  const weekLight = new THREE.PointLight(weekGlow, 2.0, 3.2, 2);
  weekLight.position.set(0, -0.2, 0.15);
  scene.add(weekLight);
  const stemFill = new THREE.PointLight(0xc8bfb2, 0.7, 14, 1.2);
  stemFill.position.set(0.4, 2.6, 2.2);
  scene.add(stemFill);

  const bloomLayer = new THREE.Layers();
  bloomLayer.set(BLOOM_LAYER);
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const hiddenMats = {};
  function darkenNonBloomed(obj) {
    if (!obj.isMesh || bloomLayer.test(obj.layers)) return;
    hiddenMats[obj.uuid] = obj.material;
    obj.material = darkMaterial;
  }
  function restoreMaterial(obj) {
    if (hiddenMats[obj.uuid]) {
      obj.material = hiddenMats[obj.uuid];
      delete hiddenMats[obj.uuid];
    }
  }

  const renderScene = new RenderPass(scene, camera);
  const renderSceneFinal = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(vw0, vh0),
    0.48, // strength — halo stays colored so the dyed rim is still visible
    0.42, // radius
    0.18  // threshold — the bright rim blooms; the center keeps its bag hue
  );
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture }
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`
    }),
    "baseTexture"
  );
  mixPass.needsSwap = true;
  const outputPass = new OutputPass();
  const composer = new EffectComposer(renderer);
  composer.addPass(renderSceneFinal);
  composer.addPass(mixPass);
  composer.addPass(outputPass);

  function renderFrame() {
    camera.layers.enable(BLOOM_LAYER);
    scene.traverse(darkenNonBloomed);
    bloomComposer.render();
    scene.traverse(restoreMaterial);
    camera.layers.disable(BLOOM_LAYER);
    composer.render();
  }

  function resizeRenderer() {
    const { w, h } = viewportSize();
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    bloomComposer.setSize(w, h);
    composer.setSize(w, h);
  }

  // Soft ground wash under the bouquet — Ethiopia hue.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const sg = shadowCanvas.getContext("2d");
  const grad = sg.createRadialGradient(128, 128, 20, 128, 128, 124);
  const wr = Math.round(weekGlow.r * 255), wg_g = Math.round(weekGlow.g * 255), wb = Math.round(weekGlow.b * 255);
  grad.addColorStop(0, "rgba(" + wr + "," + wg_g + "," + wb + ", 0.88)");
  grad.addColorStop(0.38, "rgba(" + wr + "," + wg_g + "," + wb + ", 0.32)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.03;
  scene.add(ground);

  const atmos = new THREE.Mesh(
    new THREE.SphereGeometry(ATMOS_RADIUS, 32, 24),
    new THREE.MeshBasicMaterial({
      color: weekGlow,
      transparent: true,
      opacity: ATMOS_OPACITY,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  atmos.position.y = ATMOS_Y;
  scene.add(atmos);

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const tex = new THREE.TextureLoader().load(url, () => resolve(tex), undefined, reject);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    });
  }

  function opaqueLuminance(texture) {
    const img = texture.image;
    if (!img) return 0.25;
    const cnv = document.createElement("canvas");
    const w = Math.min(img.width || 512, 256);
    const h = Math.min(img.height || 512, 256);
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 48) continue;
      const r = Math.pow(data[i] / 255, 2.2);
      const g = Math.pow(data[i + 1] / 255, 2.2);
      const b = Math.pow(data[i + 2] / 255, 2.2);
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
    }
    return n ? sum / n : 0.25;
  }

  function makeFlower(texture, opts) {
    const pull = opts.pull;
    const fillShare = clamp01(opts.fillShare);
    const open = clamp01(opts.openness || 0);
    const rSplit = OUTER_R * Math.sqrt(Math.max(0.12, fillShare));
    // Fine stays a deep tulip; mid opens like Bauhinia; coarse is a near-flat sunflower disk.
    // Residual cup is almost gone by openness ~0.9 (grind 9.0). Slightly wider flare when open.
    const flare = 0.22 + 0.38 * open;
    const lobeAmp = 0.08 + 0.16 * (4 * open * (1 - open));
    const zBfac = 0.18 * Math.pow(1 - open, 1.55);
    const zCfac = 0.64 * Math.pow(1 - open, 1.7) - 0.05 * open;
    const geo = new THREE.RingGeometry(INNER_R, OUTER_R, THETA_SEG, RADIAL_SEG);
    const pos = geo.attributes.position;
    const rest = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x0 = pos.getX(i);
      const y0 = pos.getY(i);
      const r = Math.hypot(x0, y0);
      const ang = Math.atan2(y0, x0);
      const organic = 1 + lobeAmp * Math.sin(ang * 5) + 0.035 * Math.sin(ang * 3 + 0.4);
      const zA = -pull * organic;
      const zB = -pull * zBfac * organic;
      const zC = -pull * zCfac * organic;
      const lenAB = Math.max(1e-4, rSplit - INNER_R);
      const lenBC = Math.max(1e-4, OUTER_R - rSplit);
      const mA = 1.2 * (zB - zA);
      const mB = 0;
      const mC = 1.55 * (zC - zB);
      let z, rr;
      if (r <= rSplit) {
        const tt = clamp01((r - INNER_R) / lenAB);
        z = hermite(zA, zB, mA, mB, tt);
        rr = r;
      } else {
        const tt = clamp01((r - rSplit) / lenBC);
        z = hermite(zB, zC, mB, mC, tt);
        rr = r * (1 + flare * smootherstep(tt) * organic);
      }
      const s = r > 1e-6 ? rr / r : 1;
      const x = x0 * s;
      const y = y0 * s;
      pos.setXYZ(i, x, y, z);
      rest[i * 3] = x;
      rest[i * 3 + 1] = y;
      rest[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const idx = geo.index.array;
    const neighbors = Array.from({ length: pos.count }, () => []);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      neighbors[a].push(b, c);
      neighbors[b].push(a, c);
      neighbors[c].push(a, b);
    }
    const groups = new Map();
    const keyOf = (i) => pos.getX(i).toFixed(5) + "," + pos.getY(i).toFixed(5);
    for (let i = 0; i < pos.count; i++) {
      const k = keyOf(i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    for (let i = 0; i < pos.count; i++) {
      const extras = [];
      for (const j of groups.get(keyOf(i))) {
        extras.push(j, ...neighbors[j]);
      }
      neighbors[i] = unique(extras).filter((j) => j !== i);
    }

    const pinOuter = new Uint8Array(pos.count);
    const pinInner = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(rest[i * 3], rest[i * 3 + 1]);
      if (r > OUTER_R - 1e-4) pinOuter[i] = 1;
      if (r < INNER_R + 1e-4) pinInner[i] = 1;
    }

    const targetY = 0.26;
    const lum = opaqueLuminance(texture);
    const emit = Math.min(1.55, Math.max(0.7, targetY / Math.max(lum, 0.08)));
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: emit,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      roughness: 0.62,
      metalness: 0.02,
      depthWrite: true
    });
    attachRimDye(mat, opts.modifiers || []);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.enable(BLOOM_LAYER);
    mesh.userData = {
      rest, neighbors, pinOuter, pinInner, pull,
      phase: opts.phase || 0,
      tmp: new Float32Array(pos.count * 3)
    };
    return mesh;
  }

  function relax(mesh, time) {
    const { rest, neighbors, pinOuter, pinInner, phase, tmp } = mesh.userData;
    const pos = mesh.geometry.attributes.position;
    const n = pos.count;
    const breath = Math.sin(time * 0.7 + phase) * 0.03;
    for (let iter = 0; iter < RELAX_ITERS; iter++) {
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (pinOuter[i]) {
          tmp[i3] = rest[i3];
          tmp[i3 + 1] = rest[i3 + 1];
          tmp[i3 + 2] = rest[i3 + 2];
          continue;
        }
        if (pinInner[i]) {
          tmp[i3] = rest[i3];
          tmp[i3 + 1] = rest[i3 + 1];
          tmp[i3 + 2] = rest[i3 + 2] + breath;
          continue;
        }
        const nei = neighbors[i];
        let ax = 0, ay = 0, az = 0;
        for (let k = 0; k < nei.length; k++) {
          ax += pos.getX(nei[k]);
          ay += pos.getY(nei[k]);
          az += pos.getZ(nei[k]);
        }
        const inv = 1 / nei.length;
        const b = RELAX_BLEND;
        tmp[i3]     = ax * inv * b + rest[i3] * (1 - b);
        tmp[i3 + 1] = ay * inv * b + rest[i3 + 1] * (1 - b);
        tmp[i3 + 2] = az * inv * b + rest[i3 + 2] * (1 - b);
      }
      for (let i = 0; i < n; i++) {
        pos.setXYZ(i, tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2]);
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function stemCurve(from, to, sag, softness) {
    const pts = [];
    const n = 16;
    const soft = Math.max(0.15, softness);
    // 0 at slider min (stiff), 1 at slider max (soft).
    const u = Math.min(1, Math.max(0, (soft - 0.4) / 1.8));
    // Stiff keeps today's tight-at-the-mug, nearly-straight rods
    // (mid-radius ≈ 0.31 of the span). Soft stays in the bundle longer,
    // then curves outward toward the heads — never a mid-stem belly.
    const radialPower = 1.68 + 1.15 * u;
    // Soft stems rise a little more vertically, so the last stretch
    // travels outward (and slightly down at full soft) instead of sagging.
    const yLift = (0.20 + 0.18 * (sag || 0.3)) * u;
    const CLEAR_Y = -1.36;
    const CLEAR_R = 0.82;
    for (let i = 0; i <= n; i++) {
      const tt = i / n;
      const radialT = Math.pow(tt, radialPower);
      const yT = tt + yLift * Math.sin(Math.PI * tt);
      const p = new THREE.Vector3(
        from.x + (to.x - from.x) * radialT,
        from.y + (to.y - from.y) * yT,
        from.z + (to.z - from.z) * radialT
      );
      const rad = Math.hypot(p.x, p.z);
      if (tt > 0.02 && tt < 0.95 && rad < CLEAR_R + 0.22) {
        const lift = Math.max(0, (CLEAR_R + 0.22 - rad) / (CLEAR_R + 0.22));
        p.y = Math.max(p.y, CLEAR_Y + 0.05 * lift);
      }
      pts.push(p);
    }
    return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
  }

  function makeTaperedTube(curve, tubular, r0, r1, radial) {
    const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
    const pos = geo.attributes.position;
    const segs = radial + 1;
    const rings = tubular + 1;
    const cx = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < rings; i++) {
      const radius = r0 + (r1 - r0) * (i / tubular);
      cx.set(0, 0, 0);
      for (let j = 0; j < segs; j++) {
        const k = i * segs + j;
        cx.x += pos.getX(k); cx.y += pos.getY(k); cx.z += pos.getZ(k);
      }
      cx.multiplyScalar(1 / segs);
      for (let j = 0; j < segs; j++) {
        const k = i * segs + j;
        v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(cx).setLength(radius).add(cx);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  function rebuildStem(mesh, from, to) {
    const curve = stemCurve(from, to, mesh.userData.sag, mesh.userData.softness);
    const old = mesh.geometry;
    mesh.geometry = makeTaperedTube(curve, 16, 0.022, 0.013, 6);
    if (old) old.dispose();
  }

  function makeStem(from, to, color, sag, softness) {
    const emissive = color.clone().multiplyScalar(0.35);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.86,
      metalness: 0.04,
      emissive: emissive,
      emissiveIntensity: 0.55
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.userData.sag = sag;
    mesh.userData.softness = softness;
    rebuildStem(mesh, from, to);
    return mesh;
  }

  const auraCanvas = document.createElement("canvas");
  auraCanvas.width = auraCanvas.height = 128;
  {
    const ag = auraCanvas.getContext("2d");
    const grd = ag.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.3, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ag.fillStyle = grd;
    ag.fillRect(0, 0, 128, 128);
  }
  const auraTex = new THREE.CanvasTexture(auraCanvas);

  function makeAura(hue, scale) {
    const col = hsvDial(hue, 200, 230);
    const mat = new THREE.SpriteMaterial({
      map: auraTex,
      color: col,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(1.7 * scale);
    sprite.position.y = -0.12;
    sprite.layers.enable(BLOOM_LAYER);
    sprite.userData.aura = true;
    return sprite;
  }

  const bouquet = new THREE.Group();
  scene.add(bouquet);
  const flowers = [];

  function throatOf(flower) {
    const throat = new THREE.Vector3(0, 0, -flower.userData.pull);
    flower.updateMatrixWorld(true);
    flower.localToWorld(throat);
    bouquet.worldToLocal(throat);
    return throat;
  }

  function computePlacements(shots) {
    const n = shots.length;
    return shots.map((s, i) => {
      // A single stem sits just off the mug's axis so the stalk reads,
      // tipped toward the camera. The packed golden-angle bouquet would
      // park one flower out at the rim of an empty bunch.
      const solo = n === 1;
      const t = solo ? 0 : (i + 0.5) / n;
      const angle = solo ? SOLO_ANGLE : i * GOLDEN;
      const radius = solo ? SOLO_RADIUS : 0.28 + 2.35 * Math.sqrt(t);
      const yBase = solo
        ? SOLO_YBASE
        : 2.55 + 1.85 * (1 - Math.sqrt(t)) + (s.stars - 3.5) * 0.12 + 0.16 * Math.sin(i * 2.15 + 0.4);
      const y = MOUTH_Y + (yBase - MOUTH_Y) * params.stemHeight;
      const lean = solo
        ? SOLO_LEAN
        : LEAN_INNER + (LEAN_OUTER - LEAN_INNER) * Math.min(1, radius / 2.63);
      const scale = sizedScale(s.dose, params.sizeExag);
      const open = grindOpenness(s.grind);
      const pull = (1.04 + 0.12 * Math.sin(i * 1.7 + 0.3)) * (1 - 0.94 * open);
      const sag = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(i * 1.3 + 0.8));
      const phase = i * 0.47;
      return {
        key: s.id, hue: s.hue, angle, radius, y, yBase, lean, scale, pull, phase,
        dose: s.dose, yieldG: s.yieldG, grind: s.grind, openness: open, sag,
        modifiers: parseModifiers(s.modifier),
        featured: s.featured === true
      };
    });
  }

  function disposeFlower(flower) {
    const hold = flower.userData.hold;
    const stem = flower.userData.stem;
    const aura = flower.userData.aura;
    if (stem) {
      if (stem.geometry) stem.geometry.dispose();
      if (stem.material) stem.material.dispose();
      bouquet.remove(stem);
    }
    if (aura) {
      if (aura.material) aura.material.dispose();
      if (hold) hold.remove(aura);
    }
    if (flower.geometry) flower.geometry.dispose();
    if (flower.material) flower.material.dispose();
    if (hold) bouquet.remove(hold);
  }

  function clearFlowers() {
    for (const flower of flowers) disposeFlower(flower);
    flowers.length = 0;
  }

  function addFlowerFromPlacement(p, textures) {
    const flower = makeFlower(textures[p.key], {
      pull: p.pull,
      phase: p.phase,
      fillShare: p.dose / Math.max(p.yieldG, 0.01),
      openness: p.openness,
      modifiers: p.modifiers
    });
    flower.scale.setScalar(p.scale);
    const hold = new THREE.Group();
    hold.position.set(Math.sin(p.angle) * p.radius, p.y, Math.cos(p.angle) * p.radius);
    hold.rotation.y = p.angle;
    hold.add(flower);
    const aura = makeAura(p.hue, p.scale);
    hold.add(aura);
    bouquet.add(hold);
    flower.userData.hold = hold;
    flower.userData.aura = aura;
    flower.userData.packLean = p.lean;
    flower.userData.radius = p.radius;
    flower.userData.yBase = p.yBase;
    flower.userData.baseSag = p.sag;
    flower.userData.hue = p.hue;
    flower.userData.modifiers = p.modifiers;
    flower.userData.featured = p.featured;
    applyFlowerPose(flower);
    const stem = makeStem(BUNDLE, throatOf(flower), stemColor(p.hue), p.sag, params.stemSoftness);
    bouquet.add(stem);
    flower.userData.stem = stem;
    flower.userData.bundle = BUNDLE;
    flowers.push(flower);
  }

  function rebuildFlowers(shots, textures) {
    clearFlowers();
    const only = (shots || []).filter(isHebasketPreview);
    if (only.length !== 1) return;
    const placements = computePlacements(only);
    for (const p of placements) addFlowerFromPlacement(p, textures);
  }

  function softnessAmt() {
    return Math.min(1, Math.max(0, (params.stemSoftness - 0.4) / 1.8));
  }

  function applyFlowerPose(flower) {
    const hold = flower.userData.hold;
    const u = softnessAmt();
    const radius = flower.userData.radius || 0;
    const uprightY = MOUTH_Y + (flower.userData.yBase - MOUTH_Y) * params.stemHeight;
    const span = Math.max(0.4, uprightY - MOUTH_Y);
    const reach = Math.min(1, radius / 2.63);
    // Outer heads drop more: longer stems, more leverage. Stiff stays at the packed height.
    const drop = span * (0.10 + 0.22 * reach) * u;
    const y = Math.max(MOUTH_Y + 0.85, uprightY - drop);
    hold.position.y = y;
    flower.userData.baseHoldY = y;
    const nod = (8 * Math.PI / 180) * (0.4 + 0.6 * reach) * u;
    flower.userData.baseLean = flower.userData.packLean + nod;
    flower.rotation.x = -Math.PI / 2 + flower.userData.baseLean;
    if (flower.userData.stem) flower.userData.stem.userData.softness = params.stemSoftness;
  }

  function applyStemHeight() {
    for (const flower of flowers) applyFlowerPose(flower);
    recomputeStems();
  }

  function applyStemSoftness() {
    for (const flower of flowers) applyFlowerPose(flower);
    recomputeStems();
  }

  function applySize() {
    // Recompute scale from each flower's original dose via placements stored? We stored hue only.
    // Scale is reapplied from shots when we rebuild; for live size, store dose on userData.
  }

  function recomputeStems() {
    for (const flower of flowers) {
      const stem = flower.userData.stem;
      if (!stem) continue;
      rebuildStem(stem, flower.userData.bundle, throatOf(flower));
    }
  }

  function applySizeExag(visibleShots) {
    const placements = computePlacements(visibleShots);
    for (let i = 0; i < flowers.length; i++) {
      const flower = flowers[i];
      const p = placements[i];
      if (!p) continue;
      flower.scale.setScalar(p.scale);
      if (flower.userData.aura) flower.userData.aura.scale.setScalar(1.7 * p.scale);
    }
    recomputeStems();
  }

  const ceramicEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  function makeMug() {
    const group = new THREE.Group();
    const ceramic = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.22,
      metalness: 0.08,
      emissive: 0xf4f1ea,
      emissiveIntensity: 0.08,
      envMap: ceramicEnv,
      envMapIntensity: 1.15,
      side: THREE.DoubleSide
    });
    const linerMat = new THREE.MeshStandardMaterial({
      color: 0xc5c7c8,
      roughness: 0.36,
      metalness: 0.05,
      emissive: 0xb8babc,
      emissiveIntensity: 0.04,
      envMap: ceramicEnv,
      envMapIntensity: 0.5,
      side: THREE.DoubleSide
    });
    const soilMat = new THREE.MeshStandardMaterial({
      color: 0x24160e,
      roughness: 0.92,
      metalness: 0.0
    });

    const H = 1.58;
    const pts = [
      new THREE.Vector2(0.02, 0.035),
      new THREE.Vector2(0.50, 0.00),
      new THREE.Vector2(0.58, 0.03),
      new THREE.Vector2(0.60, 0.10),
      new THREE.Vector2(0.63, 0.55),
      new THREE.Vector2(0.70, 1.32),
      new THREE.Vector2(0.71, 1.44),
      new THREE.Vector2(0.82, 1.50),
      new THREE.Vector2(0.84, 1.55),
      new THREE.Vector2(0.80, H),
      new THREE.Vector2(0.62, H),
      new THREE.Vector2(0.58, 1.52),
      new THREE.Vector2(0.57, 0.16),
      new THREE.Vector2(0.02, 0.16)
    ];
    group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 64), ceramic));

    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.565, 0.555, 1.22, 48, 1, true),
      linerMat
    );
    liner.position.y = 0.16 + 1.22 / 2;
    group.add(liner);

    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.08, 48), soilMat);
    soil.position.y = 1.42 - 0.04;
    group.add(soil);

    const handleCurve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0.72, 1.30, 0),
      new THREE.Vector3(1.28, 1.36, 0),
      new THREE.Vector3(1.30, 0.28, 0),
      new THREE.Vector3(0.64, 0.36, 0)
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 40, 0.07, 14, false), ceramic));
    const capA = new THREE.Mesh(new THREE.SphereGeometry(0.078, 16, 12), ceramic);
    capA.position.copy(handleCurve.getPoint(0));
    const capB = new THREE.Mesh(new THREE.SphereGeometry(0.078, 16, 12), ceramic);
    capB.position.copy(handleCurve.getPoint(1));
    group.add(capA, capB);
    return group;
  }

  const mug = makeMug();
  mug.position.set(0, -3.00, 0);
  mug.rotation.y = 0.32;
  bouquet.add(mug);
  const mugFill = new THREE.PointLight(0xfff8ee, 1.05, 3.2, 2);
  mugFill.position.set(0.85, -1.35, 1.45);
  scene.add(mugFill);

  let allShots = [];
  const textures = {};

  function visibleShots() {
    return allShots.filter(isHebasketPreview);
  }

  function captionText() {
    const shot = visibleShots()[0];
    const when = (shot && shot.when) || "19 Nov 2026, 11:55 AM HKT";
    return { when, brew: "Guatemala Antigua La Flor · HE BASKET" };
  }

  function dyeCountText(shots) {
    const order = ["HE BASKET", "FROZEN BALL", "SLOW FEED"];
    const counts = new Map();
    for (const s of shots) {
      for (const label of parseModifiers(s.modifier)) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    const labels = order.filter((label) => counts.has(label));
    for (const label of counts.keys()) {
      if (!labels.includes(label)) labels.push(label);
    }
    if (!labels.length) return "No rim dye in this view";
    if (shots.length === 1 && labels.length === 1 && labels[0] === "HE BASKET") {
      return "Rim dye · HE BASKET purple";
    }
    return labels.map((label) => label + " × " + counts.get(label)).join(" · ");
  }

  function updateCaption() {
    const el = document.getElementById("caption");
    const hint = document.getElementById("hint");
    const counts = document.getElementById("dye-counts");
    const text = captionText();
    const whenEl = document.getElementById("caption-when");
    const brewEl = document.getElementById("caption-brew");
    if (whenEl) whenEl.textContent = text.when;
    if (brewEl) brewEl.textContent = text.brew;
    if (el && !whenEl) el.textContent = text.when + " · " + text.brew;
    if (hint) hint.textContent = text.brew + " · drag to look around";
    if (counts) counts.textContent = dyeCountText(visibleShots());
  }

  let hashTimer = 0;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const parts = [
        "height=" + Number(params.stemHeight).toFixed(2),
        "soft=" + Number(params.stemSoftness).toFixed(2),
        "size=" + Number(params.sizeExag).toFixed(2)
      ];
      const next = "#" + parts.join("&");
      if (location.hash !== next) {
        history.replaceState(null, "", location.pathname + location.search + next);
      }
    }, 80);
  }

  function syncSlidersFromParams() {
    const set = (id, value, digits) => {
      const input = document.getElementById(id);
      const label = document.getElementById("val-" + id);
      if (input && String(input.value) !== String(value)) input.value = String(value);
      if (label) {
        label.textContent = digits == null ? String(Math.round(value)) : Number(value).toFixed(digits);
      }
    };
    set("height", params.stemHeight, 2);
    set("soft", params.stemSoftness, 2);
    set("size", params.sizeExag, 2);
    updateCaption();
  }

  function onHeightChange(v) {
    params.stemHeight = clamp(v, LIMITS.stemHeight[0], LIMITS.stemHeight[1]);
    syncSlidersFromParams();
    writeHash();
    applyStemHeight();
    paint();
  }

  function onSoftChange(v) {
    params.stemSoftness = clamp(v, LIMITS.stemSoftness[0], LIMITS.stemSoftness[1]);
    syncSlidersFromParams();
    writeHash();
    applyStemSoftness();
    paint();
  }

  function onSizeChange(v) {
    params.sizeExag = clamp(v, LIMITS.sizeExag[0], LIMITS.sizeExag[1]);
    syncSlidersFromParams();
    writeHash();
    applySizeExag(visibleShots());
    paint();
  }

  function resetParams() {
    params.stemHeight = DEFAULTS.stemHeight;
    params.stemSoftness = DEFAULTS.stemSoftness;
    params.sizeExag = DEFAULTS.sizeExag;
    syncSlidersFromParams();
    writeHash();
    rebuildFlowers(visibleShots(), textures);
    paint();
  }

  function bindUi() {
    const panel = document.getElementById("panel");
    const toggle = document.getElementById("toggle");
    const height = document.getElementById("height");
    const soft = document.getElementById("soft");
    const size = document.getElementById("size");
    const reset = document.getElementById("reset");

    const live = (input, fn, asInt) => {
      if (!input) return;
      const read = () => fn(asInt ? Math.round(Number(input.value)) : Number(input.value));
      input.addEventListener("input", read);
      input.addEventListener("change", read);
    };
    live(height, onHeightChange, false);
    live(soft, onSoftChange, false);
    live(size, onSizeChange, false);
    if (reset) reset.addEventListener("click", resetParams);

    if (toggle && panel) {
      toggle.addEventListener("click", () => {
        const open = !panel.classList.contains("open");
        panel.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "Hide controls" : "Controls";
      });
    }

    const allowTouch = (el) => !!(el && el.closest && el.closest("#panel-scroll, #panel-body, input, button, label, #toggle, #reset"));
    document.addEventListener("touchmove", (e) => {
      if (!allowTouch(e.target)) e.preventDefault();
    }, { passive: false });
    document.addEventListener("wheel", (e) => {
      if (!allowTouch(e.target)) e.preventDefault();
    }, { passive: false });

    syncSlidersFromParams();
  }

  let t0 = 0;
  let frameN = 0;
  let running = false;

  function poseStill() {
    bouquet.rotation.y = 0.55;
    bouquet.rotation.x = 0;
    for (const flower of flowers) {
      flower.rotation.x = -Math.PI / 2 + flower.userData.baseLean;
      const hold = flower.userData.hold;
      hold.rotation.z = 0;
      hold.position.y = flower.userData.baseHoldY;
      relax(flower, 0);
    }
    recomputeStems();
  }

  function paint() {
    if (stillMode || !running) {
      poseStill();
      controls.update();
      renderFrame();
    }
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    frameN += 1;
    bouquet.rotation.y = 0.55 + t * 0.12 + Math.sin(t * 0.35) * 0.08;
    bouquet.rotation.x = Math.sin(t * 0.27) * 0.03;
    for (const flower of flowers) {
      const ph = flower.userData.phase;
      const hold = flower.userData.hold;
      flower.rotation.x = -Math.PI / 2 + flower.userData.baseLean + Math.sin(t * 0.55 + ph) * 0.05;
      hold.rotation.z = Math.cos(t * 0.48 + ph) * 0.035;
      hold.position.y = flower.userData.baseHoldY + Math.sin(t * 0.62 + ph) * 0.03;
      if (flower.userData.stem && (frameN % 4 === 0)) {
        rebuildStem(flower.userData.stem, flower.userData.bundle, throatOf(flower));
      }
      relax(flower, t);
    }
    controls.update();
    renderFrame();
    requestAnimationFrame(frame);
  }

  function onViewportChange() {
    resizeRenderer();
    if (stillMode || !running) {
      controls.update();
      renderFrame();
    }
  }
  window.addEventListener("resize", onViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", (e) => {
      if (e && e.preventDefault) e.preventDefault();
      onViewportChange();
    });
  }

  const hint = document.getElementById("hint");
  if (hint) hint.textContent = "Loading bouquet…";

  try {
    const res = await fetch(shotsUrl());
    if (!res.ok) throw new Error("Could not load " + shotsUrl() + " (" + res.status + ")");
    const loaded = await res.json();
    if (!Array.isArray(loaded) || !loaded.length) throw new Error("No shots in " + shotsUrl());
    const preview = selectPreviewShot(loaded);
    if (!preview) throw new Error("11:55 AM HE BASKET Antigua brew was not in the log");
    allShots = [preview];
    textures[preview.id] = await loadTexture(textureUrlFor(preview.id));
  } catch (err) {
    console.error(err);
    if (hint) hint.textContent = "Could not load the bouquet. Open this page over http, not as a file.";
    window.__errors = window.__errors || [];
    window.__errors.push(String(err && err.message ? err.message : err));
    return;
  }

  bindUi();
  rebuildFlowers(visibleShots(), textures);
  poseStill();
  controls.update();
  renderFrame();
  document.documentElement.dataset.ready = "1";
  updateCaption();
  window.__previewShot = {
    id: allShots[0] && allShots[0].id,
    when: allShots[0] && allShots[0].when,
    iso: allShots[0] && allShots[0].iso,
    modifier: allShots[0] && allShots[0].modifier,
    hue: allShots[0] && allShots[0].hue,
    flowers: flowers.length,
    dye: flowers[0] && flowers[0].userData.modifiers
  };
  if (!stillMode) {
    running = true;
    t0 = performance.now();
    requestAnimationFrame(frame);
  }
}

__main().catch((err) => {
  console.error(err);
  window.__errors = window.__errors || [];
  window.__errors.push(String(err && err.message ? err.message : err));
  const hint = document.getElementById("hint");
  if (hint) hint.textContent = "Bouquet failed to start.";
});
