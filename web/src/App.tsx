import { useRef, useEffect, useState, useCallback } from "react";
import { Shell } from "./components/Shell";
import { HUD } from "./components/HUD";
import * as BABYLON from "@babylonjs/core";
import type { GameState, Weapon } from "./lib/types";
import { createInitialState, ALL_WEAPONS } from "./lib/types";
import { initAudio, setMuted, isMuted, sfx } from "./lib/audio";
import { useHighScore } from "./hooks/useHighScore";

// ─── Constants ────────────────────────────────────────────────────────────────
const CITY_SIZE = 80;
const BUILDING_COUNT = 24;
const ZOMBIE_SPAWN_RADIUS = 30;
const PLAYER_SPEED = 8;
const SPRINT_SPEED = 14;
const STAMINA_DRAIN = 25;
const STAMINA_REGEN = 12;
const DAY_CYCLE_SPEED = 0.004;
const WAVE_DURATION = 60;
const SUPPLY_COUNT = 12;

// ─── Runtime types ────────────────────────────────────────────────────────────
interface ZombieEntity {
  mesh: BABYLON.Mesh;
  headMesh: BABYLON.Mesh;
  health: number;
  speed: number;
  damage: number;
  type: "walker" | "runner" | "brute" | "spitter";
  attackCooldown: number;
  groanTimer: number;
  isDead: boolean;
  deathTimer: number;
}

interface SupplyCrate {
  mesh: BABYLON.Mesh;
  type: "medkit" | "ammo" | "weapon" | "score";
  collected: boolean;
}

interface Projectile {
  mesh: BABYLON.Mesh;
  velocity: BABYLON.Vector3;
  damage: number;
  life: number;
  isExplosive: boolean;
}

interface GameLoop {
  state: GameState;
  zombies: ZombieEntity[];
  supplies: SupplyCrate[];
  projectiles: Projectile[];
  keys: Record<string, boolean>;
  mouseDX: number;
  mouseDY: number;
  lastFireTime: number;
  waveTimer: number;
  footstepTimer: number;
  hurtFlash: number;
  pickupFlash: number;
  pickupFlashText: string;
  missionNotify: { text: string; timer: number };
  playerCamera: BABYLON.FreeCamera | null;
  scene: BABYLON.Scene | null;
  engine: BABYLON.Engine | null;
  buildings: BABYLON.Mesh[];
  sunLight: BABYLON.DirectionalLight | null;
  ambientLight: BABYLON.HemisphericLight | null;
  pointerLocked: boolean;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const [highScore, updateHighScore] = useHighScore("zombie_highscore");
  const [hudState, setHudState] = useState<GameState>(() => createInitialState(highScore));
  const [muted, setMutedState] = useState(true);
  const [showInventory, setShowInventory] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [pickupFlash, setPickupFlash] = useState(0);
  const [pickupFlashText, setPickupFlashText] = useState("");
  const [missionNotify, setMissionNotify] = useState({ text: "", timer: 0 });

  // Sync HUD from loop ref at ~30fps
  useEffect(() => {
    const interval = setInterval(() => {
      const lp = loopRef.current;
      if (!lp) return;
      setHudState({ ...lp.state });
      setHurtFlash(lp.hurtFlash);
      setPickupFlash(lp.pickupFlash);
      setPickupFlashText(lp.pickupFlashText);
      setMissionNotify({ ...lp.missionNotify });
    }, 33);
    return () => clearInterval(interval);
  }, []);

  // Babylon.js setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.08, 0.12, 1);
    scene.gravity = new BABYLON.Vector3(0, -20, 0);
    scene.collisionsEnabled = true;

    // Camera
    const camera = new BABYLON.FreeCamera("playerCam", new BABYLON.Vector3(0, 1.7, 0), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1.7, 1));
    camera.minZ = 0.1;
    camera.maxZ = 300;
    camera.checkCollisions = true;
    camera.applyGravity = true;
    camera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
    camera.speed = 0;

    // Lighting
    const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene);
    ambient.intensity = 0.4;
    ambient.diffuse = new BABYLON.Color3(0.6, 0.7, 1.0);
    ambient.groundColor = new BABYLON.Color3(0.1, 0.1, 0.15);

    const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-1, -2, -1).normalize(), scene);
    sun.intensity = 1.2;
    sun.diffuse = new BABYLON.Color3(1.0, 0.9, 0.7);

    // Ground
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: CITY_SIZE * 2, height: CITY_SIZE * 2, subdivisions: 4 }, scene);
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.22);
    groundMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = groundMat;
    ground.checkCollisions = true;

    // Road grid
    for (let i = -3; i <= 3; i++) {
      const roadH = BABYLON.MeshBuilder.CreateGround(`roadH_${i}`, { width: CITY_SIZE * 2, height: 4 }, scene);
      roadH.position.z = i * 20;
      roadH.position.y = 0.01;
      const roadMatH = new BABYLON.StandardMaterial(`roadMatH_${i}`, scene);
      roadMatH.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14);
      roadH.material = roadMatH;

      const roadV = BABYLON.MeshBuilder.CreateGround(`roadV_${i}`, { width: 4, height: CITY_SIZE * 2 }, scene);
      roadV.position.x = i * 20;
      roadV.position.y = 0.011;
      const roadMatV = new BABYLON.StandardMaterial(`roadMatV_${i}`, scene);
      roadMatV.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14);
      roadV.material = roadMatV;
    }

    // Buildings
    const buildings: BABYLON.Mesh[] = [];
    const buildingPositions: BABYLON.Vector3[] = [];
    const buildingColors = [
      new BABYLON.Color3(0.35, 0.32, 0.28),
      new BABYLON.Color3(0.28, 0.30, 0.35),
      new BABYLON.Color3(0.25, 0.28, 0.32),
      new BABYLON.Color3(0.32, 0.28, 0.25),
      new BABYLON.Color3(0.22, 0.24, 0.28),
    ];
    const rng = (min: number, max: number) => min + Math.random() * (max - min);

    for (let i = 0; i < BUILDING_COUNT; i++) {
      let bx = 0, bz = 0;
      let attempts = 0;
      do {
        bx = rng(-CITY_SIZE * 0.8, CITY_SIZE * 0.8);
        bz = rng(-CITY_SIZE * 0.8, CITY_SIZE * 0.8);
        attempts++;
      } while (
        buildingPositions.some(p => Math.abs(p.x - bx) < 14 && Math.abs(p.z - bz) < 14) &&
        attempts < 50
      );

      const bw = rng(6, 14);
      const bd = rng(6, 14);
      const bh = rng(8, 30);

      const building = BABYLON.MeshBuilder.CreateBox(`building_${i}`, { width: bw, depth: bd, height: bh }, scene);
      building.position.set(bx, bh / 2, bz);
      building.checkCollisions = true;
      const bMat = new BABYLON.StandardMaterial(`buildMat_${i}`, scene);
      const colorIdx = Math.floor(Math.random() * buildingColors.length);
      bMat.diffuseColor = buildingColors[colorIdx] ?? new BABYLON.Color3(0.3, 0.3, 0.35);
      bMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      building.material = bMat;

      // Windows
      const windowRows = Math.floor(bh / 3);
      for (let wr = 0; wr < windowRows; wr++) {
        const win = BABYLON.MeshBuilder.CreatePlane(`win_${i}_${wr}`, { width: 1.2, height: 0.8 }, scene);
        win.position.set(bx + bw / 2 + 0.01, bh / 2 - 3 + wr * 2.8, bz);
        win.rotation.y = Math.PI / 2;
        const winMat = new BABYLON.StandardMaterial(`winMat_${i}_${wr}`, scene);
        winMat.emissiveColor = Math.random() > 0.4
          ? new BABYLON.Color3(0.8, 0.7, 0.3)
          : new BABYLON.Color3(0.05, 0.05, 0.08);
        win.material = winMat;
      }

      buildings.push(building);
      buildingPositions.push(new BABYLON.Vector3(bx, 0, bz));
    }

    // Street props
    for (let i = 0; i < 20; i++) {
      const cx = rng(-CITY_SIZE * 0.7, CITY_SIZE * 0.7);
      const cz = rng(-CITY_SIZE * 0.7, CITY_SIZE * 0.7);
      const car = BABYLON.MeshBuilder.CreateBox(`car_${i}`, { width: 2, depth: 4, height: 1.2 }, scene);
      car.position.set(cx, 0.6, cz);
      car.rotation.y = rng(0, Math.PI * 2);
      car.checkCollisions = true;
      const carMat = new BABYLON.StandardMaterial(`carMat_${i}`, scene);
      carMat.diffuseColor = new BABYLON.Color3(rng(0.2, 0.6), rng(0.1, 0.4), rng(0.1, 0.4));
      car.material = carMat;
    }

    // Fog
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.012;
    scene.fogColor = new BABYLON.Color3(0.05, 0.07, 0.1);

    // Supply crates
    const supplies: SupplyCrate[] = [];
    const crateTypes: Array<SupplyCrate["type"]> = ["medkit", "ammo", "weapon", "score"];
    const crateColors: Record<SupplyCrate["type"], BABYLON.Color3> = {
      medkit: new BABYLON.Color3(0.9, 0.2, 0.2),
      ammo: new BABYLON.Color3(0.9, 0.7, 0.1),
      weapon: new BABYLON.Color3(0.2, 0.5, 0.9),
      score: new BABYLON.Color3(0.2, 0.9, 0.4),
    };

    for (let i = 0; i < SUPPLY_COUNT; i++) {
      const sx = rng(-CITY_SIZE * 0.6, CITY_SIZE * 0.6);
      const sz = rng(-CITY_SIZE * 0.6, CITY_SIZE * 0.6);
      const crate = BABYLON.MeshBuilder.CreateBox(`crate_${i}`, { size: 0.8 }, scene);
      crate.position.set(sx, 0.4, sz);
      const ctype = crateTypes[i % crateTypes.length] ?? "score";
      const crateMat = new BABYLON.StandardMaterial(`crateMat_${i}`, scene);
      crateMat.diffuseColor = crateColors[ctype];
      crateMat.emissiveColor = crateColors[ctype].scale(0.3);
      crate.material = crateMat;
      supplies.push({ mesh: crate, type: ctype, collected: false });
    }

    // Loop ref
    const lp: GameLoop = {
      state: createInitialState(highScore),
      zombies: [],
      supplies,
      projectiles: [],
      keys: {},
      mouseDX: 0,
      mouseDY: 0,
      lastFireTime: 0,
      waveTimer: WAVE_DURATION,
      footstepTimer: 0,
      hurtFlash: 0,
      pickupFlash: 0,
      pickupFlashText: "",
      missionNotify: { text: "", timer: 0 },
      playerCamera: camera,
      scene,
      engine,
      buildings,
      sunLight: sun,
      ambientLight: ambient,
      pointerLocked: false,
    };
    loopRef.current = lp;

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      lp.keys[e.code] = true;
      if (lp.state.phase === "playing") {
        if (e.code === "Escape") { lp.state.phase = "paused"; document.exitPointerLock(); }
        if (e.code === "KeyH") useMedkit(lp);
        if (e.code === "KeyF") useAmmoBox(lp);
        if (e.code === "KeyU") upgradeWeapon(lp);
        if (e.code === "KeyR") reloadWeapon(lp);
        if (e.code === "Digit1") lp.state.activeWeaponIdx = 0;
        if (e.code === "Digit2" && lp.state.weapons.length > 1) lp.state.activeWeaponIdx = 1;
        if (e.code === "Digit3" && lp.state.weapons.length > 2) lp.state.activeWeaponIdx = 2;
        if (e.code === "Digit4" && lp.state.weapons.length > 3) lp.state.activeWeaponIdx = 3;
      } else if (lp.state.phase === "paused") {
        if (e.code === "Escape") lp.state.phase = "playing";
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { lp.keys[e.code] = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // Pointer lock
    canvas.addEventListener("click", () => {
      if (lp.state.phase === "playing") canvas.requestPointerLock();
    });
    const onPLChange = () => { lp.pointerLocked = document.pointerLockElement === canvas; };
    document.addEventListener("pointerlockchange", onPLChange);

    // Mouse look
    const onMouseMove = (e: MouseEvent) => {
      if (lp.pointerLocked && lp.state.phase === "playing") {
        lp.mouseDX += e.movementX * 0.002;
        lp.mouseDY += e.movementY * 0.002;
      }
    };
    document.addEventListener("mousemove", onMouseMove);

    // Fire
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && lp.state.phase === "playing" && lp.pointerLocked) {
        fireWeapon(lp, scene);
      }
    };
    document.addEventListener("mousedown", onMouseDown);

    // Touch controls
    let touchStartX = 0, touchStartY = 0;
    let moveTouch: Touch | null = null;
    let lookTouch: Touch | null = null;

    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.4 && !moveTouch) {
          moveTouch = t;
          touchStartX = t.clientX;
          touchStartY = t.clientY;
        } else if (!lookTouch) {
          lookTouch = t;
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          if (lp.state.phase === "playing") fireWeapon(lp, scene);
        }
      }
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (moveTouch && t.identifier === moveTouch.identifier) {
          const dx = t.clientX - touchStartX;
          const dz = t.clientY - touchStartY;
          lp.keys["TouchForward"] = dz < -15;
          lp.keys["TouchBack"] = dz > 15;
          lp.keys["TouchLeft"] = dx < -15;
          lp.keys["TouchRight"] = dx > 15;
        } else if (lookTouch && t.identifier === lookTouch.identifier) {
          lp.mouseDX += (t.clientX - touchStartX) * 0.003;
          lp.mouseDY += (t.clientY - touchStartY) * 0.003;
          touchStartX = t.clientX;
          touchStartY = t.clientY;
        }
      }
    }, { passive: false });

    canvas.addEventListener("touchend", (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (moveTouch && t.identifier === moveTouch.identifier) {
          moveTouch = null;
          lp.keys["TouchForward"] = false;
          lp.keys["TouchBack"] = false;
          lp.keys["TouchLeft"] = false;
          lp.keys["TouchRight"] = false;
        }
        if (lookTouch && t.identifier === lookTouch.identifier) lookTouch = null;
      }
    });

    // Render loop
    scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
      if (lp.state.phase !== "playing") return;
      updateGame(lp, dt, scene);
    });

    engine.runRenderLoop(() => scene.render());

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("pointerlockchange", onPLChange);
      engine.dispose();
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // HUD callbacks
  const handleStart = useCallback(() => {
    initAudio();
    const lp = loopRef.current;
    if (!lp || !lp.scene) return;
    lp.state = createInitialState(highScore);
    lp.state.phase = "playing";
    respawnPlayer(lp);
    clearZombies(lp);
    clearProjectiles(lp);
    resetSupplies(lp);
    lp.waveTimer = WAVE_DURATION;
    spawnWave(lp, lp.scene);
    sfx.waveStart();
    if (canvasRef.current) canvasRef.current.requestPointerLock();
  }, [highScore]);

  const handleResume = useCallback(() => {
    const lp = loopRef.current;
    if (!lp) return;
    lp.state.phase = "playing";
    if (canvasRef.current) canvasRef.current.requestPointerLock();
  }, []);

  const handleRestart = useCallback(() => {
    const lp = loopRef.current;
    if (!lp || !lp.scene) return;
    lp.state = createInitialState(highScore);
    lp.state.phase = "playing";
    respawnPlayer(lp);
    clearZombies(lp);
    clearProjectiles(lp);
    resetSupplies(lp);
    lp.waveTimer = WAVE_DURATION;
    spawnWave(lp, lp.scene);
    sfx.waveStart();
    if (canvasRef.current) canvasRef.current.requestPointerLock();
  }, [highScore]);

  const handleToggleMuted = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const handleUseMedkit = useCallback(() => {
    const lp = loopRef.current;
    if (!lp || lp.state.phase !== "playing") return;
    useMedkit(lp);
  }, []);

  const handleUseAmmoBox = useCallback(() => {
    const lp = loopRef.current;
    if (!lp || lp.state.phase !== "playing") return;
    useAmmoBox(lp);
  }, []);

  const handleUpgrade = useCallback(() => {
    const lp = loopRef.current;
    if (!lp || lp.state.phase !== "playing") return;
    upgradeWeapon(lp);
  }, []);

  const handleSwitchWeapon = useCallback((i: number) => {
    const lp = loopRef.current;
    if (!lp) return;
    lp.state.activeWeaponIdx = Math.min(i, lp.state.weapons.length - 1);
  }, []);

  // High score sync
  useEffect(() => {
    const interval = setInterval(() => {
      const lp = loopRef.current;
      if (!lp) return;
      if (lp.state.score > 0) updateHighScore(lp.state.score);
    }, 2000);
    return () => clearInterval(interval);
  }, [updateHighScore]);

  return (
    <Shell>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
        />
        <HUD
          state={hudState}
          hurtFlash={hurtFlash}
          pickupFlash={pickupFlash}
          pickupFlashText={pickupFlashText}
          missionNotify={missionNotify}
          onStart={handleStart}
          onResume={handleResume}
          onRestart={handleRestart}
          onToggleMuted={handleToggleMuted}
          muted={muted}
          showInventory={showInventory}
          onToggleInventory={() => setShowInventory(v => !v)}
          onUseMedkit={handleUseMedkit}
          onUseAmmoBox={handleUseAmmoBox}
          onUpgrade={handleUpgrade}
          onSwitchWeapon={handleSwitchWeapon}
        />
      </div>
    </Shell>
  );
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

function respawnPlayer(lp: GameLoop) {
  if (!lp.playerCamera) return;
  lp.playerCamera.position.set(0, 1.7, 0);
  lp.playerCamera.setTarget(new BABYLON.Vector3(0, 1.7, 5));
  lp.mouseDX = 0;
  lp.mouseDY = 0;
}

function clearZombies(lp: GameLoop) {
  for (const z of lp.zombies) {
    z.mesh.dispose();
    z.headMesh.dispose();
  }
  lp.zombies = [];
}

function clearProjectiles(lp: GameLoop) {
  for (const p of lp.projectiles) p.mesh.dispose();
  lp.projectiles = [];
}

function resetSupplies(lp: GameLoop) {
  for (const s of lp.supplies) {
    s.collected = false;
    s.mesh.setEnabled(true);
  }
  const scav = lp.state.missions.find(m => m.id === "collectSupplies");
  if (scav) scav.progress = 0;
}

function spawnWave(lp: GameLoop, scene: BABYLON.Scene) {
  const wave = lp.state.wave;
  const count = 5 + wave * 3;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = ZOMBIE_SPAWN_RADIUS + Math.random() * 15;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    let type: ZombieEntity["type"] = "walker";
    const roll = Math.random();
    if (wave >= 3 && roll < 0.15) type = "brute";
    else if (wave >= 2 && roll < 0.3) type = "runner";
    else if (wave >= 4 && roll < 0.45) type = "spitter";

    spawnZombie(lp, scene, x, z, type);
  }
}

function spawnZombie(lp: GameLoop, scene: BABYLON.Scene, x: number, z: number, type: ZombieEntity["type"]) {
  const cfgMap: Record<ZombieEntity["type"], { h: number; r: number; hp: number; speed: number; dmg: number; color: BABYLON.Color3 }> = {
    walker: { h: 1.8, r: 0.3, hp: 60,  speed: 2.5, dmg: 10, color: new BABYLON.Color3(0.3, 0.5, 0.2) },
    runner: { h: 1.6, r: 0.25, hp: 40, speed: 5.5, dmg: 8,  color: new BABYLON.Color3(0.5, 0.3, 0.2) },
    brute:  { h: 2.2, r: 0.5, hp: 200, speed: 1.8, dmg: 25, color: new BABYLON.Color3(0.4, 0.2, 0.2) },
    spitter:{ h: 1.7, r: 0.3, hp: 50,  speed: 2.0, dmg: 12, color: new BABYLON.Color3(0.2, 0.4, 0.2) },
  };
  const cfg = cfgMap[type];

  const body = BABYLON.MeshBuilder.CreateCapsule(`z_${Date.now()}_${Math.random()}`, { height: cfg.h, radius: cfg.r }, scene);
  body.position.set(x, cfg.h / 2, z);
  const mat = new BABYLON.StandardMaterial(`zm_${Math.random()}`, scene);
  mat.diffuseColor = cfg.color;
  body.material = mat;

  const head = BABYLON.MeshBuilder.CreateSphere(`zh_${Math.random()}`, { diameter: 0.4 }, scene);
  head.position.set(x, cfg.h + 0.1, z);
  const headMat = new BABYLON.StandardMaterial(`zhm_${Math.random()}`, scene);
  headMat.diffuseColor = new BABYLON.Color3(0.6, 0.5, 0.4);
  head.material = headMat;

  lp.zombies.push({
    mesh: body,
    headMesh: head,
    health: cfg.hp,
    speed: cfg.speed * (1 + (lp.state.wave - 1) * 0.1),
    damage: cfg.dmg,
    type,
    attackCooldown: 0,
    groanTimer: Math.random() * 5,
    isDead: false,
    deathTimer: 0,
  });
}

function fireWeapon(lp: GameLoop, scene: BABYLON.Scene) {
  const now = performance.now() / 1000;
  const weapon = lp.state.weapons[lp.state.activeWeaponIdx];
  if (!weapon) return;
  if (now - lp.lastFireTime < 1 / weapon.fireRate) return;
  if (weapon.id !== "fists" && weapon.ammo <= 0) { sfx.reload(); return; }

  lp.lastFireTime = now;
  const cam = lp.playerCamera;
  if (!cam) return;

  if (weapon.id !== "fists" && weapon.ammo !== Infinity) {
    weapon.ammo = Math.max(0, weapon.ammo - 1);
  }

  const dmgMult = 1 + weapon.upgradeLevel * 0.4;
  const damage = weapon.damage * dmgMult;

  if (weapon.id === "fists") {
    sfx.punch();
    const fwdRay = cam.getForwardRay(weapon.range);
    for (const z of lp.zombies) {
      if (z.isDead) continue;
      const dist = BABYLON.Vector3.Distance(z.mesh.position, cam.position);
      if (dist < weapon.range + 1) {
        const dir = z.mesh.position.subtract(cam.position).normalize();
        if (BABYLON.Vector3.Dot(fwdRay.direction, dir) > 0.6) {
          damageZombie(lp, z, damage, scene);
        }
      }
    }
    return;
  }

  const forward = cam.getForwardRay(1).direction;
  const spread = weapon.id === "shotgun" ? 0.08 : 0.01;
  const pellets = weapon.id === "shotgun" ? 6 : 1;

  for (let i = 0; i < pellets; i++) {
    const dir = forward.add(new BABYLON.Vector3(
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
    )).normalize();

    const bullet = BABYLON.MeshBuilder.CreateSphere(`b_${Date.now()}_${i}`, { diameter: 0.12 }, scene);
    bullet.position.copyFrom(cam.position).addInPlace(forward.scale(0.8));
    const bMat = new BABYLON.StandardMaterial(`bm_${Math.random()}`, scene);
    bMat.emissiveColor = weapon.id === "molotov"
      ? new BABYLON.Color3(1, 0.4, 0)
      : new BABYLON.Color3(1, 0.9, 0.3);
    bullet.material = bMat;

    lp.projectiles.push({
      mesh: bullet,
      velocity: dir.scale(weapon.id === "molotov" ? 18 : 60),
      damage: damage / pellets,
      life: weapon.range / 60,
      isExplosive: weapon.id === "molotov",
    });
  }

  if (weapon.id === "shotgun") sfx.shotgunBlast();
  else if (weapon.id === "rifle") sfx.rifleShot();
  else if (weapon.id === "molotov") sfx.molotov();
  else sfx.shoot();
}

function damageZombie(lp: GameLoop, z: ZombieEntity, damage: number, scene: BABYLON.Scene) {
  z.health -= damage;
  if (z.health <= 0 && !z.isDead) {
    z.isDead = true;
    z.deathTimer = 1.5;
    lp.state.kills++;
    lp.state.zombiesKilled++;
    lp.state.score += z.type === "brute" ? 50 : z.type === "runner" ? 30 : z.type === "spitter" ? 35 : 20;
    const mat = z.mesh.material as BABYLON.StandardMaterial;
    if (mat) mat.diffuseColor = new BABYLON.Color3(0.15, 0.05, 0.05);
    sfx.zombieDie();

    // Blood splat
    const splat = BABYLON.MeshBuilder.CreateDisc(`splat_${Math.random()}`, { radius: 0.6, tessellation: 8 }, scene);
    splat.position.set(z.mesh.position.x, 0.02, z.mesh.position.z);
    splat.rotation.x = Math.PI / 2;
    const splatMat = new BABYLON.StandardMaterial(`sm_${Math.random()}`, scene);
    splatMat.diffuseColor = new BABYLON.Color3(0.4, 0.0, 0.0);
    splat.material = splatMat;
    setTimeout(() => { if (!splat.isDisposed()) splat.dispose(); }, 15000);

    updateMission(lp, "kill10", 1);
  }
}

function updateMission(lp: GameLoop, id: string, delta: number) {
  const m = lp.state.missions.find(m => m.id === id);
  if (!m || m.status !== "active") return;
  m.progress += delta;
  if (m.progress >= m.goal) {
    m.status = "complete";
    m.progress = m.goal;
    lp.state.score += 500;
    lp.missionNotify = { text: `✅ Mission Complete: ${m.title} (+500pts)`, timer: 3 };
    sfx.missionComplete();
  }
}

function useMedkit(lp: GameLoop) {
  const item = lp.state.inventory.find(i => i.id === "medkit");
  if (!item || item.count <= 0 || lp.state.health >= lp.state.maxHealth) return;
  item.count--;
  lp.state.health = Math.min(lp.state.maxHealth, lp.state.health + 50);
  lp.pickupFlash = 1.5;
  lp.pickupFlashText = "❤️ +50 Health";
  sfx.pickup();
}

function useAmmoBox(lp: GameLoop) {
  const item = lp.state.inventory.find(i => i.id === "ammo");
  if (!item || item.count <= 0) return;
  item.count--;
  for (const w of lp.state.weapons) {
    if (w.id !== "fists") w.ammo = Math.min(w.maxAmmo, w.ammo + Math.floor(w.maxAmmo * 0.5));
  }
  lp.pickupFlash = 1.5;
  lp.pickupFlashText = "📦 Ammo Restocked!";
  sfx.pickup();
}

function reloadWeapon(lp: GameLoop) {
  const w = lp.state.weapons[lp.state.activeWeaponIdx];
  if (!w || w.id === "fists") return;
  const ammoItem = lp.state.inventory.find(i => i.id === "ammo");
  if (!ammoItem || ammoItem.count <= 0 || w.ammo >= w.maxAmmo) return;
  ammoItem.count--;
  w.ammo = w.maxAmmo;
  sfx.reload();
  lp.pickupFlash = 1;
  lp.pickupFlashText = "🔄 Reloaded!";
}

function upgradeWeapon(lp: GameLoop) {
  const w = lp.state.weapons[lp.state.activeWeaponIdx];
  if (!w || w.id === "fists" || w.upgradeLevel >= 3) return;
  const cost = (w.upgradeLevel + 1) * 150;
  if (lp.state.score < cost) return;
  lp.state.score -= cost;
  w.upgradeLevel++;
  w.damage = Math.round(w.damage * 1.35);
  w.fireRate = Math.round(w.fireRate * 1.15 * 10) / 10;
  lp.pickupFlash = 2;
  lp.pickupFlashText = `⬆️ ${w.name} Upgraded! (Lv${w.upgradeLevel})`;
  sfx.missionComplete();
}

function collectCrate(lp: GameLoop, crate: SupplyCrate) {
  crate.collected = true;
  crate.mesh.setEnabled(false);
  sfx.pickup();

  const state = lp.state;
  if (crate.type === "medkit") {
    const item = state.inventory.find(i => i.id === "medkit");
    if (item) item.count += 2;
    else state.inventory.push({ id: "medkit", name: "Medkit", count: 2, icon: "🩺" });
    lp.pickupFlash = 1.5;
    lp.pickupFlashText = "🩺 Found Medkits ×2!";
  } else if (crate.type === "ammo") {
    const item = state.inventory.find(i => i.id === "ammo");
    if (item) item.count += 3;
    else state.inventory.push({ id: "ammo", name: "Ammo Box", count: 3, icon: "📦" });
    lp.pickupFlash = 1.5;
    lp.pickupFlashText = "📦 Found Ammo ×3!";
  } else if (crate.type === "weapon") {
    grantRandomWeapon(lp);
  } else {
    state.score += 200;
    lp.pickupFlash = 1.5;
    lp.pickupFlashText = "⭐ +200 Score!";
  }

  updateMission(lp, "collectSupplies", 1);
}

function grantRandomWeapon(lp: GameLoop) {
  const available = (["shotgun", "rifle", "molotov"] as const).filter(
    id => !lp.state.weapons.find(w => w.id === id)
  );
  if (available.length === 0) {
    lp.state.score += 300;
    lp.pickupFlash = 1.5;
    lp.pickupFlashText = "🔫 +300 Score (duplicate weapon)";
    return;
  }
  const id = available[Math.floor(Math.random() * available.length)];
  if (!id) return;
  const template = ALL_WEAPONS[id];
  const newWeapon: Weapon = {
    ...template,
    ammo: Math.floor(template.maxAmmo * 0.6),
    upgradeLevel: 0,
  };
  lp.state.weapons.push(newWeapon);
  lp.pickupFlash = 2;
  lp.pickupFlashText = `${template.icon} Found ${template.name}!`;
}

function explode(lp: GameLoop, pos: BABYLON.Vector3, damage: number, scene: BABYLON.Scene) {
  const radius = 5;
  for (const z of lp.zombies) {
    if (z.isDead) continue;
    const dist = BABYLON.Vector3.Distance(pos, z.mesh.position);
    if (dist < radius) damageZombie(lp, z, damage * (1 - dist / radius), scene);
  }
  const flash = BABYLON.MeshBuilder.CreateSphere(`expl_${Math.random()}`, { diameter: radius * 2 }, scene);
  flash.position.copyFrom(pos);
  const fMat = new BABYLON.StandardMaterial(`fm_${Math.random()}`, scene);
  fMat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
  fMat.alpha = 0.6;
  flash.material = fMat;
  setTimeout(() => { if (!flash.isDisposed()) flash.dispose(); }, 300);
}

// ─── Main update ──────────────────────────────────────────────────────────────
function updateGame(lp: GameLoop, dt: number, scene: BABYLON.Scene) {
  const state = lp.state;
  const cam = lp.playerCamera;
  if (!cam) return;

  // Mouse look
  if (lp.mouseDX !== 0 || lp.mouseDY !== 0) {
    cam.rotation.y += lp.mouseDX;
    cam.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cam.rotation.x + lp.mouseDY));
    lp.mouseDX = 0;
    lp.mouseDY = 0;
  }

  // Player movement
  const sprinting = (lp.keys["ShiftLeft"] === true || lp.keys["ShiftRight"] === true) && state.stamina > 5;
  const speed = sprinting ? SPRINT_SPEED : PLAYER_SPEED;

  if (sprinting) {
    state.stamina = Math.max(0, state.stamina - STAMINA_DRAIN * dt);
  } else {
    state.stamina = Math.min(state.maxStamina, state.stamina + STAMINA_REGEN * dt);
  }

  const fwd = cam.getForwardRay(1).direction.clone();
  const right = BABYLON.Vector3.Cross(fwd, BABYLON.Vector3.Up()).normalize();
  fwd.y = 0;
  fwd.normalize();

  const moveDir = new BABYLON.Vector3(0, 0, 0);
  if (lp.keys["KeyW"] === true || lp.keys["ArrowUp"] === true || lp.keys["TouchForward"] === true) moveDir.addInPlace(fwd);
  if (lp.keys["KeyS"] === true || lp.keys["ArrowDown"] === true || lp.keys["TouchBack"] === true) moveDir.subtractInPlace(fwd);
  if (lp.keys["KeyA"] === true || lp.keys["ArrowLeft"] === true || lp.keys["TouchLeft"] === true) moveDir.subtractInPlace(right);
  if (lp.keys["KeyD"] === true || lp.keys["ArrowRight"] === true || lp.keys["TouchRight"] === true) moveDir.addInPlace(right);

  const moving = moveDir.length() > 0.01;
  if (moving) {
    moveDir.normalize();
    cam.position.addInPlace(moveDir.scale(speed * dt));
    lp.footstepTimer -= dt;
    if (lp.footstepTimer <= 0) {
      sfx.footstep();
      lp.footstepTimer = sprinting ? 0.25 : 0.4;
    }
  }

  cam.position.x = Math.max(-CITY_SIZE, Math.min(CITY_SIZE, cam.position.x));
  cam.position.z = Math.max(-CITY_SIZE, Math.min(CITY_SIZE, cam.position.z));
  cam.position.y = Math.max(1.7, cam.position.y);

  // Day/night cycle
  state.timeOfDay = (state.timeOfDay + DAY_CYCLE_SPEED * dt) % 1;
  updateDayNight(lp, state.timeOfDay);

  // Wave timer
  lp.waveTimer -= dt;
  const aliveZombies = lp.zombies.filter(z => !z.isDead).length;

  if (aliveZombies === 0 || lp.waveTimer <= 0) {
    state.wave++;
    state.day = Math.floor(state.wave / 3) + 1;
    state.difficulty = 1 + (state.wave - 1) * 0.15;
    lp.waveTimer = WAVE_DURATION;
    spawnWave(lp, scene);
    sfx.waveStart();
    updateMission(lp, "survive3waves", 1);
    lp.pickupFlash = 2;
    lp.pickupFlashText = `🌊 Wave ${state.wave} Incoming!`;

    // Respawn some supplies every 2 waves
    if (state.wave % 2 === 0) {
      for (const s of lp.supplies) {
        if (s.collected && Math.random() > 0.5) {
          s.collected = false;
          s.mesh.setEnabled(true);
          s.mesh.position.set(
            (Math.random() - 0.5) * CITY_SIZE * 1.2,
            0.4,
            (Math.random() - 0.5) * CITY_SIZE * 1.2,
          );
        }
      }
    }
  }

  // Update zombies
  const playerPos = cam.position;
  const toRemove: ZombieEntity[] = [];

  for (const z of lp.zombies) {
    if (z.isDead) {
      z.deathTimer -= dt;
      if (z.deathTimer <= 0) toRemove.push(z);
      continue;
    }

    const dir = playerPos.subtract(z.mesh.position);
    dir.y = 0;
    const dist = dir.length();

    if (dist > 0.1) {
      dir.normalize();
      z.mesh.position.addInPlace(dir.scale(z.speed * dt * state.difficulty));
      z.headMesh.position.set(z.mesh.position.x, z.mesh.position.y + 1.1, z.mesh.position.z);
      z.mesh.lookAt(new BABYLON.Vector3(playerPos.x, z.mesh.position.y, playerPos.z));
    }

    if (dist < 1.5) {
      z.attackCooldown -= dt;
      if (z.attackCooldown <= 0) {
        z.attackCooldown = 1.2;
        state.health -= z.damage * state.difficulty;
        lp.hurtFlash = 1;
        sfx.playerHurt();
        if (state.health <= 0) {
          state.health = 0;
          state.phase = "gameover";
          sfx.gameOver();
          document.exitPointerLock();
        }
      }
    }

    z.groanTimer -= dt;
    if (z.groanTimer <= 0) {
      z.groanTimer = 4 + Math.random() * 6;
      if (dist < 25) sfx.zombieGroan();
    }

    // Spitter ranged attack
    if (z.type === "spitter" && dist > 4 && dist < 20) {
      z.attackCooldown -= dt;
      if (z.attackCooldown <= 0) {
        z.attackCooldown = 3;
        const aBullet = BABYLON.MeshBuilder.CreateSphere(`acid_${Math.random()}`, { diameter: 0.2 }, scene);
        aBullet.position.copyFrom(z.mesh.position).addInPlace(new BABYLON.Vector3(0, 1.2, 0));
        const aMat = new BABYLON.StandardMaterial(`am_${Math.random()}`, scene);
        aMat.emissiveColor = new BABYLON.Color3(0.2, 1, 0.2);
        aBullet.material = aMat;
        const aimDir = playerPos.subtract(aBullet.position).normalize();
        lp.projectiles.push({
          mesh: aBullet,
          velocity: aimDir.scale(12),
          damage: -(z.damage),
          life: 3,
          isExplosive: false,
        });
      }
    }
  }

  for (const z of toRemove) {
    z.mesh.dispose();
    z.headMesh.dispose();
    const idx = lp.zombies.indexOf(z);
    if (idx >= 0) lp.zombies.splice(idx, 1);
  }

  // Update projectiles
  const projToRemove: Projectile[] = [];

  for (const p of lp.projectiles) {
    p.mesh.position.addInPlace(p.velocity.scale(dt));
    p.life -= dt;

    if (p.life <= 0) {
      projToRemove.push(p);
      if (p.isExplosive) explode(lp, p.mesh.position, p.damage, scene);
      continue;
    }

    if (p.damage > 0) {
      for (const z of lp.zombies) {
        if (z.isDead) continue;
        if (BABYLON.Vector3.Distance(p.mesh.position, z.mesh.position) < 0.8) {
          damageZombie(lp, z, p.damage, scene);
          if (!p.isExplosive) projToRemove.push(p);
          break;
        }
      }
    } else {
      if (BABYLON.Vector3.Distance(p.mesh.position, playerPos) < 0.6) {
        state.health -= Math.abs(p.damage) * state.difficulty;
        lp.hurtFlash = 0.8;
        sfx.playerHurt();
        projToRemove.push(p);
        if (state.health <= 0) {
          state.health = 0;
          state.phase = "gameover";
          sfx.gameOver();
          document.exitPointerLock();
        }
      }
    }
  }

  for (const p of projToRemove) {
    if (!p.mesh.isDisposed()) p.mesh.dispose();
    const idx = lp.projectiles.indexOf(p);
    if (idx >= 0) lp.projectiles.splice(idx, 1);
  }

  // Supply crate collection + bob animation
  for (const s of lp.supplies) {
    if (s.collected) continue;
    if (BABYLON.Vector3.Distance(s.mesh.position, playerPos) < 1.5) {
      collectCrate(lp, s);
      continue;
    }
    s.mesh.position.y = 0.4 + Math.sin(performance.now() / 600 + s.mesh.position.x) * 0.15;
    s.mesh.rotation.y += dt * 1.2;
  }

  // Decay timers
  if (lp.hurtFlash > 0) lp.hurtFlash = Math.max(0, lp.hurtFlash - dt * 2);
  if (lp.pickupFlash > 0) lp.pickupFlash = Math.max(0, lp.pickupFlash - dt * 1.5);
  if (lp.missionNotify.timer > 0) lp.missionNotify.timer -= dt;
}

function updateDayNight(lp: GameLoop, t: number) {
  const sun = lp.sunLight;
  const amb = lp.ambientLight;
  const scene = lp.scene;
  if (!sun || !amb || !scene) return;

  if (t < 0.15) {
    const p = t / 0.15;
    sun.intensity = 0.3 + p * 0.9;
    sun.diffuse = new BABYLON.Color3(1.0, 0.6 + p * 0.3, 0.3 + p * 0.4);
    amb.intensity = 0.2 + p * 0.3;
    scene.fogColor = new BABYLON.Color3(0.3 + p * 0.2, 0.2 + p * 0.2, 0.15 + p * 0.1);
    scene.clearColor = new BABYLON.Color4(0.3 + p * 0.3, 0.2 + p * 0.3, 0.15 + p * 0.25, 1);
    scene.fogDensity = 0.012;
  } else if (t < 0.45) {
    sun.intensity = 1.2;
    sun.diffuse = new BABYLON.Color3(1.0, 0.95, 0.85);
    amb.intensity = 0.5;
    scene.fogColor = new BABYLON.Color3(0.5, 0.55, 0.65);
    scene.clearColor = new BABYLON.Color4(0.4, 0.55, 0.75, 1);
    scene.fogDensity = 0.012;
  } else if (t < 0.55) {
    const p = (t - 0.45) / 0.1;
    sun.intensity = 1.2 - p * 0.9;
    sun.diffuse = new BABYLON.Color3(1.0, 0.5 - p * 0.2, 0.1);
    amb.intensity = 0.5 - p * 0.3;
    scene.fogColor = new BABYLON.Color3(0.5 - p * 0.4, 0.3 - p * 0.2, 0.2 - p * 0.15);
    scene.clearColor = new BABYLON.Color4(0.4 - p * 0.35, 0.3 - p * 0.25, 0.2 - p * 0.18, 1);
    scene.fogDensity = 0.012 + p * 0.006;
  } else {
    sun.intensity = 0.05;
    sun.diffuse = new BABYLON.Color3(0.3, 0.35, 0.5);
    amb.intensity = 0.12;
    scene.fogColor = new BABYLON.Color3(0.04, 0.05, 0.08);
    scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.06, 1);
    scene.fogDensity = 0.018;
  }

  const angle = t * Math.PI * 2;
  sun.direction = new BABYLON.Vector3(
    Math.cos(angle),
    -Math.abs(Math.sin(angle)) - 0.3,
    Math.sin(angle * 0.5),
  ).normalize();
}
