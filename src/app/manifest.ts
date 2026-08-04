import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sprig",
    short_name: "Sprig",
    description: "Plan and tend your garden beds.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f3e9",
    theme_color: "#225a35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
