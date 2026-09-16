import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MapGenerator — GPX Route Generator",
  description:
    "Generate custom GPX routes for trail running, road running, hiking, and cycling using OpenStreetMap data. Self-hosted, free, powered by BRouter and GraphHopper.",
  keywords: ["GPX", "route generator", "trail running", "hiking", "cycling", "BRouter", "GraphHopper", "OpenStreetMap"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
