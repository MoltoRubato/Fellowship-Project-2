import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import Providers from "@/app/providers";

export const metadata: Metadata = {
  title: "Standup Bot",
  description: "Slack-native standup logging with GitHub and Linear sync",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
