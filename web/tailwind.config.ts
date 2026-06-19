import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:      "#0f1115",
        panel:   "#161922",
        border:  "#2a2f3a",
        muted:   "#8a93a6",
        accent:  "#5eead4",
        ok:      "#10b981",
        warn:    "#f59e0b",
        bad:     "#ef4444",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
