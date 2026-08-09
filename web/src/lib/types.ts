// ─── Shared Types ────────────────────────────────────────────────────────────

export type GamePhase = "menu" | "playing" | "paused" | "gameover";

export type WeaponId = "fists" | "pistol" | "shotgun" | "rifle" | "molotov";
export type ZombieType = "walker" | "runner" | "brute" | "spitter";
export type MissionStatus = "active" | "complete" | "failed";

export interface Weapon {
  id: WeaponId;
  name: string;
  damage: number;
  range: number;
  fireRate: number; // shots per second
  ammo: number;
  maxAmmo: number;
  upgradeLevel: number; // 0–3
  icon: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  count: number;
  icon: string;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  status: MissionStatus;
  progress: number;
  goal: number;
}

export interface GameState {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  score: number;
  wave: number;
  day: number;
  timeOfDay: number; // 0–1 (0=dawn, 0.5=noon, 1=midnight)
  weapons: Weapon[];
  activeWeaponIdx: number;
  inventory: InventoryItem[];
  missions: Mission[];
  zombiesKilled: number;
  ammoPickups: number;
  highScore: number;
  kills: number;
  difficulty: number; // multiplier
}

export const INITIAL_WEAPONS: Weapon[] = [
  {
    id: "fists",
    name: "Fists",
    damage: 10,
    range: 1.5,
    fireRate: 1.5,
    ammo: Infinity,
    maxAmmo: Infinity,
    upgradeLevel: 0,
    icon: "👊",
  },
  {
    id: "pistol",
    name: "Pistol",
    damage: 35,
    range: 15,
    fireRate: 2,
    ammo: 30,
    maxAmmo: 120,
    upgradeLevel: 0,
    icon: "🔫",
  },
];

export const ALL_WEAPONS: Record<WeaponId, Omit<Weapon, "ammo" | "upgradeLevel">> = {
  fists: { id: "fists", name: "Fists", damage: 10, range: 1.5, fireRate: 1.5, maxAmmo: Infinity, icon: "👊" },
  pistol: { id: "pistol", name: "Pistol", damage: 35, range: 15, fireRate: 2, maxAmmo: 120, icon: "🔫" },
  shotgun: { id: "shotgun", name: "Shotgun", damage: 80, range: 8, fireRate: 0.8, maxAmmo: 50, icon: "💥" },
  rifle: { id: "rifle", name: "Assault Rifle", damage: 55, range: 25, fireRate: 5, maxAmmo: 180, icon: "🎯" },
  molotov: { id: "molotov", name: "Molotov", damage: 120, range: 12, fireRate: 0.4, maxAmmo: 8, icon: "🔥" },
};

export function createInitialState(highScore: number): GameState {
  return {
    phase: "menu",
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    score: 0,
    wave: 1,
    day: 1,
    timeOfDay: 0.15,
    weapons: JSON.parse(JSON.stringify(INITIAL_WEAPONS)) as Weapon[],
    activeWeaponIdx: 0,
    inventory: [
      { id: "medkit", name: "Medkit", count: 2, icon: "🩺" },
      { id: "ammo", name: "Ammo Box", count: 1, icon: "📦" },
    ],
    missions: [
      {
        id: "kill10",
        title: "First Blood",
        description: "Kill 10 zombies",
        status: "active",
        progress: 0,
        goal: 10,
      },
      {
        id: "survive3waves",
        title: "Survivor",
        description: "Survive 3 waves",
        status: "active",
        progress: 0,
        goal: 3,
      },
      {
        id: "collectSupplies",
        title: "Scavenger",
        description: "Collect 5 supply crates",
        status: "active",
        progress: 0,
        goal: 5,
      },
    ],
    zombiesKilled: 0,
    ammoPickups: 0,
    highScore,
    kills: 0,
    difficulty: 1,
  };
}
