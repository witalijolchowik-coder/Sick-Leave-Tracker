import LockRoundedIcon from "@mui/icons-material/LockRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const authErrorMessage = (code) => {
  const messages = {
    "auth/invalid-credential": "Nieprawidłowy adres e-mail lub hasło.",
    "auth/invalid-email": "Podaj prawidłowy adres e-mail.",
    "auth/too-many-requests": "Zbyt wiele prób. Spróbuj ponownie później.",
    "auth/user-disabled": "To konto zostało wyłączone.",
  };
  return messages[code] || "Nie udało się zalogować. Spróbuj ponownie.";
};

export function LoginPage() {
  const { user, authLoading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!authLoading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (authError) {
      setError(authErrorMessage(authError.code));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 5,
      }}
    >
      <Paper
        elevation={24}
        sx={{
          width: "100%",
          maxWidth: 440,
          p: { xs: 3, sm: 5 },
          borderRadius: 5,
          bgcolor: "rgba(23,28,42,.94)",
          boxShadow: "0 30px 80px rgba(0,0,0,.38)",
        }}
      >
        <Stack spacing={3}>
          <Stack alignItems="center" spacing={1.5}>
            <Avatar
              sx={{
                width: 60,
                height: 60,
                bgcolor: "primary.main",
                backgroundImage: "linear-gradient(145deg,#7C8CFF,#9B72F5)",
                boxShadow: "0 18px 36px rgba(124,140,255,.25)",
              }}
            >
              <ShieldRoundedIcon fontSize="large" />
            </Avatar>
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h4">SickLeave PRO</Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>
                Zaloguj się, aby otworzyć monitoring zwolnień.
              </Typography>
            </Box>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}

          <Stack component="form" spacing={2} onSubmit={handleSubmit}>
            <TextField
              label="Adres e-mail"
              type="email"
              autoComplete="email"
              autoFocus
              required
              fullWidth
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Hasło"
              type="password"
              autoComplete="current-password"
              required
              fullWidth
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              startIcon={
                submitting ? <CircularProgress size={18} color="inherit" /> : <LockRoundedIcon />
              }
              sx={{ minHeight: 50 }}
            >
              {submitting ? "Logowanie…" : "Zaloguj się"}
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" textAlign="center">
            Dostęp wyłącznie dla autoryzowanych użytkowników.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
