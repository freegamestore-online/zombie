import * as BABYLON from "@babylonjs/core";
import { sfx } from "./audio";
import type { GameState, Weapon, ZombieType } from "./types";
import { createInitialState, ALL_WEAPONS } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────
const CITY_SIZE = 80;
const BUILDING_COUNT = 28;
const DAY_DURATION = 120; // seconds per full day
const ZOMBIE_GROAN_INTERVAL = 3000;
const FOOTSTEP_INTERVAL = 380;
const STAMINA_DRAIN = 22; // per second while sprinting
const STAMINA_REGEN = 10; // per second while not sprinting
const PLAYER_SPEED = 8;
const SPRINT_MULT = 1.7;
const MAX_ZOMBIES = 40;

// ─── Internal types ───────────────────────────────────────────────────────────
interface ZombieAgent {
  mesh: BABYLON.Mesh;
  hp: number;
  maxHp: number;
  type: ZombieType;
  speed: number;
  damage: number;
  attackCooldown: number;
  groanTimer: number;
  dead: boolean;
  onFire: boolean;
  fireTimer: number;
}

interface Pickup {
  mesh: BABYLON.Mesh;
  kind: "medkit" | "ammo" | "weapon" | "supply";
  weaponId?: string;
  collected: boolean;
}

interface Building {
  mesh: BABYLON.Mesh;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

// ─── Game Engine ──────────────────────────────────────────────────────────────
export class ZombieGame {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.FreeCamera;
  private sunLight!: BABYLON.DirectionalLight;
  private ambientLight!: BABYLON.HemisphericLight;
  private shadowGenerator!: BABYLON.ShadowGenerator;

  private state: GameState;
  private onStateChange: (s: GameState) => void;

  private zombies: ZombieAgent[] = [];
  private pickups: Pickup[] = [];
  private buildings: Building[] = [];
  private playerMesh!: BABYLON.Mesh; // invisible collision capsule

  // Input
  private keys: Record<string, boolean> = {};
  private mouseDown = false;
  private mouseLocked = false;
  private yaw = 0;
  private pitch = 0;

  // Timers
  private shootCooldown = 0;
  private waveTimer = 0;
  private waveSpawnCount = 0;
  private waveSpawnTotal = 0;
  private waveSpawnInterval = 0;
  private waveSpawnTimer = 0;
  private footstepTimer = 0;
  private groanTimer = 0;
  private lastTime = 0;
  private dayTimer = 0;
  private missionNotifyTimer = 0;
  private missionNotifyText = "";
  private hurtFlash = 0;
  private pickupFlash = 0;
  private pickupFlashText = "";

  // Materials cache
  private matCache: Map<string, BABYLON.StandardMaterial> = new Map();

  // Fog / sky
  private fogColor!: BABYLON.Color3;

  constructor(canvas: HTMLCanvasElement, highScore: number, onChange: (s: GameState) => void) {
    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.state = createInitialState(highScore);
    this.onStateChange = onChange;

    this.buildScene();
    this.setupInput(canvas);

    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.05);
      this.lastTime = now;
      if (this.state.phase === "playing") this.tick(dt);
      this.scene.render();
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  // ── Scene Setup ──────────────────────────────────────────────────────────────
  private buildScene() {
    const scene = this.scene;
    scene.gravity = new BABYLON.Vector3(0, -20, 0);
    scene.collisionsEnabled = true;
    scene.clearColor = new BABYLON.Color4(0.05, 0.07, 0.12, 1);

    // Fog
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.018;
    this.fogColor = new BABYLON.Color3(0.5, 0.55, 0.6);
    scene.fogColor = this.fogColor;

    // Lights
    this.ambientLight = new BABYLON.HemisphericLight("amb", new BABYLON.Vector3(0, 1, 0), scene);
    this.ambientLight.intensity = 0.4;
    this.ambientLight.diffuse = new BABYLON.Color3(0.8, 0.85, 1.0);
    this.ambientLight.groundColor = new BABYLON.Color3(0.1, 0.1, 0.15);

    this.sunLight = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-1, -2, -1), scene);
    this.sunLight.intensity = 1.2;
    this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.8);
    this.sunLight.position = new BABYLON.Vector3(30, 40, 30);

    // Shadows
    this.shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 16;

    // Camera
    this.camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 200;
    this.camera.checkCollisions = true;
    this.camera.applyGravity = true;
    this.camera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);

    // Ground
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: CITY_SIZE, height: CITY_SIZE, subdivisions: 4 }, scene);
    const gm = this.mat("ground", 0.18, 0.19, 0.2);
    ground.material = gm;
    ground.checkCollisions = true;
    ground.receiveShadows = true;

    // Roads grid
    this.buildRoads();

    // Buildings
    this.buildCity();

    // Pickups
    this.spawnInitialPickups();

    // Player invisible mesh for reference
    this.playerMesh = BABYLON.MeshBuilder.CreateCylinder("player", { height: 1.8, diameter: 0.9 }, scene);
    this.playerMesh.isVisible = false;
    this.playerMesh.checkCollisions = false;
  }

  private mat(key: string, r: number, g: number, b: number, emissive?: BABYLON.Color3): BABYLON.StandardMaterial {
    if (this.matCache.has(key)) return this.matCache.get(key)!;
    const m = new BABYLON.StandardMaterial(key, this.scene);
    m.diffuseColor = new BABYLON.Color3(r, g, b);
    if (emissive) m.emissiveColor = emissive;
    this.matCache.set(key, m);
    return m;
  }

  private buildRoads() {
    const scene = this.scene;
    // Main cross roads
    const roadMat = this.mat("road", 0.12, 0.12, 0.14);
    const roadH = BABYLON.MeshBuilder.CreateGround("roadH", { width: CITY_SIZE, height: 10 }, scene);
    roadH.material = roadMat;
    roadH.position.y = 0.01;
    const roadV = BABYLON.MeshBuilder.CreateGround("roadV", { width: 10, height: CITY_SIZE }, scene);
    roadV.material = roadMat;
    roadV.position.y = 0.01;
    // Lane markings
    for (let i = -3; i <= 3; i++) {
      const stripe = BABYLON.MeshBuilder.CreateGround(`stripeH${i}`, { width: 4, height: 0.3 }, scene);
      stripe.material = this.mat("stripe", 0.9, 0.85, 0.1);
      stripe.position.set(i * 10, 0.02, 0);
      const stripeV = BABYLON.MeshBuilder.CreateGround(`stripeV${i}`, { width: 0.3, height: 4 }, scene);
      stripeV.material = this.mat("stripe", 0.9, 0.85, 0.1);
      stripeV.position.set(0, 0.02, i * 10);
    }
  }

  private buildCity() {
    const scene = this.scene;
    const rng = this.seededRng(42);

    const buildingColors: Array<[number, number, number]> = [
      [0.25, 0.27, 0.3], [0.3, 0.25, 0.22], [0.22, 0.28, 0.32],
      [0.28, 0.28, 0.25], [0.2, 0.22, 0.25], [0.35, 0.3, 0.28],
    ];

    const placed: Array<{ x: number; z: number; w: number; d: number }> = [];

    for (let i = 0; i < BUILDING_COUNT; i++) {
      let x = 0, z = 0, w = 0, d = 0;
      let tries = 0;
      do {
        x = (rng() - 0.5) * (CITY_SIZE - 12);
        z = (rng() - 0.5) * (CITY_SIZE - 12);
        w = 4 + rng() * 10;
        d = 4 + rng() * 10;
        tries++;
      } while (tries < 30 && (
        Math.abs(x) < 7 && Math.abs(z) < 7 || // keep center clear
        placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 + 2 && Math.abs(p.z - z) < (p.d + d) / 2 + 2)
      ));

      const h = 4 + rng() * 20;
      const col = buildingColors[Math.floor(rng() * buildingColors.length)]!;

      const b = BABYLON.MeshBuilder.CreateBox(`bld${i}`, { width: w, height: h, depth: d }, scene);
      b.position.set(x, h / 2, z);
      b.material = this.mat(`bld${i}`, col[0], col[1], col[2]);
      b.checkCollisions = true;
      b.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(b);

      // Windows (emissive planes)
      const wRows = Math.floor(h / 2.5);
      const wCols = Math.floor(w / 2);
      for (let wr = 0; wr < wRows; wr++) {
        for (let wc = 0; wc < wCols; wc++) {
          if (rng() > 0.55) continue;
          const lit = rng() > 0.4;
          const wp = BABYLON.MeshBuilder.CreatePlane(`win${i}_${wr}_${wc}`, { width: 0.7, height: 0.9 }, scene);
          wp.position.set(x - w / 2 + 1 + wc * 2, 1.5 + wr * 2.5, z + d / 2 + 0.05);
          const wm = new BABYLON.StandardMaterial(`wm${i}_${wr}_${wc}`, scene);
          wm.emissiveColor = lit
            ? new BABYLON.Color3(0.9 + rng() * 0.1, 0.85 + rng() * 0.1, 0.5 + rng() * 0.3)
            : new BABYLON.Color3(0.05, 0.07, 0.1);
          wp.material = wm;
        }
      }

      placed.push({ x, z, w, d });
      this.buildings.push({
        mesh: b,
        bounds: { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 },
      });
    }

    // Street lights
    const rng2 = this.seededRng(99);
    for (let i = 0; i < 20; i++) {
      const lx = (rng2() - 0.5) * (CITY_SIZE - 4);
      const lz = (rng2() - 0.5) * (CITY_SIZE - 4);
      const pole = BABYLON.MeshBuilder.CreateCylinder(`pole${i}`, { height: 6, diameter: 0.15 }, scene);
      pole.position.set(lx, 3, lz);
      pole.material = this.mat("metal", 0.3, 0.3, 0.35);
      pole.checkCollisions = true;

      const lamp = BABYLON.MeshBuilder.CreateSphere(`lamp${i}`, { diameter: 0.4 }, scene);
      lamp.position.set(lx, 6.2, lz);
      const lm = new BABYLON.StandardMaterial(`lampMat${i}`, scene);
      lm.emissiveColor = new BABYLON.Color3(1, 0.95, 0.6);
      lamp.material = lm;

      const pl = new BABYLON.PointLight(`pl${i}`, new BABYLON.Vector3(lx, 6, lz), scene);
      pl.intensity = 0.6;
      pl.range = 12;
      pl.diffuse = new BABYLON.Color3(1, 0.9, 0.6);
    }

    // Debris / props
    const rng3 = this.seededRng(77);
    for (let i = 0; i < 30; i++) {
      const px = (rng3() - 0.5) * (CITY_SIZE - 4);
      const pz = (rng3() - 0.5) * (CITY_SIZE - 4);
      const debris = BABYLON.MeshBuilder.CreateBox(`debris${i}`, {
        width: 0.5 + rng3() * 1.5,
        height: 0.3 + rng3() * 0.8,
        depth: 0.5 + rng3() * 1.5,
      }, scene);
      debris.position.set(px, 0.3, pz);
      debris.rotation.y = rng3() * Math.PI * 2;
      debris.material = this.mat("debris", 0.2 + rng3() * 0.15, 0.18 + rng3() * 0.1, 0.15 + rng3() * 0.1);
      debris.checkCollisions = true;
    }
  }

  private spawnInitialPickups() {
    const rng = this.seededRng(55);
    const kinds: Array<Pickup["kind"]> = ["medkit", "ammo", "supply", "ammo", "medkit", "supply", "weapon", "ammo"];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i]!;
      let px = (rng() - 0.5) * 50;
      let pz = (rng() - 0.5) * 50;
      // keep away from spawn
      if (Math.abs(px) < 5) px += 8;
      if (Math.abs(pz) < 5) pz += 8;
      this.spawnPickup(px, pz, kind, i === 6 ? "shotgun" : undefined);
    }
  }

  private spawnPickup(x: number, z: number, kind: Pickup["kind"], weaponId?: string) {
    const colors: Record<Pickup["kind"], [number, number, number]> = {
      medkit: [0.9, 0.1, 0.1],
      ammo: [0.9, 0.7, 0.1],
      supply: [0.1, 0.6, 0.9],
      weapon: [0.6, 0.9, 0.2],
    };
    const col = colors[kind];
    const mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${kind}_${Date.now()}_${Math.random()}`, { size: 0.6 }, this.scene);
    mesh.position.set(x, 0.4, z);
    mesh.material = this.mat(`pm_${kind}`, col[0], col[1], col[2], new BABYLON.Color3(col[0] * 0.3, col[1] * 0.3, col[2] * 0.3));
    this.pickups.push({ mesh, kind, weaponId, collected: false });
    // Animate pickup bob
    let t = Math.random() * Math.PI * 2;
    this.scene.onBeforeRenderObservable.add(() => {
      if (!mesh.isDisposed()) {
        t += 0.03;
        mesh.position.y = 0.4 + Math.sin(t) * 0.15;
        mesh.rotation.y += 0.02;
      }
    });
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  private setupInput(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "Escape") this.togglePause();
      if (e.code === "KeyR") this.reload();
      if (e.code === "Digit1") this.switchWeapon(0);
      if (e.code === "Digit2") this.switchWeapon(1);
      if (e.code === "Digit3") this.switchWeapon(2);
      if (e.code === "Digit4") this.switchWeapon(3);
      if (e.code === "KeyH") this.useMedkit();
      if (e.code === "KeyF") this.useAmmoBox();
      if (e.code === "KeyU") this.upgradeWeapon();
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });

    canvas.addEventListener("click", () => {
      if (this.state.phase === "playing" && !this.mouseLocked) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.mouseLocked = document.pointerLockElement === canvas;
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!this.mouseLocked || this.state.phase !== "playing") return;
      const sens = 0.002;
      this.yaw += e.movementX * sens;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + e.movementY * sens));
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.y = this.yaw;
    });

    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    canvas.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
  }

  // ── Game Loop ─────────────────────────────────────────────────────────────────
  private tick(dt: number) {
    this.updateDayNight(dt);
    this.updatePlayer(dt);
    this.updateShooting(dt);
    this.updateZombies(dt);
    this.updatePickups();
    this.updateWave(dt);
    this.updateMissions();
    this.updateTimers(dt);
    this.playerMesh.position.copyFrom(this.camera.position);
    this.emit();
  }

  private updateDayNight(dt: number) {
    this.dayTimer += dt;
    if (this.dayTimer >= DAY_DURATION) {
      this.dayTimer -= DAY_DURATION;
      this.state.day++;
      this.state.difficulty = Math.min(5, 1 + (this.state.day - 1) * 0.3);
    }
    const t = this.dayTimer / DAY_DURATION; // 0–1
    this.state.timeOfDay = t;

    // Sun angle
    const angle = t * Math.PI * 2 - Math.PI / 2;
    this.sunLight.direction.set(Math.cos(angle), -Math.abs(Math.sin(angle)) - 0.3, 0.5);

    // Day/night colors
    // t=0 dawn, t=0.25 noon, t=0.5 dusk, t=0.75 midnight
    let skyR: number, skyG: number, skyB: number;
    let sunInt: number, ambInt: number;
    let fogD: number;

    if (t < 0.1) { // dawn
      const p = t / 0.1;
      skyR = lerp(0.05, 0.6, p); skyG = lerp(0.05, 0.5, p); skyB = lerp(0.15, 0.7, p);
      sunInt = lerp(0.1, 1.2, p); ambInt = lerp(0.1, 0.5, p);
      fogD = lerp(0.025, 0.018, p);
      this.sunLight.diffuse.set(lerp(1, 1, p), lerp(0.5, 0.95, p), lerp(0.3, 0.8, p));
    } else if (t < 0.4) { // day
      const p = (t - 0.1) / 0.3;
      skyR = lerp(0.6, 0.55, p); skyG = lerp(0.5, 0.65, p); skyB = lerp(0.7, 0.85, p);
      sunInt = 1.2; ambInt = 0.5;
      fogD = lerp(0.018, 0.012, p);
      this.sunLight.diffuse.set(1, 0.95, 0.8);
    } else if (t < 0.55) { // dusk
      const p = (t - 0.4) / 0.15;
      skyR = lerp(0.55, 0.35, p); skyG = lerp(0.65, 0.2, p); skyB = lerp(0.85, 0.2, p);
      sunInt = lerp(1.2, 0.2, p); ambInt = lerp(0.5, 0.15, p);
      fogD = lerp(0.012, 0.03, p);
      this.sunLight.diffuse.set(lerp(1, 1, p), lerp(0.95, 0.4, p), lerp(0.8, 0.2, p));
    } else { // night
      const p = Math.min(1, (t - 0.55) / 0.2);
      skyR = lerp(0.35, 0.02, p); skyG = lerp(0.2, 0.03, p); skyB = lerp(0.2, 0.06, p);
      sunInt = lerp(0.2, 0.0, p); ambInt = lerp(0.15, 0.06, p);
      fogD = lerp(0.03, 0.045, p);
      this.sunLight.diffuse.set(0.3, 0.3, 0.5);
    }

    this.scene.clearColor.set(skyR, skyG, skyB, 1);
    this.scene.fogColor.set(skyR * 0.8, skyG * 0.8, skyB * 0.8);
    this.scene.fogDensity = fogD;
    this.sunLight.intensity = sunInt;
    this.ambientLight.intensity = ambInt;
  }

  private updatePlayer(dt: number) {
    const cam = this.camera;
    const isSprinting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const canSprint = this.state.stamina > 5;
    const speed = PLAYER_SPEED * (isSprinting && canSprint ? SPRINT_MULT : 1) * dt;

    const fwd = new BABYLON.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new BABYLON.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let move = BABYLON.Vector3.Zero();

    if (this.keys["KeyW"] || this.keys["ArrowUp"]) move.addInPlace(fwd);
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) move.subtractInPlace(fwd);
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) move.addInPlace(right);
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) move.subtractInPlace(right);

    const moving = move.length() > 0.01;
    if (moving) {
      move.normalize().scaleInPlace(speed);
      cam.position.addInPlace(move);
      // Clamp to city
      cam.position.x = Math.max(-CITY_SIZE / 2 + 1, Math.min(CITY_SIZE / 2 - 1, cam.position.x));
      cam.position.z = Math.max(-CITY_SIZE / 2 + 1, Math.min(CITY_SIZE / 2 - 1, cam.position.z));

      // Footstep
      this.footstepTimer -= dt * 1000;
      if (this.footstepTimer <= 0) {
        sfx.footstep();
        this.footstepTimer = FOOTSTEP_INTERVAL / (isSprinting && canSprint ? 1.5 : 1);
      }
    }

    // Stamina
    if (isSprinting && canSprint && moving) {
      this.state.stamina = Math.max(0, this.state.stamina - STAMINA_DRAIN * dt);
    } else {
      this.state.stamina = Math.min(this.state.maxStamina, this.state.stamina + STAMINA_REGEN * dt);
    }

    // Keep camera at eye height
    if (cam.position.y < 1.8) cam.position.y = 1.8;
    if (cam.position.y > 2.5) cam.position.y = 2.5;
  }

  private updateShooting(dt: number) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    const weapon = this.state.weapons[this.state.activeWeaponIdx];
    if (!weapon) return;

    if (this.mouseDown && this.shootCooldown <= 0 && this.mouseLocked) {
      this.fireWeapon(weapon);
    }
  }

  private fireWeapon(weapon: Weapon) {
    if (weapon.ammo <= 0 && weapon.id !== "fists") {
      sfx.reload();
      return;
    }

    const cooldown = 1 / weapon.fireRate;
    this.shootCooldown = cooldown;

    if (weapon.id !== "fists") {
      weapon.ammo = Math.max(0, weapon.ammo - 1);
    }

    // Play sound
    if (weapon.id === "fists") sfx.punch();
    else if (weapon.id === "shotgun") sfx.shotgunBlast();
    else if (weapon.id === "rifle") sfx.rifleShot();
    else if (weapon.id === "molotov") sfx.molotov();
    else sfx.shoot();

    // Ray cast
    const cam = this.camera;
    const origin = cam.position.clone();
    const dir = cam.getForwardRay().direction.clone();

    const effectiveDamage = weapon.damage * (1 + weapon.upgradeLevel * 0.3) * this.state.difficulty;
    const effectiveRange = weapon.range * (1 + weapon.upgradeLevel * 0.15);

    // Shotgun: multiple pellets
    const pellets = weapon.id === "shotgun" ? 6 : 1;
    for (let p = 0; p < pellets; p++) {
      const spread = weapon.id === "shotgun" ? 0.08 : 0.01;
      const pd = dir.clone().addInPlace(new BABYLON.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
      )).normalize();

      // Check zombies
      for (const z of this.zombies) {
        if (z.dead) continue;
        const toZ = z.mesh.position.subtract(origin);
        const dist = toZ.length();
        if (dist > effectiveRange) continue;
        const dot = BABYLON.Vector3.Dot(toZ.normalize(), pd);
        if (dot < 0.97) continue; // ~14° cone

        const dmg = effectiveDamage / pellets;
        this.damageZombie(z, dmg, weapon.id === "molotov");
        break;
      }
    }

    // Muzzle flash effect (brief point light)
    const flash = new BABYLON.PointLight("flash", cam.position.clone().add(dir.scale(1.5)), this.scene);
    flash.intensity = 3;
    flash.range = 5;
    flash.diffuse = new BABYLON.Color3(1, 0.8, 0.4);
    setTimeout(() => flash.dispose(), 80);

    this.emit();
  }

  private damageZombie(z: ZombieAgent, dmg: number, setFire = false) {
    z.hp -= dmg;
    if (setFire) {
      z.onFire = true;
      z.fireTimer = 5;
      const fm = z.mesh.material as BABYLON.StandardMaterial;
      fm.emissiveColor = new BABYLON.Color3(0.8, 0.3, 0);
    }
    if (z.hp <= 0) {
      this.killZombie(z);
    } else {
      sfx.zombieGroan();
      // Flash red
      const m = z.mesh.material as BABYLON.StandardMaterial;
      const orig = m.diffuseColor.clone();
      m.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
      setTimeout(() => { if (!z.dead && !z.mesh.isDisposed()) m.diffuseColor = orig; }, 120);
    }
  }

  private killZombie(z: ZombieAgent) {
    if (z.dead) return;
    z.dead = true;
    sfx.zombieDie();

    // Score
    const pts = { walker: 10, runner: 20, brute: 50, spitter: 30 }[z.type];
    this.state.score += pts * Math.floor(this.state.difficulty);
    this.state.kills++;
    this.state.zombiesKilled++;

    // Death animation: sink into ground
    let sinkT = 0;
    const startY = z.mesh.position.y;
    const sinkObs = this.scene.onBeforeRenderObservable.add(() => {
      sinkT += 0.03;
      if (z.mesh.isDisposed()) { this.scene.onBeforeRenderObservable.remove(sinkObs); return; }
      z.mesh.position.y = startY - sinkT * 2;
      z.mesh.scaling.y = Math.max(0.01, 1 - sinkT);
      if (sinkT >= 1) {
        this.scene.onBeforeRenderObservable.remove(sinkObs);
        z.mesh.dispose();
        // Random pickup drop
        if (Math.random() < 0.25) {
          const kind: Pickup["kind"] = Math.random() < 0.5 ? "ammo" : "medkit";
          this.spawnPickup(z.mesh.position.x, z.mesh.position.z, kind);
        }
      }
    });
  }

  private updateZombies(dt: number) {
    const playerPos = this.camera.position;
    this.groanTimer -= dt * 1000;
    if (this.groanTimer <= 0) {
      sfx.zombieGroan();
      this.groanTimer = ZOMBIE_GROAN_INTERVAL + Math.random() * 2000;
    }

    for (const z of this.zombies) {
      if (z.dead || z.mesh.isDisposed()) continue;

      // Fire damage
      if (z.onFire) {
        z.fireTimer -= dt;
        z.hp -= 15 * dt;
        if (z.fireTimer <= 0 || z.hp <= 0) {
          z.onFire = false;
          if (z.hp <= 0) { this.killZombie(z); continue; }
        }
      }

      const toPlayer = playerPos.subtract(z.mesh.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();

      // Move toward player
      if (dist > 0.8) {
        const spd = z.speed * this.state.difficulty * dt;
        const dir = toPlayer.normalize().scale(spd);
        z.mesh.position.addInPlace(dir);
        // Face player
        z.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        // Animate bob
        z.mesh.position.y = 0.8 + Math.sin(performance.now() * 0.005 * z.speed) * 0.1;
      }

      // Attack player
      if (dist < 1.5) {
        z.attackCooldown -= dt;
        if (z.attackCooldown <= 0) {
          z.attackCooldown = 1.2 / this.state.difficulty;
          this.state.health = Math.max(0, this.state.health - z.damage * this.state.difficulty);
          sfx.playerHurt();
          this.hurtFlash = 0.5;
          if (this.state.health <= 0) this.gameOver();
        }
      }
    }

    // Clean dead
    this.zombies = this.zombies.filter(z => !z.dead || !z.mesh.isDisposed());
  }

  private updatePickups() {
    const playerPos = this.camera.position;
    for (const p of this.pickups) {
      if (p.collected || p.mesh.isDisposed()) continue;
      const dist = BABYLON.Vector3.Distance(playerPos, p.mesh.position);
      if (dist < 1.5) {
        this.collectPickup(p);
      }
    }
    this.pickups = this.pickups.filter(p => !p.collected);
  }

  private collectPickup(p: Pickup) {
    p.collected = true;
    sfx.pickup();
    p.mesh.dispose();

    if (p.kind === "medkit") {
      const heal = 30;
      this.state.health = Math.min(this.state.maxHealth, this.state.health + heal);
      this.pickupFlash = 1.5;
      this.pickupFlashText = `+${heal} Health`;
    } else if (p.kind === "ammo") {
      const weapon = this.state.weapons[this.state.activeWeaponIdx];
      if (weapon && weapon.id !== "fists") {
        const add = Math.floor(weapon.maxAmmo * 0.3);
        weapon.ammo = Math.min(weapon.maxAmmo, weapon.ammo + add);
        this.pickupFlash = 1.5;
        this.pickupFlashText = `+${add} Ammo`;
      }
      this.state.ammoPickups++;
    } else if (p.kind === "supply") {
      this.state.score += 50;
      const m = this.state.missions.find(m => m.id === "collectSupplies");
      if (m && m.status === "active") m.progress++;
      this.pickupFlash = 1.5;
      this.pickupFlashText = "+50 Score";
    } else if (p.kind === "weapon" && p.weaponId) {
      this.giveWeapon(p.weaponId);
      this.pickupFlash = 2;
      this.pickupFlashText = `Found ${p.weaponId}!`;
    }
  }

  private giveWeapon(id: string) {
    const def = ALL_WEAPONS[id as keyof typeof ALL_WEAPONS];
    if (!def) return;
    const existing = this.state.weapons.find(w => w.id === def.id);
    if (existing) {
      existing.ammo = Math.min(existing.maxAmmo, existing.ammo + Math.floor(existing.maxAmmo * 0.5));
      return;
    }
    this.state.weapons.push({ ...def, ammo: Math.floor(def.maxAmmo * 0.4), upgradeLevel: 0 });
  }

  private updateWave(dt: number) {
    const aliveZombies = this.zombies.filter(z => !z.dead && !z.mesh.isDisposed()).length;

    // Spawn zombies for current wave
    if (this.waveSpawnCount < this.waveSpawnTotal) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0 && aliveZombies < MAX_ZOMBIES) {
        this.waveSpawnTimer = this.waveSpawnInterval;
        this.spawnZombie();
        this.waveSpawnCount++;
      }
    }

    // Wave cleared
    if (this.waveSpawnCount >= this.waveSpawnTotal && aliveZombies === 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.nextWave();
      }
    }
  }

  private nextWave() {
    this.state.wave++;
    this.waveTimer = 5; // 5s break
    const base = 5 + this.state.wave * 3;
    this.waveSpawnTotal = Math.floor(base * this.state.difficulty);
    this.waveSpawnCount = 0;
    this.waveSpawnInterval = Math.max(0.5, 2.5 - this.state.wave * 0.15);
    sfx.waveStart();

    // Update survive mission
    const m = this.state.missions.find(m => m.id === "survive3waves");
    if (m && m.status === "active") m.progress = this.state.wave - 1;

    // Spawn extra pickups every 3 waves
    if (this.state.wave % 3 === 0) {
      const rng = Math.random;
      this.spawnPickup((rng() - 0.5) * 40, (rng() - 0.5) * 40, "supply");
      this.spawnPickup((rng() - 0.5) * 40, (rng() - 0.5) * 40, "ammo");
      if (this.state.wave === 6) this.spawnPickup((rng() - 0.5) * 30, (rng() - 0.5) * 30, "weapon", "rifle");
      if (this.state.wave === 9) this.spawnPickup((rng() - 0.5) * 30, (rng() - 0.5) * 30, "weapon", "molotov");
    }
  }

  private spawnZombie() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 20;
    const x = this.camera.position.x + Math.cos(angle) * dist;
    const z = this.camera.position.z + Math.sin(angle) * dist;
    const cx = Math.max(-CITY_SIZE / 2 + 2, Math.min(CITY_SIZE / 2 - 2, x));
    const cz = Math.max(-CITY_SIZE / 2 + 2, Math.min(CITY_SIZE / 2 - 2, z));

    // Type based on wave
    let type: ZombieType = "walker";
    const r = Math.random();
    if (this.state.wave >= 3 && r < 0.2) type = "runner";
    if (this.state.wave >= 5 && r < 0.1) type = "brute";
    if (this.state.wave >= 7 && r < 0.08) type = "spitter";

    const configs: Record<ZombieType, { hp: number; speed: number; damage: number; color: [number, number, number]; h: number }> = {
      walker: { hp: 60,  speed: 2.5, damage: 10, color: [0.3, 0.45, 0.3],  h: 1.6 },
      runner: { hp: 40,  speed: 5.5, damage: 8,  color: [0.5, 0.35, 0.2],  h: 1.5 },
      brute:  { hp: 200, speed: 1.5, damage: 25, color: [0.4, 0.25, 0.25], h: 2.0 },
      spitter:{ hp: 50,  speed: 2.0, damage: 12, color: [0.25, 0.45, 0.25],h: 1.6 },
    };
    const cfg = configs[type];
    const hpScale = 1 + (this.state.wave - 1) * 0.15;

    const mesh = BABYLON.MeshBuilder.CreateBox(`zombie_${type}_${Date.now()}`, {
      width: type === "brute" ? 1.0 : 0.7,
      height: cfg.h,
      depth: type === "brute" ? 0.8 : 0.5,
    }, this.scene);
    mesh.position.set(cx, cfg.h / 2, cz);

    const m = new BABYLON.StandardMaterial(`zm_${Date.now()}`, this.scene);
    m.diffuseColor = new BABYLON.Color3(...cfg.color);
    mesh.material = m;
    this.shadowGenerator.addShadowCaster(mesh);

    // Head
    const head = BABYLON.MeshBuilder.CreateSphere(`head_${Date.now()}`, { diameter: type === "brute" ? 0.55 : 0.4 }, this.scene);
    head.parent = mesh;
    head.position.y = cfg.h / 2 + 0.25;
    const hm = new BABYLON.StandardMaterial(`hm_${Date.now()}`, this.scene);
    hm.diffuseColor = new BABYLON.Color3(cfg.color[0] * 0.8, cfg.color[1] * 0.8, cfg.color[2] * 0.8);
    head.material = hm;

    // Glowing eyes
    const eyeL = BABYLON.MeshBuilder.CreateSphere(`eyeL_${Date.now()}`, { diameter: 0.08 }, this.scene);
    eyeL.parent = head;
    eyeL.position.set(-0.1, 0.02, 0.18);
    const eyeR = eyeL.clone(`eyeR_${Date.now()}`);
    eyeR.position.set(0.1, 0.02, 0.18);
    const em = new BABYLON.StandardMaterial(`em_${Date.now()}`, this.scene);
    em.emissiveColor = type === "runner"
      ? new BABYLON.Color3(1, 0.3, 0)
      : type === "brute"
        ? new BABYLON.Color3(1, 0, 0)
        : new BABYLON.Color3(0.8, 1, 0.2);
    eyeL.material = em;
    eyeR.material = em;

    this.zombies.push({
      mesh,
      hp: cfg.hp * hpScale,
      maxHp: cfg.hp * hpScale,
      type,
      speed: cfg.speed,
      damage: cfg.damage,
      attackCooldown: 0,
      groanTimer: Math.random() * 3000,
      dead: false,
      onFire: false,
      fireTimer: 0,
    });
  }

  private updateMissions() {
    // Kill mission
    const killM = this.state.missions.find(m => m.id === "kill10");
    if (killM && killM.status === "active") {
      killM.progress = this.state.kills;
      if (killM.progress >= killM.goal) {
        killM.status = "complete";
        this.state.score += 200;
        this.missionNotifyText = "✅ Mission Complete: First Blood!";
        this.missionNotifyTimer = 4;
        sfx.missionComplete();
      }
    }

    // Survive mission
    const survM = this.state.missions.find(m => m.id === "survive3waves");
    if (survM && survM.status === "active") {
      if (survM.progress >= survM.goal) {
        survM.status = "complete";
        this.state.score += 300;
        this.missionNotifyText = "✅ Mission Complete: Survivor!";
        this.missionNotifyTimer = 4;
        sfx.missionComplete();
        // Give shotgun reward
        this.giveWeapon("shotgun");
      }
    }

    // Supply mission
    const supM = this.state.missions.find(m => m.id === "collectSupplies");
    if (supM && supM.status === "active") {
      if (supM.progress >= supM.goal) {
        supM.status = "complete";
        this.state.score += 250;
        this.missionNotifyText = "✅ Mission Complete: Scavenger!";
        this.missionNotifyTimer = 4;
        sfx.missionComplete();
      }
    }
  }

  private updateTimers(dt: number) {
    if (this.missionNotifyTimer > 0) this.missionNotifyTimer -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt * 2;
    if (this.pickupFlash > 0) this.pickupFlash -= dt;
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  startGame() {
    const hs = this.state.highScore;
    this.state = createInitialState(hs);
    this.state.phase = "playing";

    // Reset camera
    this.camera.position.set(0, 1.8, 0);
    this.camera.rotation.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;

    // Clear zombies
    for (const z of this.zombies) { if (!z.mesh.isDisposed()) z.mesh.dispose(); }
    this.zombies = [];

    // Clear pickups
    for (const p of this.pickups) { if (!p.mesh.isDisposed()) p.mesh.dispose(); }
    this.pickups = [];

    // Reset wave
    this.waveSpawnTotal = 8;
    this.waveSpawnCount = 0;
    this.waveSpawnInterval = 2.5;
    this.waveSpawnTimer = 1;
    this.waveTimer = 5;
    this.dayTimer = 0;

    // Re-spawn pickups
    this.spawnInitialPickups();

    this.emit();
  }

  togglePause() {
    if (this.state.phase === "playing") {
      this.state.phase = "paused";
      document.exitPointerLock();
    } else if (this.state.phase === "paused") {
      this.state.phase = "playing";
    }
    this.emit();
  }

  resumeGame() {
    this.state.phase = "playing";
    this.emit();
  }

  gameOver() {
    this.state.phase = "gameover";
    if (this.state.score > this.state.highScore) {
      this.state.highScore = this.state.score;
      localStorage.setItem("zombie_highscore", String(this.state.score));
    }
    document.exitPointerLock();
    sfx.gameOver();
    this.emit();
  }

  switchWeapon(idx: number) {
    if (idx < this.state.weapons.length) {
      this.state.activeWeaponIdx = idx;
      this.emit();
    }
  }

  reload() {
    const w = this.state.weapons[this.state.activeWeaponIdx];
    if (!w || w.id === "fists") return;
    const inv = this.state.inventory.find(i => i.id === "ammo");
    if (inv && inv.count > 0) {
      const need = w.maxAmmo - w.ammo;
      const give = Math.min(need, Math.floor(w.maxAmmo * 0.5));
      w.ammo = Math.min(w.maxAmmo, w.ammo + give);
      inv.count--;
      if (inv.count <= 0) this.state.inventory = this.state.inventory.filter(i => i.id !== "ammo");
      sfx.reload();
      this.emit();
    }
  }

  useMedkit() {
    const inv = this.state.inventory.find(i => i.id === "medkit");
    if (inv && inv.count > 0 && this.state.health < this.state.maxHealth) {
      this.state.health = Math.min(this.state.maxHealth, this.state.health + 50);
      inv.count--;
      if (inv.count <= 0) this.state.inventory = this.state.inventory.filter(i => i.id !== "medkit");
      sfx.pickup();
      this.pickupFlash = 1.5;
      this.pickupFlashText = "+50 Health";
      this.emit();
    }
  }

  useAmmoBox() {
    const w = this.state.weapons[this.state.activeWeaponIdx];
    if (!w || w.id === "fists") return;
    const inv = this.state.inventory.find(i => i.id === "ammo");
    if (inv && inv.count > 0) {
      const add = Math.floor(w.maxAmmo * 0.4);
      w.ammo = Math.min(w.maxAmmo, w.ammo + add);
      inv.count--;
      if (inv.count <= 0) this.state.inventory = this.state.inventory.filter(i => i.id !== "ammo");
      sfx.reload();
      this.pickupFlash = 1.5;
      this.pickupFlashText = `+${add} Ammo`;
      this.emit();
    }
  }

  upgradeWeapon() {
    const w = this.state.weapons[this.state.activeWeaponIdx];
    if (!w || w.upgradeLevel >= 3) return;
    const cost = (w.upgradeLevel + 1) * 150;
    if (this.state.score >= cost) {
      this.state.score -= cost;
      w.upgradeLevel++;
      sfx.missionComplete();
      this.pickupFlash = 2;
      this.pickupFlashText = `${w.name} Upgraded to Lvl ${w.upgradeLevel}!`;
      this.emit();
    }
  }

  getHurtFlash() { return this.hurtFlash; }
  getPickupFlash() { return this.pickupFlash; }
  getPickupFlashText() { return this.pickupFlashText; }
  getMissionNotify() { return { text: this.missionNotifyText, timer: this.missionNotifyTimer }; }
  getState() { return this.state; }

  dispose() {
    this.engine.dispose();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  private seededRng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  private emit() {
    this.onStateChange({ ...this.state });
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
