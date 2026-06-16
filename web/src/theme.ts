import { createTheme } from "@mui/material/styles";

// Palette C · Blush & Slate (pastel, light)
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#c98a8a", contrastText: "#ffffff" },
    secondary: { main: "#8794a8" }, // slate accent
    background: { default: "#faf6f5", paper: "#ffffff" },
    text: { primary: "#54413f", secondary: "#7a5a5a" },
  },
  shape: { borderRadius: 14 },
  typography: { fontFamily: "Roboto, system-ui, sans-serif" },
});

export const GENDER_COLORS = {
  male: "#7e9bc4",
  female: "#d49db5",
} as const;

export const EDGE_COLOR = "#9aa8bd";
