module.exports = {
  presets: [require("@baraat/config/tailwind-preset")],
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "rgb(var(--surface) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        edge: "rgb(var(--edge) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        soft: "rgb(var(--soft) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
