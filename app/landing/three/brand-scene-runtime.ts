import {
  ACESFilmicToneMapping, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry,
  Scene, ShadowMaterial, SRGBColorSpace, WebGLRenderer,
} from "three";
import { BRAND_PATHS, createBrandGeometry } from "./brand-geometry";

export type BrandSceneHandle = { setActive: (active: boolean) => void; dispose: () => void };

export function createBrandScene(mount: HTMLElement, host: HTMLElement, onFailure: () => void): BrandSceneHandle {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // Explicit preflight avoids a renderer constructor error when WebGL is blocked.
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  if (!context || context.getParameter(context.MAX_TEXTURE_SIZE) < 4096) {
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error("Static brand fallback");
  }
  let renderer: WebGLRenderer | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const geometries: (ReturnType<typeof createBrandGeometry> | PlaneGeometry)[] = [];
  const materials: (MeshStandardMaterial | ShadowMaterial)[] = [];
  let key: DirectionalLight | undefined;
  let frame = 0, active = false, disposed = false, previous = 0, age = 0;
  let targetX = 0, targetY = 0, tiltX = 0, tiltY = 0;
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 1, 1200);
  camera.position.set(0, 0, 380);
  const model = new Group();
  const pieces: Mesh[] = [];
  const resting = [-0.1, -0.29, -0.1];

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    host.dataset.rendering = "paused";
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    resizeObserver?.disconnect();
    host.removeEventListener("pointermove", pointerMove);
    host.removeEventListener("pointerleave", pointerLeave);
    canvas.removeEventListener("webglcontextlost", contextLost);
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    key?.shadow.map?.dispose();
    scene.clear();
    renderer?.renderLists.dispose();
    renderer?.dispose();
    // Release the context too; Strict Mode remounts must not retain a GPU context.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
  }
  function fail() { dispose(); onFailure(); }
  function contextLost(event: Event) { event.preventDefault(); fail(); }
  function schedule() {
    if (!frame && active && !disposed) {
      host.dataset.rendering = "active";
      frame = requestAnimationFrame(tick);
    }
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const bounds = host.getBoundingClientRect();
    targetY = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1)) * 0.1;
    targetX = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1)) * 0.065;
    schedule();
  }
  function pointerLeave() { targetX = 0; targetY = 0; schedule(); }
  function tick(now: number) {
    frame = 0;
    if (!active || disposed) return;
    // One rAF chain, capped at 30 rendered frames/s.
    if (previous && now - previous < 1000 / 30) { schedule(); return; }
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 30;
    previous = now;
    age += dt;
    const reveal = Math.min(age / 1.8, 1);
    const ease = 1 - (1 - reveal) ** 3;
    const blend = 1 - Math.exp(-5 * dt);
    tiltX += (targetX - tiltX) * blend;
    tiltY += (targetY - tiltY) * blend;
    // Settle after twelve visible seconds. Cursor movement can request new frames.
    const ambient = Math.max(0, Math.min(1, (12 - age) / 2));
    model.rotation.set(resting[0] + tiltX + Math.sin(age * 0.48) * 0.022 * ambient, resting[1] + tiltY + Math.sin(age * 0.34) * 0.045 * ambient + (1 - ease) * 0.18, resting[2]);
    model.position.y = 5 + Math.sin(age * 0.65) * 1.5 * ambient;
    model.scale.setScalar(0.92 + ease * 0.08);
    pieces.forEach((piece, index) => {
      // Separate along their own sides, preserving the front/back ordering.
      piece.position.set((index ? 1 : -1) * (1 - ease) * 11, (index ? -1 : 1) * (1 - ease) * 8, index * 2);
    });
    if (key) key.intensity = 2.5 + ease * 1.3;
    try {
      renderer!.render(scene, camera);
      if (context!.isContextLost()) { fail(); return; }
    } catch { fail(); return; }
    if (age < 12 || Math.abs(targetX - tiltX) + Math.abs(targetY - tiltY) > 0.0001) schedule();
    else { previous = 0; host.dataset.rendering = "settled"; }
  }
  function resize() {
    if (disposed || !renderer) return;
    const { width, height } = mount.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    schedule();
  }
  try {
    canvas.addEventListener("webglcontextlost", contextLost);
    renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    renderer.setClearColor(0x082632, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    const palettes = [["#168b83", "#153e47"], ["#32b5ab", "#126b70"]];
    BRAND_PATHS.forEach((points, index) => {
      const geometry = createBrandGeometry(points);
      geometries.push(geometry);
      const face = new MeshStandardMaterial({ color: palettes[index][0], metalness: 0.48, roughness: 0.32 });
      const side = new MeshStandardMaterial({ color: palettes[index][1], metalness: 0.58, roughness: 0.4 });
      materials.push(face, side);
      const piece = new Mesh(geometry, [face, side]);
      piece.castShadow = true;
      piece.receiveShadow = true;
      model.add(piece);
      pieces.push(piece);
    });
    scene.add(model);
    scene.add(new HemisphereLight(0xdaf6f2, 0x153e47, 2.4));
    key = new DirectionalLight(0xe2fffa, 3.8);
    key.position.set(-100, 150, 230);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    Object.assign(key.shadow.camera, { left: -140, right: 140, top: 150, bottom: -150, near: 1, far: 600 });
    key.shadow.bias = -0.001;
    key.shadow.normalBias = 1;
    scene.add(key);
    const rim = new DirectionalLight(0x79c9d0, 3);
    rim.position.set(140, 30, -30);
    scene.add(rim);
    const shadowGeometry = new PlaneGeometry(310, 310);
    const shadowMaterial = new ShadowMaterial({ opacity: 0.22 });
    geometries.push(shadowGeometry);
    materials.push(shadowMaterial);
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.position.set(0, -5, -30);
    shadow.receiveShadow = true;
    scene.add(shadow);
    mount.appendChild(canvas);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    // Compile/render before hiding the server-rendered fallback.
    model.rotation.set(...resting as [number, number, number]);
    renderer.render(scene, camera);
    if (context.isContextLost()) throw new Error("Context unavailable");
    host.addEventListener("pointermove", pointerMove, { passive: true });
    host.addEventListener("pointerleave", pointerLeave);
    return {
      setActive(value) {
        if (disposed) return;
        active = value;
        if (active) schedule();
        else stop();
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
