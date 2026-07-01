import { CssBaseline, ThemeProvider } from "@mui/material";
import { HashRouter } from "react-router-dom";
import { AppRouter } from "./app/router";
import { appTheme } from "./app/theme";
import { AuthProvider } from "./contexts/AuthContext";

export default function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <HashRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </HashRouter>
    </ThemeProvider>
  );
}
