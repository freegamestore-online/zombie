import { useRef, useEffect, useState, useCallback } from "react";
import { Shell } from "./components/Shell";
import { HUD } from "./components/HUD";
import { ZombieGame } from "./lib/game";
import { initAudio, setMuted, isMuted } from "./lib/audio";
import type { GameState } from "./lib/types";
import { createInitialState } from "./lib/types";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ZombieGame | null>(null);

  const savedHs = parseInt(localStorage.getItem("zombie_highscore") ?? "0", 10) || 0;
  const [gameState, setGameState] = useState<GameState>(() => createInitialState(savedHs));
  const [muted, setMutedState] = useState(true);
  const [showInventory, setShowInventory] = useState(false);

  // HUD reactive values — polled from game engine each frame
  const [hurtFlash, setHurtFlash] = useState(0);
  const [pickupFlash, setPickupFlash] = useState(0);
  const [pickupFlashText, setPickupFlashText] = useState("");
  const [missionNotify, setMissionNotify] = useState({ text: "", timer: 0 });

  // Poll game engine for flash values at ~20fps
  useEffect(() => {
    const id = setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      setHurtFlash(g.getHurtFlash());
      setPickupFlash(g.getPickupFlash());
      setPickupFlashText(g.getPickupFlashText());
      setMissionNotify({ ...g.getMissionNotify() });
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Mount Babylon engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initAudio();

    const game = new ZombieGame(canvas, savedHs, (s) => {
      setGameState({ ...s });
    });
    gameRef.current = game;

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = useCallback(() => {
    initAudio();
    setMuted(false);
    setMutedState(false);
    gameRef.current?.startGame();
  }, []);

  const handleResume = useCallback(() => {
    gameRef.current?.resumeGame();
  }, []);

  const handleRestart = useCallback(() => {
    gameRef.current?.startGame();
  }, []);

  const handleToggleMuted = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const handleSwitchWeapon = useCallback((i: number) => {
    gameRef.current?.switchWeapon(i);
  }, []);

  const handleUseMedkit = useCallback(() => {
    gameRef.current?.useMedkit();
    setShowInventory(false);
  }, []);

  const handleUseAmmoBox = useCallback(() => {
    gameRef.current?.useAmmoBox();
    setShowInventory(false);
  }, []);

  const handleUpgrade = useCallback(() => {
    gameRef.current?.upgradeWeapon();
  }, []);

  return (
    <Shell>
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          tabIndex={0}
        />
        <HUD
          state={gameState}
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
