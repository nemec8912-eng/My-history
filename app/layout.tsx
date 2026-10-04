import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { DriveBanner } from "@/components/DriveSection";

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
  themeColor: "#0f0d1c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        {children}
        <RegisterSW />
        <DriveBanner />
      </body>
    </html>
  );
}
