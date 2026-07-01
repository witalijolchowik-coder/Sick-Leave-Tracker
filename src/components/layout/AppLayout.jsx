import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={{
          backdropFilter: "blur(18px)",
          bgcolor: "rgba(12,15,25,.78)",
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <Toolbar sx={{ minHeight: 64 }}>
          <Container
            maxWidth="xl"
            disableGutters
            sx={{ display: "flex", alignItems: "center", gap: 2 }}
          >
            <Avatar
              variant="rounded"
              sx={{
                bgcolor: "primary.main",
                backgroundImage: "linear-gradient(145deg,#7C8CFF,#9B72F5)",
              }}
            >
              <ShieldRoundedIcon />
            </Avatar>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              SickLeave{" "}
              <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                PRO
              </Box>
            </Typography>
            <Tooltip title="Firebase Authentication i Firestore są skonfigurowane">
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<CloudDoneRoundedIcon />}
                label="Firebase"
                sx={{
                  height: 25,
                  display: { xs: "none", md: "flex" },
                  "& .MuiChip-label": { px: 0.8, fontSize: 11 },
                }}
              />
            </Tooltip>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={user?.email}
              sx={{ display: { xs: "none", sm: "flex" } }}
            />
            <Button
              color="inherit"
              startIcon={<LogoutRoundedIcon />}
              onClick={signOut}
              sx={{ color: "text.secondary" }}
            >
              Wyloguj
            </Button>
          </Container>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 2.25 } }}>
        <Outlet />
      </Container>
    </Box>
  );
}
