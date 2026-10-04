// 手柄支持：轮询 Gamepad API，把按键 / 摇杆映射成高层动作。
// 标准 Gamepad API 按键索引（Xbox 布局，PlayStation 位置对应）。
import { useEffect, useRef, useState } from "react";

export type GamepadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "menu"
  | "prev"
  | "next";

/** 离散按键（按下沿触发一次） */
const BUTTON_ACTIONS: Record<number, GamepadAction> = {
  0: "confirm", // A / ✕
  1: "back", // B / ○
  4: "prev", // LB / L1
  5: "next", // RB / R1
  8: "menu", // Select / View
  9: "menu", // Start / Menu
};

/** 十字键（长按重复） */
const DPAD_ACTIONS: Record<number, GamepadAction> = {
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

const AXIS_DEADZONE = 0.5;
const REPEAT_FIRST_MS = 380; // 长按后首次重复的延迟
const REPEAT_EVERY_MS = 110; // 之后的重复间隔

function dirFromPad(pad: Gamepad): GamepadAction | null {
  for (const [idx, action] of Object.entries(DPAD_ACTIONS)) {
    if (pad.buttons[Number(idx)]?.pressed) return action;
  }
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (ay < -AXIS_DEADZONE) return "up";
  if (ay > AXIS_DEADZONE) return "down";
  if (ax < -AXIS_DEADZONE) return "left";
  if (ax > AXIS_DEADZONE) return "right";
  return null;
}

/**
 * 监听手柄输入并回调高层动作。返回是否已连接手柄。
 * onAction 用 ref 持有，调用方无需 useCallback。
 */
export function useGamepad(onAction: (a: GamepadAction) => void): boolean {
  const cbRef = useRef(onAction);
  cbRef.current = onAction;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;

    let raf = 0;
    let connectedNow = false;
    let prevButtons: boolean[] = [];
    let heldDir: GamepadAction | null = null;
    let nextRepeat = 0;

    const poll = () => {
      const pad = Array.from(navigator.getGamepads()).find((p): p is Gamepad => !!p);
      if (pad) {
        if (!connectedNow) {
          connectedNow = true;
          setConnected(true);
        }
        const now = performance.now();

        // 离散按键（边沿触发）
        for (const [idxStr, action] of Object.entries(BUTTON_ACTIONS)) {
          const idx = Number(idxStr);
          const pressed = pad.buttons[idx]?.pressed ?? false;
          if (pressed && !prevButtons[idx]) cbRef.current(action);
          prevButtons[idx] = pressed;
        }

        // 方向（长按重复）
        const dir = dirFromPad(pad);
        if (dir) {
          if (dir !== heldDir) {
            heldDir = dir;
            nextRepeat = now + REPEAT_FIRST_MS;
            cbRef.current(dir);
          } else if (now >= nextRepeat) {
            nextRepeat = now + REPEAT_EVERY_MS;
            cbRef.current(dir);
          }
        } else {
          heldDir = null;
        }
      } else if (connectedNow) {
        connectedNow = false;
        setConnected(false);
        prevButtons = [];
        heldDir = null;
      }

      raf = requestAnimationFrame(poll);
    };

    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  return connected;
}
