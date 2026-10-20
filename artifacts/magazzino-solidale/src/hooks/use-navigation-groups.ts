import { useEffect, useRef, useState } from "react";
import { navigationPath } from "@/lib/navigation-current";

/** Owned above the mobile Sheet; a new authenticated layout starts a session. */
export function useNavigationGroups(
  location: string,
  currentGroup: string | undefined,
  mapsPending: boolean,
) {
  const path = navigationPath(location);
  const [openGroups, setOpenGroups] = useState(
    () => new Set(currentGroup ? [currentGroup] : []),
  );
  const initial = useRef({
    path,
    pending: path === "/maps" && mapsPending,
    interacted: false,
    navigated: false,
  });
  useEffect(() => {
    const entry = initial.current;
    if (path !== entry.path) entry.navigated = true;
    if (!entry.pending || mapsPending) return;
    entry.pending = false;
    if (
      !entry.interacted &&
      !entry.navigated &&
      path === entry.path &&
      currentGroup
    ) {
      setOpenGroups(new Set([currentGroup]));
    }
  }, [path, currentGroup, mapsPending]);
  const changeGroup = (group: string, open: boolean) => {
    initial.current.interacted = true;
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (open) next.add(group);
      else next.delete(group);
      return next;
    });
  };
  return { openGroups, changeGroup };
}
