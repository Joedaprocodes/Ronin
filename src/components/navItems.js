import {
  Inbox,
  Megaphone,
  Contact,
  ShieldCheck,
  Zap,
  Settings,
  LayoutGrid,
  CircleDashed,
} from "lucide-react";

/**
 * The main tab bar holds five top-level items. "Power" is a group: it has no
 * route of its own, only `children`, and opens a floating submenu with the
 * Broadcasts, Guards and Automation screens.
 */
export const NAV_ITEMS = [
  { to: "/inbox", id: "inbox", label: "Inbox", icon: Inbox },
  // { to: "/status", id: "status", label: "Status", icon: CircleDashed },
  { to: "/contacts", id: "contacts", label: "Contacts", icon: Contact },
  {
    id: "power",
    label: "Power",
    icon: LayoutGrid,
    children: [
      { to: "/broadcasts", id: "broadcasts", label: "Broadcasts", icon: Megaphone },
      { to: "/guards", id: "guards", label: "Guards", icon: ShieldCheck },
      { to: "/automation", id: "automation", label: "Automation", icon: Zap },
    ],
  },
  { to: "/settings", id: "settings", label: "Settings", icon: Settings },
];

/**
 * Every concrete route reachable from the tab bar (Power's children included).
 * The bar is shown only on these top-level routes; detail/editor screens keep
 * their own back arrow instead.
 */
export const NAV_ROUTES = NAV_ITEMS.flatMap((item) =>
  item.children ? item.children.map((child) => child.to) : [item.to]
);
