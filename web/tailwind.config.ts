import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-outfit)", "Outfit", "sans-serif"],
      },
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        "on-brand": "rgb(var(--on-brand) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        mint: "rgb(var(--mint) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        star: "rgb(var(--star) / <alpha-value>)",
      },
      boxShadow: {
        sheet: "0 24px 60px rgb(18 60 50 / 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
