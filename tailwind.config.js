/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", ".mode-dark"],
  corePlugins: {
    // Preserve custom CSS rules while unlocking full utility powers
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        dark: {
          surface: "#0d1117",
          card: "#161b22",
          cardHover: "#1c2129",
          border: "#30363d",
          muted: "#8b949e",
          text: "#f0f6fc",
        },
      },
      fontFamily: {
        sans: ["'DM Sans'", "'Inter'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        display: ["'Manrope'", "'DM Sans'", "sans-serif"],
      },
      boxShadow: {
        premium: "0 10px 30px -5px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        glow: "0 0 25px -5px rgba(99, 102, 241, 0.35)",
        glowSm: "0 0 15px -3px rgba(99, 102, 241, 0.25)",
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out forwards",
        "slide-up": "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "pulse-subtle": "pulseSubtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};
