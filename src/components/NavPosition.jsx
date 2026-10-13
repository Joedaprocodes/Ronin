import { createContext, useContext, useEffect, useState } from "react";
import { PanelBottom, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/* Saved on this device: "bottom" | "right" */
const POSITION_KEY = "nav-position";
const NavPositionContext = createContext(null);

function getInitialPosition() {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved === "bottom" || saved === "right") return saved;
  } catch {
    // storage unavailable, use the default
  }
  return "bottom";
}

export function NavPositionProvider({ children }) {
  const [position, setPosition] = useState(getInitialPosition);

  useEffect(() => {
    try {
      localStorage.setItem(POSITION_KEY, position);
    } catch {
      // ignore: the choice still applies for this session
    }
  }, [position]);

  return (
    <NavPositionContext.Provider value={{ position, setPosition }}>
      {children}
    </NavPositionContext.Provider>
  );
}

export function useNavPosition() {
  const ctx = useContext(NavPositionContext);
  if (!ctx) {
    throw new Error("useNavPosition must be used inside <NavPositionProvider>");
  }
  return ctx;
}

/* Settings control: drop this inside any Card */
export function NavPositionSetting() {
  const { position, setPosition } = useNavPosition();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label className="flex-1">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Navigation position</span>
          <span className="text-xs font-normal text-muted-foreground">
            Show the menu along the bottom or in a centered column on the right.
          </span>
        </span>
      </Label>
      <div role="radiogroup" aria-label="Navigation position" className="flex gap-1">
        <Button
          type="button"
          role="radio"
          aria-checked={position === "bottom"}
          aria-label="Bottom bar"
          size="icon"
          variant={position === "bottom" ? "default" : "outline"}
          onClick={() => setPosition("bottom")}
        >
          <PanelBottom className="size-4" />
        </Button>
        <Button
          type="button"
          role="radio"
          aria-checked={position === "right"}
          aria-label="Right column"
          size="icon"
          variant={position === "right" ? "default" : "outline"}
          onClick={() => setPosition("right")}
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}