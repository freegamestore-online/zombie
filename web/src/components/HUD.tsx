import type { GameState } from "../lib/types";

interface HUDProps {
  state: GameState;
  hurtFlash: number;
  pickupFlash: number;
  pickupFlashText: string;
  missionNotify: { text: string; timer: number };
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onToggleMuted: () => void;
  muted: boolean;
  showInventory: boolean;
  onToggleInventory: () => void;
  onUseMedkit: () => void;
  onUseAmmoBox: () => void;
  onUpgrade: () => void;
  onSwitchWeapon: (i: number) => void;
}

export function HUD({
  state,
  hurtFlash,
  pickupFlash,
  pickupFlashText,
  missionNotify,
  onStart,
  onResume,
  onRestart,
  onToggleMuted,
  muted,
  showInventory,
  onToggleInventory,
  onUseMedkit,
  onUseAmmoBox,
  onUpgrade,
  onSwitchWeapon,
}: HUDProps) {
  const { phase, health, maxHealth, stamina, score, wave, day, timeOfDay, weapons, activeWeaponIdx, inventory, missions, highScore, kills } = state;
  const activeWeapon = weapons[activeWeaponIdx];

  // Day/night label
  let timeLabel = "Dawn";
  if (timeOfDay > 0.1 && timeOfDay < 0.45) timeLabel = "Day";
  else if (timeOfDay >= 0.45 && timeOfDay < 0.55) timeLabel = "Dusk";
  else if (timeOfDay >= 0.55) timeLabel = "Night";

  const timeIcon = timeLabel === "Day" ? "☀️" : timeLabel === "Night" ? "🌙" : timeLabel === "Dusk" ? "🌆" : "🌅";

  // Upgrade cost
  const upgradeCost = activeWeapon ? (activeWeapon.upgradeLevel + 1) * 150 : 0;
  const canUpgrade = activeWeapon && activeWeapon.id !== "fists" && activeWeapon.upgradeLevel < 3 && score >= upgradeCost;

  if (phase === "menu") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 z-20 select-none">
        <div className="text-center px-6 max-w-lg">
          <h1 className="font-['Fraunces'] text-5xl md:text-7xl text-green-400 mb-2 drop-shadow-lg">ZOMBIE</h1>
          <p className="font-['Fraunces'] text-xl text-green-300 mb-1">City Survival</p>
          <p className="text-gray-400 text-sm mb-8">3D open-world zombie survival</p>

          <div className="bg-gray-900/80 border border-green-800 rounded-xl p-5 mb-6 text-left text-sm text-gray-300 space-y-1">
            <p className="text-green-400 font-bold mb-2">Controls</p>
            <p><span className="text-white font-semibold">WASD</span> — Move &nbsp; <span className="text-white font-semibold">Shift</span> — Sprint</p>
            <p><span className="text-white font-semibold">Mouse</span> — Look &nbsp; <span className="text-white font-semibold">Click</span> — Shoot</p>
            <p><span className="text-white font-semibold">1–4</span> — Switch Weapon &nbsp; <span className="text-white font-semibold">R</span> — Reload</p>
            <p><span className="text-white font-semibold">H</span> — Use Medkit &nbsp; <span className="text-white font-semibold">F</span> — Use Ammo Box</p>
            <p><span className="text-white font-semibold">U</span> — Upgrade Weapon &nbsp; <span className="text-white font-semibold">ESC</span> — Pause</p>
          </div>

          {highScore > 0 && (
            <p className="text-yellow-400 text-sm mb-4">🏆 Best Score: {highScore.toLocaleString()}</p>
          )}

          <button
            onClick={onStart}
            className="w-full py-4 bg-green-600 hover:bg-green-500 text-white text-xl font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-green-900"
          >
            🧟 Start Surviving
          </button>
          <button
            onClick={onToggleMuted}
            className="mt-3 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-all"
          >
            {muted ? "🔇 Sound Off" : "🔊 Sound On"} (click to toggle)
          </button>
        </div>
      </div>
    );
  }

  if (phase === "paused") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 z-20 select-none">
        <div className="text-center px-6 max-w-sm w-full">
          <h2 className="font-['Fraunces'] text-4xl text-white mb-6">Paused</h2>
          <div className="bg-gray-900/90 border border-gray-700 rounded-xl p-4 mb-4 text-sm text-gray-300 space-y-1">
            <p>Wave <span className="text-green-400 font-bold">{wave}</span> &nbsp;|&nbsp; Day <span className="text-yellow-400 font-bold">{day}</span></p>
            <p>Score <span className="text-white font-bold">{score.toLocaleString()}</span> &nbsp;|&nbsp; Kills <span className="text-red-400 font-bold">{kills}</span></p>
          </div>
          <button onClick={onResume} className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl mb-3 transition-all active:scale-95">
            ▶ Resume
          </button>
          <button onClick={onToggleMuted} className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl mb-3 transition-all text-sm">
            {muted ? "🔇 Sound Off" : "🔊 Sound On"}
          </button>
          <button onClick={onRestart} className="w-full py-2 bg-red-900/60 hover:bg-red-800 text-red-300 rounded-xl transition-all text-sm">
            🔄 Restart
          </button>
        </div>
      </div>
    );
  }

  if (phase === "gameover") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 select-none">
        <div className="text-center px-6 max-w-sm w-full">
          <h2 className="font-['Fraunces'] text-5xl text-red-500 mb-2">YOU DIED</h2>
          <p className="text-gray-400 text-sm mb-6">The city has fallen…</p>
          <div className="bg-gray-900/90 border border-red-900 rounded-xl p-4 mb-6 space-y-2 text-sm">
            <p className="text-gray-300">Final Score <span className="text-white font-bold text-lg">{score.toLocaleString()}</span></p>
            <p className="text-gray-300">Waves Survived <span className="text-green-400 font-bold">{wave}</span></p>
            <p className="text-gray-300">Days Survived <span className="text-yellow-400 font-bold">{day}</span></p>
            <p className="text-gray-300">Zombies Killed <span className="text-red-400 font-bold">{kills}</span></p>
            {score >= highScore && score > 0 && (
              <p className="text-yellow-400 font-bold">🏆 New High Score!</p>
            )}
            {score < highScore && (
              <p className="text-gray-400">Best: {highScore.toLocaleString()}</p>
            )}
          </div>
          <button onClick={onRestart} className="w-full py-4 bg-red-700 hover:bg-red-600 text-white font-bold text-xl rounded-xl transition-all active:scale-95 shadow-lg">
            🧟 Try Again
          </button>
          <button onClick={() => window.location.reload()} className="mt-3 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl text-sm transition-all">
            Main Menu
          </button>
        </div>
      </div>
    );
  }

  // ── Playing HUD ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hurt flash overlay */}
      {hurtFlash > 0 && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ background: `rgba(200,0,0,${Math.min(0.45, hurtFlash * 0.5)})` }}
        />
      )}

      {/* Pickup flash */}
      {pickupFlash > 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <p className="text-green-300 text-xl font-bold drop-shadow-lg" style={{ opacity: Math.min(1, pickupFlash) }}>
            {pickupFlashText}
          </p>
        </div>
      )}

      {/* Mission notification */}
      {missionNotify.timer > 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-black/70 border border-green-500 rounded-lg px-4 py-2 text-green-300 text-sm font-semibold">
            {missionNotify.text}
          </div>
        </div>
      )}

      {/* Crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="relative w-6 h-6">
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/70 -translate-y-1/2" />
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/70 -translate-x-1/2" />
          <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-white/90 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        </div>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between px-3 pt-2 z-10 pointer-events-none">
        {/* Left: Health + Stamina */}
        <div className="space-y-1 min-w-[140px]">
          <div className="flex items-center gap-2">
            <span className="text-red-400 text-xs">❤️</span>
            <div className="flex-1 h-3 bg-black/60 rounded-full overflow-hidden border border-red-900/50">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${(health / maxHealth) * 100}%`,
                  background: health > 60 ? "#22c55e" : health > 30 ? "#eab308" : "#ef4444",
                }}
              />
            </div>
            <span className="text-white text-xs font-bold w-8 text-right">{Math.ceil(health)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-xs">⚡</span>
            <div className="flex-1 h-2 bg-black/60 rounded-full overflow-hidden border border-blue-900/50">
              <div
                className="h-full bg-blue-400 rounded-full transition-all duration-100"
                style={{ width: `${(stamina / state.maxStamina) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Center: Wave + Day */}
        <div className="text-center">
          <div className="bg-black/60 border border-gray-700 rounded-lg px-3 py-1">
            <p className="text-green-400 font-bold text-sm">Wave {wave}</p>
            <p className="text-gray-400 text-xs">{timeIcon} {timeLabel} · Day {day}</p>
          </div>
        </div>

        {/* Right: Score */}
        <div className="text-right">
          <div className="bg-black/60 border border-gray-700 rounded-lg px-3 py-1">
            <p className="text-yellow-400 font-bold text-sm">{score.toLocaleString()}</p>
            <p className="text-gray-500 text-xs">🧟 {kills} kills</p>
          </div>
        </div>
      </div>

      {/* Bottom: Weapons + Inventory */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-3 pb-3 z-10 pointer-events-none">
        {/* Weapon slots */}
        <div className="flex gap-1">
          {weapons.map((w, i) => (
            <button
              key={w.id}
              onClick={() => onSwitchWeapon(i)}
              className={`pointer-events-auto flex flex-col items-center justify-center w-14 h-14 rounded-lg border text-xs transition-all ${
                i === activeWeaponIdx
                  ? "bg-green-900/80 border-green-500 shadow-lg shadow-green-900"
                  : "bg-black/60 border-gray-700 hover:border-gray-500"
              }`}
            >
              <span className="text-xl">{w.icon}</span>
              <span className="text-gray-400 text-[10px] leading-tight truncate w-full text-center px-0.5">{w.name}</span>
              {w.id !== "fists" && (
                <span className={`text-[10px] font-bold ${w.ammo === 0 ? "text-red-400" : "text-gray-300"}`}>
                  {w.ammo === Infinity ? "∞" : w.ammo}
                </span>
              )}
              {w.upgradeLevel > 0 && (
                <span className="text-yellow-400 text-[8px]">{"★".repeat(w.upgradeLevel)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Active weapon info + upgrade button */}
        {activeWeapon && (
          <div className="text-center">
            <div className="bg-black/70 border border-gray-700 rounded-lg px-3 py-1">
              <p className="text-white font-bold text-sm">{activeWeapon.icon} {activeWeapon.name}</p>
              {activeWeapon.id !== "fists" && (
                <p className="text-gray-400 text-xs">
                  {activeWeapon.ammo} / {activeWeapon.maxAmmo} ammo
                </p>
              )}
              {activeWeapon.upgradeLevel < 3 && activeWeapon.id !== "fists" && (
                <button
                  onClick={onUpgrade}
                  className={`pointer-events-auto mt-1 text-[10px] px-2 py-0.5 rounded transition-all ${
                    canUpgrade
                      ? "bg-yellow-700 hover:bg-yellow-600 text-yellow-100"
                      : "bg-gray-800 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  ⬆ Upgrade ({upgradeCost}pts)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Inventory */}
        <div className="flex flex-col items-end gap-1 pointer-events-auto">
          <button
            onClick={onToggleInventory}
            className="bg-black/60 border border-gray-700 hover:border-gray-500 rounded-lg px-2 py-1 text-xs text-gray-400 transition-all"
          >
            🎒 Bag
          </button>
          {showInventory && (
            <div className="bg-black/80 border border-gray-700 rounded-lg p-2 space-y-1">
              {inventory.length === 0 && <p className="text-gray-500 text-xs">Empty</p>}
              {inventory.map(item => (
                <button
                  key={item.id}
                  onClick={item.id === "medkit" ? onUseMedkit : onUseAmmoBox}
                  className="flex items-center gap-2 w-full text-left hover:bg-white/10 rounded px-2 py-1 transition-all"
                >
                  <span>{item.icon}</span>
                  <span className="text-gray-300 text-xs">{item.name}</span>
                  <span className="text-white text-xs font-bold ml-auto">×{item.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Missions sidebar */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none space-y-1 max-w-[180px]">
        {missions.map(m => (
          <div
            key={m.id}
            className={`bg-black/70 border rounded-lg px-2 py-1 text-xs ${
              m.status === "complete"
                ? "border-green-700 opacity-50"
                : m.status === "failed"
                  ? "border-red-900 opacity-40"
                  : "border-gray-700"
            }`}
          >
            <p className={`font-bold truncate ${m.status === "complete" ? "text-green-400 line-through" : "text-white"}`}>
              {m.status === "complete" ? "✅ " : "📋 "}{m.title}
            </p>
            {m.status === "active" && (
              <>
                <p className="text-gray-400 text-[10px] truncate">{m.description}</p>
                <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (m.progress / m.goal) * 100)}%` }}
                  />
                </div>
                <p className="text-gray-500 text-[10px] text-right">{Math.min(m.progress, m.goal)}/{m.goal}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Sound toggle */}
      <button
        onClick={onToggleMuted}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-black/50 border border-gray-700 hover:border-gray-500 rounded-full w-8 h-8 flex items-center justify-center text-sm transition-all"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* Click to aim prompt */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <p className="text-gray-500 text-xs">Click game to aim · ESC to pause</p>
      </div>
    </>
  );
}
