import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { DriveBanner } from "@/components/DriveSection";
import { OfflineBar } from "@/components/OfflineBar";
import { AppLock } from "@/components/AppLock";
import { SavePrompt } from "@/components/SavePrompt";

export const metadata: Metadata = {
  title: "Моя история",
  description: "Личный дневник поездок и воспоминаний",
  applicationName: "Моя история",
  appleWebApp: { capable: true, title: "Моя история", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0d14",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Замок Face ID: прячем содержимое ещё до первой отрисовки, чтобы записи не мелькнули на экране. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("app-lock-credential")&&!(Date.now()-Number(sessionStorage.getItem("app-lock-unlocked-at")||0)<${5 * 60_000}))document.documentElement.classList.add("applocked")}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <RegisterSW />
        <DriveBanner />
        <OfflineBar />
        <SavePrompt />
        <AppLock />
      </body>
    </html>
  );
}
