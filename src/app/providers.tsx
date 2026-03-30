"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { TRPCProvider } from "@/trpc/react";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <TRPCProvider>{children}</TRPCProvider>
    </SessionProvider>
  );
}
