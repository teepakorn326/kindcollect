"use client";

import { createContext, useContext, useState } from "react";

/** Lets the allocation panel tell the stale banner "this change is ours" while a confirm is in flight. */
const OwnWriteContext = createContext<{ ownWrite: boolean; setOwnWrite: (v: boolean) => void }>({
  ownWrite: false,
  setOwnWrite: () => {},
});

export function OwnWriteProvider({ children }: { children: React.ReactNode }) {
  const [ownWrite, setOwnWrite] = useState(false);
  return <OwnWriteContext.Provider value={{ ownWrite, setOwnWrite }}>{children}</OwnWriteContext.Provider>;
}

export const useOwnWrite = () => useContext(OwnWriteContext);
