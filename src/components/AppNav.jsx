import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import useMeasure from "react-use-measure";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./navItems";

/**
 * The rows inside a group's floating submenu.
 */
const SubmenuContent = ({ items, pathname }) => (
  <div className="space-y-0.5 min-w-[210px] p-[6px] py-0.5">
    {items.map(({ to, id, label, icon: Icon }) => {
      const active = pathname === to;

      return (
        <NavLink
          key={id}
          to={to}
          className={cn(
            "group flex w-full items-center gap-3 px-3 py-2 text-[15px] rounded-[12px] transition-all duration-75",
            active
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <Icon
            size={20}
            className={cn(
              "transition-all duration-75",
              active
                ? "text-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          <span className="transition-all duration-75">{label}</span>
        </NavLink>
      );
    })}
  </div>
);

/**
 * Props:
 * - badges: optional counts per tab id, e.g. { inbox: 3 }
 * - position: "bottom" (centered pill, default) or "right" (one column,
 *   vertically centered on the right edge)
 *
 * A top-level item with `children` (Power) opens a floating submenu instead of
 * navigating; the others are plain links.
 */
const AppNav = ({ badges = {}, position = "bottom" }) => {
  const isRight = position === "right";
  const { pathname } = useLocation();
  const containerRef = useRef(null);
  const [menuRef, menuBounds] = useMeasure();
  // The open submenu plus the path it was opened on. If the route changes (a
  // child tapped, the back button, …) the stored path no longer matches and the
  // submenu closes on its own, so no route-syncing effect is needed.
  const [menu, setMenu] = useState(null);
  const openItem =
    menu && menu.path === pathname
      ? NAV_ITEMS.find((item) => item.id === menu.id)
      : null;
  const openId = openItem?.id ?? null;
  const submenu = openItem?.children ?? null;

  // Close on an outside click or Escape while the submenu is open.
  useEffect(() => {
    if (!openId) return;

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMenu(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openId]);

  const renderItem = ({ to, id, label, icon: Icon, children }) => {
    const count = badges[id];

    if (children) {
      const active = children.some((child) => pathname === child.to);
      const open = openId === id;

      return (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setMenu(openId === id ? null : { id, path: pathname })}
          className={cn(
            "relative p-3 rounded-[16px] transition-all cursor-pointer",
            active || open ? "bg-accent" : "hover:bg-muted"
          )}
        >
          <Icon
            size={22}
            className={cn(
              "transition-all",
              active || open ? "text-foreground" : "text-muted-foreground"
            )}
          />
        </button>
      );
    }

    return (
      <NavLink
        key={id}
        to={to}
        aria-label={label}
        title={label}
        className={({ isActive }) =>
          cn(
            "relative p-3 rounded-[16px] transition-all",
            isActive ? "bg-accent" : "hover:bg-muted"
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              size={22}
              className={cn(
                "transition-all",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            />
            {count > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-50",
        isRight
          ? "right-4 top-1/2 -translate-y-1/2"
          : "bottom-4 left-1/2 -translate-x-1/2"
      )}
    >
      {/* Hidden copy of the submenu, measured so the open animation can size to it */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] top-[-9999px] invisible pointer-events-none"
      >
        <div
          ref={menuRef}
          className="rounded-[18px] bg-background/95 border border-border py-1"
        >
          {submenu && <SubmenuContent items={submenu} pathname={pathname} />}
        </div>
      </div>

      {/* Animated submenu */}
      <AnimatePresence>
        {submenu && (
          <motion.div
            key="submenu"
            initial={{ opacity: 0, scaleY: 0.9, scaleX: 0.95, height: 0, width: 0 }}
            animate={{
              opacity: 1,
              scaleY: 1,
              scaleX: 1,
              height: menuBounds.height || "auto",
              width: menuBounds.width || "auto",
            }}
            exit={{ opacity: 0, scaleY: 0.9, scaleX: 0.95, height: 0, width: 0 }}
            transition={{ duration: 0.3, ease: [0.45, 0, 0.25, 1] }}
            style={{ transformOrigin: isRight ? "right center" : "bottom center" }}
            className={cn(
              "absolute overflow-hidden",
              isRight
                ? "right-[70px] top-1/2 -translate-y-1/2"
                : "bottom-[70px] left-1/2 -translate-x-1/2"
            )}
          >
            <div className="rounded-[18px] bg-background/95 backdrop-blur-xl border border-border">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={openId}
                  initial={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.95, filter: "blur(12px)" }}
                  transition={{ duration: 0.25, ease: [0.42, 0, 0.58, 1] }}
                  className="py-1"
                >
                  <SubmenuContent items={submenu} pathname={pathname} />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toolbar */}
      <nav
        aria-label="Main navigation"
        className={cn(
          "flex items-center gap-1 bg-background/95 backdrop-blur-xl border border-border rounded-[18px] p-1 z-10",
          isRight && "flex-col"
        )}
      >
        {NAV_ITEMS.map(renderItem)}
      </nav>
    </div>
  );
};

export default AppNav;
