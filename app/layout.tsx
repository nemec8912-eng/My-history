import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { DriveBanner } from "@/components/DriveSection";
import { OfflineBar } from "@/components/OfflineBar";

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
    <html lang="ru">
      <body>
        {children}
        <RegisterSW />
        <DriveBanner />
        <OfflineBar />
      </body>
    </html>
  );
}
