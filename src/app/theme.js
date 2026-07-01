import { alpha, createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#7C8CFF", light: "#A7B0FF", dark: "#5363E8" },
    secondary: { main: "#27D3A2" },
    background: { default: "#0C0F19", paper: "#171C2A" },
    text: { primary: "#F6F7FC", secondary: "#98A3B8" },
    error: { main: "#FF6B7A" },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Segoe UI", Inter, system-ui, sans-serif',
    h4: { fontWeight: 800, letterSpacing: "-0.04em" },
    h6: { fontWeight: 750, letterSpacing: "-0.02em" },
    button: { fontWeight: 750, textTransform: "none" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          minWidth: 320,
          backgroundImage:
            "radial-gradient(circle at 15% 0%, rgba(124,140,255,.12), transparent 32rem)",
          backgroundAttachment: "fixed",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: "none",
          border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
        }),
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 11, minHeight: 42 },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
    },
  },
});
